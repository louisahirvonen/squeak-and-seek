// Host screen: runs the game and holds all state.
(function () {
  const { escapeHtml: esc, ANSWERS, GLYPHS, answerStyle, birthdayRat, avatar, pointsFor, ordinal, fmt } = SQ;
  const AGE = SQ.cfg.birthdayAge || 24;
  const TONES = ['pink', 'lime', 'lilac', 'orange', 'sky'];
  const pad = (n) => String(n).padStart(2, '0');
  const deco = (v) => `<div class="deco deco-${v}" aria-hidden="true"><span class="s1"></span><span class="s2"></span><span class="s3"></span><span class="s4"></span></div>`;
  const CROWN = '<svg class="crown" viewBox="0 0 64 40" aria-hidden="true"><path fill="currentColor" d="M4 12l14 12L32 4l14 20 14-12-6 28H10z"/></svg>';
  const A = SQAudio;
  const STORE = 'squeak-host';
  const INTRO_MS = 4000;
  const LATE_GRACE_S = 1.2;
  const NAME = SQ.cfg.birthdayName || 'Louisa';

  const $ = (sel, root = document) => root.querySelector(sel);
  const stage = $('#stage');

  const S = {
    phase: 'title', code: null, title: 'Squeak & Seek', questions: [], errors: [], loadError: null,
    players: {}, qi: -1, done: 0, answers: {}, counts: [], qStart: 0, limit: 20, endsAt: 0, seq: 0,
    prevScores: {}, lastTick: null,
  };
  let link = null; let heartbeat = null; let timerRaf = null; let introTimer = null; let ending = false;

  // ---------- persistence ----------
  const persist = () => localStorage.setItem(STORE, JSON.stringify({ code: S.code, players: S.players, done: S.done, savedAt: Date.now() }));
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } };

  // ---------- helpers ----------
  const q = () => S.questions[S.qi];
  const total = () => S.questions.length;
  const ranked = () => Object.entries(S.players).map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.score - a.score || (a.reachedAt || 0) - (b.reachedAt || 0) || a.joinedAt - b.joinedAt);
  const playerCount = () => Object.keys(S.players).length;
  const answeredCount = () => Object.keys(S.answers).length;
  const joinUrl = () => {
    const base = location.href.split('#')[0].replace(/host\.html.*$/, '');
    return `${base}?room=${S.code}${SQ.isLocal ? '&transport=local' : ''}`;
  };
  const shortUrl = () => location.href.split('#')[0].replace(/host\.html.*$/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const makeCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');

  // ---------- networking ----------
  function connect() {
    if (link) link.close();
    link = SQ.connect({ code: S.code, role: 'host', events: ['join', 'answer'], onMessage, onStatus: (s) => { $('#barCode')?.classList.toggle('offline', s !== 'SUBSCRIBED'); if (s === 'SUBSCRIBED') broadcastAll(); } });
    clearInterval(heartbeat);
    heartbeat = setInterval(() => { if (S.phase !== 'title') broadcastState(); }, 4000);
  }

  function statePayload() {
    const cq = q();
    const p = { phase: S.phase, code: S.code, title: S.title, q: S.qi, total: total(), seq: ++S.seq, players: playerCount() };
    if (cq && ['intro', 'question', 'reveal'].includes(S.phase)) {
      p.type = cq.type; p.n = cq.options.length; p.video = !!cq.media?.video;
      if (cq.type === 'photo') p.opts = cq.options.map((o) => ({ label: o.label, image: o.image }));
      if (S.phase === 'question') p.endsIn = Math.max(0, S.endsAt - performance.now());
      if (S.phase === 'reveal') p.correct = cq.correct;
    }
    return p;
  }
  const broadcastState = () => link && link.send('state', statePayload());
  function broadcastStandings() {
    if (!link) return;
    const r = {};
    ranked().forEach((p, i) => {
      const a = S.answers[p.id];
      r[p.id] = { n: p.name, s: p.score, k: i + 1 };
      if (S.phase === 'reveal' && q()) { r[p.id].c = a ? a.correct : null; r[p.id].p = a ? a.points : 0; }
    });
    link.send('results', { q: S.qi, phase: S.phase, r, total: playerCount() });
  }
  const broadcastAll = () => { broadcastState(); broadcastStandings(); };

  function onMessage(event, msg) {
    if (!msg || !msg.id || S.phase === 'title') return;
    if (event === 'join') return onJoin(msg);
    if (event === 'answer') return onAnswer(msg);
  }

  function onJoin({ id, name }) {
    const existing = S.players[id];
    if (!existing) {
      let clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 15) || 'Rat';
      const taken = new Set(Object.values(S.players).map((p) => p.name.toLowerCase()));
      let final = clean; let n = 2;
      while (taken.has(final.toLowerCase())) final = `${clean.slice(0, 12)} ${n++}`;
      S.players[id] = { name: final, score: 0, reachedAt: 0, joinedAt: Date.now() };
      persist();
      A.sfx.squeak();
      if (S.phase === 'lobby') renderLobbyPlayers();
      else toast(`${final} joined`);
    }
    broadcastAll();
  }

  function onAnswer({ id, q: qi, choice }) {
    if (S.phase !== 'question' || qi !== S.qi || !S.players[id] || S.answers[id]) return;
    const cq = q();
    if (!Number.isInteger(choice) || choice < 0 || choice >= cq.options.length) return;
    const t = (performance.now() - S.qStart) / 1000;
    if (t > S.limit + LATE_GRACE_S) return;
    const correct = cq.correct.includes(choice);
    S.answers[id] = { choice, t, correct, points: correct ? pointsFor(t, S.limit) : 0, at: Date.now() };
    const el = $('#answered'); if (el) el.textContent = `${answeredCount()} / ${playerCount()}`;
    A.sfx.pop();
    if (answeredCount() >= playerCount()) setTimeout(endQuestion, 400);
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
    if (saved) { S.code = saved.code; S.players = saved.players || {}; S.done = saved.done || 0; }
    else { S.code = makeCode(); S.players = {}; S.done = 0; localStorage.removeItem(STORE); }
    persist(); connect();
    $('#bar').hidden = false; $('#barCode').textContent = S.code;
    if (S.done === 0) { S.qi = -1; go('lobby'); }
    else if (S.done >= total()) { S.qi = total() - 1; go('podium'); }
    else { S.qi = S.done - 1; S.prevScores = Object.fromEntries(Object.entries(S.players).map(([id, p]) => [id, p.score])); go('leaderboard'); }
  }

  function go(phase) {
    S.phase = phase;
    clearTimeout(introTimer); cancelAnimationFrame(timerRaf);
    render();
    broadcastAll();
  }

  function nextQuestion() {
    if (S.qi + 1 >= total()) return go('podium');
    S.qi += 1; S.answers = {}; ending = false;
    const cq = q();
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
      introTimer = setTimeout(startQuestion, INTRO_MS);
    }
  }

  function startQuestion() {
    const cq = q();
    S.limit = cq.timeLimit; S.answers = {};
    S.qStart = performance.now(); S.endsAt = S.qStart + S.limit * 1000; S.lastTick = null;
    go('question');
    A.sfx.go(); A.playSlot('question');
    const loop = () => {
      if (S.phase !== 'question') return;
      const left = Math.max(0, (S.endsAt - performance.now()) / 1000);
      const el = $('#timeLeft'); if (el) el.textContent = Math.ceil(left);
      const ring = $('#timerRing'); if (ring) ring.style.setProperty('--p', (left / S.limit).toFixed(4));
      const whole = Math.ceil(left);
      if (whole <= 5 && whole > 0 && whole !== S.lastTick) { S.lastTick = whole; A.sfx.tick(); $('#timer')?.classList.add('urgent'); }
      if (left <= 0) { setTimeout(endQuestion, 600); return; }
      timerRaf = requestAnimationFrame(loop);
    };
    timerRaf = requestAnimationFrame(loop);
  }

  function endQuestion() {
    if (S.phase !== 'question' || ending) return;
    ending = true;
    A.stopMusic();
    const cq = q();
    S.prevScores = Object.fromEntries(Object.entries(S.players).map(([id, p]) => [id, p.score]));
    S.counts = cq.options.map(() => 0);
    Object.entries(S.answers).forEach(([id, a]) => {
      S.counts[a.choice] += 1;
      const p = S.players[id]; if (!p) return;
      if (a.correct) { p.score += a.points; p.reachedAt = a.at; }
    });
    S.done = S.qi + 1; persist();
    const right = Object.values(S.answers).filter((a) => a.correct).length;
    go('reveal');
    if (right >= Math.max(1, playerCount() / 2)) A.sfx.chime(); else A.sfx.womp();
  }

  function next() {
    if (S.phase === 'lobby' && playerCount() > 0) return nextQuestion();
    if (S.phase === 'reveal') { if (S.qi + 1 >= total()) return go('podium'); go('leaderboard'); A.sfx.whoosh(); A.playSlot('lobby'); return; }
    if (S.phase === 'leaderboard') return nextQuestion();
  }

  function playAgain() {
    Object.values(S.players).forEach((p) => { p.score = 0; p.reachedAt = 0; });
    S.qi = -1; S.done = 0; S.answers = {}; persist(); go('lobby');
  }

  // ---------- rendering ----------
  function render() {
    stage.className = `stage phase-${S.phase}`;
    document.body.dataset.phase = S.phase;
    document.body.dataset.tone = S.qi >= 0 ? TONES[S.qi % TONES.length] : 'pink';
    const prog = $('#barProgress');
    if (prog) prog.textContent = S.qi >= 0 && !['lobby', 'podium'].includes(S.phase) ? `${pad(S.qi + 1)} / ${pad(total())}` : '';
    ({ title: renderTitle, lobby: renderLobby, intro: renderIntro, question: renderQuestion, reveal: renderReveal, leaderboard: renderLeaderboard, podium: renderPodium })[S.phase]();
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
          <p class="lede">${total()} question${total() === 1 ? '' : 's'}. One winner. Grab your phone.</p>
          ${problems.length ? `<div class="errors"><strong>Fix these in questions.json</strong><ul>${problems.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
          <div class="actions">
            <button class="btn primary big" id="btnStart" ${!total() || S.loadError ? 'disabled' : ''}>Start the party &rarr;</button>
            ${canResume ? `<button class="btn ghost big" id="btnResume">Resume room ${esc(saved.code)} &middot; ${Object.keys(saved.players).length} players, ${saved.done} done</button>` : ''}
          </div>
          <details class="sound-details"><summary>Music &amp; sound</summary><div id="titleAudio"></div></details>
          ${SQ.isLocal ? '<p class="hint">Local test mode: open player tabs in this same browser.</p>' : ''}
        </div>
        <div class="title-art">
          <div class="age-badge"><span>${AGE}</span></div>
          <div class="mascot hero float">${birthdayRat()}</div>
        </div>
      </section>`;
    $('#btnStart')?.addEventListener('click', () => startParty(false));
    $('#btnResume')?.addEventListener('click', () => startParty(true));
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
    renderLobbyPlayers();
    A.playSlot('lobby');
  }

  function renderLobbyPlayers() {
    const box = $('#lobbyRats'); if (!box) return;
    const list = Object.entries(S.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    box.innerHTML = list.length ? list.map(([id, p]) => `<button class="guest pop-in" data-id="${esc(id)}" title="Remove ${esc(p.name)}">${avatar(id)}<span>${esc(p.name)}</span></button>`).join('')
      : '<p class="empty">Waiting for the first rat&hellip;</p>';
    $('#lobbyNum').textContent = list.length;
    const btn = $('#btnGo'); btn.disabled = !list.length;
    box.querySelectorAll('.guest').forEach((b) => b.addEventListener('click', () => {
      const p = S.players[b.dataset.id];
      if (p && confirm(`Remove ${p.name} from the game?`)) { delete S.players[b.dataset.id]; persist(); link.send('kick', { id: b.dataset.id }); renderLobbyPlayers(); broadcastAll(); }
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

  const qLabel = () => `Question ${pad(S.qi + 1)} <span>/ ${pad(total())}</span>`;

  function renderIntro() {
    const cq = q();
    stage.innerHTML = `
      <section class="intro ${cq.media ? 'has-media' : ''}">
        ${deco('intro')}
        <p class="kicker big">${qLabel()}</p>
        <h2 class="q-display">${esc(cq.text)}</h2>
        ${mediaHTML(cq, 'large', true)}
        ${cq.media?.video ? '' : '<div class="intro-bar"><span></span></div>'}
        <div class="mascot corner">${birthdayRat()}</div>
      </section>`;
    $('#btnSkipVideo')?.addEventListener('click', () => { const v = $('#introVideo'); v.pause(); A.resumeMusic(); startQuestion(); });
  }

  function answersHTML(cq, reveal) {
    const tick = `<span class="tick">${GLYPHS.yes}</span>`;
    if (cq.type === 'photo') {
      return `<div class="photo-grid n${cq.options.length}">${cq.options.map((o, i) => {
        const st = ANSWERS[i]; const ok = cq.correct.includes(i);
        return `<figure class="photo-opt ${reveal ? (ok ? 'correct' : 'wrong') : ''}" style="--c:${st.color};--ink:${st.ink}">
          <img src="${esc(o.image)}" alt="${esc(o.label)}">
          <figcaption><span class="chip">${st.glyph}</span><span class="label">${esc(o.label)}</span>${reveal ? `<span class="count">${S.counts[i]}</span>` : ''}</figcaption>
          ${reveal && ok ? tick : ''}
        </figure>`;
      }).join('')}</div>`;
    }
    return `<div class="answer-grid n${cq.options.length} ${cq.type}">${cq.options.map((o, i) => {
      const st = answerStyle(cq.type, i); const ok = cq.correct.includes(i);
      return `<div class="answer ${reveal ? (ok ? 'correct' : 'wrong') : ''}" style="--c:${st.color};--ink:${st.ink}">
        <span class="chip">${st.glyph}</span><span class="label">${esc(o.label)}</span>
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
      <section class="question ${cq.type}">
        ${qHead(cq, `<div class="timer" id="timer"><div class="ring" id="timerRing" style="--p:1"></div><span id="timeLeft">${cq.timeLimit}</span></div>`)}
        <div class="q-body">
          <div class="q-visual">${middle}</div>
          <div class="answered"><span id="answered">0 / ${playerCount()}</span><small>answered</small><button class="btn ghost small" id="btnSkip">End now</button></div>
        </div>
        ${answersHTML(cq, false)}
      </section>`;
    $('#btnSkip').addEventListener('click', () => { S.endsAt = performance.now(); });
  }

  function renderReveal() {
    const cq = q();
    const right = Object.values(S.answers).filter((a) => a.correct).length;
    const mood = right >= Math.max(1, playerCount() / 2) ? 'happy' : 'sad';
    const middle = cq.type === 'photo' ? '' : (mediaHTML(cq, 'medium', false) || `<div class="mascot mid ${mood === 'happy' ? 'hop' : 'droop'}">${birthdayRat({ mood })}</div>`);
    stage.innerHTML = `
      <section class="question reveal ${cq.type}">
        ${qHead(cq, `<div class="stat"><span class="stat-num">${right}<small>/${playerCount()}</small></span><span class="stat-label">got it right</span></div>`)}
        <div class="q-body">
          <div class="q-visual">${middle}</div>
          <button class="btn primary big" id="btnNext">${S.qi + 1 >= total() ? 'Final results &rarr;' : 'Leaderboard &rarr;'}</button>
        </div>
        ${answersHTML(cq, true)}
      </section>`;
    $('#btnNext').addEventListener('click', next);
  }

  function renderLeaderboard() {
    const top = ranked().slice(0, 5);
    const max = Math.max(1, ...top.map((p) => p.score));
    stage.innerHTML = `
      <section class="leaderboard">
        ${deco('lb')}
        <header><p class="kicker">After question ${S.qi + 1} of ${total()}</p><h2 class="display-md">Top rats</h2></header>
        <ol class="ranks">${top.map((p, i) => {
          const before = S.prevScores[p.id] ?? p.score; const gained = p.score - before;
          return `<li style="--i:${i}">
            <span class="rank">${i + 1}</span>
            ${avatar(p.id)}
            <span class="who">${esc(p.name)}</span>
            <div class="score-bar"><span data-w="${(p.score / max) * 100}" style="width:${(before / max) * 100}%"></span></div>
            <span class="pts">${fmt(p.score)}${gained > 0 ? `<small>+${fmt(gained)}</small>` : ''}</span>
          </li>`;
        }).join('')}</ol>
        <div class="lb-foot"><button class="btn dark big" id="btnNext">Next question &rarr;</button></div>
      </section>`;
    requestAnimationFrame(() => requestAnimationFrame(() => stage.querySelectorAll('.score-bar span').forEach((el) => { el.style.width = el.dataset.w + '%'; })));
    $('#btnNext').addEventListener('click', next);
  }

  function renderPodium() {
    const [p1, p2, p3] = ranked();
    const card = (p, place, delay) => p ? `<div class="card place${place}" style="--d:${delay}s">
        ${place === 1 ? CROWN : ''}
        <span class="place">#${place}</span>
        ${avatar(p.id, 'big')}
        <p class="pname">${esc(p.name)}</p>
        <p class="pscore">${fmt(p.score)} pts</p>
      </div>` : '<div class="card empty"></div>';
    const credits = A.credits();
    stage.innerHTML = `
      <section class="podium">
        ${deco('podium')}
        <header><p class="kicker">Final results</p><h2 class="display-md">The big cheese</h2></header>
        <div class="winners">${card(p2, 2, 1.4)}${card(p1, 1, 2.8)}${card(p3, 3, 0)}</div>
        <aside class="bday"><div class="mascot hop">${birthdayRat()}</div><p>Happy ${AGE}th,<br>${esc(NAME)}!</p></aside>
        <div class="podium-actions"><button class="btn ghost" id="btnAgain">Play again</button><button class="btn ghost" id="btnNew">New game</button></div>
        ${credits.length ? `<p class="credits">Music: ${credits.map(esc).join(' &middot; ')}</p>` : ''}
      </section>`;
    A.stopMusic(); A.playSlot('podium');
    setTimeout(() => { if (S.phase === 'podium') { SQ.confetti(5000); A.sfx.horn(); } }, 3000);
    $('#btnAgain').addEventListener('click', playAgain);
    $('#btnNew').addEventListener('click', () => { if (confirm('Start a brand new game? Players will need to join again.')) { localStorage.removeItem(STORE); location.reload(); } });
  }

  let toastTimer = null;
  function toast(text) {
    let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = text; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
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
    if (e.target.closest('input, select, textarea, dialog')) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'm' || e.key === 'M') $('#btnMute').click();
    if (e.key === 'f' || e.key === 'F') $('#btnFull').click();
  });
  window.addEventListener('beforeunload', (e) => { if (S.phase !== 'title' && S.phase !== 'podium') { e.preventDefault(); e.returnValue = ''; } });
  $('#btnMute').classList.toggle('muted', A.muted);

  loadQuestions().then(render);
  window.__host = S; // for debugging in the console
})();
