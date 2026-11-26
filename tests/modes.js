// Party modes with 15 players at small-projector size: majority votes (for a guest, and between fixed answers),
// reactions, and the betting round before the final question. Local transport, audio muted.
// Usage: cd tests && npm run modes   (screenshots: tests/shots/modes-*.png)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const PORT = 8769;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };
const NAMES = ['Louisa', 'Cheddar Chad', 'Brie Brie', 'Gouda Gal', 'Maximilian XV', 'Åsa', 'Jo', 'Parmesan Pelle', 'Feta Frida', 'Ost-Olle', 'Mozzarella M', 'Stilton Stina', 'Ricotta Rut', 'Halloumi Hugo', 'Camembert C'];
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
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  try {
    const ctx = await browser.newContext();
    const errors = [];
    const base = `http://localhost:${PORT}/`;
    const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `modes-${name}.png`) });
    const host = await ctx.newPage(); host.on('pageerror', (e) => errors.push('host: ' + e.message));
    await host.setViewportSize({ width: Number(process.env.W) || 1280, height: Number(process.env.H) || 720 });
    await host.goto(`${base}host.html?transport=local&questions=tests/fixtures/party-modes.json`);
    await host.click('#btnStart'); await sleep(400);
    const code = (await host.textContent('#barCode')).trim();
    const P = [];
    for (let i = 0; i < NAMES.length; i++) {
      const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(`p${i}: ${e.message}`));
      await p.setViewportSize({ width: 390, height: 780 });
      await p.goto(`${base}?room=${code}&transport=local&slot=m${i}`);
      await p.fill('#name', NAMES[i]); await p.click('button[type=submit]'); P.push(p);
    }
    await sleep(1500);
    const H = (fn) => host.evaluate(fn);
    const byName = (name) => host.evaluate((n) => { const S = window.__host; const id = Object.keys(S.players).find((k) => S.players[k].name === n); return { ...S.players[id], answer: S.answers[id], wager: S.wagers[id] }; }, name);
    const toQuestion = async () => { await host.waitForSelector('#timer', { timeout: 20000 }); await sleep(500); };
    const toReveal = async () => { await host.waitForSelector('.reveal', { timeout: 8000 }); await sleep(2000); };
    await H(() => { SQ.cfg.autoAdvanceSeconds = 0; });

    // Q1: everyone right except the last two.
    await host.click('#btnGo'); await toQuestion();
    for (let i = 0; i < 13; i++) await P[i].click('.p-answer[data-i="0"]');
    await P[13].click('.p-answer[data-i="1"]'); await P[14].click('.p-answer[data-i="1"]');
    await toReveal();

    // Reactions float up the big screen.
    check(await P[1].locator('#react').isVisible(), 'phones show the reaction buttons on the result screen');
    for (let i = 0; i < 8; i++) await P[i].click(`#react button[data-r="${i % 4}"]`);
    await sleep(700);
    const floating = await host.locator('.react').count();
    check(floating === 8, `reactions reach the big screen (${floating} of 8)`);
    await shot(host, '01-reactions'); await shot(P[1], 'p-01-reactions');
    await P[0].click('#react button[data-r="0"]'); await P[0].click('#react button[data-r="0"]'); await sleep(300);
    check(await host.locator('.react').count() === 9, 'a second tap straight away is not sent twice');
    await host.click('#btnNext'); await sleep(2500);

    // Q2: vote for a guest. Ten vote for Louisa, Louisa and three others vote for Jo, one stays silent.
    await host.click('#btnNext'); await sleep(1000); await shot(host, '02-vote-intro'); await toQuestion();
    check(await P[0].locator('.p-vote').count() === 14, 'a guest can vote for everyone except themselves');
    await shot(host, '03-vote-question'); await shot(P[0], 'p-03-vote');
    for (let i = 1; i <= 10; i++) await P[i].click('.p-vote:has-text("Louisa")');
    await shot(P[1], 'p-03-voted');
    for (const i of [0, 11, 12, 13]) await P[i].click('.p-vote:has-text("Jo")');
    await host.click('#btnSkip'); await toReveal();
    await shot(host, '04-vote-reveal'); await shot(P[1], 'p-04-vote-won'); await shot(P[11], 'p-04-vote-lost');
    const chad = await byName('Cheddar Chad'); const stina = await byName('Stilton Stina');
    check(chad.answer.correct && chad.answer.base === 1000 && chad.streak === 2, `voting with the majority scores 1000 and extends the streak (${chad.answer.points} pts, streak ${chad.streak})`);
    check(!stina.answer.correct && stina.answer.points === 0 && stina.streak === 1, `being outvoted gives nothing but keeps the streak (streak ${stina.streak})`);
    await host.click('#btnNext'); await sleep(2500);

    // Q3: vote between fixed answers, tied 5-5: both win.
    await host.click('#btnNext'); await toQuestion();
    for (let i = 0; i < 5; i++) await P[i].click('.p-answer[data-i="0"]');
    for (let i = 5; i < 10; i++) await P[i].click('.p-answer[data-i="2"]');
    await P[10].click('.p-answer[data-i="3"]');
    await host.click('#btnSkip'); await toReveal();
    await shot(host, '05-vote-fixed-reveal');
    check(JSON.stringify(await H(() => window.__host.questions[2].correct)) === '[0,2]', 'a tied vote lets both answers win');
    await host.click('#btnNext'); await sleep(2500);

    // A surprise dare: the wheel picks someone (never the birthday rat), they accept on their phone, the host says done.
    await host.click('#btnNext'); await sleep(1200); await shot(host, '05b-dare-intro'); await shot(P[5], 'p-05b-dare-intro');
    await host.waitForFunction(() => window.__host.phase === 'reveal' && window.__host.dare, null, { timeout: 15000 }); await sleep(2500);
    await shot(host, '05c-dare-spinning'); await shot(P[5], 'p-05c-dare-spinning');
    const onWheel = await H(() => window.__host.dare.list.map((p) => p.name));
    check(onWheel.length === 13 && !onWheel.includes('Louisa') && !onWheel.includes('Camembert C'), `the wheel holds everyone who is playing, except the birthday rat (${onWheel.length} names)`);
    check(!(await P[3].textContent('#screen')).includes(await H(() => window.__host.dare.name)), 'phones do not know who it is while the wheel turns');
    await host.waitForFunction(() => window.__host.dare.st === 'asked', null, { timeout: 15000 }); await sleep(1200);
    const who = await H(() => window.__host.dare.name); const wi = NAMES.indexOf(who); const other = wi === 5 ? 6 : 5;
    const pin = await host.evaluate(() => { const w = document.querySelector('#wheel').getBoundingClientRect(); const el = document.elementFromPoint(w.left + w.width / 2, w.top + 30); return el.closest('svg') ? [...document.querySelectorAll('#wheel text')].map((t) => { const r = t.getBoundingClientRect(); return { n: t.textContent, d: Math.hypot(r.left + r.width / 2 - (w.left + w.width / 2), r.top + r.height / 2 - (w.top + w.height * 0.2)) }; }).sort((x, y) => x.d - y.d)[0].n : ''; });
    check(who.startsWith(pin.replace('…', '')), `the wheel stops with the chosen name under the pin (${who})`);
    const whoBefore = (await byName(who)).score;
    await shot(host, '05d-dare-asked'); await shot(P[wi], 'p-05d-dare-you'); await shot(P[other], 'p-05d-dare-other');
    check(await P[wi].locator('#dareYes').count() === 1 && await P[other].locator('#dareYes').count() === 0, 'only the chosen rat is asked to accept the dare');
    await H(() => { SQ.cfg.autoAdvanceSeconds = 1; }); await sleep(2500);
    check(await H(() => window.__host.phase) === 'reveal', 'the screen waits for the judge instead of moving on');
    await H(() => { SQ.cfg.autoAdvanceSeconds = 0; });
    await P[wi].click('#dareYes'); await sleep(600);
    check(await H(() => window.__host.dare.st) === 'accepted', 'accepting on the phone reaches the big screen');
    await shot(P[wi], 'p-05e-dare-go');
    await host.click('#dareBox [data-st="done"]'); await sleep(700);
    const whoAfter = (await byName(who)).score;
    check(whoAfter === whoBefore + 1500, `a finished dare gives 1,500 points (${whoBefore} -> ${whoAfter})`);
    check((await byName('Cheddar Chad')).streak === 3, 'a dare leaves streaks alone');
    await shot(host, '05e-dare-done'); await shot(P[wi], 'p-05e-dare-done');
    // The wheel leans towards low scores and away from rats who already had a dare.
    const lean = await host.evaluate(() => {
      const list = [{ score: 9000 }, { score: 5000 }, { score: 1000 }, { score: 1000, dares: 1 }]; const n = [0, 0, 0, 0];
      for (let i = 0; i < 20000; i++) n[window.__pickDare(list)] += 1; return n;
    });
    check(lean[2] > lean[0] * 1.7 && lean[2] < lean[0] * 2.3 && lean[1] > lean[0] && lean[3] < lean[2] / 3, `last place is about twice as likely as the leader (${lean.join(' / ')})`);
    await host.click('#btnNext'); await sleep(2500);

    // Q5: anonymous answers. Twelve rats write, then everyone votes; Louisa's answer wins.
    await host.click('#btnNext'); await sleep(1000); await shot(host, '05f-write-intro');
    await host.waitForFunction(() => window.__host.phase === 'write', null, { timeout: 15000 }); await sleep(500);
    await shot(P[1], 'p-05g-write');
    const TEXTS = ['Hennes skratt', 'Att hon alltid har snacks med sig', 'Tålamodet', 'Hon kan sova var som helst, när som helst, hur som helst', 'Dansen', 'Omtanken', 'Hon minns allas födelsedagar', 'Humorn', 'Envisheten', 'Råttkärleken', 'Modet', 'Att hon lyssnar'];
    for (let i = 0; i < 12; i++) { await P[i].fill('#pText', TEXTS[i]); await P[i].click('#writeForm button'); }
    await sleep(400); await shot(host, '05g-write'); await shot(P[1], 'p-05g-written');
    check(await H(() => Object.keys(window.__host.texts).length) === 12, 'written answers reach the big screen');
    await host.click('#btnEndWrite'); await toQuestion();
    await shot(host, '05h-write-vote'); await shot(P[1], 'p-05h-write-vote');
    const shown = await host.textContent('.write-grid');
    check(TEXTS.every((t) => shown.includes(t)) && !NAMES.some((n) => shown.includes(n)), 'the answers are on the big screen without names');
    check(await P[0].locator('.p-text').count() === 11 && await P[14].locator('.p-text').count() === 12, 'a phone lists every answer except its own');
    const louisaBefore = (await byName('Louisa')).score;
    for (let i = 1; i <= 8; i++) await P[i].click('.p-text:has-text("Hennes skratt")');
    await P[0].click('.p-text:has-text("Tålamodet")'); await P[13].click('.p-text:has-text("Tålamodet")');
    await host.click('#btnSkip'); await toReveal();
    await shot(host, '05i-write-reveal'); await shot(P[0], 'p-05i-write-won'); await shot(P[2], 'p-05i-write-votes');
    check((await byName('Louisa')).score === louisaBefore + 1000, 'the writer of the winning answer gets 1,000 points');
    check((await host.textContent('.write-grid')).includes('Louisa'), 'the writers are named once the vote is over');
    await host.click('#btnNext'); await sleep(2500);
    await shot(host, '06-leaderboard-before-bets'); await shot(P[3], 'p-06-leaderboard-before-bets');

    // Bet your cheese, then the final question.
    const before = { louisa: (await byName('Louisa')).score, chad: (await byName('Cheddar Chad')).score, hugo: (await byName('Halloumi Hugo')).score, jo: (await byName('Jo')).score };
    await host.click('#btnNext'); await sleep(900);
    check(await H(() => window.__host.phase) === 'wager', 'the betting round comes before the final question');
    await shot(P[0], 'p-07-bet');
    await P[0].click('.p-bet[data-pct="100"]'); await P[1].click('.p-bet[data-pct="50"]'); await P[13].click('.p-bet[data-pct="100"]'); await P[6].click('.p-bet[data-pct="0"]');
    for (const i of [2, 3, 4, 5, 7, 8, 9]) await P[i].click('.p-bet[data-pct="25"]');
    await sleep(500);
    await shot(host, '07-bet'); await shot(P[0], 'p-07-bet-placed'); await shot(P[6], 'p-07-no-bet');
    check(await H(() => Object.keys(window.__host.bets).length) === 11, 'bets reach the big screen');
    await host.click('#btnNext'); await sleep(1000); await shot(host, '08-final-intro'); await toQuestion();
    check((await host.textContent('#barProgress')).trim() === '05 / 05', 'dares are not counted as questions');
    await shot(host, '09-final-question');
    await P[0].click('.p-answer[data-i="1"]'); // Louisa: all in, right
    await P[1].click('.p-answer[data-i="0"]'); // Chad: half, wrong
    await P[13].click('.p-answer[data-i="1"]'); // Hugo: all in from a low score, right
    await P[6].click('.p-answer[data-i="1"]'); // Jo: no bet, right
    for (const i of [2, 3, 4, 5]) await P[i].click('.p-answer[data-i="1"]');
    await host.click('#btnSkip'); await toReveal();
    await shot(host, '10-final-reveal'); await shot(P[0], 'p-10-bet-won'); await shot(P[1], 'p-10-bet-lost');
    const L = await byName('Louisa'); const C = await byName('Cheddar Chad'); const Hu = await byName('Halloumi Hugo'); const J = await byName('Jo');
    check(L.wager === before.louisa && L.score === before.louisa * 2 + L.answer.points, `all in and right doubles the score, plus the question's points (${before.louisa} -> ${L.score})`);
    check(C.wager === -Math.round(before.chad / 2) && C.score === before.chad + C.wager, `half and wrong loses half (${before.chad} -> ${C.score})`);
    check(Hu.wager === Math.max(1000, before.hugo), `a rat at the bottom can still stake 1,000 (${before.hugo} -> ${Hu.score})`);
    check(J.wager === undefined && J.score === before.jo + J.answer.points, 'no bet, no change');
    check(await H(() => Object.values(window.__host.players).every((p) => p.score >= 0)), 'nobody ends below zero');
    await host.click('#btnNext'); await sleep(10000);
    await shot(host, '11-podium');
    check(await P[2].locator('#react').isVisible(), 'reactions are there on the final screen too');
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally { await browser.close(); server.close(); }
  console.log(`\n${failures.length ? failures.length + ' check(s) failed' : 'All checks passed'}. Screenshots: tests/shots/modes-*.png`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
