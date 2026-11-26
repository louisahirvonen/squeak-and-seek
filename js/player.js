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
  let holdTimer = null; let lastSqueak = 0; let partied = ''; let shownScore = 0; let resendTimer = null; let stepTimer = null;
  const avatar = (id, cls = '') => SQ.avatar(id, cls, SQ.isBirthday(me.name) || !!(mine && mine.bd));
  const buzz = (pattern) => { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not supported */ } };
  // Small arrows instead of emoji.
  const ARROW = (dir) => `<svg class="p-arrow" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="${dir === 'up' ? 'M6 1l5 9H1z' : 'M6 11L1 2h10z'}"/></svg>`;
  const RIGHT = ['Squeak-tacular.', 'Gouda job.', 'Un-brie-lievable.', 'Big cheese energy.', 'Sharp as cheddar.', 'Nailed it, whiskers and all.'];
  const WRONG = ['Next one is yours.', 'The cheese was a trap.', 'Shake it off, whiskers.', 'Even the best rats miss.', 'Plenty of cheese left.'];
  const LOCKED = ['Fingers crossed', 'Paws crossed', 'No take-backs', 'Bold choice', 'Locked and loaded'];
  const answers = (() => { try { return JSON.parse(sessionStorage.getItem('squeak-answers')) || {}; } catch (e) { return {}; } })();
  const saveMe = () => { try { localStorage.setItem(STORE, JSON.stringify(me)); } catch (e) { /* private mode */ } };

  // ---------- join ----------
  function renderJoin(message = '', lastCode = '') {
    shownKey = 'join';
    document.body.dataset.phase = 'join';
    screen.innerHTML = `
      <section class="p-join">
        <div class="p-hero"><div class="mascot p-mascot float" id="joinRat">${birthdayRat()}</div><span class="p-age">${AGE}</span></div>
        <p class="kicker">${esc(NAME)} turns ${AGE}</p>
        <h1 class="display sm">Squeak<br><em>&amp;</em> Seek</h1>
        ${message ? `<p class="p-msg">${esc(message)}</p>` : ''}
        <form id="joinForm" autocomplete="off">
          <label>Room code<input id="code" inputmode="text" autocapitalize="characters" maxlength="4" placeholder="ABCD" value="${esc(urlRoom || me.code || lastCode)}" required></label>
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
      const code = $('#code').value.trim().toUpperCase(); const name = $('#name').value.replace(/\s+/g, ' ').trim();
      const problem = code.length !== 4 ? 'The room code is the four letters on the big screen.' : !name ? 'Type a name so we know who you are.' : '';
      if (problem) {
        let m = form.querySelector('.p-msg'); if (!m) { m = document.createElement('p'); m.className = 'p-msg'; form.prepend(m); }
        m.textContent = problem; (code.length !== 4 ? $('#code') : $('#name')).focus(); return;
      }
      if (code !== me.code) { me.id = SQ.uid(); }
      me.code = code; me.name = name; saveMe();
      SQ.keepAwake();
      start();
    });
    if (!urlRoom && !me.code && !lastCode) $('#code').focus(); else if (!me.name) $('#name').focus();
  }

  // quiet = true: only swap the connection for a fresh one and leave the screen as it is.
  function start(quiet) {
    SQ.keepAwake(); // also after an automatic rejoin, not only after tapping Join
    if (!quiet) { joined = false; lastState = null; mine = null; renderWaiting('Finding the party…'); }
    lastHeard = Date.now();
    if (link) link.close();
    link = SQ.connect({
      code: me.code, role: 'player', events: ['state', 'results', 'kick'], onMessage,
      onStatus: (s) => { $('#conn').hidden = s === 'SUBSCRIBED'; if (s === 'SUBSCRIBED') sendJoin(); },
    });
    clearInterval(joinRetry);
    joinRetry = setInterval(() => {
      const quietFor = Date.now() - lastHeard;
      // The big screen speaks every 4 seconds. A long silence means this connection has died without saying so
      // (wifi to mobile data, a phone that slept): show it, and open a new one.
      if (joined && quietFor > 13000) { $('#conn').hidden = false; return start(true); }
      if (!joined || quietFor > 9000) sendJoin();
    }, 3000);
    if (quiet) return;
    clearTimeout(notFoundTimer);
    notFoundTimer = setTimeout(() => { if (!joined) renderWaiting(`Can't find room ${me.code} yet. Check the code on the big screen.`, true); }, 6000);
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
      checkSent();
    }
  }

  // An answer is only safe once the big screen says it has it. Until then, keep sending it.
  const arrived = (s) => !s || !['question', 'wager', 'write'].includes(s.phase) || !s.k || answers[s.k] === undefined || (Array.isArray(s.a) ? s.a.includes(SQ.hash(me.id)) : true);
  function checkSent() {
    const s = lastState; const ok = arrived(s);
    clearTimeout(resendTimer);
    if (ok) { const note = $('#pSent'); if (note) note.hidden = true; return; }
    resendTimer = setTimeout(() => {
      if (arrived(lastState)) return;
      const note = $('#pSent'); if (note) note.hidden = false;
      send(lastState, answers[lastState.k]); checkSent();
    }, 1200);
  }

  // ---------- screens ----------
  function render(fromResults) {
    const s = lastState; if (!s) return;
    const key = `${s.phase}:${s.q}:${me.name}:${s.phase === 'reveal' || s.phase === 'leaderboard' || s.phase === 'podium' ? ((mine ? [mine.phase, mine.q, mine.s, mine.k, mine.c].join('/') : '') + (s.dare ? s.dare.st + (s.dare.h || '') : '')) : s.phase === 'lobby' && mine ? mine.s : ''}`;
    if (key === shownKey) return;
    shownKey = key;
    clearInterval(countdown); clearTimeout(holdTimer); clearInterval(stepTimer); clearTimeout(stepTimer);
    document.body.dataset.phase = s.phase;
    document.body.dataset.tone = ['pink', 'lime', 'lilac', 'orange', 'sky'][Math.max(0, s.q) % 5];
    delete document.body.dataset.result; delete document.body.dataset.urgent;
    ({ lobby: pLobby, intro: pIntro, question: pQuestion, reveal: pReveal, leaderboard: pLeaderboard, wager: pWager, write: pWrite, podium: pPodium }[s.phase] || pLobby)(s);
  }

  const header = (score = mine ? mine.s : 0) => { shownScore = score; return `<header class="p-head">${avatar(me.id, 'p-avatar')}<span class="p-name">${esc(me.name)}</span>${mine && mine.st >= 2 ? `<span class="p-streak">${mine.st} in a row</span>` : ''}<span class="p-score"><span id="pScore">${fmt(score)}</span> pts</span></header>`; };
  function countScore(to) {
    const el = $('#pScore'); const from = shownScore; if (!el || from === to) return;
    const t0 = performance.now(); shownScore = to;
    (function step(now) { const k = Math.min(1, (now - t0) / 900); el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1 && el.isConnected) requestAnimationFrame(step); })(t0);
  }
  const moveLine = (r) => (r.d > 0 ? `${ARROW('up')} Up ${r.d} place${r.d === 1 ? '' : 's'}` : r.d < 0 ? `${ARROW('down')} Down ${-r.d} place${r.d === -1 ? '' : 's'}` : '');
  const gapLine = (r) => (r.up ? (r.up.g === 0 ? `Tied with ${esc(r.up.n)}` : `${fmt(r.up.g)} point${r.up.g === 1 ? '' : 's'} behind ${esc(r.up.n)}`) : r.lead !== undefined ? (r.lead === 0 ? 'Tied at the top' : `Leading by ${fmt(r.lead)} point${r.lead === 1 ? '' : 's'}`) : '');

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
    if (s.type === 'dare') {
      document.body.dataset.result = 'dare';
      screen.innerHTML = `${header()}
        <section class="p-center p-dare-in">
          <p class="kicker p-warn">Warning</p>
          <h2 class="p-title huge p-slam">A dare<br>approaches</h2>
          <p class="p-lede">The wheel picks one of you. Eyes on the big screen.</p>
        </section>`;
      buzz([90, 60, 90, 60, 220]);
      return;
    }
    screen.innerHTML = `${header()}
      <section class="p-center">
        <p class="kicker">${s.type === 'dare' ? 'Surprise' : (s.no || s.q + 1) === (s.of || s.total) && s.total > 1 ? 'Final question' : `Question ${pad(s.no || s.q + 1)} / ${pad(s.of || s.total)}`}</p>
        <h2 class="p-title">${s.type === 'dare' ? 'A dare' : s.dbl ? 'Double points' : s.wg ? 'The bets are in' : s.video ? 'Watch the video' : 'Get ready'}</h2>
        <p class="p-lede">${s.video ? 'It plays on the big screen. Answers come right after.' : s.type === 'write' ? 'You write your own answer for this one. Nobody sees who wrote what.' : s.type === 'dare' ? 'The wheel picks one of you. Eyes on the big screen.' : s.type === 'vote' ? 'A vote. You score if you pick what most of the room picks.' : 'Read the question on the big screen.'}${s.dbl ? ' This one counts twice.' : s.wg ? ' Your bet rides on this one.' : ''}</p>
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
      send(s, value);
      shownKey = ''; render(false);
      checkSent();
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
          <p class="kicker">${s.cl ? 'Closest guess wins the most' : 'Your answer'}</p>
          <div class="p-num-row">
            <button class="p-step" id="pMinus" aria-label="Lower">${arrow('M15 5l-7 7 7 7')}</button>
            <div class="p-num"><output id="pVal">${value}</output>${s.unit ? `<small>${esc(s.unit)}</small>` : ''}</div>
            <button class="p-step" id="pPlus" aria-label="Higher">${arrow('M9 5l7 7-7 7')}</button>
          </div>
          <button class="btn primary big" id="pLock">Lock in &rarr;</button>
        </section>`;
      const out = $('#pVal');
      const step = (d) => { const v = Math.max(min, Math.min(max, value + d)); if (v === value) { clearInterval(stepTimer); return buzz(40); } value = v; out.textContent = v; out.classList.remove('p-bump'); void out.offsetWidth; out.classList.add('p-bump'); buzz(10); $('#pMinus').disabled = v === min; $('#pPlus').disabled = v === max; };
      $('#pMinus').disabled = true;
      // One tap is one step; holding the button runs, slowly at first and then fast.
      const stop = () => { clearTimeout(stepTimer); clearInterval(stepTimer); };
      [['#pMinus', -1], ['#pPlus', 1]].forEach(([sel, d]) => {
        const b = $(sel);
        b.addEventListener('pointerdown', (e) => { if (e.button) return; stop(); step(d); stepTimer = setTimeout(() => { stepTimer = setInterval(() => step(d), 80); }, 380); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
        b.addEventListener('click', (e) => { if (e.detail === 0) step(d); }); // keyboard
        b.addEventListener('contextmenu', (e) => e.preventDefault());
      });
      $('#pLock').addEventListener('click', () => lockIn(value));
      return startBar();
    }
    if (s.type === 'write') {
      // Vote for the best of the written answers (your own is left out).
      const mineH = SQ.hash(me.id); const list = (s.opts || []).map((o, i) => (o.h === mineH ? '' : `<button class="p-text" data-i="${i}">${esc(o.label)}</button>`)).join('');
      screen.innerHTML = `${header()}${timerRow}
        <section class="p-votes">
          <p class="kicker">Vote for the best answer</p>
          <div class="p-text-list">${list || '<p class="p-lede">No other answers to vote for.</p>'}</div>
        </section>`;
      startBar();
      screen.querySelectorAll('.p-text').forEach((b) => b.addEventListener('click', () => lockIn(Number(b.dataset.i))));
      return;
    }
    if (s.opts && s.opts[0] && s.opts[0].pid) {
      // Vote for a guest (not yourself). The answer with the most votes wins.
      screen.innerHTML = `${header()}${timerRow}
        <section class="p-votes">
          <p class="kicker">Pick who most of the room will pick</p>
          <div class="p-vote-list">${s.opts.map((o, i) => (o.pid === me.id ? '' : `<button class="p-vote" data-i="${i}">${SQ.avatar(o.pid, '', !!o.bd)}<span>${esc(o.label)}</span></button>`)).join('')}</div>
        </section>`;
      startBar();
      screen.querySelectorAll('.p-vote').forEach((b) => b.addEventListener('click', () => lockIn(Number(b.dataset.i))));
      return;
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

  // Sent again by checkSent() until the big screen confirms it.
  function send(s, choice) {
    if (!link) return;
    (s.phase === 'write' ? link.send('text', { id: me.id, t: choice }) : s.phase === 'wager' ? link.send('bet', { id: me.id, pct: choice }) : link.send('answer', { id: me.id, q: s.q, choice })).catch(() => {});
  }

  function pLocked(s, picked) {
    if (s.type === 'write') {
      screen.innerHTML = `${header()}
        <section class="p-center">
          <p class="kicker">Your vote</p>
          <h2 class="p-title p-quote">${esc(s.opts && s.opts[picked] ? s.opts[picked].label : '')}</h2>
          <p class="p-lede">Watch the big screen.</p>
          <p class="p-sent" id="pSent" hidden>Sending your vote&hellip;</p>
        </section>`;
      return;
    }
    const guest = s.opts && s.opts[picked] && s.opts[picked].pid ? s.opts[picked] : null;
    if (guest) {
      screen.innerHTML = `${header()}
        <section class="p-center">
          <div class="p-voted pop-in">${SQ.avatar(guest.pid, '', !!guest.bd)}</div>
          <p class="kicker">Your vote</p>
          <h2 class="p-title">${esc(guest.label)}</h2>
          <p class="p-lede">Watch the big screen.</p>
          <p class="p-sent" id="pSent" hidden>Sending your vote&hellip;</p>
        </section>`;
      return;
    }
    const num = s.type === 'number';
    const st = num ? { color: SQ.C.lime, ink: SQ.C.ink } : answerStyle(s.type, picked);
    screen.innerHTML = `${header()}
      <section class="p-center">
        <div class="p-picked ${num ? 'p-picked-num' : ''}" style="--c:${st.color};--ink:${st.ink}">${num ? `<span>${picked}</span>` : st.glyph}</div>
        <p class="kicker">Answer locked in</p>
        <h2 class="p-title">${pickLine(LOCKED, me.id + (s.k || s.q))}</h2>
        <p class="p-lede">Watch the big screen.</p>
        <p class="p-sent" id="pSent" hidden>Sending your answer&hellip;</p>
      </section>`;
  }

  function pReveal(s) {
    const r = mine && mine.q === s.q && mine.phase === 'reveal' ? mine : null;
    const wg = r ? r.wg || 0 : 0; // what the bet on the final question won or cost
    const before = r ? r.s - (r.p || 0) - wg - (r.fav || 0) : mine ? mine.s : 0;
    const waiting = () => { screen.innerHTML = `${header(before)}<section class="p-center"><div class="loader"><span></span><span></span><span></span></div><p class="p-lede">Checking answers&hellip;</p></section>`; };
    if (!r) return waiting();
    const show = () => {
      if (s.type === 'dare') return pDare(s, r);
      const last = s.q + 1 >= s.total;
      let cls = 'none', kicker = 'Out of time', title = 'Too slow', sub = 'No answer this time.';
      if (r.nw) { kicker = 'You\'re in'; title = 'Welcome'; sub = last ? 'Just in time for the results.' : 'The next question is yours.'; }
      if (r.c === true) {
        cls = 'right'; kicker = r.f ? 'Correct, and the fastest in the room' : r.t !== undefined && r.t < 1.5 ? 'Correct. Lightning paws.' : 'Correct'; title = `+${fmt(r.p)}`;
        sub = r.b ? `${s.dbl ? 'Double points. ' : ''}${r.st} in a row: +${fmt(r.b)} streak bonus.` : s.dbl ? 'Double points. ' + pickLine(RIGHT, me.id + s.q) : pickLine(RIGHT, me.id + s.q);
      } else if (r.c === false) { cls = 'wrong'; kicker = 'Not quite'; title = 'Rats.'; sub = last ? 'That was the last one.' : pickLine(WRONG, me.id + s.q); }
      if (s.type === 'vote') {
        if (r.c === true) { kicker = 'With the majority'; sub = r.b ? sub : 'You and the room agree.'; }
        else if (r.c === false) { cls = 'none'; kicker = 'Outvoted'; title = 'Hmm.'; sub = 'The room saw it differently. Your streak is safe.'; }
      }
      if (s.type === 'write') {
        if (r.c === true) { cls = 'right'; kicker = 'The room\'s favourite'; title = `+${fmt(r.p)}`; sub = 'Your answer won the vote.'; }
        else if (r.v !== undefined) { cls = 'none'; kicker = 'Your answer got'; title = `${r.v} vote${r.v === 1 ? '' : 's'}`; sub = 'Another answer won this time.'; }
        else { cls = 'none'; kicker = 'No answer from you'; title = 'Hmm.'; sub = 'Write one next time.'; }
      }
      const unitTxt = s.unit ? ' ' + esc(s.unit) : '';
      if (s.cl && r.c === true && r.off > 0) { kicker = 'Closest guess in the room'; sub = `Only ${r.off} off. The answer was ${s.correct[0]}${unitTxt}.`; }
      if (s.cl && r.c === false && r.p > 0) { cls = 'near'; kicker = r.off === 1 ? 'So close' : 'Not far off'; title = `+${fmt(r.p)}`; sub = `${r.off} off. The answer was ${s.correct[0]}${unitTxt}.`; }
      else if (s.type === 'number' && r.c !== true && Array.isArray(s.correct)) sub = `The answer was ${s.correct[0]}${s.unit ? ' ' + esc(s.unit) : ''}. ${r.c === false ? sub : ''}`;
      if (wg > 0) { title = `+${fmt(r.p + wg)}`; sub = `Your bet paid off: +${fmt(wg)}.`; }
      if (wg < 0) { title = `&minus;${fmt(-wg)}`; sub = 'There goes your bet.'; }
      document.body.dataset.result = cls;
      const extra = [r.fav ? `The room picked you: +${fmt(r.fav)}` : '', moveLine(r), gapLine(r)].filter(Boolean);
      screen.innerHTML = `${header(before)}
        <section class="p-center p-result ${cls}">
          <p class="kicker">${kicker}</p>
          <h2 class="p-title huge p-pop">${title}</h2>
          <p class="p-lede">${sub}</p>
          <div class="p-rank"><span>${ordinal(r.k)}</span><small>place right now</small></div>
          ${extra.length ? `<p class="p-extra">${extra.join('<br>')}</p>` : ''}
        </section>`;
      countScore(r.s);
      if (s.type === 'write') { /* no buzz pattern for a matter of taste */ } else if (cls === 'right') buzz(r.b ? [40, 60, 40, 60, 80] : [40, 60, 40]); else if (cls === 'wrong') buzz(120); else if (cls === 'near') buzz(40);
    };
    // The big screen builds a moment of suspense first; hold the phone back for the same time.
    const key = `${s.k || s.q}`;
    if (partied === 'rv' + key || !s.wait) return show();
    partied = 'rv' + key; waiting(); holdTimer = setTimeout(show, s.wait);
  }

  // Dare: the chosen rat accepts or declines here; everyone else follows along.
  function pDare(s, r) {
    const d = s.dare; const me1 = d && d.h === SQ.hash(me.id); const pts = d ? fmt(d.pts) : '';
    let kicker = 'The dare', title = 'Nobody', sub = 'Nobody has to this time.', cls = 'none', btns = '';
    if (d && d.st === 'spin') { kicker = 'The wheel is spinning'; title = 'Who?'; sub = 'It could be you.'; }
    else if (d && d.st === 'steal') {
      // The chosen rat said no: everyone else can grab the dare. First tap wins.
      if (me1) { kicker = 'You passed'; title = 'Up for grabs'; sub = 'Someone else may steal your dare.'; }
      else if (SQ.isBirthday(me.name) || (mine && mine.bd)) { kicker = `${esc(d.n)} said no`; title = 'Any takers?'; sub = 'You are the judge, so this one is not for you.'; }
      else { kicker = `${esc(d.n)} said no`; title = 'Steal it?'; sub = `First to tap gets the dare and the ${pts} points.`; btns = '<div class="p-dare-btns"><button class="btn primary big" id="dareSteal">Steal the dare</button></div>'; }
    }
    else if (d && me1) {
      ({ asked: () => { kicker = 'The wheel has chosen'; title = 'It\'s you'; sub = `Do the dare on the big screen for ${pts} points. ${esc(NAME)} is the judge.`; btns = '<div class="p-dare-btns"><button class="btn primary big" id="dareYes">I\'ll do it</button><button class="btn ghost" id="dareNo">No thanks</button></div>'; },
        accepted: () => { kicker = d.sto ? 'You stole the dare' : 'Dare accepted'; title = 'Go!'; sub = `${esc(NAME)} is watching.`; },
        done: () => { cls = 'right'; kicker = 'Dare done'; title = `+${pts}`; sub = 'Worth it.'; },
        failed: () => { cls = 'wrong'; kicker = 'The judge has spoken'; title = 'Not quite'; sub = 'No points, but full marks for trying.'; },
        declined: () => { kicker = 'Dare declined'; title = 'Passed'; sub = 'No points lost.'; } }[d.st] || (() => {}))();
    } else if (d) {
      title = esc(d.n);
      ({ asked: () => { kicker = 'The dare goes to'; sub = 'Will they do it?'; }, accepted: () => { kicker = d.sto ? 'Dare stolen by' : 'Dare accepted by'; sub = 'Eyes on them.'; },
        done: () => { kicker = 'Dare done by'; sub = `+${pts} points.`; }, failed: () => { kicker = 'So close'; sub = 'The judge said no.'; },
        declined: () => { kicker = 'No thanks, said'; sub = 'The dare goes undone.'; } }[d.st] || (() => {}))();
    }
    document.body.dataset.result = cls;
    screen.innerHTML = `${header(shownScore)}
      <section class="p-center p-result ${cls}">
        <p class="kicker">${kicker}</p>
        <h2 class="p-title ${title.length > 9 ? '' : 'huge'} p-pop">${title}</h2>
        <p class="p-lede">${sub}</p>
        ${btns}
        ${r ? `<div class="p-rank"><span>${ordinal(r.k)}</span><small>place right now</small></div>` : ''}
      </section>`;
    if (r) countScore(r.s);
    const answer = (ok) => { buzz(30); if (link) link.send('dare', { id: me.id, ok }).catch(() => {}); screen.querySelectorAll('.p-dare-btns button').forEach((b) => { b.disabled = true; }); };
    $('#dareSteal')?.addEventListener('click', (e) => { buzz(30); e.currentTarget.disabled = true; if (link) link.send('steal', { id: me.id }).catch(() => {}); });
    $('#dareYes')?.addEventListener('click', () => answer(true)); $('#dareNo')?.addEventListener('click', () => answer(false));
    if (me1 && d.st === 'asked') buzz([60, 60, 60, 60, 120]);
    if (me1 && d.st === 'done') SQ.confetti(2500);
  }

  function pLeaderboard(s) {
    const extra = mine ? [moveLine(mine), gapLine(mine)].filter(Boolean) : [];
    screen.innerHTML = `${header()}
      <section class="p-center">
        <p class="kicker">After question ${s.no || s.q + 1} of ${s.of || s.total}</p>
        <h2 class="p-title huge">${mine ? ordinal(mine.k) : '&ndash;'}</h2>
        <p class="p-lede">${mine ? fmt(mine.s) : 0} points${mine && mine.k <= 5 ? ' &middot; you made the top 5' : ''}</p>
        ${extra.length ? `<p class="p-extra">${extra.join('<br>')}</p>` : ''}
        ${s.fin ? '<p class="p-fin">Last question next. Double points.</p>' : s.wgn ? '<p class="p-fin">One question left. First: bet your cheese.</p>' : ''}
      </section>`;
  }

  // Anonymous answers, step one: type an answer. It shows on the big screen without your name.
  function pWrite(s) {
    const key = s.k; const sent = answers[key]; const max = s.max || 60;
    if (sent !== undefined) {
      screen.innerHTML = `${header()}
        <section class="p-center">
          <p class="kicker">Answer sent</p>
          <h2 class="p-title p-quote">${esc(sent)}</h2>
          <p class="p-lede">Nobody knows it is yours. The vote comes next.</p>
          <p class="p-sent" id="pSent" hidden>Sending your answer&hellip;</p>
        </section>`;
      return;
    }
    screen.innerHTML = `${header()}
      <section class="p-write">
        <p class="kicker">Your answer, anonymous</p>
        <form id="writeForm" autocomplete="off">
          <textarea id="pText" maxlength="${max}" rows="3" placeholder="Write here" enterkeyhint="send"></textarea>
          <p class="p-hint"><span id="pLeft">${max}</span> characters left &middot; <span id="pWSecs"></span></p>
          <button class="btn primary big" type="submit">Send &rarr;</button>
        </form>
      </section>`;
    const box = $('#pText'); const ends = Date.now() + (s.endsIn || 0);
    const tick = () => { const left = Math.ceil(Math.max(0, ends - Date.now()) / 1000); const el = $('#pWSecs'); if (el) el.textContent = left ? `${left} s` : 'time is up'; if (!left) clearInterval(countdown); };
    tick(); countdown = setInterval(tick, 250);
    box.addEventListener('input', () => { $('#pLeft').textContent = max - box.value.length; });
    const submit = (e) => {
      if (e) e.preventDefault();
      const t = box.value.replace(/\s+/g, ' ').trim(); if (!t) return box.focus();
      answers[key] = t; try { sessionStorage.setItem('squeak-answers', JSON.stringify(answers)); } catch (err) { /* private mode */ }
      buzz(30); send(s, t); shownKey = ''; render(false); checkSent();
    };
    $('#writeForm').addEventListener('submit', submit);
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(e); });
    box.focus();
  }

  // Bet your cheese: before the final question, stake part of your score on getting it right.
  function pWager(s) {
    const key = s.k; const picked = answers[key]; const score = mine ? mine.s : 0;
    const NAMES = { 0: 'Nothing', 25: 'A quarter', 50: 'Half', 100: 'All in' };
    if (picked !== undefined) {
      screen.innerHTML = `${header()}
        <section class="p-center">
          <p class="kicker">${picked ? 'Your bet' : 'Playing it safe'}</p>
          <h2 class="p-title huge p-pop">${picked ? fmt(SQ.stake(score, picked)) : 'No bet'}</h2>
          <p class="p-lede">${picked ? 'Right answer wins it. Wrong answer loses it.' : 'Nothing to win, nothing to lose.'}</p>
          <p class="p-sent" id="pSent" hidden>Sending your bet&hellip;</p>
        </section>`;
      return;
    }
    screen.innerHTML = `${header()}
      <section class="p-wager">
        <p class="kicker">Before the final question</p>
        <h2 class="p-title">Bet your cheese</h2>
        <p class="p-lede">Right answer: you win your bet. Wrong: you lose it.</p>
        <div class="p-bets">${SQ.BETS.map((pct) => `<button class="p-bet b${pct}" data-pct="${pct}"><strong>${NAMES[pct]}</strong><span>${pct ? fmt(SQ.stake(score, pct)) : 'No risk'}</span></button>`).join('')}</div>
        <p class="p-hint"><span id="pWSecs"></span></p>
      </section>`;
    const ends = Date.now() + (s.endsIn || 0);
    const tick = () => { const left = Math.ceil(Math.max(0, ends - Date.now()) / 1000); const el = $('#pWSecs'); if (el) el.textContent = left ? `${left} s to decide` : 'Time is up'; if (!left) clearInterval(countdown); };
    tick(); countdown = setInterval(tick, 250);
    screen.querySelectorAll('.p-bet').forEach((b) => b.addEventListener('click', () => {
      answers[key] = Number(b.dataset.pct); try { sessionStorage.setItem('squeak-answers', JSON.stringify(answers)); } catch (e) { /* private mode */ }
      buzz(30); send(s, answers[key]); shownKey = ''; render(false); checkSent();
    }));
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
    const old = link; const keep = me.code;
    // Tell the big screen, so no empty seat is left behind (not when the host removed us).
    if (old && joined && !message) old.send('leave', { id: me.id }).catch(() => {}).then(() => old.close()); else if (old) old.close();
    link = null; joined = false; clearTimeout(resendTimer); clearInterval(joinRetry); clearTimeout(notFoundTimer);
    me.code = ''; me.id = SQ.uid(); saveMe();
    renderJoin(message, keep);
  }

  // Reactions: a row of buttons under the result, the leaderboard and the final screen. Each tap floats up the big screen.
  const bar = document.createElement('nav'); bar.id = 'react'; bar.className = 'p-react'; bar.setAttribute('aria-label', 'Send a reaction');
  bar.innerHTML = SQ.REACTIONS.map((r, i) => `<button data-r="${i}" aria-label="${esc(r.name)}">${r.html}</button>`).join('');
  document.body.appendChild(bar);
  let lastReact = 0;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !link || !joined) return;
    b.classList.remove('p-react-go'); void b.offsetWidth; b.classList.add('p-react-go'); buzz(12);
    if (Date.now() - lastReact < 650) return;
    lastReact = Date.now(); link.send('react', { id: me.id, r: Number(b.dataset.r) }).catch(() => {});
  });

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && link) { sendJoin(); } });

  // Auto-rejoin if this phone was already in this room.
  if (me.code && me.name && (!urlRoom || urlRoom === me.code)) start();
  else renderJoin();
})();
