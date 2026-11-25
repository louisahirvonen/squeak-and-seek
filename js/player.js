// Player phone: join, answer, see your result.
(function () {
  const { escapeHtml: esc, ANSWERS, answerStyle, birthdayRat, ordinal, fmt, pickLine } = SQ;
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
  let holdTimer = null; let lastSqueak = 0; let partied = ''; let shownScore = 0;
  const avatar = (id, cls = '') => SQ.avatar(id, cls, SQ.isBirthday(me.name) || !!(mine && mine.bd));
  const buzz = (pattern) => { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not supported */ } };
  // Small arrows instead of emoji.
  const ARROW = (dir) => `<svg class="p-arrow" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="${dir === 'up' ? 'M6 1l5 9H1z' : 'M6 11L1 2h10z'}"/></svg>`;
  const RIGHT = ['Squeak-tacular.', 'Gouda job.', 'Un-brie-lievable.', 'Big cheese energy.', 'Sharp as cheddar.', 'Nailed it, whiskers and all.'];
  const WRONG = ['Next one is yours.', 'The cheese was a trap.', 'Shake it off, whiskers.', 'Even the best rats miss.', 'Plenty of cheese left.'];
  const LOCKED = ['Fingers crossed', 'Paws crossed', 'No take-backs', 'Bold choice', 'Locked and loaded'];
  const answers = (() => { try { return JSON.parse(sessionStorage.getItem('squeak-answers')) || {}; } catch (e) { return {}; } })();
  const saveMe = () => localStorage.setItem(STORE, JSON.stringify(me));

  // ---------- join ----------
  function renderJoin(message = '') {
    shownKey = 'join';
    document.body.dataset.phase = 'join';
    screen.innerHTML = `
      <section class="p-join">
        <div class="p-hero"><div class="mascot p-mascot float" id="joinRat">${birthdayRat()}</div><span class="p-age">${AGE}</span></div>
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
    // Easter egg: poke the rat.
    $('#joinRat').addEventListener('click', (e) => { const r = e.currentTarget.firstElementChild; r.classList.remove('egg-poke'); void r.getBoundingClientRect(); r.classList.add('egg-poke'); buzz(20); });
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
    SQ.keepAwake(); // also after an automatic rejoin, not only after tapping Join
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
      lastState = msg; msg.at = Date.now();
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
    clearInterval(countdown); clearTimeout(holdTimer);
    document.body.dataset.phase = s.phase;
    document.body.dataset.tone = ['pink', 'lime', 'lilac', 'orange', 'sky'][Math.max(0, s.q) % 5];
    delete document.body.dataset.result; delete document.body.dataset.urgent;
    ({ lobby: pLobby, intro: pIntro, question: pQuestion, reveal: pReveal, leaderboard: pLeaderboard, podium: pPodium }[s.phase] || pLobby)(s);
  }

  const header = (score = mine ? mine.s : 0) => { shownScore = score; return `<header class="p-head">${avatar(me.id, 'p-avatar')}<span class="p-name">${esc(me.name)}</span>${mine && mine.st >= 2 ? `<span class="p-streak">${mine.st} in a row</span>` : ''}<span class="p-score"><span id="pScore">${fmt(score)}</span> pts</span></header>`; };
  function countScore(to) {
    const el = $('#pScore'); const from = shownScore; if (!el || from === to) return;
    const t0 = performance.now(); shownScore = to;
    (function step(now) { const k = Math.min(1, (now - t0) / 900); el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1 && el.isConnected) requestAnimationFrame(step); })(t0);
  }
  const moveLine = (r) => (r.d > 0 ? `${ARROW('up')} Up ${r.d} place${r.d === 1 ? '' : 's'}` : r.d < 0 ? `${ARROW('down')} Down ${-r.d} place${r.d === -1 ? '' : 's'}` : '');
  const gapLine = (r) => (r.up ? (r.up.g === 0 ? `Tied with ${esc(r.up.n)}` : `${fmt(r.up.g)} points behind ${esc(r.up.n)}`) : r.lead !== undefined ? (r.lead === 0 ? 'Tied at the top' : `Leading by ${fmt(r.lead)} points`) : '');

  function renderWaiting(text, showLeave) {
    shownKey = 'waiting';
    document.body.dataset.phase = 'waiting';
    screen.innerHTML = `<section class="p-center"><div class="loader"><span></span><span></span><span></span></div><p class="p-lede">${esc(text)}</p>${showLeave ? '<button class="btn ghost" id="btnLeave">Change room or name</button>' : ''}</section>`;
    $('#btnLeave')?.addEventListener('click', () => leave());
  }

  function pLobby() {
    screen.innerHTML = `${header()}
      <section class="p-center">
        <button class="p-me pop-in" id="btnSqueak" aria-label="Squeak">${avatar(me.id, 'xl')}</button>
        <p class="kicker">${SQ.isBirthday(me.name) ? 'The birthday rat is in' : 'You\'re in'}</p>
        <h2 class="p-title">${esc(me.name)}</h2>
        <p class="p-lede">Eyes on the big screen. We start soon.</p>
        <p class="p-hint">Psst. Tap your rat.</p>
        <button class="link" id="btnLeave">Not you? Leave</button>
      </section>`;
    $('#btnLeave').addEventListener('click', () => leave());
    // Tapping your rat makes it squeak on the big screen (at most twice a second).
    $('#btnSqueak').addEventListener('click', (e) => {
      const b = e.currentTarget; b.classList.remove('pop-in', 'p-squeak'); void b.offsetWidth; b.classList.add('p-squeak'); buzz(15);
      if (Date.now() - lastSqueak < 500 || !link) return;
      lastSqueak = Date.now(); link.send('squeak', { id: me.id }).catch(() => {});
    });
  }

  function pIntro(s) {
    screen.innerHTML = `${header()}
      <section class="p-center">
        <p class="kicker">${s.q + 1 === s.total && s.total > 1 ? 'Final question' : `Question ${pad(s.q + 1)} / ${pad(s.total)}`}</p>
        <h2 class="p-title">${s.dbl ? 'Double points' : s.video ? 'Watch the video' : 'Get ready'}</h2>
        <p class="p-lede">${s.video ? 'It plays on the big screen. Answers come right after.' : 'Read the question on the big screen.'}${s.dbl ? ' This one counts twice.' : ''}</p>
      </section>`;
  }

  function pQuestion(s) {
    // The host gives every asking of a question its own key, so a replay never looks "already answered".
    const key = s.k || `${me.code}:${s.q}`;
    const picked = answers[key];
    if (picked !== undefined) return pLocked(s, picked);
    const ends = Date.now() + (s.endsIn || 0);
    const total = (s.limit ? s.limit * 1000 : 0) || s.endsIn || 1;
    const lockIn = (value) => {
      answers[key] = value; try { sessionStorage.setItem('squeak-answers', JSON.stringify(answers)); } catch (e) { /* private mode */ }
      buzz(30);
      send(s.q, value, 0);
      shownKey = ''; render(false);
    };
    const startBar = () => {
      const bar = $('#pBar'); const secs = $('#pSecs'); let lastSec = null;
      const tickBar = () => {
        const left = Math.max(0, ends - Date.now()); bar.style.width = Math.min(100, (left / total) * 100) + '%';
        const whole = Math.ceil(left / 1000);
        if (whole !== lastSec) { lastSec = whole; secs.textContent = whole; if (whole <= 5) { document.body.dataset.urgent = '1'; if (whole > 0 && whole <= 3) buzz(12); } }
        if (!left) clearInterval(countdown);
      };
      tickBar(); countdown = setInterval(tickBar, 100);
    };
    const timerRow = '<div class="p-timer-row"><div class="p-timer"><span id="pBar"></span></div><span class="p-secs" id="pSecs"></span></div>';
    if (s.type === 'number') {
      // A counter that starts at the lowest number; arrows step it, the big button locks it in.
      const min = Number.isFinite(s.min) ? s.min : 0; const max = Number.isFinite(s.max) ? s.max : 20; let value = min;
      const arrow = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      screen.innerHTML = `${header()}${timerRow}
        <section class="p-number">
          <p class="kicker">Your answer</p>
          <div class="p-num-row">
            <button class="p-step" id="pMinus" aria-label="Lower">${arrow('M15 5l-7 7 7 7')}</button>
            <div class="p-num"><output id="pVal">${value}</output>${s.unit ? `<small>${esc(s.unit)}</small>` : ''}</div>
            <button class="p-step" id="pPlus" aria-label="Higher">${arrow('M9 5l7 7-7 7')}</button>
          </div>
          <button class="btn primary big" id="pLock">Lock in &rarr;</button>
        </section>`;
      const out = $('#pVal');
      const step = (d) => { const v = Math.max(min, Math.min(max, value + d)); if (v === value) return buzz(40); value = v; out.textContent = v; out.classList.remove('p-bump'); void out.offsetWidth; out.classList.add('p-bump'); buzz(10); $('#pMinus').disabled = v === min; $('#pPlus').disabled = v === max; };
      $('#pMinus').disabled = true;
      $('#pMinus').addEventListener('click', () => step(-1)); $('#pPlus').addEventListener('click', () => step(1));
      $('#pLock').addEventListener('click', () => lockIn(value));
      return startBar();
    }
    const buttons = Array.from({ length: s.n }, (_, i) => {
      const st = answerStyle(s.type, i);
      const opt = s.opts && s.opts[i];
      const label = s.type === 'truefalse' ? (i === 0 ? 'True' : 'False') : opt ? opt.label : '';
      return `<button class="p-answer" data-i="${i}" style="--c:${st.color};--ink:${st.ink}" aria-label="${esc(label || st.name)}">
        ${opt && opt.image ? `<img src="${esc(opt.image)}" alt="">` : ''}
        <span class="p-glyph">${st.glyph}</span>${label ? `<span class="p-label">${esc(label)}</span>` : ''}
      </button>`;
    }).join('');
    screen.innerHTML = `${header()}${timerRow}
      <section class="p-answers n${s.n} ${s.type}">${buttons}</section>`;
    startBar();
    screen.querySelectorAll('.p-answer').forEach((b) => b.addEventListener('click', () => lockIn(Number(b.dataset.i))));
  }

  function send(q, choice, attempt) {
    link.send('answer', { id: me.id, q, choice }).then((ok) => { if (!ok && attempt < 2) setTimeout(() => send(q, choice, attempt + 1), 400); })
      .catch(() => { if (attempt < 2) setTimeout(() => send(q, choice, attempt + 1), 400); });
  }

  function pLocked(s, picked) {
    const num = s.type === 'number';
    const st = num ? { color: SQ.C.lime, ink: SQ.C.ink } : answerStyle(s.type, picked);
    screen.innerHTML = `${header()}
      <section class="p-center">
        <div class="p-picked ${num ? 'p-picked-num' : ''}" style="--c:${st.color};--ink:${st.ink}">${num ? `<span>${picked}</span>` : st.glyph}</div>
        <p class="kicker">Answer locked in</p>
        <h2 class="p-title">${pickLine(LOCKED, me.id + (s.k || s.q))}</h2>
        <p class="p-lede">Watch the big screen.</p>
      </section>`;
  }

  function pReveal(s) {
    const r = mine && mine.q === s.q && mine.phase === 'reveal' ? mine : null;
    const before = r ? r.s - (r.p || 0) : mine ? mine.s : 0;
    const waiting = () => { screen.innerHTML = `${header(before)}<section class="p-center"><div class="loader"><span></span><span></span><span></span></div><p class="p-lede">Checking answers&hellip;</p></section>`; };
    if (!r) return waiting();
    const show = () => {
      let cls = 'none', kicker = 'Out of time', title = 'Too slow', sub = 'No answer this time.';
      if (r.c === true) {
        cls = 'right'; kicker = r.f ? 'Correct, and the fastest in the room' : r.t !== undefined && r.t < 1.5 ? 'Correct. Lightning paws.' : 'Correct'; title = `+${fmt(r.p)}`;
        sub = r.b ? `${r.st} in a row: +${fmt(r.b)} streak bonus${s.dbl ? ', doubled' : ''}.` : s.dbl ? 'Double points. ' + pickLine(RIGHT, me.id + s.q) : pickLine(RIGHT, me.id + s.q);
      } else if (r.c === false) { cls = 'wrong'; kicker = 'Not quite'; title = 'Rats.'; sub = pickLine(WRONG, me.id + s.q); }
      if (s.type === 'number' && r.c !== true && Array.isArray(s.correct)) sub = `The answer was ${s.correct[0]}${s.unit ? ' ' + esc(s.unit) : ''}. ${r.c === false ? sub : ''}`;
      document.body.dataset.result = cls;
      const extra = [moveLine(r), gapLine(r)].filter(Boolean);
      screen.innerHTML = `${header(before)}
        <section class="p-center p-result ${cls}">
          <p class="kicker">${kicker}</p>
          <h2 class="p-title huge p-pop">${title}</h2>
          <p class="p-lede">${sub}</p>
          <div class="p-rank"><span>${ordinal(r.k)}</span><small>place right now</small></div>
          ${extra.length ? `<p class="p-extra">${extra.join('<br>')}</p>` : ''}
        </section>`;
      countScore(r.s);
      if (cls === 'right') buzz(r.b ? [40, 60, 40, 60, 80] : [40, 60, 40]); else if (cls === 'wrong') buzz(120);
    };
    // The big screen builds a moment of suspense first; hold the phone back for the same time.
    const key = `${s.k || s.q}`;
    if (partied === 'rv' + key || !s.wait) return show();
    partied = 'rv' + key; waiting(); holdTimer = setTimeout(show, s.wait);
  }

  function pLeaderboard(s) {
    const extra = mine ? [moveLine(mine), gapLine(mine)].filter(Boolean) : [];
    screen.innerHTML = `${header()}
      <section class="p-center">
        <p class="kicker">After question ${s.q + 1} of ${s.total}</p>
        <h2 class="p-title huge">${mine ? ordinal(mine.k) : '&ndash;'}</h2>
        <p class="p-lede">${mine ? fmt(mine.s) : 0} points${mine && mine.k <= 5 ? ' &middot; you made the top 5' : ''}</p>
        ${extra.length ? `<p class="p-extra">${extra.join('<br>')}</p>` : ''}
        ${s.fin ? '<p class="p-fin">Last question next. Double points.</p>' : ''}
      </section>`;
  }

  function pPodium(s) {
    const k = mine ? mine.k : null;
    const show = () => {
      screen.innerHTML = `${header()}
        <section class="p-center p-final">
          <p class="kicker">Final results</p>
          <h2 class="p-title huge p-pop">${k ? ordinal(k) : 'Done'}</h2>
          <p class="p-lede">${mine ? fmt(mine.s) : 0} points${k === 1 ? ' &middot; the big cheese' : k === 2 ? ' &middot; so close' : k === 3 ? ' &middot; on the podium' : ''}</p>
          <div class="p-bday"><div class="mascot hop">${birthdayRat()}</div><p>Happy ${AGE}th, ${esc(NAME)}!</p></div>
        </section>`;
      const once = `pod${s.g || ''}:${me.code}`;
      if (k && k <= 3 && partied !== once) { partied = once; SQ.confetti(3000); buzz([60, 80, 60, 80, 160]); }
    };
    // The big screen reveals third, second, first: a podium phone must not spoil it.
    const at = s.rv && k && s.rv[k] !== undefined ? s.rv[k] + 400 : 900;
    const hold = Math.max(0, at - (s.el || 0) - (Date.now() - (s.at || Date.now())));
    if (!s.rv || hold < 150) return show();
    screen.innerHTML = `${header()}
      <section class="p-center p-final">
        <p class="kicker">Final results</p>
        <div class="loader"><span></span><span></span><span></span></div>
        <h2 class="p-title">Drumroll</h2>
        <p class="p-lede">Eyes on the big screen.</p>
      </section>`;
    holdTimer = setTimeout(show, hold);
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
