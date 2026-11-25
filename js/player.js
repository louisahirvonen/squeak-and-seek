// Player phone: join, answer, see your result.
(function () {
  const { escapeHtml: esc, ANSWERS, answerStyle, avatar, birthdayRat, ordinal, fmt } = SQ;
  const AGE = SQ.cfg.birthdayAge || 24;
  const pad = (n) => String(n).padStart(2, '0');
  const STORE = 'squeak-player' + (SQ.params.get('slot') || ''); // ?slot= lets several test players share one browser
  const NAME = SQ.cfg.birthdayName || 'Louisa';
  const $ = (sel) => document.querySelector(sel);
  const screen = $('#screen');

  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  const me = { id: saved.id || SQ.uid(), name: saved.name || '', code: saved.code || '' };
  const urlRoom = (SQ.params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  let link = null; let joined = false; let lastState = null; let mine = null; let shownKey = '';
  let lastHeard = 0; let joinRetry = null; let countdown = null; let notFoundTimer = null;
  const answers = (() => { try { return JSON.parse(sessionStorage.getItem('squeak-answers')) || {}; } catch (e) { return {}; } })();
  const saveMe = () => localStorage.setItem(STORE, JSON.stringify(me));

  // ---------- join ----------
  function renderJoin(message = '') {
    shownKey = 'join';
    document.body.dataset.phase = 'join';
    screen.innerHTML = `
      <section class="p-join">
        <div class="p-hero"><div class="mascot p-mascot float">${birthdayRat()}</div><span class="p-age">${AGE}</span></div>
        <p class="kicker">${esc(NAME)} turns ${AGE}</p>
        <h1 class="display sm">Squeak<br><em>&amp;</em> Seek</h1>
        ${message ? `<p class="p-msg">${esc(message)}</p>` : ''}
        <form id="joinForm" autocomplete="off">
          <label>Room code<input id="code" inputmode="text" autocapitalize="characters" maxlength="4" placeholder="ABCD" value="${esc(urlRoom || me.code)}" required></label>
          <label>Your name<input id="name" maxlength="15" placeholder="e.g. Cheddar Chad" value="${esc(me.name)}" required></label>
          <button class="btn primary big" type="submit">Join the party &rarr;</button>
        </form>
      </section>`;
    const form = $('#joinForm');
    $('#code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = $('#code').value.trim().toUpperCase(); const name = $('#name').value.trim();
      if (code.length !== 4 || !name) return;
      if (code !== me.code) { me.id = SQ.uid(); }
      me.code = code; me.name = name; saveMe();
      SQ.keepAwake();
      start();
    });
    if (!urlRoom && !me.code) $('#code').focus(); else if (!me.name) $('#name').focus();
  }

  function start() {
    joined = false; lastState = null; mine = null;
    renderWaiting('Finding the party…');
    if (link) link.close();
    link = SQ.connect({
      code: me.code, role: 'player', events: ['state', 'results', 'kick'], onMessage,
      onStatus: (s) => { $('#conn').hidden = s === 'SUBSCRIBED'; if (s === 'SUBSCRIBED') sendJoin(); },
    });
    clearInterval(joinRetry);
    joinRetry = setInterval(() => { if (!joined || Date.now() - lastHeard > 9000) sendJoin(); }, 3000);
    clearTimeout(notFoundTimer);
    notFoundTimer = setTimeout(() => { if (!joined) renderWaiting(`Can't find room ${me.code} yet. Check the code on the big screen.`, true); }, 9000);
  }
  const sendJoin = () => link && link.send('join', { id: me.id, name: me.name }).catch(() => {});

  function onMessage(event, msg) {
    lastHeard = Date.now();
    $('#conn').hidden = true;
    if (event === 'kick') { if (msg.id === me.id) { leave('The host removed you from the game. You can join again with another name.'); } return; }
    if (event === 'results') {
      const r = msg.r && msg.r[me.id];
      if (!r) { if (joined) sendJoin(); return; }
      if (!joined) { joined = true; clearTimeout(notFoundTimer); }
      mine = { ...r, phase: msg.phase, q: msg.q, total: msg.total };
      if (r.n && r.n !== me.name) { me.name = r.n; saveMe(); }
      render(true);
      return;
    }
    if (event === 'state') {
      lastState = msg;
      if (!joined) return;
      render(false);
    }
  }

  // ---------- screens ----------
  function render(fromResults) {
    const s = lastState; if (!s) return;
    const key = `${s.phase}:${s.q}:${me.name}:${s.phase === 'reveal' || s.phase === 'leaderboard' || s.phase === 'podium' ? (mine ? [mine.phase, mine.q, mine.s, mine.k, mine.c].join('/') : '') : ''}`;
    if (key === shownKey) return;
    shownKey = key;
    clearInterval(countdown);
    document.body.dataset.phase = s.phase;
    document.body.dataset.tone = ['pink', 'lime', 'lilac', 'orange', 'sky'][Math.max(0, s.q) % 5];
    delete document.body.dataset.result;
    ({ lobby: pLobby, intro: pIntro, question: pQuestion, reveal: pReveal, leaderboard: pLeaderboard, podium: pPodium }[s.phase] || pLobby)(s);
  }

  const header = () => `<header class="p-head">${avatar(me.id, 'p-avatar')}<span class="p-name">${esc(me.name)}</span><span class="p-score">${mine ? fmt(mine.s) : 0} pts</span></header>`;

  function renderWaiting(text, showLeave) {
    shownKey = 'waiting';
    document.body.dataset.phase = 'waiting';
    screen.innerHTML = `<section class="p-center"><div class="loader"><span></span><span></span><span></span></div><p class="p-lede">${esc(text)}</p>${showLeave ? '<button class="btn ghost" id="btnLeave">Change room or name</button>' : ''}</section>`;
    $('#btnLeave')?.addEventListener('click', () => leave());
  }

  function pLobby() {
    screen.innerHTML = `${header()}
      <section class="p-center">
        <div class="p-me pop-in">${avatar(me.id, 'xl')}</div>
        <p class="kicker">You're in</p>
        <h2 class="p-title">${esc(me.name)}</h2>
        <p class="p-lede">Eyes on the big screen. We start soon.</p>
        <button class="link" id="btnLeave">Not you? Leave</button>
      </section>`;
    $('#btnLeave').addEventListener('click', () => leave());
  }

  function pIntro(s) {
    screen.innerHTML = `${header()}
      <section class="p-center">
        <p class="kicker">Question ${pad(s.q + 1)} / ${pad(s.total)}</p>
        <h2 class="p-title">${s.video ? 'Watch the video' : 'Get ready'}</h2>
        <p class="p-lede">${s.video ? 'It plays on the big screen. Answers come right after.' : 'Read the question on the big screen.'}</p>
      </section>`;
  }

  function pQuestion(s) {
    const picked = answers[`${me.code}:${s.q}`];
    if (picked !== undefined) return pLocked(s, picked);
    const ends = Date.now() + (s.endsIn || 0);
    const total = s.endsIn || 1;
    const buttons = Array.from({ length: s.n }, (_, i) => {
      const st = answerStyle(s.type, i);
      const opt = s.opts && s.opts[i];
      const label = s.type === 'truefalse' ? (i === 0 ? 'True' : 'False') : opt ? opt.label : '';
      return `<button class="p-answer" data-i="${i}" style="--c:${st.color};--ink:${st.ink}" aria-label="${esc(label || st.name)}">
        ${opt && opt.image ? `<img src="${esc(opt.image)}" alt="">` : ''}
        <span class="p-glyph">${st.glyph}</span>${label ? `<span class="p-label">${esc(label)}</span>` : ''}
      </button>`;
    }).join('');
    screen.innerHTML = `${header()}
      <div class="p-timer"><span id="pBar"></span></div>
      <section class="p-answers n${s.n} ${s.type}">${buttons}</section>`;
    const bar = $('#pBar');
    countdown = setInterval(() => { const left = Math.max(0, ends - Date.now()); bar.style.width = (left / total) * 100 + '%'; if (!left) clearInterval(countdown); }, 100);
    screen.querySelectorAll('.p-answer').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      answers[`${me.code}:${s.q}`] = i; sessionStorage.setItem('squeak-answers', JSON.stringify(answers));
      if (navigator.vibrate) navigator.vibrate(30);
      send(s.q, i, 0);
      shownKey = ''; render(false);
    }));
  }

  function send(q, choice, attempt) {
    link.send('answer', { id: me.id, q, choice }).then((ok) => { if (!ok && attempt < 2) setTimeout(() => send(q, choice, attempt + 1), 400); })
      .catch(() => { if (attempt < 2) setTimeout(() => send(q, choice, attempt + 1), 400); });
  }

  function pLocked(s, picked) {
    const st = answerStyle(s.type, picked);
    screen.innerHTML = `${header()}
      <section class="p-center">
        <div class="p-picked" style="--c:${st.color};--ink:${st.ink}">${st.glyph}</div>
        <p class="kicker">Answer locked in</p>
        <h2 class="p-title">Fingers crossed</h2>
      </section>`;
  }

  function pReveal(s) {
    const r = mine && mine.q === s.q && mine.phase === 'reveal' ? mine : null;
    if (!r) { screen.innerHTML = `${header()}<section class="p-center"><div class="loader"><span></span><span></span><span></span></div><p class="p-lede">Checking answers&hellip;</p></section>`; return; }
    let cls = 'none', kicker = 'Out of time', title = 'Too slow', sub = 'No answer this time.';
    if (r.c === true) { cls = 'right'; kicker = 'Correct'; title = `+${fmt(r.p)}`; sub = 'Squeak-tacular.'; }
    else if (r.c === false) { cls = 'wrong'; kicker = 'Not quite'; title = 'Rats.'; sub = 'Next one is yours.'; }
    document.body.dataset.result = cls;
    screen.innerHTML = `${header()}
      <section class="p-center p-result ${cls}">
        <p class="kicker">${kicker}</p>
        <h2 class="p-title huge">${title}</h2>
        <p class="p-lede">${sub}</p>
        <div class="p-rank"><span>${ordinal(r.k)}</span><small>place right now</small></div>
      </section>`;
    if (cls === 'right' && navigator.vibrate) navigator.vibrate([40, 60, 40]);
  }

  function pLeaderboard(s) {
    screen.innerHTML = `${header()}
      <section class="p-center">
        <p class="kicker">After question ${s.q + 1} of ${s.total}</p>
        <h2 class="p-title huge">${mine ? ordinal(mine.k) : '&ndash;'}</h2>
        <p class="p-lede">${mine ? fmt(mine.s) : 0} points${mine && mine.k <= 5 ? ' &middot; you made the top 5' : ''}</p>
      </section>`;
  }

  function pPodium() {
    const k = mine ? mine.k : null;
    screen.innerHTML = `${header()}
      <section class="p-center p-final">
        <p class="kicker">Final results</p>
        <h2 class="p-title huge">${k ? ordinal(k) : 'Done'}</h2>
        <p class="p-lede">${mine ? fmt(mine.s) : 0} points${k === 1 ? ' &middot; the big cheese' : ''}</p>
        <div class="p-bday"><div class="mascot hop">${birthdayRat()}</div><p>Happy ${AGE}th, ${esc(NAME)}!</p></div>
      </section>`;
    if (k && k <= 3) SQ.confetti(3000);
  }

  function leave(message) {
    if (link) link.close(); link = null; joined = false; clearInterval(joinRetry); clearTimeout(notFoundTimer);
    me.code = ''; me.id = SQ.uid(); saveMe();
    renderJoin(message);
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && link) { sendJoin(); } });

  // Auto-rejoin if this phone was already in this room.
  if (me.code && me.name && (!urlRoom || urlRoom === me.code)) start();
  else renderJoin();
})();
