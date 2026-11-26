// Checks for the second bug-fix round: things that go wrong on a real night (a lost answer, a guest who leaves,
// a host who walks away). Local transport, audio muted. Usage: cd tests && npm run round2
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8767;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures.push(msg); };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  try {
    const ctx = await browser.newContext();
    // Lets a test swallow a phone's next few answers, as a bad connection would.
    await ctx.addInitScript(() => {
      const post = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (m) { if (m && m.event === 'answer' && window.__drop > 0) { window.__drop -= 1; return; } return post.call(this, m); };
    });
    const errors = [];
    const base = `http://localhost:${PORT}/`;
    const host = await ctx.newPage(); host.on('pageerror', (e) => errors.push(e.message));
    await host.setViewportSize({ width: 1280, height: 720 });
    await host.goto(`${base}host.html?transport=local&questions=tests/fixtures/test-questions.json`);
    await host.click('#btnStart'); await sleep(400);
    const code = (await host.textContent('#barCode')).trim();
    const names = () => host.evaluate(() => Object.values(window.__host.players).map((p) => p.name).sort().join(','));
    const join = async (slot, name) => {
      const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
      await p.setViewportSize({ width: 390, height: 780 });
      await p.goto(`${base}?room=${code}&transport=local&slot=${slot}`);
      if (name !== null) { await p.fill('#name', name); await p.click('button[type=submit]'); }
      return p;
    };

    // Join form says what is wrong instead of doing nothing.
    const a = await join(0, null);
    await a.fill('#name', '   '); await a.click('button[type=submit]'); await sleep(100);
    check(/Type a name/.test(await a.textContent('#screen')), 'a name of only spaces gets a message');
    await a.fill('#name', 'Ann'); await a.click('button[type=submit]');
    const b = await join(1, 'Louisa'); const c = await join(2, 'louisa'); let d = await join(3, 'Troll');
    await sleep(1200);
    check(await host.evaluate(() => Object.values(window.__host.players).filter((p) => p.bday).length) === 1, 'only one birthday rat, even with two Louisas');

    // Leaving the lobby leaves no empty seat behind.
    await c.click('#btnLeave'); await sleep(500);
    check(await names() === 'Ann,Louisa,Troll', `a guest who taps Leave is gone from the lobby (${await names()})`);

    // A removed guest stays out, even if their phone never heard about it.
    await d.close();
    host.once('dialog', (x) => x.accept());
    await host.click('.guest:has-text("Troll")'); await sleep(300);
    d = await join(3, null); await sleep(4000);
    check(await names() === 'Ann,Louisa', `a removed guest cannot walk back in (${await names()})`);

    // A lost answer is sent again until the big screen has it.
    await host.click('#btnGo'); await host.waitForSelector('#timer', { timeout: 20000 }); await sleep(400);
    await a.evaluate(() => { window.__drop = 2; });
    await a.click('.p-answer[data-i="0"]'); await sleep(500);
    check(await host.evaluate(() => Object.keys(window.__host.answers).length) === 0, 'the first sends are lost (simulated)');
    await sleep(3500);
    check(await host.evaluate(() => Object.keys(window.__host.answers).length) === 1, 'the phone resends until the answer arrives');

    // Someone walking in during the answer screen is welcomed, not told they were too slow.
    await host.click('#btnSkip'); await host.waitForSelector('.reveal'); 
    const late = await join(4, 'Late Lars'); await sleep(2500);
    check(/You.re in/.test(await late.textContent('#screen')), 'a guest who joins during the answers is welcomed');

    // Nobody answers: the quiz waits for the host instead of playing on by itself.
    await host.evaluate(() => { SQ.cfg.autoAdvanceSeconds = 1; });
    await host.click('#btnNext'); await sleep(600);
    const afterAuto = await host.waitForSelector('.intro', { timeout: 8000 }).then(() => true, () => false);
    check(afterAuto, 'the leaderboard still moves on by itself after a question people answered');
    await host.waitForSelector('#timer', { timeout: 20000 }); await sleep(300);
    await host.click('#btnSkip'); await host.waitForSelector('.reveal'); await sleep(3500);
    check(await host.evaluate(() => window.__host.phase) === 'reveal', 'a question nobody answered holds the screen');

    // Number question: holding the arrow runs the counter.
    await host.evaluate(() => { const S = window.__host; S.qi = S.questions.findIndex((q) => q.type === 'number') - 1; });
    await host.keyboard.press('p'); await sleep(200); await host.click('#btnNext'); await sleep(600); await host.click('#btnNext');
    await host.waitForSelector('#timer', { timeout: 20000 }); await sleep(400);
    const plus = await a.locator('#pPlus').boundingBox();
    await a.mouse.move(plus.x + 20, plus.y + 20); await a.mouse.down(); await sleep(900); await a.mouse.up();
    const held = Number(await a.textContent('#pVal'));
    check(held >= 5, `holding the arrow runs the counter (${held} after 0.9 s)`);
    await a.click('#pMinus');
    check(Number(await a.textContent('#pVal')) === held - 1, 'one tap is still one step');

    // After a refresh, the button that keeps the game is the main one, and a new party asks first.
    host.on('dialog', (x) => (x.type() === 'beforeunload' ? x.accept() : x.dismiss()));
    await host.reload(); await sleep(800);
    check(await host.evaluate(() => document.querySelector('#btnResume')?.classList.contains('primary')), 'after a refresh "Resume room" is the main button');
    await host.click('#btnStart'); await sleep(300);
    check(await host.evaluate(() => window.__host.phase) === 'title', 'starting a new party over a saved one asks first');

    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally { await browser.close(); server.close(); }
  console.log(`\n${failures.length ? failures.length + ' check(s) failed' : 'All checks passed'}.`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
