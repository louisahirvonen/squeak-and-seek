// Layout check at party size: one host + 15 players (one of them the birthday rat) play the real questions.json
// in local transport mode. No assertions: it only takes screenshots (tests/shots/crowd-*.png) to look at.
// Usage: cd tests && npm run crowd
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const PORT = 8766;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
const NAMES = ['Louisa', 'Cheddar Chad', 'Brie Brie', 'Gouda Gal', 'Maximilian XV', 'Åsa', 'Jo', 'Parmesan Pelle', 'Feta Frida', 'Ost-Olle', 'Mozzarella M', 'Stilton Stina', 'Ricotta Rut', 'Halloumi Hugo', 'Camembert C'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const ctx = await browser.newContext();
  const base = `http://localhost:${PORT}/`;
  const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `crowd-${name}.png`) });
  const host = await ctx.newPage();
  host.on('pageerror', (e) => console.log('host error:', e.message));
  await host.setViewportSize({ width: Number(process.env.W) || 1440, height: Number(process.env.H) || 900 }); // W=1280 H=720 npm run crowd checks a small projector
  await host.goto(`${base}host.html?transport=local`);
  await host.click('#btnStart'); await sleep(400);
  const code = (await host.textContent('#barCode')).trim();
  const players = [];
  for (let i = 0; i < NAMES.length; i++) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(`p${i} error:`, e.message));
    await p.setViewportSize({ width: 390, height: 780 });
    await p.goto(`${base}?room=${code}&transport=local&slot=c${i}`);
    await p.fill('#name', NAMES[i]); await p.click('button[type=submit]');
    players.push(p);
  }
  await sleep(1500);
  await shot(host, '01-lobby');
  const total = await host.evaluate(() => window.__host.questions.length);
  for (let qi = 0; qi < total; qi++) {
    await host.click('#btnGo, #btnNext');
    await sleep(1200); await shot(host, `02-intro-q${qi}`);
    await host.waitForSelector('#timer', { timeout: 30000 }); await sleep(400);
    const Q = await host.evaluate(() => { const q = window.__host.questions[window.__host.qi]; return { correct: q.correct, n: q.options.length, type: q.type, min: q.min, max: q.max }; });
    if (Q.type === 'number') await shot(players[0], `p-03-number-q${qi}`);
    // Players answer in a different order each question; roughly two in three get it right; the last two stay silent.
    for (let j = 0; j < NAMES.length - 2; j++) {
      const i = (j * 7 + qi * 5) % NAMES.length;
      const right = (i + qi) % 3 !== 0;
      if (Q.type === 'number') {
        const target = right ? Q.correct[0] : Math.max(Q.min, Math.min(Q.max, Q.correct[0] + ((i % 5) - 2 || 3)));
        for (let v = Q.min; v < target; v++) await players[i].click('#pPlus').catch(() => {});
        await players[i].click('#pLock').catch(() => {});
      } else {
        const choice = right ? Q.correct[0] : [...Array(Q.n).keys()].find((x) => !Q.correct.includes(x));
        await players[i].click(`.p-answer[data-i="${choice}"]`).catch(() => {});
      }
      await sleep(120);
      if (j === 11) { await shot(host, `03-question-q${qi}`); await shot(players[(qi * 5 + 3) % NAMES.length], `p-03-question-q${qi}`); }
    }
    await host.click('#btnSkip');
    await host.waitForSelector('.reveal', { timeout: 8000 }); await sleep(2100);
    await shot(host, `04-reveal-q${qi}`); await shot(players[1], `p-04-reveal-q${qi}`);
    await host.click('#btnNext'); await sleep(3200);
    if (qi < total - 1) { await shot(host, `05-leaderboard-q${qi}`); await shot(players[2], `p-05-leaderboard-q${qi}`); }
  }
  await sleep(8000);
  await shot(host, '06-podium'); await shot(players[1], 'p-06-podium');
  await browser.close(); server.close();
  console.log('Screenshots: tests/shots/crowd-*.png');
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
