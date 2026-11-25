// End-to-end test: one host + three players play a full game in local transport mode
// (BroadcastChannel, no Supabase needed). Exits non-zero on failure.
// Usage: cd tests && npm install && npx playwright install chromium && npm test
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const PORT = 8765;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
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
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext();
  const errors = [];
  const watch = (p, tag) => {
    p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/vibrate/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
  };
  const base = `http://localhost:${PORT}/`;
  const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, name) });

  // Host
  const host = await ctx.newPage(); watch(host, 'host');
  await host.setViewportSize({ width: 1440, height: 900 });
  await host.goto(`${base}host.html?transport=local&questions=tests/fixtures/test-questions.json`);
  await sleep(800);
  await shot(host, '01-title.png');

  // Regression: avatars must render for any player id (a signed shift once broke ~40% of ids).
  const avatarErrors = await host.evaluate(() => { let bad = 0; for (let i = 0; i < 3000; i++) { try { SQ.avatar(SQ.uid()); SQ.playerRat(SQ.uid()); } catch (e) { bad++; } } return bad; });
  check(avatarErrors === 0, 'avatars render for 3000 random player ids');

  await host.click('#btnStart');
  await sleep(500);
  const code = (await host.textContent('#barCode')).trim();
  check(/^[A-Z]{4}$/.test(code), `room code created (${code})`);

  // Players (slot= gives each tab its own identity inside one browser)
  const names = ['Cheddar Chad', 'Brie Brie', 'Gouda Gal'];
  const players = [];
  for (let i = 0; i < names.length; i++) {
    const p = await ctx.newPage(); watch(p, `p${i}`);
    await p.setViewportSize({ width: 390, height: 780 });
    await p.goto(`${base}?room=${code}&transport=local&slot=${i}`);
    if (i === 0) await shot(p, 'p-00-join.png');
    await p.fill('#name', names[i]);
    await p.click('button[type=submit]');
    players.push(p);
  }
  await sleep(1500);
  const joined = await host.evaluate(() => Object.values(window.__host.players).map((x) => x.name).sort());
  check(JSON.stringify(joined) === JSON.stringify([...names].sort()), `all players joined the lobby (${joined.join(', ')})`);
  // Lobby easter egg: tapping your rat on the phone squeaks on the big screen.
  await players[0].click('#btnSqueak'); await sleep(300);
  check(await host.evaluate(() => window.__host.squeaks) === 1, 'tapping your rat in the lobby reaches the host');
  await shot(host, '02-lobby.png');
  await shot(players[0], 'p-01-lobby.png');

  // Play every question. p0 always right, p1 wrong except on multi-answer questions, p2 answers only even questions (right).
  const total = await host.evaluate(() => window.__host.questions.length);
  for (let qi = 0; qi < total; qi++) {
    await host.click('#btnGo, #btnNext');
    await sleep(900);
    await shot(host, `03-intro-q${qi}.png`);
    await host.waitForSelector('#timer', { timeout: 20000 });
    await sleep(600);
    await shot(host, `04-question-q${qi}.png`);
    await shot(players[0], `p-04-question-q${qi}.png`);
    const Q = await host.evaluate(() => { const q = window.__host.questions[window.__host.qi]; return { correct: q.correct, n: q.options.length }; });
    const wrong = [...Array(Q.n).keys()].find((i) => !Q.correct.includes(i));
    await players[0].click(`.p-answer[data-i="${Q.correct[0]}"]`);
    await sleep(250);
    await players[1].click(`.p-answer[data-i="${Q.correct.length > 1 ? Q.correct[Q.correct.length - 1] : wrong}"]`);
    if (qi % 2 === 0) { await sleep(250); await players[2].click(`.p-answer[data-i="${Q.correct[0]}"]`); }
    else { await sleep(300); await host.click('#btnSkip'); }
    await host.waitForSelector('.reveal', { timeout: 8000 });
    await sleep(2100); // the reveal holds the right answer back for a moment
    await shot(host, `05-reveal-q${qi}.png`);
    for (let i = 0; i < 3; i++) await shot(players[i], `p-05-reveal-q${qi}-p${i}.png`);
    await host.click('#btnNext');
    await sleep(2200);
    if (qi < total - 1) { await sleep(600); await shot(host, `06-leaderboard-q${qi}.png`); await shot(players[1], `p-06-leaderboard-q${qi}.png`); }
    if (qi === 1) {
      // Simulate an accidental refresh of the big screen and resume.
      host.on('dialog', (d) => d.accept());
      await host.reload(); await sleep(800);
      await host.click('#btnResume'); await sleep(1200);
      const st = await host.evaluate(() => ({ phase: window.__host.phase, players: Object.keys(window.__host.players).length }));
      check(st.phase === 'leaderboard' && st.players === 3, `host resumes after refresh (${st.phase}, ${st.players} players)`);
    }
  }
  await shot(players[0], 'p-07-podium-drumroll.png');
  await sleep(9500); // third, second, drumroll, first, then the awards
  await shot(host, '07-podium.png');
  for (let i = 0; i < 3; i++) await shot(players[i], `p-07-podium-p${i}.png`);

  const scores = await host.evaluate(() => Object.fromEntries(Object.values(window.__host.players).map((p) => [p.name, p.score])));
  console.log('      scores', JSON.stringify(scores));
  check(scores['Cheddar Chad'] > scores['Gouda Gal'] && scores['Gouda Gal'] > scores['Brie Brie'], 'ranking matches answers given');
  check(scores['Brie Brie'] > 0, 'multiple-correct question awards points for the second correct option');
  const chad = await host.evaluate(() => Object.values(window.__host.players).find((p) => p.name === 'Cheddar Chad'));
  check(chad.best === total && chad.score > total * 1000, `streak bonus and double final are counted (best streak ${chad.best}, ${chad.score} pts)`);

  await players[1].reload(); await sleep(1500);
  const rejoin = (await players[1].textContent('#screen')).replace(/\s+/g, ' ');
  check(/Final results/.test(rejoin), 'player rejoins automatically after reloading the page');

  // Regression: after "Play again" the same question numbers come round again; phones must be able to answer them.
  await host.click('#btnAgain'); await sleep(600);
  await host.click('#btnGo');
  await host.waitForSelector('#timer', { timeout: 20000 }); await sleep(500);
  const canAnswer = await players[0].locator('.p-answer').count();
  check(canAnswer > 0, `phones can answer again after "Play again" (${canAnswer} buttons)`);
  await players[0].click('.p-answer[data-i="0"]'); await sleep(400);
  check(await host.evaluate(() => Object.keys(window.__host.answers).length) === 1, 'the replayed answer reaches the host');
  // Easter egg: typing "rat" on the host keyboard sends rats running across the screen.
  await host.keyboard.type('rat'); await sleep(300);
  check(await host.locator('.egg-run').count() === 1, 'typing "rat" on the host starts the stampede');
  await shot(host, '08-stampede.png');

  check(errors.length === 0, `no page errors${errors.length ? ':\n  ' + errors.join('\n  ') : ''}`);
  await browser.close(); server.close();
  console.log(`\n${failures.length ? failures.length + ' check(s) failed' : 'All checks passed'}. Screenshots: tests/shots/`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
