// Host screen: runs the game and holds all state.
(function () {
  const { escapeHtml: esc, ANSWERS, GLYPHS, answerStyle, birthdayRat, pointsFor, ordinal, fmt } = SQ;
  const AGE = SQ.cfg.birthdayAge || 24;
  const TONES = ['pink', 'lime', 'lilac', 'orange', 'sky'];
  const pad = (n) => String(n).padStart(2, '0');
  const deco = (v) => `<div class="deco deco-${v}" aria-hidden="true"><span class="s1"></span><span class="s2"></span><span class="s3"></span><span class="s4"></span></div>`;
  const CROWN = '<svg class="crown" viewBox="0 0 64 40" aria-hidden="true"><path fill="currentColor" d="M4 12l14 12L32 4l14 20 14-12-6 28H10z"/></svg>';
  const A = SQAudio;
  const STORE = 'squeak-host';
  const INTRO_MS = 4000;
  const DARE_INTRO_MS = 7000; // a dare makes an entrance: alarm, title, silhouette, then the task
  const LATE_GRACE_S = 1.2;
  const NAME = SQ.cfg.birthdayName || 'Louisa';
  const WAGER_S = 20; // how long the betting round before the final question stays open
  const REVEAL_MS = 900; // suspense before the right answer lights up (phones wait the same time)
  const ARROW = (dir) => `<svg viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="${dir === 'up' ? 'M6 1l5 9H1z' : 'M6 11L1 2h10z'}"/></svg>`;

  const $ = (sel, root = document) => root.querySelector(sel);
  const stage = $('#stage');

  const S = {
    phase: 'title', code: null, title: 'Squeak & Seek', questions: [], errors: [], loadError: null,
    players: {}, qi: -1, done: 0, answers: {}, counts: [], qStart: 0, limit: 20, endsAt: 0, seq: 0,
    prevScores: {}, prevRanks: {}, moves: false, fastest: null, lastTick: null,
    game: 1, qKey: '', podStart: 0, podTimes: null, squeaks: 0, kicked: [], qWall: 0, bets: {}, wagers: {}, betKey: '', betEnds: 0, dare: null, texts: {}, extra: {}, votesFor: {},
  };
  let link = null; let heartbeat = null; let timerRaf = null; let introTimer = null; let ending = false;
  let timers = []; let lastNext = 0; let offlineTimer = null; let offline = false; const lastReact = {}; let lastReactSound = 0; const lobbySeen = new Set(); const lastSqueak = {};
  // Timers that belong to the current phase: all cleared when the phase changes.
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const avatar = (id, cls = '') => SQ.avatar(id, cls, !!S.players[id]?.bday);
  // "Bet your cheese": before the final question everyone bets part of their score on getting it right.
  // When it is on, it takes the place of the double-points final.
  const wagerOn = () => SQ.cfg.wagerFinal === true && realTotal() >= 3;
  const isBetQ = (qi = S.qi) => wagerOn() && qi === finalIdx();
  const isDouble = (qi = S.qi) => SQ.cfg.doubleFinal !== false && !wagerOn() && realTotal() >= 3 && qi === finalIdx();

  // ---------- persistence ----------
  const persist = () => localStorage.setItem(STORE, JSON.stringify({ code: S.code, players: S.players, done: S.done, game: S.game, kicked: S.kicked, savedAt: Date.now() }));
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } };

  // ---------- helpers ----------
  const q = () => S.questions[S.qi];
  const total = () => S.questions.length;
  // Dares are surprise events: they sit in the list but are not counted or numbered as questions.
  const isQ = (x) => x.type !== 'dare';
  const realTotal = () => S.questions.filter(isQ).length;
  const realNo = (qi = S.qi) => S.questions.slice(0, qi + 1).filter(isQ).length;
  const finalIdx = () => S.questions.map(isQ).lastIndexOf(true);
  const ranked = () => Object.entries(S.players).map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.score - a.score || (a.reachedAt || 0) - (b.reachedAt || 0) || a.joinedAt - b.joinedAt);
  const playerCount = () => Object.keys(S.players).length;
  const answeredCount = () => Object.keys(S.answers).length;
  // A rat who left, or who let two questions in a row go by, is taken to be away: the question does not wait for them.
  const away = (p) => !!p.gone || (p.idle || 0) >= 2;
  const waitingFor = () => Object.entries(S.players).filter(([id, p]) => !S.answers[id] && !away(p));
  // The folder this page is served from (works for /host.html and for /host without the extension).
  const baseUrl = () => new URL('.', location.href).href;
  const joinUrl = () => `${baseUrl()}?room=${S.code}${SQ.isLocal ? '&transport=local' : ''}`;
  const shortUrl = () => baseUrl().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const makeCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');

  // ---------- networking ----------
  function connect() {
    if (link) link.close();
    link = SQ.connect({ code: S.code, role: 'host', events: ['join', 'answer', 'squeak', 'leave', 'bet', 'react', 'dare', 'text'], onMessage, onStatus: (s) => {
      $('#barCode')?.classList.toggle('offline', s !== 'SUBSCRIBED');
      clearTimeout(offlineTimer);
      if (s === 'SUBSCRIBED') { if (offline) { offline = false; toast('Back online'); } broadcastAll(); }
      // Say it out loud when the game server cannot be reached: the lobby looks normal otherwise.
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') offlineTimer = setTimeout(() => { offline = true; toast('No connection to the game server. Check the internet on this laptop.', 8000); }, 1500);
    } });
    clearInterval(heartbeat);
    // Repeats the standings too: a phone that missed its result gets it on the next beat.
    heartbeat = setInterval(() => { if (S.phase !== 'title') broadcastAll(); }, 4000);
  }

  function statePayload() {
    const cq = q();
    const p = { phase: S.phase, code: S.code, title: S.title, q: S.qi, total: total(), no: realNo(), of: realTotal(), seq: ++S.seq, players: playerCount(), g: S.game };
    if (S.phase === 'leaderboard' && isDouble(S.qi + 1)) p.fin = true; // the next question is the final, double one
    if (S.phase === 'leaderboard' && isBetQ(S.qi + 1)) p.wgn = 1; // the betting round comes next
    if (S.phase === 'write') { p.type = 'write'; p.k = `${S.qKey}.w`; p.limit = q().writeLimit; p.max = SQ.WRITE_MAX; p.endsIn = Math.max(0, S.endsAt - performance.now()); p.a = Object.keys(S.texts).map(SQ.hash); }
    if (S.phase === 'wager') { p.k = S.betKey; p.limit = WAGER_S; p.endsIn = Math.max(0, S.betEnds - performance.now()); p.a = Object.keys(S.bets).map(SQ.hash); }
    if (S.phase === 'podium' && S.podTimes) { p.rv = S.podTimes; p.el = Math.round(performance.now() - S.podStart); }
    if (cq && ['intro', 'question', 'reveal'].includes(S.phase)) {
      p.type = cq.type; p.n = cq.options.length; p.video = !!cq.media?.video;
      p.k = S.qKey; p.limit = cq.timeLimit; if (isDouble()) p.dbl = true; if (isBetQ()) p.wg = 1;
      if (S.phase === 'reveal') p.wait = REVEAL_MS;
      if (cq.type === 'photo') p.opts = cq.options.map((o) => ({ label: o.label, image: o.image }));
      if (cq.type === 'write') p.opts = cq.options.map((o) => ({ label: o.label, h: SQ.hash(o.pid) })); // no names: only a mark so a phone can leave out its own
      if (cq.guests) p.opts = cq.options.map((o) => ({ label: o.label, pid: o.pid, bd: o.bd ? 1 : 0 })); // vote for a guest
      if (cq.type === 'number') { p.min = cq.min; p.max = cq.max; p.unit = cq.unit; if (cq.closest) p.cl = true; }
      if (S.phase === 'question') {
        p.endsIn = Math.max(0, S.endsAt - performance.now());
        p.a = Object.keys(S.answers).map(SQ.hash); // whose answers have arrived: a phone resends until it sees itself here
      }
      if (S.phase === 'reveal') p.correct = cq.correct;
      if (S.phase === 'reveal' && cq.type === 'dare' && S.dare) p.dare = S.dare.st === 'spin' ? { st: 'spin', pts: cq.points } : { n: S.dare.name, h: SQ.hash(S.dare.id), st: S.dare.st, pts: cq.points }; // no name while the wheel turns
    }
    return p;
  }
  const broadcastState = () => link && link.send('state', statePayload());
  function broadcastStandings() {
    if (!link) return;
    const r = {}; const list = ranked();
    list.forEach((p, i) => {
      const a = S.answers[p.id];
      const o = r[p.id] = { n: p.name, s: p.score, k: i + 1 };
      if (p.bday) o.bd = 1;
      if (S.phase !== 'lobby') {
        o.st = p.streak || 0;
        if (S.moves && S.prevRanks[p.id] !== undefined) o.d = S.prevRanks[p.id] - i;
        if (i > 0) o.up = { n: list[i - 1].name, g: list[i - 1].score - p.score };
        else if (list[1]) o.lead = p.score - list[1].score;
      }
      if (S.phase === 'reveal' && q()) {
        o.c = a ? a.correct : null; o.p = a ? a.points : 0;
        if (S.wagers[p.id]) o.wg = S.wagers[p.id];
        if (S.extra[p.id]) { o.c = true; o.p = S.extra[p.id]; } // points for something other than the answer given (the winning anonymous answer)
        if (S.votesFor[p.id] !== undefined) o.v = S.votesFor[p.id]; // what the bet won (+) or cost (−)
        if (!a && S.qWall && p.joinedAt > S.qWall) o.nw = 1; // walked in during this question
        if (a) { o.b = a.bonus || 0; o.t = Math.round(a.t * 10) / 10; if (S.fastest === p.id) o.f = 1; if (a.off !== undefined) o.off = a.off; }
      }
    });
    link.send('results', { q: S.qi, phase: S.phase, r, total: playerCount() });
  }
  const broadcastAll = () => { broadcastState(); broadcastStandings(); };

  function onMessage(event, msg) {
    if (!msg || !msg.id || S.phase === 'title') return;
    if (event === 'join') return onJoin(msg);
    if (event === 'answer') return onAnswer(msg);
    if (event === 'squeak') return onSqueak(msg);
    if (event === 'leave') return onLeave(msg);
    if (event === 'bet') return onBet(msg);
    if (event === 'react') return onReact(msg);
    if (event === 'dare') return onDare(msg);
    if (event === 'text') return onText(msg);
  }

  // A guest tapped "Leave" on their phone: out of the lobby, or no longer waited for once the quiz is running.
  function onLeave({ id }) {
    const p = S.players[id]; if (!p) return;
    if (S.phase === 'lobby') { delete S.players[id]; lobbySeen.delete(id); persist(); renderLobbyPlayers(); broadcastAll(); return; }
    p.gone = true; persist(); updateAnswered(); checkAllIn(); checkBetsIn();
  }

  // A guest tapped their rat in the lobby: it squeaks and wiggles on the big screen.
  function onSqueak({ id }) {
    if (S.phase !== 'lobby' || !S.players[id]) return;
    const now = performance.now(); if (now - (lastSqueak[id] || 0) < 500) return;
    lastSqueak[id] = now; S.squeaks += 1;
    A.sfx.squeak();
    const el = stage.querySelector(`.guest[data-id="${CSS.escape(id)}"]`); if (!el) return;
    el.classList.remove('guest-squeak'); void el.offsetWidth; el.classList.add('guest-squeak');
  }

  function onJoin({ id, name }) {
    if (S.kicked.includes(id)) return link.send('kick', { id }); // removed by the host: stays out, even if the phone missed it
    const existing = S.players[id];
    if (existing && existing.gone) { existing.gone = false; existing.idle = 0; persist(); }
    if (!existing) {
      let clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 15) || 'Rat';
      const taken = new Set(Object.values(S.players).map((p) => p.name.toLowerCase()));
      let final = clean; let n = 2;
      while (taken.has(final.toLowerCase())) final = `${clean.slice(0, 12)} ${n++}`;
      const bday = SQ.isBirthday(clean) && !Object.values(S.players).some((p) => p.bday); // one birthday rat only
      S.players[id] = { name: final, score: 0, reachedAt: 0, joinedAt: Date.now(), streak: 0, best: 0, right: 0, climb: 0, bday };
      persist();
      A.sfx.squeak();
      if (S.phase === 'lobby') renderLobbyPlayers();
      else toast(`${final} joined`);
      if (bday) { toast('The birthday rat has arrived'); SQ.confetti(2200); A.sfx.chime(); }
      updateAnswered();
    }
    broadcastAll();
  }

  function onAnswer({ id, q: qi, choice }) {
    if (S.phase !== 'question' || qi !== S.qi || !S.players[id] || S.answers[id]) return;
    const cq = q();
    if (!Number.isInteger(choice)) return;
    if (cq.type === 'number' ? (choice < cq.min || choice > cq.max) : (choice < 0 || choice >= cq.options.length)) return;
    if (cq.options[choice] && cq.options[choice].pid === id) return; // no voting for yourself, or for your own answer
    const t = (performance.now() - S.qStart) / 1000;
    if (t > S.limit + LATE_GRACE_S) return;
    const correct = cq.correct.includes(choice);
    const base = correct ? pointsFor(t, S.limit) : 0;
    S.answers[id] = { choice, t, correct, base, points: base, bonus: 0, at: Date.now() }; // streak bonus and doubling are added in endQuestion
    updateAnswered();
    A.sfx.pop();
    broadcastState(); // tells the phone its answer arrived
    checkAllIn();
  }
  // Everyone we are waiting for has answered: no need to run the clock down.
  function checkAllIn() { if (S.phase === 'question' && answeredCount() > 0 && !waitingFor().length) later(endQuestion, 400); }

  // ---------- anonymous answers ----------
  // Step one of a "write" question: everyone types an answer. Step two is the ordinary question phase, as a vote
  // between those answers with the names left off.
  function startWrite() {
    const cq = q();
    S.texts = {}; S.limit = cq.writeLimit; S.endsAt = performance.now() + S.limit * 1000;
    go('write');
    A.sfx.go(); A.playSlot('question');
    const tick = () => {
      if (S.phase !== 'write') return;
      const left = Math.max(0, (S.endsAt - performance.now()) / 1000);
      const el = $('#timeLeft'); if (el) el.textContent = Math.ceil(left);
      const ring = $('#timerRing'); if (ring) ring.style.setProperty('--p', (left / S.limit).toFixed(4));
      if (left <= 0) return finishWrite();
      later(tick, 200);
    };
    later(tick, 200);
  }
  function onText({ id, t }) {
    if (S.phase !== 'write' || !S.players[id] || S.texts[id] !== undefined) return;
    const clean = String(t || '').replace(/\s+/g, ' ').trim().slice(0, SQ.WRITE_MAX); if (!clean) return;
    S.texts[id] = clean; S.players[id].idle = 0;
    A.sfx.pop(); updateWrite(); broadcastState();
    if (!Object.entries(S.players).some(([pid, p]) => S.texts[pid] === undefined && !away(p))) later(finishWrite, 700);
  }
  function updateWrite() {
    const el = $('#answered'); if (el) el.textContent = `${Object.keys(S.texts).length} / ${playerCount()}`;
    const faces = $('#qFaces');
    if (faces) Object.keys(S.texts).forEach((id) => { if (!faces.querySelector(`[data-id="${CSS.escape(id)}"]`)) faces.insertAdjacentHTML('beforeend', `<span class="q-face pop-in" data-id="${esc(id)}">${avatar(id)}</span>`); });
  }
  function finishWrite() {
    if (S.phase !== 'write') return;
    const cq = q();
    cq.options = Object.entries(S.texts).map(([pid, label]) => ({ label, pid })).sort(() => Math.random() - 0.5);
    startQuestion();
    if (cq.options.length < 2) S.endsAt = performance.now(); // nothing to choose between: straight to the result
  }
  function renderWrite() {
    const cq = q();
    stage.innerHTML = `
      <section class="question write">
        ${qHead(cq, `<span class="q-double">Anonymous</span><div class="timer" id="wTimer"><div class="ring" id="timerRing" style="--p:1"></div><span id="timeLeft">${cq.writeLimit}</span></div>`)}
        <div class="q-body">
          <div class="q-visual">${mediaHTML(cq, 'medium', false) || `<div class="mascot mid bob">${birthdayRat()}</div>`}</div>
          <div class="answered"><span id="answered">0 / ${playerCount()}</span><small>written</small><div class="q-faces" id="qFaces"></div><button class="btn ghost small" id="btnEndWrite">On to the vote</button></div>
        </div>
        <div class="num-panel"><p class="num-hint write-hint">Write your answer on your phone. <b>Nobody sees who wrote what until the vote is over.</b></p></div>
      </section>`;
    $('#btnEndWrite').addEventListener('click', finishWrite);
    updateWrite();
  }

  // ---------- dare ----------
  // A surprise event between questions. A wheel of fortune picks a rat for the task; they answer on their phone and
  // the host (the judge) says whether it was done. The host's buttons also work without the phone's answer.
  const DARE_OVER = ['done', 'failed', 'declined'];
  const SPIN_MS = 6200;
  const WHEEL_COLORS = [SQ.C.lime, SQ.C.pink, SQ.C.sky, SQ.C.orange, SQ.C.lilac, SQ.C.mint];
  // Who is on the wheel: everyone who is here, except the birthday rat (she is the judge).
  function dareCandidates() {
    const here = Object.entries(S.players).filter(([, p]) => !away(p)).sort((x, y) => x[1].joinedAt - y[1].joinedAt);
    const guests = here.filter(([, p]) => !p.bday);
    return (guests.length ? guests : here).map(([id, p]) => ({ id, ...p }));
  }
  // The wheel looks fair, but it leans a little: the rat in last place is twice as likely as the leader, with
  // everyone else in between, and someone who already had a dare is much less likely to get another.
  function pickDare(list = dareCandidates()) {
    if (!list.length) return null;
    const scores = list.map((p) => p.score); const hi = Math.max(...scores); const lo = Math.min(...scores);
    const weights = list.map((p) => (1 + (hi > lo ? (hi - p.score) / (hi - lo) : 0)) * Math.pow(0.25, p.dares || 0));
    let r = Math.random() * weights.reduce((x, y) => x + y, 0);
    for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return i; }
    return list.length - 1;
  }
  function startDare() {
    S.answers = {}; S.counts = []; S.fastest = null; S.wagers = {}; S.extra = {}; S.votesFor = {}; ending = false;
    S.prevScores = Object.fromEntries(Object.entries(S.players).map(([id, p]) => [id, p.score]));
    S.prevRanks = Object.fromEntries(ranked().map((p, i) => [p.id, i]));
    S.moves = Object.values(S.prevScores).some((v) => v > 0);
    const list = dareCandidates(); const k = pickDare(list);
    S.dare = k === null ? null : { id: list[k].id, name: list[k].name, st: 'spin', k, list: list.map((p) => ({ id: p.id, name: p.name })) };
    S.done = S.qi + 1; persist();
    A.stopMusic();
    go('reveal');
    if (!S.dare) return;
    // Clicks that slow down with the wheel, then the verdict on who it is.
    for (let j = 0; j < 34; j++) later(() => A.sfx.tick(1 + (j % 2)), Math.round(SPIN_MS * Math.pow(j / 34, 2.2)));
    later(() => {
      S.dare.st = 'asked'; if (S.players[S.dare.id]) { S.players[S.dare.id].dares = (S.players[S.dare.id].dares || 0) + 1; persist(); }
      A.sfx.slam(); flash(); later(() => A.sfx.chime(), 180); $('#wheelWrap')?.classList.add('landed');
      paintDare(); broadcastAll();
    }, SPIN_MS + 250);
  }
  function wheelSVG(list) {
    const n = list.length; const a = 360 / n; const R = 190; const C = 200;
    const pt = (deg, r = R) => { const t = (deg - 90) * Math.PI / 180; return `${(C + r * Math.cos(t)).toFixed(1)} ${(C + r * Math.sin(t)).toFixed(1)}`; };
    const size = n <= 6 ? 24 : n <= 10 ? 19 : n <= 16 ? 15 : 11;
    const short = (name) => (name.length > 13 ? name.slice(0, 12) + '…' : name);
    return `<svg viewBox="0 0 400 400" aria-hidden="true">${list.map((p, i) => {
      const col = n > 1 && i === n - 1 && i % WHEEL_COLORS.length === 0 ? SQ.C.paper : WHEEL_COLORS[i % WHEEL_COLORS.length];
      const wedge = n === 1 ? `<circle cx="${C}" cy="${C}" r="${R}" fill="${col}"/>` : `<path d="M${C} ${C} L${pt(i * a)} A${R} ${R} 0 0 1 ${pt((i + 1) * a)} Z" fill="${col}" stroke="${SQ.C.ink}" stroke-width="2"/>`;
      return `${wedge}<text x="${C + 178}" y="${C}" text-anchor="end" dominant-baseline="central" font-size="${size}" transform="rotate(${(i + 0.5) * a - 90} ${C} ${C})">${esc(short(p.name))}</text>`;
    }).join('')}<circle cx="${C}" cy="${C}" r="26" fill="${SQ.C.ink}"/><circle cx="${C}" cy="${C}" r="9" fill="${SQ.C.paper}"/></svg>`;
  }
  function renderDare() {
    const cq = q(); const d = S.dare;
    stage.innerHTML = `
      <section class="question reveal dare">
        ${qHead(cq, `<span class="q-double">${fmt(cq.points)} points</span>`)}
        <div class="dare-stage">
          ${d ? `<div class="wheel-wrap ${d.st === 'spin' ? '' : 'landed'}" id="wheelWrap"><div class="wheel-pin"></div><div class="wheel" id="wheel">${wheelSVG(d.list)}</div></div>` : '<p class="num-hint write-hint">Nobody is here to take the dare.</p>'}
          <div class="rv-side">${d ? '<div id="dareBox"></div>' : ''}<button class="btn primary big" id="btnNext">${S.qi + 1 >= total() ? 'Final results &rarr;' : 'Leaderboard &rarr;'}</button></div>
        </div>
      </section>`;
    $('#btnNext').addEventListener('click', next);
    if (!d) return autoNext();
    // The chosen name ends under the pin at the top, after six full turns (or at once, on a re-render).
    const wheel = $('#wheel'); const a = 360 / d.list.length;
    const end = 360 * 6 - (d.k + 0.5) * a + (SQ.hash(d.id + S.qKey) % 100 / 100 - 0.5) * a * 0.6;
    if (d.st === 'spin') { void wheel.offsetWidth; wheel.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.12,.62,.08,1)`; }
    wheel.style.transform = `rotate(${end}deg)`;
    paintDare();
    if (DARE_OVER.includes(d.st)) autoNext();
  }
  // A dare with "seconds" gets a clock the host starts when the rat is ready; with "music" the dance music plays
  // for as long as the clock runs.
  function startDareClock() {
    const d = S.dare; const cq = q(); if (!d || !cq.seconds || d.ends || DARE_OVER.includes(d.st) || d.st === 'spin') return;
    if (d.st === 'asked') setDare('accepted');
    d.ends = performance.now() + cq.seconds * 1000; d.timeUp = false;
    if (cq.music) A.playSlot('dance');
    A.sfx.go(); paintDare();
    const tick = () => {
      if (S.dare !== d || !d.ends) return;
      const left = Math.ceil((d.ends - performance.now()) / 1000);
      const el = $('#dareClock'); if (el) el.textContent = Math.max(0, left);
      if (left <= 3 && left > 0 && left !== d.lastTick) { d.lastTick = left; A.sfx.tick(left); }
      if (left <= 0) { stopDareClock(); d.timeUp = true; A.sfx.timeUp(); paintDare(); return; }
      later(tick, 200);
    };
    later(tick, 200);
  }
  function stopDareClock() { const d = S.dare; if (!d || !d.ends) return; d.ends = 0; if (q().music) A.stopMusic(); }
  function onDare({ id, ok }) { if (S.phase === 'reveal' && S.dare && S.dare.id === id && S.dare.st === 'asked') setDare(ok ? 'accepted' : 'declined'); }
  function setDare(st) {
    const d = S.dare; const cq = q(); if (!d || S.phase !== 'reveal' || d.st === 'spin' || DARE_OVER.includes(d.st)) return;
    d.st = st;
    if (DARE_OVER.includes(st)) stopDareClock();
    if (st === 'done' && S.players[d.id]) { S.players[d.id].score += cq.points; S.players[d.id].reachedAt = Date.now(); persist(); SQ.confetti(2600); A.sfx.fanfare(); }
    else if (st === 'accepted') A.sfx.chime(); else A.sfx.womp();
    paintDare(); broadcastAll();
    if (DARE_OVER.includes(st) && !$('#btnHold')) autoNext(); // the screen waited for the verdict; now it may move on
  }
  function paintDare() {
    const box = $('#dareBox'); const d = S.dare; if (!box || !d) return;
    const pts = fmt(q().points);
    if (d.st === 'spin') { box.className = 'dare-box dare-spin'; box.innerHTML = '<div class="dare-who"><div><small>The wheel decides</small><strong>Who will it be?</strong><span>Anyone could get it.</span></div></div>'; return; }
    const line = { asked: 'Waiting for the answer on their phone&hellip;', accepted: `Accepted. ${esc(NAME)} is the judge.`, done: `Done. +${pts} points.`, failed: 'Not quite. No points.', declined: 'Said no thanks.' }[d.st];
    box.className = `dare-box pop-in dare-${d.st}`;
    box.innerHTML = `<div class="dare-who">${avatar(d.id)}<div><small>The dare goes to</small><strong>${esc(d.name)}</strong><span>${line}</span></div></div>
      ${DARE_OVER.includes(d.st) || !q().seconds ? '' : d.ends ? `<div class="dare-clock running"><b id="dareClock">${Math.max(0, Math.ceil((d.ends - performance.now()) / 1000))}</b><span>seconds left</span></div>` : d.timeUp ? '<div class="dare-clock"><b>0</b><span>Time is up</span></div>' : `<button class="btn dark small dare-start" id="dareStart">Start the clock &middot; ${q().seconds} s${q().music ? ' + music' : ''}</button>`}
      ${DARE_OVER.includes(d.st) ? '' : `<div class="dare-btns"><button class="btn primary small" data-st="done">Done &middot; +${pts}</button><button class="btn ghost small" data-st="failed">Failed</button><button class="btn ghost small" data-st="declined">Declined</button></div>`}`;
    box.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => setDare(b.dataset.st)));
    $('#dareStart')?.addEventListener('click', startDareClock);
  }

  // ---------- reactions ----------
  // A guest tapped a reaction on their phone: it floats up the big screen with their rat next to it.
  function onReact({ id, r }) {
    const p = S.players[id]; const R = SQ.REACTIONS[r];
    if (!p || !R || !['reveal', 'leaderboard', 'podium'].includes(S.phase)) return;
    const now = performance.now(); if (now - (lastReact[id] || 0) < 600) return; lastReact[id] = now;
    let layer = $('#reacts'); if (!layer) { layer = document.createElement('div'); layer.id = 'reacts'; layer.className = 'reacts'; document.body.appendChild(layer); }
    if (layer.childElementCount > 40) return;
    const el = document.createElement('div'); el.className = `react r${r}`;
    el.style.left = `${4 + Math.random() * 88}%`; el.style.setProperty('--tilt', `${(Math.random() * 16 - 8).toFixed(1)}deg`);
    el.innerHTML = `${avatar(id)}<span class="react-what">${R.html}</span>`;
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove()); setTimeout(() => el.remove(), 4000);
    if (now - lastReactSound > 350) { lastReactSound = now; A.sfx.pop(); }
  }

  // ---------- bet your cheese ----------
  function startWager() {
    S.bets = {}; S.wagers = {}; S.betKey = `${S.game}.w.${Date.now().toString(36)}`;
    S.betEnds = performance.now() + WAGER_S * 1000;
    go('wager');
    A.sfx.fanfare();
    const tick = () => {
      if (S.phase !== 'wager') return;
      const left = Math.max(0, Math.ceil((S.betEnds - performance.now()) / 1000));
      const el = $('#wSecs'); if (el) el.textContent = left;
      if (left <= 0) return nextQuestion();
      later(tick, 250);
    };
    later(tick, 250);
  }
  function onBet({ id, pct }) {
    if (S.phase !== 'wager' || !S.players[id] || S.bets[id] !== undefined || !SQ.BETS.includes(pct)) return;
    S.bets[id] = pct;
    A.sfx.pop();
    updateBets(); broadcastState(); checkBetsIn();
  }
  function updateBets() {
    const n = Object.keys(S.bets).length;
    const el = $('#wCount'); if (el) el.textContent = `${n} / ${playerCount()}`;
    const faces = $('#wFaces');
    if (faces) Object.keys(S.bets).forEach((id) => { if (!faces.querySelector(`[data-id="${CSS.escape(id)}"]`)) faces.insertAdjacentHTML('beforeend', `<span class="q-face pop-in" data-id="${esc(id)}">${avatar(id)}</span>`); });
  }
  function checkBetsIn() {
    if (S.phase !== 'wager' || !Object.keys(S.bets).length) return;
    if (!Object.entries(S.players).some(([id, p]) => S.bets[id] === undefined && !away(p))) later(nextQuestion, 900);
  }
  function renderWager() {
    stage.innerHTML = `
      <section class="wager">
        ${deco('intro')}
        <p class="kicker big">Before the final question</p>
        <h2 class="display">Bet your<br>cheese</h2>
        <p class="wager-rule">Choose on your phone how much of your score to bet.<br><b>Right answer: you win it. Wrong answer: you lose it.</b></p>
        <div class="wager-foot">
          <div class="wager-count"><span class="wager-num" id="wCount">0 / ${playerCount()}</span><small>bets placed</small><div class="q-faces" id="wFaces"></div></div>
          <div class="wager-go"><span class="wager-secs"><b id="wSecs">${WAGER_S}</b> s</span><button class="btn dark big" id="btnNext">Final question &rarr;</button></div>
        </div>
      </section>`;
    $('#btnNext').addEventListener('click', next);
  }

  // Question screen: the counter, a face for everyone who has locked in, and who we are still waiting for.
  function updateAnswered() {
    if (S.phase !== 'question') return;
    const el = $('#answered'); if (el) el.textContent = `${answeredCount()} / ${playerCount()}`;
    const faces = $('#qFaces');
    if (faces) Object.keys(S.answers).forEach((id) => { if (!faces.querySelector(`[data-id="${CSS.escape(id)}"]`)) faces.insertAdjacentHTML('beforeend', `<span class="q-face pop-in" data-id="${esc(id)}">${avatar(id)}</span>`); });
    const wait = $('#qWaiting');
    if (wait) {
      const left = waitingFor().map(([, p]) => p.name);
      wait.textContent = left.length && left.length <= 3 && answeredCount() >= left.length ? `Waiting for ${left.join(', ')}` : '';
    }
  }

  // ---------- flow ----------
  async function loadQuestions() {
    const file = SQ.params.get('questions') || SQ.cfg.questionsFile || 'questions.json';
    try {
      const r = await fetch(file, { cache: 'no-store' });
      if (!r.ok) throw new Error(`Could not load ${file} (HTTP ${r.status}).`);
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
      const res = SQ.normalizeQuestions(data);
      Object.assign(S, { title: res.title, questions: res.questions, errors: res.errors });
    } catch (e) { S.loadError = e.message; }
  }

  function startParty(resume) {
    A.ensure(); SQ.keepAwake();
    const saved = resume ? loadSaved() : null;
    if (saved) { S.code = saved.code; S.players = saved.players || {}; S.done = saved.done || 0; S.game = saved.game || 1; S.kicked = saved.kicked || []; }
    else { S.code = makeCode(); S.players = {}; S.done = 0; S.game = 1; S.kicked = []; localStorage.removeItem(STORE); }
    S.prevRanks = Object.fromEntries(ranked().map((p, i) => [p.id, i])); S.moves = false;
    persist(); connect();
    $('#bar').hidden = false; $('#barCode').textContent = S.code;
    if (S.done === 0) { S.qi = -1; go('lobby'); }
    else if (S.done >= total()) { S.qi = total() - 1; go('podium'); }
    else { S.qi = S.done - 1; S.prevScores = Object.fromEntries(Object.entries(S.players).map(([id, p]) => [id, p.score])); go('leaderboard'); }
  }

  function go(phase) {
    S.phase = phase;
    clearTimeout(introTimer); cancelAnimationFrame(timerRaf);
    timers.forEach(clearTimeout); timers = [];
    delete document.body.dataset.urgent; A.hurry(false);
    stage.querySelectorAll('video').forEach((v) => v.pause()); // a clip must not play on after its screen is gone
    render();
    broadcastAll();
  }

  function nextQuestion() {
    if (S.qi + 1 >= total()) return go('podium');
    S.qi += 1; S.answers = {}; ending = false;
    // A fresh key for every time a question is asked: phones remember their answer by this key, so a replay
    // ("Play again") or a question re-asked after a host refresh is never mistaken for one already answered.
    S.qKey = `${S.game}.${S.qi}.${Date.now().toString(36)}`;
    const cq = q();
    if (cq.after) clipFor(cq);
    go('intro');
    if (cq.media?.video) {
      A.pauseMusic();
      const v = $('#introVideo');
      const done = () => { if (S.phase === 'intro' && S.qi === S.questions.indexOf(cq)) startQuestion(); };
      v.addEventListener('ended', done, { once: true });
      v.addEventListener('error', () => setTimeout(done, 1500), { once: true });
      v.play().catch(() => { v.muted = true; v.play().catch(() => setTimeout(done, 1500)); });
    } else {
      A.stopMusic();
      introTimer = setTimeout(cq.type === 'write' ? startWrite : cq.type === 'dare' ? startDare : startQuestion, cq.type === 'dare' ? DARE_INTRO_MS : INTRO_MS);
      if (cq.type !== 'dare') [3, 2, 1].forEach((n) => later(() => A.sfx.blip(3 - n), INTRO_MS - n * 1000));
      else {
        A.sfx.alarm();
        [550, 900, 3200].forEach((ms) => later(() => { A.sfx.slam(); flash(); }, ms));
        later(() => A.sfx.fanfare(), 3300);
        [3, 2, 1].forEach((n) => later(() => A.sfx.blip(3 - n), DARE_INTRO_MS - n * 1000));
      }
      if (isDouble()) later(() => A.sfx.fanfare(), 250);
    }
  }

  function startQuestion() {
    const cq = q();
    S.dare = null; S.extra = {}; S.votesFor = {};
    if (['vote', 'dare', 'write'].includes(cq.type)) cq.correct = []; // decided by the room when the question ends
    if (cq.guests) cq.options = Object.entries(S.players).sort((x, y) => x[1].joinedAt - y[1].joinedAt).map(([pid, p]) => ({ label: p.name, pid, bd: p.bday }));
    S.limit = cq.timeLimit; S.answers = {};
    S.qWall = Date.now(); S.qStart = performance.now(); S.endsAt = S.qStart + S.limit * 1000; S.lastTick = null;
    go('question');
    A.sfx.go(); A.playSlot('question');
    const loop = () => {
      if (S.phase !== 'question') return;
      const left = Math.max(0, (S.endsAt - performance.now()) / 1000);
      const el = $('#timeLeft'); if (el) el.textContent = Math.ceil(left);
      const ring = $('#timerRing'); if (ring) ring.style.setProperty('--p', (left / S.limit).toFixed(4));
      const whole = Math.ceil(left);
      if (whole <= 5 && whole > 0 && whole !== S.lastTick) {
        S.lastTick = whole; A.sfx.tick(whole); $('#timer')?.classList.add('urgent');
        document.body.dataset.urgent = '1'; A.hurry(true);
        const t = $('#timer'); if (t) { t.classList.remove('thump'); void t.offsetWidth; t.classList.add('thump'); }
      }
      if (left <= 0) { later(endQuestion, 600); return; }
      timerRaf = requestAnimationFrame(loop);
    };
    timerRaf = requestAnimationFrame(loop);
    // Animation frames stop while the host tab is in the background; this makes sure the question still ends.
    const backup = () => { if (S.phase !== 'question') return; if (performance.now() >= S.endsAt) endQuestion(); else later(backup, 500); };
    later(backup, S.limit * 1000 + 700);
  }

  function endQuestion() {
    if (S.phase !== 'question' || ending) return;
    ending = true;
    A.stopMusic();
    const cq = q();
    S.prevScores = Object.fromEntries(Object.entries(S.players).map(([id, p]) => [id, p.score]));
    S.prevRanks = Object.fromEntries(ranked().map((p, i) => [p.id, i]));
    S.moves = Object.values(S.prevScores).some((v) => v > 0);
    S.counts = cq.type === 'number' ? {} : cq.options.map(() => 0); // number questions: guesses per value
    const mult = isDouble() ? 2 : 1;
    S.fastest = null;
    // Closest-guess scoring: players are ranked by how far off they were. The closest guess (or guesses) counts as
    // correct and gets 1000; each step further down the ranking gets evenly less. Speed plays no part.
    if (cq.closest) {
      const c = cq.correct[0];
      const dists = [...new Set(Object.values(S.answers).map((a) => Math.abs(a.choice - c)))].sort((x, y) => x - y);
      Object.values(S.answers).forEach((a) => {
        a.off = Math.abs(a.choice - c); const g = dists.indexOf(a.off);
        a.correct = g === 0; a.base = Math.round(1000 * (1 - g / dists.length));
      });
    }
    // Majority vote: the most popular answer (or answers, on a tie) wins, and everyone who picked it scores 1000.
    // Speed plays no part. Two rats have to agree before anything counts as a majority.
    if (cq.type === 'vote') {
      const tally = {}; Object.values(S.answers).forEach((a) => { tally[a.choice] = (tally[a.choice] || 0) + 1; });
      const top = Math.max(0, ...Object.values(tally));
      cq.correct = top >= 2 || answeredCount() === 1 ? Object.keys(tally).filter((k) => tally[k] === top).map(Number) : [];
      Object.values(S.answers).forEach((a) => { a.correct = cq.correct.includes(a.choice); a.base = a.correct ? 1000 : 0; a.vote = 1; });
    }
    // Anonymous answers: the answer with the most votes wins and its writer (or writers, on a tie) gets 1000.
    if (cq.type === 'write') {
      const tally = cq.options.map(() => 0); Object.values(S.answers).forEach((a) => { tally[a.choice] += 1; a.vote = 1; a.correct = false; a.base = 0; });
      const top = Math.max(0, ...tally);
      cq.correct = top ? tally.map((n, i) => (n === top ? i : -1)).filter((i) => i >= 0) : [];
      cq.options.forEach((o, i) => { S.votesFor[o.pid] = tally[i]; });
      cq.correct.forEach((i) => { const p = S.players[cq.options[i].pid]; if (p) { p.score += 1000; p.reachedAt = Date.now(); S.extra[cq.options[i].pid] = 1000; } });
    }
    Object.entries(S.players).forEach(([id, p]) => {
      const a = S.answers[id];
      p.idle = a ? 0 : (p.idle || 0) + 1;
      if (a) S.counts[a.choice] = (S.counts[a.choice] || 0) + 1;
      // Close but not closest: points, and the streak is neither broken nor extended.
      if (a && !a.correct && cq.closest && a.base > 0) { a.points = a.base * mult; p.score += a.points; p.reachedAt = a.at; return; }
      if (cq.type === 'write') return; // a vote for the best answer touches nobody's streak
      if (a && a.vote && !a.correct) return; // outvoted: no points, but a streak is not broken by a matter of taste
      if (!a || !a.correct) { p.streak = 0; return; }
      p.streak = (p.streak || 0) + 1; p.best = Math.max(p.best || 0, p.streak); p.right = (p.right || 0) + 1;
      if (!cq.closest && !a.vote) p.fast = Math.min(p.fast ?? 999, a.t); // speed plays no part in a closest-guess question
      a.bonus = SQ.streakBonus(p.streak) * mult;
      a.points = a.base * mult + a.bonus;
      p.score += a.points; p.reachedAt = a.at;
      if (!cq.closest && !a.vote && (!S.fastest || a.t < S.answers[S.fastest].t)) S.fastest = id;
    });
    // Bets on the final question: win the stake when right, lose it (never below zero) when wrong or silent.
    S.wagers = {};
    if (isBetQ()) Object.entries(S.players).forEach(([id, p]) => {
      const pct = S.bets[id]; if (!pct) return;
      const before = S.prevScores[id] ?? 0; const stake = SQ.stake(before, pct); const a = S.answers[id];
      const delta = a && a.correct ? stake : -Math.min(stake, before);
      if (!delta) return;
      p.score += delta; S.wagers[id] = delta; if (delta > 0) p.reachedAt = a.at;
    });
    if (S.moves) ranked().forEach((p, i) => { const up = S.prevRanks[p.id] - i; const pl = S.players[p.id]; if (up > (pl.climb || 0)) pl.climb = up; });
    S.done = S.qi + 1; persist();
    const right = cq.type === 'write' ? playerCount() : Object.values(S.answers).filter((a) => a.correct).length;
    go('reveal');
    A.sfx.roll(REVEAL_MS / 1000 - 0.05);
    later(() => { if (right >= Math.max(1, playerCount() / 2)) A.sfx.chime(); else A.sfx.womp(); }, REVEAL_MS);
  }

  function next(auto) {
    // A double press (or Space right after a click) must not skip a whole screen. After the screen moved on by
    // itself the guard is longer: a click aimed at the old screen must not skip the new one.
    const now = performance.now(); if (now < lastNext) return; lastNext = now + (auto === true ? 1600 : 450);
    if (S.phase === 'lobby' && playerCount() > 0) return nextQuestion();
    if (S.phase === 'reveal') { if (S.qi + 1 >= total()) return go('podium'); go('leaderboard'); A.sfx.whoosh(); A.playSlot('lobby'); return; }
    if (S.phase === 'leaderboard') return isBetQ(S.qi + 1) ? startWager() : nextQuestion();
    if (S.phase === 'wager') return nextQuestion();
  }

  // The answer screen and the leaderboard move on by themselves: a countdown on the button, and a Pause next to it.
  function autoNext() {
    const btn = $('#btnNext'); let left = Math.round(Number(SQ.cfg.autoAdvanceSeconds ?? 20));
    if (!btn || !(left > 0)) return;
    const phase = S.phase; let paused = !answeredCount() && q().type !== 'dare'; // nobody played this one: wait for the host instead of running on alone
    const hold = document.createElement('button'); hold.className = 'btn ghost small'; hold.id = 'btnHold'; hold.textContent = 'Pause';
    const wrap = document.createElement('div'); wrap.className = 'auto-wrap';
    btn.replaceWith(wrap); wrap.append(hold, btn);
    btn.insertAdjacentHTML('beforeend', `<span class="auto-count" id="autoCount">${left}</span>`);
    if (paused) { hold.textContent = 'Resume'; wrap.classList.add('paused'); }
    hold.addEventListener('click', () => { paused = !paused; hold.textContent = paused ? 'Resume' : 'Pause'; wrap.classList.toggle('paused', paused); });
    const tick = () => {
      if (S.phase !== phase) return;
      // Stand still while paused or while the music dialog is open.
      if (!paused && !$('#soundDialog').open) { left -= 1; const c = $('#autoCount'); if (c) c.textContent = left; }
      if (left <= 0) { lastNext = 0; return next(true); }
      later(tick, 1000);
    };
    later(tick, 1000);
  }

  function playAgain() {
    Object.values(S.players).forEach((p) => Object.assign(p, { score: 0, reachedAt: 0, streak: 0, best: 0, right: 0, climb: 0, fast: undefined, idle: 0, dares: 0 }));
    S.qi = -1; S.done = 0; S.answers = {}; S.game += 1; S.prevScores = {}; S.prevRanks = {}; S.moves = false; persist(); go('lobby');
  }

  // ---------- rendering ----------
  function render() {
    const oldBg = getComputedStyle(document.body).backgroundColor;
    stage.className = `stage phase-${S.phase}`;
    document.body.dataset.phase = S.phase;
    document.body.dataset.tone = S.qi >= 0 ? TONES[S.qi % TONES.length] : 'pink';
    document.body.toggleAttribute('data-dare', S.phase === 'intro' && q()?.type === 'dare');
    wipe(oldBg);
    const prog = $('#barProgress');
    if (prog) prog.textContent = S.qi >= 0 && !['lobby', 'podium', 'wager'].includes(S.phase) && !(q().type === 'dare' && S.phase !== 'leaderboard') ? `${pad(realNo())} / ${pad(realTotal())}` : '';
    ({ title: renderTitle, lobby: renderLobby, intro: renderIntro, question: renderQuestion, reveal: () => (q().type === 'dare' ? renderDare() : renderReveal()), leaderboard: renderLeaderboard, wager: renderWager, write: renderWrite, podium: renderPodium })[S.phase]();
  }

  // Colour change between screens: the old colour shrinks away in a circle instead of cutting.
  function wipe(oldBg) {
    if (oldBg === getComputedStyle(document.body).backgroundColor || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelectorAll('.wipe').forEach((w) => w.remove());
    const w = document.createElement('div'); w.className = 'wipe'; w.style.background = oldBg;
    document.body.insertBefore(w, stage);
    w.addEventListener('animationend', () => w.remove()); setTimeout(() => w.remove(), 1200);
  }

  function renderTitle() {
    const saved = loadSaved();
    const canResume = saved && saved.code && Object.keys(saved.players || {}).length && Date.now() - saved.savedAt < 1000 * 60 * 60 * 12;
    const problems = S.loadError ? [S.loadError] : S.errors;
    stage.innerHTML = `
      <section class="title-screen">
        ${deco('title')}
        <div class="title-copy">
          <p class="kicker">${esc(NAME)} turns ${AGE} &middot; The birthday quiz</p>
          <h1 class="display">Squeak<br><em>&amp;</em> Seek</h1>
          <p class="lede">${realTotal()} question${realTotal() === 1 ? '' : 's'}. One winner. Grab your phone.</p>
          ${problems.length ? `<div class="errors"><strong>Fix these in questions.json</strong><ul>${problems.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
          <div class="actions">
            ${canResume ? `<button class="btn primary big" id="btnResume" ${!total() || S.loadError ? 'disabled' : ''}>Resume room ${esc(saved.code)} &middot; ${Object.keys(saved.players).length} players, ${saved.done} done &rarr;</button>` : ''}
            <button class="btn ${canResume ? 'ghost' : 'primary'} big" id="btnStart" ${!total() || S.loadError ? 'disabled' : ''}>${canResume ? 'Start a new party' : 'Start the party &rarr;'}</button>
          </div>
          <details class="sound-details"><summary>Music &amp; sound</summary><div id="titleAudio"></div></details>
          ${SQ.isLocal ? '<p class="hint">Local test mode: open player tabs in this same browser.</p>' : ''}
        </div>
        <div class="title-art">
          <div class="age-badge"><span>${AGE}</span></div>
          <div class="mascot hero float" id="titleRat">${birthdayRat()}</div>
        </div>
      </section>`;
    $('#btnStart')?.addEventListener('click', () => { if (!canResume || confirm(`Start a new party? Room ${saved.code} and its scores will be gone, and everyone has to join again.`)) startParty(false); });
    $('#btnResume')?.addEventListener('click', () => startParty(true));
    // Easter egg: poke the birthday rat. Five pokes and it rains cheese.
    let pokes = 0;
    $('#titleRat').addEventListener('click', (e) => {
      A.ensure(); A.sfx.squeak();
      const r = e.currentTarget.firstElementChild; r.classList.remove('egg-poke'); void r.getBoundingClientRect(); r.classList.add('egg-poke');
      if (++pokes % 5 === 0) cheeseRain();
    });
    const box = $('#titleAudio');
    const paint = () => { box.innerHTML = A.panelHTML(); A.bindPanel(box, (re) => re && paint()); };
    A.loadTracks().then(paint);
  }

  function renderLobby() {
    const qr = qrcode(0, 'M'); qr.addData(joinUrl()); qr.make();
    const credits = A.credits();
    stage.innerHTML = `
      <section class="lobby">
        ${deco('lobby')}
        <div class="join">
          <p class="kicker">Scan to join</p>
          <div class="qr-card">${qr.createSvgTag({ cellSize: 8, margin: 1, scalable: true })}</div>
          <p class="url">${esc(shortUrl())}</p>
          <p class="kicker">Room code</p>
          <p class="room-code">${esc(S.code)}</p>
        </div>
        <div class="guests">
          <div class="guests-head">
            <span class="big-num" id="lobbyNum">0</span>
            <div><h2>rats at the party</h2><p class="muted" id="lobbyCount">${esc(NAME)} turns ${AGE} today</p></div>
          </div>
          <div class="guest-list" id="lobbyRats"></div>
          <div class="lobby-foot">
            <span class="muted">Tap a name to remove it</span>
            <button class="btn primary big" id="btnGo">Start the quiz &rarr;</button>
          </div>
        </div>
      </section>
      ${credits.length ? `<p class="credits">Music: ${credits.map(esc).join(' &middot; ')}</p>` : ''}`;
    $('#btnGo').addEventListener('click', next);
    lobbySeen.clear();
    renderLobbyPlayers();
    A.playSlot('lobby');
  }

  function renderLobbyPlayers() {
    const box = $('#lobbyRats'); if (!box) return;
    const list = Object.entries(S.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    // Only a rat that just walked in pops; the others stay put.
    box.innerHTML = list.length ? list.map(([id, p]) => `<button class="guest ${lobbySeen.has(id) ? '' : 'pop-in'} ${p.bday ? 'guest-bday' : ''}" data-id="${esc(id)}" title="Remove ${esc(p.name)}">${avatar(id)}<span>${esc(p.name)}</span></button>`).join('')
      : '<p class="empty">Waiting for the first rat&hellip;</p>';
    const grew = list.some(([id]) => !lobbySeen.has(id)) && lobbySeen.size > 0;
    list.forEach(([id]) => lobbySeen.add(id));
    const num = $('#lobbyNum'); num.textContent = list.length;
    if (grew) { num.classList.remove('bump'); void num.offsetWidth; num.classList.add('bump'); }
    const btn = $('#btnGo'); btn.disabled = !list.length;
    box.querySelectorAll('.guest').forEach((b) => b.addEventListener('click', () => {
      const p = S.players[b.dataset.id];
      if (p && confirm(`Remove ${p.name} from the game?`)) { delete S.players[b.dataset.id]; lobbySeen.delete(b.dataset.id); S.kicked.push(b.dataset.id); persist(); link.send('kick', { id: b.dataset.id }); renderLobbyPlayers(); broadcastAll(); }
    }));
  }

  function mediaHTML(cq, size, forIntro) {
    if (!cq.media) return '';
    if (cq.media.image) return `<div class="media ${size}"><img src="${esc(cq.media.image)}" alt=""></div>`;
    if (cq.media.video) return forIntro
      ? `<div class="media ${size}"><video id="introVideo" src="${esc(cq.media.video)}" playsinline preload="auto"></video><button class="btn ghost small skip" id="btnSkipVideo">Skip video</button></div>`
      : `<div class="media ${size}"><video src="${esc(cq.media.video)}#t=0.1" muted playsinline preload="metadata"></video></div>`;
    return '';
  }

  const qLabel = () => (q().type === 'dare' ? 'Surprise dare' : `Question ${pad(realNo())} <span>/ ${pad(realTotal())}</span>`);

  // A white flash over everything, for the moments something lands.
  function flash() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const f = document.createElement('div'); f.className = 'flash'; document.body.appendChild(f);
    f.addEventListener('animationend', () => f.remove()); setTimeout(() => f.remove(), 900);
  }

  // A dare does not get the calm question intro. It interrupts: siren, warning stripes, a title that slams in,
  // a mystery silhouette, and only then what the dare is.
  function renderDareIntro(cq) {
    stage.innerHTML = `
      <section class="dare-intro">
        <div class="di-stripes" aria-hidden="true"></div>
        <div class="di-bars" aria-hidden="true"><span></span><span></span></div>
        <div class="di-who" aria-hidden="true"><div class="di-spot"></div><div class="di-sil">${SQ.ratSVG()}</div><b>?</b></div>
        <div class="di-copy">
          <p class="di-warn"><b>Warning</b><b>Warning</b><b>Warning</b></p>
          <h2 class="di-title"><span>A dare</span><span>approaches</span></h2>
          <div class="di-task"><small>The dare &middot; ${fmt(cq.points)} points</small><p>${esc(cq.text)}</p><span>The wheel decides who.</span></div>
        </div>
      </section>`;
    flash();
  }

  function renderIntro() {
    const cq = q();
    if (cq.type === 'dare') return renderDareIntro(cq);
    stage.innerHTML = `
      <section class="intro ${cq.media ? 'has-media' : ''}">
        ${deco('intro')}
        <p class="kicker big">${S.qi === finalIdx() && realTotal() > 1 ? 'Final question' : qLabel()}${isDouble() ? ' <b class="intro-stamp">Double points</b>' : isBetQ() ? ' <b class="intro-stamp">The bets are in</b>' : cq.type === 'vote' ? ' <b class="intro-stamp">Majority wins</b>' : cq.type === 'dare' ? ` <b class="intro-stamp">${fmt(cq.points)} points</b>` : cq.type === 'write' ? ' <b class="intro-stamp">Write your own answer</b>' : ''}</p>
        <h2 class="q-display">${esc(cq.text)}</h2>
        ${mediaHTML(cq, 'large', true)}
        ${cq.media?.video ? '' : '<div class="intro-bar"><span></span></div>'}
        <div class="mascot corner">${birthdayRat()}</div>
      </section>`;
    $('#btnSkipVideo')?.addEventListener('click', () => { const v = $('#introVideo'); v.pause(); A.resumeMusic(); startQuestion(); });
  }

  function answersHTML(cq, reveal) {
    const tick = `<span class="tick">${GLYPHS.yes}</span>`;
    if (cq.type === 'number') {
      const unit = cq.unit ? `<span class="num-unit">${esc(cq.unit)}</span>` : '';
      if (!reveal) return `<div class="num-panel"><div class="num-answer"><span class="num-big">?</span>${unit}</div><p class="num-hint">Set your number on your phone, then lock it in.${cq.closest ? ' <b>The closer you are, the more points.</b>' : ''}</p></div>`;
      // Every number somebody guessed, plus the right one, as a small bar chart.
      const c = cq.correct[0];
      const vals = [...new Set([...Object.keys(S.counts).map(Number), c])].sort((a, b) => a - b);
      const top = Math.max(1, ...Object.values(S.counts));
      const best = Math.min(...Object.keys(S.counts).map((v) => Math.abs(Number(v) - c)), Infinity); // how far off the closest guess was
      return `<div class="num-panel">
        <div class="num-answer rv-late"><span class="num-big">${c}</span>${unit}</div>
        <div class="num-hist">${vals.map((v) => `<div class="num-col ${v === c ? 'correct' : cq.closest && S.counts[v] && Math.abs(v - c) === best ? 'closest' : 'wrong'}" style="--share:${((S.counts[v] || 0) / top).toFixed(3)}"><span class="num-count">${S.counts[v] || 0}</span><span class="num-bar"></span><span class="num-val">${v}</span></div>`).join('')}</div>
      </div>`;
    }
    if (cq.type === 'write') {
      // The written answers, without names; on the reveal the votes, most first, and who wrote each one.
      if (!cq.options.length) return '<div class="num-panel"><p class="num-hint write-hint">Nobody wrote an answer this time.</p></div>';
      let list = cq.options.map((o, i) => ({ o, i, n: reveal ? S.counts[i] || 0 : 0 }));
      if (reveal) list = list.sort((x, y) => y.n - x.n);
      const top = Math.max(1, ...list.map((x) => x.n));
      return `<div class="write-grid ${list.length > 9 ? 'many' : ''} ${list.length <= 4 ? 'few' : ''}">${list.map(({ o, i, n }) => `<div class="write-opt ${reveal ? (cq.correct.includes(i) ? 'correct' : 'other') : ''}" style="--share:${(n / top).toFixed(3)}"><span class="label">${esc(o.label)}</span>${reveal ? `<span class="write-by rv-late">${S.players[o.pid] ? avatar(o.pid) : ''}${esc(S.players[o.pid]?.name || '')}</span><span class="count">${n}</span>` : ''}</div>`).join('')}</div>`;
    }
    if (cq.guests) {
      // Vote for a guest: everyone's rat and name; on the reveal the votes, most first, with the winner lit up.
      const top = Math.max(1, ...(reveal ? S.counts : [1]));
      let list = cq.options.map((o, i) => ({ o, i, n: reveal ? S.counts[i] || 0 : 0 }));
      if (reveal) { list = list.sort((x, y) => y.n - x.n); if (list.some((x) => x.n)) list = list.filter((x) => x.n); } // only the rats somebody voted for
      return `<div class="vote-grid ${list.length > 15 ? 'many' : ''} ${reveal ? 'tally' : ''}">${list.map(({ o, i, n }) => `<div class="vote-opt ${reveal ? (cq.correct.includes(i) ? 'correct' : n ? 'some' : 'wrong') : ''}" style="--share:${(n / top).toFixed(3)}">${SQ.avatar(o.pid, '', !!o.bd)}<span class="label">${esc(o.label)}</span>${reveal ? `<span class="count">${n}</span>` : ''}</div>`).join('')}</div>`;
    }
    const most = Math.max(1, ...(reveal ? S.counts : [1]));
    const share = (i) => (reveal ? (S.counts[i] / most).toFixed(3) : 0); // how full this answer's bar is on the reveal
    if (cq.type === 'photo') {
      return `<div class="photo-grid n${cq.options.length}">${cq.options.map((o, i) => {
        const st = ANSWERS[i]; const ok = cq.correct.includes(i);
        return `<figure class="photo-opt ${reveal ? (ok ? 'correct' : 'wrong') : ''}" style="--c:${st.color};--ink:${st.ink};--share:${share(i)}">
          <img src="${esc(o.image)}" alt="${esc(o.label)}">
          <figcaption><span class="chip">${st.glyph}</span><span class="label">${esc(o.label)}</span>${reveal ? `<span class="count">${S.counts[i]}</span>` : ''}</figcaption>
          ${reveal && ok ? tick : ''}
        </figure>`;
      }).join('')}</div>`;
    }
    const long = cq.options.some((o) => o.label.length > 34); // one long answer: all four get the smaller size, so they match
    return `<div class="answer-grid n${cq.options.length} ${cq.type}">${cq.options.map((o, i) => {
      const st = answerStyle(cq.type, i); const ok = cq.correct.includes(i);
      return `<div class="answer ${long ? 'long' : ''} ${reveal ? (ok ? 'correct' : 'wrong') : ''}" style="--c:${st.color};--ink:${st.ink};--share:${share(i)}">
        <span class="chip">${st.glyph}</span>${o.icon ? `<img class="answer-icon" src="${esc(o.icon)}" alt="">` : ''}<span class="label">${esc(o.label)}</span>
        ${reveal ? `<span class="count">${S.counts[i]}</span>${ok ? tick : ''}` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function qHead(cq, right) {
    return `<header class="q-head">
        <div class="q-copy"><p class="kicker">${qLabel()}</p><h2 class="q-title">${esc(cq.text)}</h2></div>
        ${right}
      </header>`;
  }

  function renderQuestion() {
    const cq = q();
    const middle = cq.type === 'photo' ? '' : (mediaHTML(cq, 'medium', false) || `<div class="mascot mid bob">${birthdayRat()}</div>`);
    stage.innerHTML = `
      <section class="question ${cq.type} ${cq.type === 'write' ? 'voting' : ''}">
        ${qHead(cq, `${isDouble() ? '<span class="q-double">Double points</span>' : isBetQ() ? '<span class="q-double">Bets are in</span>' : cq.type === 'vote' ? '<span class="q-double">Majority wins</span>' : cq.type === 'write' ? '<span class="q-double">Vote for the best</span>' : ''}<div class="timer" id="timer"><div class="ring" id="timerRing" style="--p:1"></div><span id="timeLeft">${cq.timeLimit}</span></div>`)}
        <div class="q-body">
          <div class="q-visual">${middle}</div>
          <div class="answered"><span id="answered">0 / ${playerCount()}</span><small>answered</small><div class="q-faces" id="qFaces"></div><p class="q-waiting" id="qWaiting"></p><button class="btn ghost small" id="btnSkip">End now</button></div>
        </div>
        ${answersHTML(cq, false)}
      </section>`;
    $('#btnSkip').addEventListener('click', () => { S.endsAt = performance.now(); });
  }

  function renderReveal() {
    const cq = q();
    const right = Object.values(S.answers).filter((a) => a.correct).length;
    const mood = cq.type === 'write' || right >= Math.max(1, playerCount() / 2) ? 'happy' : 'sad';
    const middle = cq.type === 'photo' ? '' : (mediaHTML(cq, 'medium', false) || `<div class="mascot mid rv-late ${mood === 'happy' ? 'hop' : 'droop'}">${birthdayRat({ mood })}</div>`);
    const spotOn = Object.values(S.answers).some((a) => a.off === 0);
    const label = !answeredCount() ? 'nobody answered' : cq.type === 'vote' ? (right ? 'voted with the room' : 'no two rats agreed') : cq.closest && !spotOn ? (right === 1 ? 'was closest' : 'were closest') : right === 0 ? 'not a single rat' : right === playerCount() && right > 1 ? 'full house' : 'got it right';
    const f = S.fastest && S.players[S.fastest];
    const wi = cq.type === 'write' ? cq.correct.map((i) => cq.options[i]).filter((o) => S.players[o.pid]) : [];
    const wrote = wi.length ? `<div class="rv-fast rv-late">${avatar(wi[0].pid)}<div><small>The room's favourite</small><strong>${esc(wi.map((o) => S.players[o.pid].name).join(' & '))}</strong><span>+1,000</span></div></div>` : '';
    const fastest = cq.type === 'write' ? wrote : f ? `<div class="rv-fast rv-late">${avatar(S.fastest)}<div><small>Fastest paw</small><strong>${esc(f.name)}</strong><span>${S.answers[S.fastest].t.toFixed(1)} s</span></div></div>` : '';
    const won = Object.entries(S.wagers).sort((x, y) => y[1] - x[1])[0]; const lost = Object.entries(S.wagers).sort((x, y) => x[1] - y[1])[0];
    const betLine = (label, e) => (e && S.players[e[0]] ? `<div class="rv-fast rv-bet rv-late">${avatar(e[0])}<div><small>${label}</small><strong>${esc(S.players[e[0]].name)}</strong><span>${e[1] > 0 ? '+' : '&minus;'}${fmt(Math.abs(e[1]))}</span></div></div>` : '');
    const bets = (won && won[1] > 0 ? betLine('Biggest bet won', won) : '') + (lost && lost[1] < 0 ? betLine('Biggest bet lost', lost) : '');
    stage.innerHTML = `
      <section class="question reveal ${cq.type}">
        ${qHead(cq, cq.type === 'write' ? `<div class="stat rv-late"><span class="stat-num">${Math.max(0, ...Object.values(S.votesFor))}<small>/${answeredCount()}</small></span><span class="stat-label">votes for the favourite</span></div>`
          : `<div class="stat rv-late"><span class="stat-num">${right}<small>/${playerCount()}</small></span><span class="stat-label">${label}</span></div>`)}
        <div class="q-body">
          <div class="q-visual">${middle}</div>
          <div class="rv-side">${bets || fastest}<button class="btn primary big" id="btnNext">${S.qi + 1 >= total() ? 'Final results &rarr;' : 'Leaderboard &rarr;'}</button></div>
        </div>
        ${answersHTML(cq, true)}
      </section>`;
    $('#btnNext').addEventListener('click', next);
    if (cq.after) later(() => playAfter(cq, autoNext), REVEAL_MS + 2800); else autoNext();
  }

  // The clip is fetched while the question is still being asked, so it starts at once when its moment comes.
  const clips = {};
  function clipFor(cq) {
    const src = cq.after.video;
    if (!clips[src]) { const v = document.createElement('video'); v.playsInline = true; v.preload = 'auto'; v.src = src; v.load(); clips[src] = v; }
    return clips[src];
  }

  // A clip after the answer: it takes over the screen once the right answer has had its moment, plays (for at most
  // "seconds"), and only then does the screen start counting down to the leaderboard.
  function playAfter(cq, done) {
    if (S.phase !== 'reveal' || q() !== cq) return;
    A.stopMusic();
    const box = document.createElement('div'); box.className = 'after-video'; box.id = 'afterVideo';
    box.innerHTML = '<button class="btn ghost small" id="btnSkipAfter">Skip video</button>';
    const v = clipFor(cq); v.currentTime = 0; box.prepend(v);
    stage.appendChild(box);
    v.muted = A.muted; let over = false;
    const end = () => { if (over) return; over = true; v.pause(); box.classList.add('out'); setTimeout(() => box.remove(), 350); if (S.phase === 'reveal' && q() === cq) done(); };
    v.addEventListener('ended', end);
    v.addEventListener('error', () => later(end, 800));
    if (cq.after.seconds) v.addEventListener('timeupdate', () => { if (v.currentTime >= cq.after.seconds) end(); });
    later(end, ((cq.after.seconds || 120) + 6) * 1000); // whatever happens, the quiz goes on
    box.querySelector('#btnSkipAfter').addEventListener('click', end);
    v.play().catch(() => { v.muted = true; v.play().catch(() => later(end, 800)); });
  }

  // Count a number up (or down) in an element.
  function countUp(el, from, to, ms = 1200) {
    if (!el || from === to) return;
    const t0 = performance.now();
    (function step(now) {
      const k = Math.min(1, (now - t0) / ms); const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    })(t0);
  }

  function renderLeaderboard() {
    const list = ranked(); const top = list.slice(0, 5);
    const max = Math.max(1, ...top.map((p) => p.score));
    const move = (p, i) => (S.moves && S.prevRanks[p.id] !== undefined ? S.prevRanks[p.id] - i : 0);
    // Callouts: who climbed the most, and who is on the longest streak.
    const climber = list.map((p, i) => ({ p, d: move(p, i) })).filter((x) => x.d >= 2).sort((a, b) => b.d - a.d)[0];
    const hot = list.filter((p) => (p.streak || 0) >= 3).sort((a, b) => b.streak - a.streak)[0];
    const callout = (label, p, text) => `<div class="lb-callout">${avatar(p.id)}<div><small>${label}</small><strong>${esc(p.name)}</strong><span>${text}</span></div></div>`;
    const finalNext = isDouble(S.qi + 1); const betNext = isBetQ(S.qi + 1);
    let note = '';
    if (betNext) note = 'One question left. <b>First: bet your cheese.</b>';
    else if (finalNext) note = 'Last question next. <b>Double points.</b> Still anyone\'s game.';
    else if (list[1] && list[0].score > 0) { const gap = list[0].score - list[1].score; note = gap === 0 ? `<b>${esc(list[0].name)}</b> and <b>${esc(list[1].name)}</b> are tied at the top.` : `<b>${esc(list[1].name)}</b> is ${fmt(gap)} points off the lead.`; }
    stage.innerHTML = `
      <section class="leaderboard">
        ${deco('lb')}
        <header>
          <div><p class="kicker">${q().type === 'dare' ? 'After the dare' : `After question ${realNo()} of ${realTotal()}`}</p><h2 class="display-md">Top rats</h2></div>
          <div class="lb-callouts">${climber ? callout('Biggest climber', climber.p, `up ${climber.d} places`) : ''}${hot ? callout('On a streak', hot, `${hot.streak} right in a row`) : ''}</div>
        </header>
        <ol class="ranks">${top.map((p, i) => {
          const before = S.prevScores[p.id] ?? p.score; const gained = p.score - before; const d = move(p, i);
          const tags = `${d ? `<span class="lb-move ${d > 0 ? 'up' : 'down'}">${ARROW(d > 0 ? 'up' : 'down')}${Math.abs(d)}</span>` : ''}${(p.streak || 0) >= 2 ? `<span class="lb-streak">${p.streak} in a row</span>` : ''}`;
          return `<li style="--i:${i}" data-from="${S.moves ? Math.min(S.prevRanks[p.id] ?? 5, 5) : i}" data-d="${d}">
            <span class="rank">${i + 1}</span>
            ${avatar(p.id)}
            <div class="lb-who"><span class="who">${esc(p.name)}</span>${tags ? `<span class="lb-tags">${tags}</span>` : ''}</div>
            <div class="score-bar"><span data-w="${(p.score / max) * 100}" style="width:${(before / max) * 100}%"></span></div>
            <span class="pts"><span class="lb-num" data-from="${before}" data-to="${p.score}">${fmt(before)}</span>${gained > 0 ? `<small>+${fmt(gained)}</small>` : ''}</span>
          </li>`;
        }).join('')}</ol>
        <div class="lb-foot">
          <p class="lb-note">${note}${list.length > 5 ? ` <span>${list.length - 5} more rat${list.length - 5 === 1 ? '' : 's'} below. Your place is on your phone.</span>` : ''}</p>
          <button class="btn dark big" id="btnNext">${betNext ? 'Place your bets' : finalNext ? 'Final question' : 'Next question'} &rarr;</button>
        </div>
      </section>`;
    // Rows start where they stood before this question, then slide to their new place while the scores count up.
    const rows = [...stage.querySelectorAll('.ranks li')];
    const h = rows[0] ? rows[0].offsetHeight : 0;
    rows.forEach((li, i) => { const from = Number(li.dataset.from) - i; if (from) { li.style.transform = `translateY(${from * h}px)`; if (Number(li.dataset.from) >= 5) li.style.opacity = 0; } });
    later(() => {
      stage.querySelector('.ranks')?.classList.add('lb-go');
      let ups = 0;
      rows.forEach((li) => { li.style.transform = ''; li.style.opacity = ''; if (Number(li.dataset.d) > 0) { const n = ups++; later(() => A.sfx.blip(n), 150 + n * 120); } });
      stage.querySelectorAll('.score-bar span').forEach((el) => { el.style.width = el.dataset.w + '%'; });
      stage.querySelectorAll('.lb-num').forEach((el) => countUp(el, Number(el.dataset.from), Number(el.dataset.to), 1400));
    }, 700);
    $('#btnNext').addEventListener('click', next);
    autoNext();
  }

  // End-of-game awards, so more than three rats get a moment.
  function awards() {
    const ps = Object.entries(S.players).map(([id, p]) => ({ id, ...p }));
    const best = (arr, key, dir) => arr.sort((a, b) => dir * (a[key] - b[key]) || a.joinedAt - b.joinedAt)[0];
    const out = [];
    const fast = best(ps.filter((p) => typeof p.fast === 'number' && p.fast < 999), 'fast', 1);
    if (fast) out.push({ label: 'Fastest paw', p: fast, text: `${fast.fast.toFixed(1)} s answer` });
    const streak = best(ps.filter((p) => (p.best || 0) >= 2), 'best', -1);
    if (streak) out.push({ label: 'Hottest streak', p: streak, text: `${streak.best} right in a row` });
    const climb = best(ps.filter((p) => (p.climb || 0) >= 2), 'climb', -1);
    if (climb) out.push({ label: 'Comeback rat', p: climb, text: `up ${climb.climb} places at once` });
    return out;
  }

  function renderPodium() {
    const list = ranked(); const [p1, p2, p3] = list;
    // Third, then second, then a long drumroll before the winner. Phones hold back their own result to match.
    const T = list.length >= 3 ? { 3: 1200, 2: 3400, 1: 6600 } : list.length === 2 ? { 2: 1200, 1: 4400 } : { 1: 2400 };
    S.podTimes = T; S.podStart = performance.now();
    const card = (p, place) => p ? `<div class="card place${place}" style="--d:${T[place] / 1000}s">
        ${place === 1 ? CROWN : ''}
        <span class="place">#${place}</span>
        ${avatar(p.id, 'big')}
        <p class="pname">${esc(p.name)}</p>
        <p class="pscore">${fmt(p.score)} pts</p>
      </div>` : '<div class="card empty"></div>';
    const credits = A.credits();
    const aw = awards(); const rest = list.slice(3);
    const after = (T[1] + 1800) / 1000;
    stage.innerHTML = `
      <section class="podium" style="--after:${after}s">
        ${deco('podium')}
        <header><p class="kicker">Final results</p><h2 class="display-md">The big cheese</h2></header>
        <div class="pod-extra">
          ${aw.length ? `<div class="pod-awards">${aw.map((a) => `<div class="pod-award">${avatar(a.p.id)}<div><small>${a.label}</small><strong>${esc(a.p.name)}</strong><span>${a.text}</span></div></div>`).join('')}</div>` : ''}
          ${rest.length ? `<ol class="pod-rest" start="4">${rest.map((p, i) => `<li><b>${i + 4}</b>${esc(p.name)}<span>${fmt(p.score)}</span></li>`).join('')}</ol>` : ''}
        </div>
        <div class="winners">${card(p2, 2)}${card(p1, 1)}${card(p3, 3)}</div>
        <aside class="bday"><div class="mascot hop">${birthdayRat()}</div><p>Happy ${AGE}th,<br>${esc(NAME)}!</p></aside>
        <div class="podium-actions"><button class="btn ghost" id="btnAgain">Play again</button><button class="btn ghost" id="btnNew">New game</button></div>
        ${credits.length ? `<p class="credits">Music: ${credits.map(esc).join(' &middot; ')}</p>` : ''}
      </section>`;
    A.stopMusic();
    A.sfx.roll(Math.min(T[1], 1100) / 1000);
    if (T[3]) later(() => A.sfx.chime(), T[3]);
    if (T[2]) { later(() => A.sfx.chime(), T[2]); later(() => A.sfx.roll((T[1] - T[2] - 500) / 1000), T[2] + 450); }
    later(() => { SQ.confetti(6000); A.sfx.fanfare(); A.playSlot('podium'); }, T[1]);
    later(() => A.sfx.horn(), T[1] + 900);
    $('#btnAgain').addEventListener('click', playAgain);
    $('#btnNew').addEventListener('click', () => { if (confirm('Start a brand new game? Players will need to join again.')) { localStorage.removeItem(STORE); location.reload(); } });
  }

  // ---------- easter eggs ----------
  function cheeseRain() { A.ensure(); SQ.confetti(4500, 'cheese'); A.sfx.chime(); }
  function stampede() {
    A.ensure();
    const el = document.createElement('div'); el.className = 'egg-run';
    el.innerHTML = Array.from({ length: 7 }, (_, i) => `<span style="--n:${i}">${SQ.playerRat(SQ.uid())}</span>`).join('');
    document.body.appendChild(el);
    [0, 250, 600, 900, 1400].forEach((ms) => setTimeout(() => A.sfx.squeak(), ms));
    setTimeout(() => el.remove(), 4200);
  }
  // Type a secret word on the host keyboard (not while typing in a field).
  const EGGS = { rat: stampede, cheese: cheeseRain, [String(AGE)]: () => { A.ensure(); SQ.confetti(4000); A.sfx.fanfare(); toast(`Happy ${AGE}th, ${NAME}!`); } };
  let typed = '';
  function secretKey(key) {
    if (key.length !== 1) return;
    typed = (typed + key.toLowerCase()).slice(-12);
    Object.keys(EGGS).forEach((word) => { if (typed.endsWith(word)) { typed = ''; EGGS[word](); } });
  }

  let toastTimer = null;
  function toast(text, ms = 2500) {
    let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = text; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- controls ----------
  $('#btnMute').addEventListener('click', () => { $('#btnMute').classList.toggle('muted', A.toggleMute()); });
  $('#btnFull').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
  $('#btnSound').addEventListener('click', async () => {
    await A.loadTracks();
    const body = $('#soundBody'); const paint = () => { body.innerHTML = A.panelHTML(); A.bindPanel(body, (re) => re && paint()); };
    paint(); $('#soundDialog').showModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.target.closest('input, select, textarea, dialog')) return;
    if (!e.metaKey && !e.ctrlKey && !e.altKey) secretKey(e.key);
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'm' || e.key === 'M') $('#btnMute').click();
    if (e.key === 'f' || e.key === 'F') $('#btnFull').click();
    if (e.key === 'p' || e.key === 'P') $('#btnHold')?.click();
  });
  window.addEventListener('beforeunload', (e) => { if (S.phase !== 'title' && S.phase !== 'podium') { e.preventDefault(); e.returnValue = ''; } });
  $('#btnMute').classList.toggle('muted', A.muted);

  loadQuestions().then(render);
  window.__host = S; window.__pickDare = pickDare; // for debugging in the console, and for the tests
})();
