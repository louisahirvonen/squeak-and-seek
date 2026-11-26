// Shared helpers for the host screen and the player phones.
(function () {
  const cfg = window.SQUEAK_CONFIG;
  const params = new URLSearchParams(location.search);
  // ?transport=local runs everything through BroadcastChannel (same browser, several tabs): for testing without Supabase.
  const isLocal = params.get('transport') === 'local';

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36));

  const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ---------- Palette + answer styles ----------
  const C = { ink: '#0B0B0F', paper: '#F4F1EA', lime: '#D2F65A', pink: '#FF5FA2', sky: '#7FA8FF', orange: '#FF7A45', lilac: '#C9B8FF', mint: '#5EE6A8', coral: '#FF6B5B', blue: '#3D5AFE' };
  const g = (inner) => `<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true">${inner}</svg>`;
  const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  const GLYPHS = {
    cheese: g(`<path fill="currentColor" fill-rule="evenodd" d="M4 22 L40 9 L44 22 Z M4 25 H44 V40 H4 Z ${circ(30, 32, 3.6)} ${circ(14, 30, 2.4)} ${circ(39, 29, 2)} ${circ(20, 36, 1.6)}"/>`),
    cake: g(`<path fill="currentColor" d="M22.5 6c0 0-2.6 3-2.6 4.8a2.6 2.6 0 0 0 5.2 0C25.1 9 22.5 6 22.5 6z"/><rect fill="currentColor" x="21" y="14" width="3" height="8" rx="1"/><path fill="currentColor" d="M8 24h31a2 2 0 0 1 2 2v4c-2.6 0-2.6 2.4-5.2 2.4S33.2 30 30.6 30s-2.6 2.4-5.2 2.4S22.8 30 20.2 30 17.6 32.4 15 32.4 12.4 30 9.8 30H6v-4a2 2 0 0 1 2-2z"/><path fill="currentColor" d="M6 33.6c1.4.5 2.4.5 3.8 0 2.6 2.4 7.8 2.4 10.4 0 2.6 2.4 7.8 2.4 10.4 0 2.6 2.4 7.8 2.4 10.4 0V42H6z"/>`),
    balloon: g(`<path fill="currentColor" d="M24 4c7.7 0 13 6.3 13 13.6C37 26 30.6 32 24 32S11 26 11 17.6C11 10.3 16.3 4 24 4z"/><path fill="currentColor" d="M21 34h6l-3-3z"/><path d="M24 34c-3 4 3 6 0 10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>`),
    gift: g(`<path fill="currentColor" fill-rule="evenodd" d="M6 16h36v8H6z M9 26h30v16H9z M22 16h4v26h-4z"/><path fill="currentColor" d="M24 15c-3-6-10-8-11-4s6 4 11 4zm0 0c3-6 10-8 11-4s-6 4-11 4z"/>`),
    yes: g(`<path d="M10 25 L20 35 L39 14" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
    no: g(`<path d="M13 13 L35 35 M35 13 L13 35" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round"/>`),
  };
  const ANSWERS = [
    { name: 'cheese', color: C.lime, ink: C.ink, glyph: GLYPHS.cheese },
    { name: 'cake', color: C.pink, ink: C.ink, glyph: GLYPHS.cake },
    { name: 'balloon', color: C.sky, ink: C.ink, glyph: GLYPHS.balloon },
    { name: 'present', color: C.orange, ink: C.ink, glyph: GLYPHS.gift },
  ];
  const TF = [
    { name: 'true', color: C.mint, ink: C.ink, glyph: GLYPHS.yes },
    { name: 'false', color: C.coral, ink: C.ink, glyph: GLYPHS.no },
  ];
  const answerStyle = (type, i) => (type === 'truefalse' ? TF[i] : ANSWERS[i]);

  // ---------- Rats (flat, graphic) ----------
  const FURS = ['#FFFFFF', '#C9C5D3', '#3A3842', '#E9D3AE', '#C98B5E', '#9AA6BC'];
  const BADGES = [C.lime, C.pink, C.sky, C.orange, C.lilac, C.mint];
  let svgId = 0;
  function ratSVG({ fur = '#FFFFFF', eye = '#1E3FD9', hat = C.pink, hat2 = C.lime, mood = 'happy', cls = '' } = {}) {
    const id = 'hat' + (++svgId);
    const dark = fur === '#3A3842';
    const inner = dark ? '#E07A9B' : '#FFB4C8';
    const line = dark ? 'rgba(255,255,255,.35)' : 'rgba(11,11,15,.28)';
    const mouth = mood === 'sad'
      ? `<path d="M93 145 Q100 139 107 145" stroke="${C.ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`
      : `<path d="M93 141 Q100 148 107 141" stroke="${C.ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    const brows = mood === 'sad' ? `<path d="M70 99 L88 104 M130 99 L112 104" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>` : '';
    return `<svg class="rat ${cls}" viewBox="0 0 200 220" aria-hidden="true">
  <defs><clipPath id="${id}"><path d="M70 74 L100 4 L130 74 Z"/></clipPath></defs>
  <path d="M152 196 C194 198 198 156 174 146" stroke="#FF9BB8" stroke-width="8" fill="none" stroke-linecap="round"/>
  <ellipse cx="100" cy="178" rx="60" ry="40" fill="${fur}"/>
  <ellipse cx="78" cy="214" rx="14" ry="6" fill="#FF9BB8"/><ellipse cx="122" cy="214" rx="14" ry="6" fill="#FF9BB8"/>
  <circle cx="50" cy="84" r="31" fill="${fur}"/><circle cx="50" cy="84" r="19" fill="${inner}"/>
  <circle cx="150" cy="84" r="31" fill="${fur}"/><circle cx="150" cy="84" r="19" fill="${inner}"/>
  <ellipse cx="100" cy="120" rx="58" ry="50" fill="${fur}"/>
  ${brows}
  <ellipse cx="79" cy="116" rx="10" ry="11.5" fill="${eye}"/><ellipse cx="121" cy="116" rx="10" ry="11.5" fill="${eye}"/>
  <circle cx="82.5" cy="111.5" r="3.6" fill="#fff"/><circle cx="124.5" cy="111.5" r="3.6" fill="#fff"/>
  <ellipse cx="100" cy="134" rx="8" ry="6" fill="#FF7EA6"/>
  ${mouth}
  <g stroke="${line}" stroke-width="2" stroke-linecap="round"><path d="M84 134 L52 128"/><path d="M84 139 L52 143"/><path d="M116 134 L148 128"/><path d="M116 139 L148 143"/></g>
  <path d="M70 74 L100 4 L130 74 Z" fill="${hat}"/>
  <g clip-path="url(#${id})" fill="${hat2}"><path d="M60 30 L140 10 L140 22 L60 42 Z"/><path d="M60 58 L140 38 L140 50 L60 70 Z"/></g>
  <circle cx="100" cy="6" r="9" fill="${hat2}"/>
</svg>`;
  }
  // The birthday rat: white fur, blue eyes.
  const birthdayRat = (opts = {}) => ratSVG({ fur: '#FFFFFF', eye: '#1E3FD9', hat: C.pink, hat2: C.lime, ...opts });
  const pick = (id) => { const h = hash(id); return { fur: FURS[h % FURS.length], badge: BADGES[(h >>> 3) % BADGES.length], hat: BADGES[(h >>> 7) % BADGES.length] }; };
  const playerRat = (id, opts = {}) => { const p = pick(id); return ratSVG({ fur: p.fur, eye: p.fur === '#3A3842' ? '#F4F1EA' : C.ink, hat: p.hat === p.badge ? C.ink : p.hat, hat2: C.paper, ...opts }); };
  // Round avatar badge: rat face on a coloured disc.
  // bday = true draws the birthday rat herself (white fur, blue eyes, party hat) whatever the id.
  function avatar(id, cls = '', bday = false) {
    const p = bday ? { fur: '#FFFFFF', badge: C.pink } : pick(id);
    const dark = p.fur === '#3A3842';
    const eye = bday ? '#1E3FD9' : dark ? '#F4F1EA' : C.ink;
    return `<svg class="avatar ${cls}" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="50" fill="${p.badge}"/>
  <circle cx="27" cy="42" r="15" fill="${p.fur}"/><circle cx="27" cy="42" r="9" fill="${dark ? '#E07A9B' : '#FFB4C8'}"/>
  <circle cx="73" cy="42" r="15" fill="${p.fur}"/><circle cx="73" cy="42" r="9" fill="${dark ? '#E07A9B' : '#FFB4C8'}"/>
  <ellipse cx="50" cy="64" rx="27" ry="24" fill="${p.fur}"/>
  <ellipse cx="40" cy="61" rx="4.6" ry="5.4" fill="${eye}"/><ellipse cx="60" cy="61" rx="4.6" ry="5.4" fill="${eye}"/>
  <ellipse cx="50" cy="71" rx="4" ry="3" fill="#FF7EA6"/>
  ${bday ? `<path d="M37 43 L50 12 L63 43 Z" fill="${C.lime}"/><circle cx="50" cy="11" r="5" fill="${C.paper}"/>` : ''}
</svg>`;
  }
  const isBirthday = (name) => String(name || '').trim().toLowerCase() === String(cfg.birthdayName || '').trim().toLowerCase();

  // ---------- Questions ----------
  function normalizeQuestions(data) {
    const errors = [];
    if (!data || !Array.isArray(data.questions)) return { title: 'Squeak & Seek', questions: [], errors: ['questions.json needs a "questions" list.'] };
    const def = Number(data.defaultTimeLimit) || 20;
    const questions = data.questions.map((q, i) => {
      const n = i + 1;
      const text = String(q.text ?? '').trim();
      if (!text) errors.push(`Question ${n}: missing "text".`);
      let type = q.type || (Array.isArray(q.options) ? (q.options.some((o) => o && o.image) ? 'photo' : 'multiple') : 'truefalse');
      if (type === 'image' || type === 'images') type = 'photo';
      if (type === 'tf' || type === 'true/false') type = 'truefalse';
      if (type === 'slider' || type === 'numeric') type = 'number';
      if (type === 'poll' || type === 'majority') type = 'vote';
      if (type === 'task' || type === 'challenge') type = 'dare';
      if (type === 'anonymous' || type === 'open' || type === 'text') type = 'write';
      let options; let correct; let extra = {};
      if (type === 'number') {
        // Players step a counter up and down on their phone; only the exact number counts.
        const min = Number.isFinite(Number(q.min)) ? Math.round(Number(q.min)) : 0;
        const max = Number.isFinite(Number(q.max)) ? Math.round(Number(q.max)) : 20;
        const c = Number(q.correct);
        options = []; correct = [c]; extra = { min, max, unit: String(q.unit ?? ''), closest: q.scoring === 'closest' };
        if (max <= min) errors.push(`Question ${n}: "max" must be larger than "min".`);
        if (!Number.isInteger(c) || c < min || c > max) errors.push(`Question ${n}: "correct" must be a whole number from ${min} to ${max}.`);
      } else if (type === 'write') {
        // Everyone writes an answer; the answers are then shown without names and the room votes for the best one.
        options = []; correct = []; extra = { writeLimit: Number(q.writeLimit) || 45, voteLimit: Number(q.timeLimit) || 40 };
      } else if (type === 'dare') {
        // A surprise event, not a numbered question: a wheel picks a guest for the task in "text"; they accept or
        // decline, and the host judges.
        options = []; correct = []; extra = { points: Number(q.points) > 0 ? Math.round(Number(q.points)) : 1500 };
      } else if (type === 'vote' && q.options === 'players') {
        // Majority vote among the guests themselves: the options are filled in with whoever is playing when it is asked.
        options = []; correct = []; extra = { guests: true };
      } else if (type === 'truefalse') {
        options = [{ label: 'True' }, { label: 'False' }];
        const c = Array.isArray(q.correct) ? q.correct : [q.correct];
        correct = [...new Set(c.map((v) => (v === true || v === 'true' || v === 0 ? 0 : 1)))];
        if (q.correct === undefined) errors.push(`Question ${n}: true/false needs "correct": true or false.`);
      } else {
        options = (q.options || []).map((o) => (typeof o === 'string' || typeof o === 'number' ? { label: String(o) } : { label: String(o.label ?? ''), image: o.image, icon: o.icon }));
        if (options.length < 2 || options.length > 4) errors.push(`Question ${n}: needs 2–4 options (has ${options.length}).`);
        if (type === 'photo' && options.some((o) => !o.image)) errors.push(`Question ${n}: every option of a photo question needs an "image".`);
        const c = Array.isArray(q.correct) ? q.correct : [q.correct];
        correct = c.map(Number).filter((v) => Number.isInteger(v) && v >= 0 && v < options.length);
        if (type === 'vote') correct = []; // no right answer: the most popular one wins, decided when the question ends
        else if (!correct.length) errors.push(`Question ${n}: "correct" must be an option position from 0 to ${options.length - 1} (or a list of them).`);
      }
      const media = q.media || (q.image ? { image: q.image } : q.video ? { video: q.video } : null);
      return { text, type, options, correct, media, timeLimit: extra.voteLimit || Number(q.timeLimit) || def, ...extra };
    });
    return { title: data.title || 'Squeak & Seek', questions, errors };
  }

  const pointsFor = (seconds, limit) => { const t = Math.max(0, Math.min(seconds, limit)); return Math.round(1000 * (1 - t / (2 * limit))); };

  // Streak bonus: 2 right in a row = +100, 3 = +200, 4 or more = +300.
  const streakBonus = (streak) => Math.max(0, Math.min(streak - 1, 3)) * 100;
  // Bet your cheese: the shares of your score you can bet, and what a share is worth. Everyone can stake at least
  // 1,000, so the rats at the bottom have something to play for too.
  const WRITE_MAX = 60; // longest anonymous answer, in characters
  const BETS = [0, 25, 50, 100];
  const stake = (score, pct) => Math.round(Math.max(Number(score) || 0, 1000) * pct / 100);
  // Stable pick from a list (same seed, same line), so a re-render never changes the text.
  const pickLine = (list, seed) => list[hash(seed) % list.length];

  // ---------- Transport ----------
  // Two topics per room: "squeak-CODE" (host -> phones) and "squeak-CODE-host" (phones -> host only).
  let sbClient = null;
  const client = () => sbClient || (sbClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey));

  function connect({ code, role, events, onMessage, onStatus = () => {} }) {
    const roomTopic = `squeak-${code}`;
    const hostTopic = `squeak-${code}-host`;
    const listenTopic = role === 'host' ? hostTopic : roomTopic;
    const sendTopic = role === 'host' ? roomTopic : hostTopic;

    if (isLocal) {
      const inbox = new BroadcastChannel(listenTopic);
      const outbox = new BroadcastChannel(sendTopic);
      inbox.onmessage = (e) => onMessage(e.data.event, e.data.payload);
      setTimeout(() => onStatus('SUBSCRIBED'), 30);
      return {
        send: async (event, payload) => { outbox.postMessage({ event, payload: JSON.parse(JSON.stringify(payload)) }); return true; },
        close: () => { inbox.close(); outbox.close(); },
      };
    }

    const sb = client();
    const inbox = sb.channel(listenTopic, { config: { broadcast: { self: false } } });
    events.forEach((ev) => inbox.on('broadcast', { event: ev }, (m) => onMessage(ev, m.payload)));
    inbox.subscribe((status) => onStatus(status));

    // Host sends over the websocket (one message fans out to all phones).
    // Phones send over REST so their answers are not copied to every other phone.
    const outbox = sb.channel(sendTopic, { config: { broadcast: { self: false } } });
    let outReady = null;
    const subscribeOutbox = () => outReady || (outReady = new Promise((res) => outbox.subscribe((s) => { if (s === 'SUBSCRIBED') res(); })));
    let restBroken = false;
    if (role === 'host') subscribeOutbox();

    async function send(event, payload) {
      if (role === 'host') {
        await Promise.race([subscribeOutbox(), new Promise((r) => setTimeout(r, 3000))]);
        const r = await outbox.send({ type: 'broadcast', event, payload });
        return r === 'ok';
      }
      if (!restBroken) {
        try { await outbox.httpSend(event, payload); return true; } catch (err) { console.warn('httpSend failed, switching to websocket', err); restBroken = true; }
      }
      await Promise.race([subscribeOutbox(), new Promise((r) => setTimeout(r, 4000))]);
      return (await outbox.send({ type: 'broadcast', event, payload })) === 'ok';
    }
    return { send, close: () => { sb.removeChannel(inbox); sb.removeChannel(outbox); } };
  }

  // ---------- Keep screens awake ----------
  let lock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch (e) { /* not supported */ }
  }
  document.addEventListener('visibilitychange', () => { if (lock && document.visibilityState === 'visible') keepAwake(); });

  // ---------- Confetti ----------
  function confetti(duration = 3500, kind = 'paper') {
    const c = document.createElement('canvas');
    c.className = 'confetti';
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const resize = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; };
    resize();
    const cheese = kind === 'cheese';
    const colors = cheese ? ['#FFD23F', '#FFC21A', C.lime, C.paper] : [C.lime, C.pink, C.sky, C.orange, C.lilac, C.paper];
    const parts = Array.from({ length: 180 }, () => ({
      x: Math.random() * c.width, y: -Math.random() * c.height * 0.6, w: (6 + Math.random() * 8) * dpr * (cheese ? 2.2 : 1), h: (8 + Math.random() * 10) * dpr * (cheese ? 1.6 : 1),
      vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, col: colors[Math.floor(Math.random() * colors.length)],
    }));
    const start = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, c.width, c.height);
      parts.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.05 * dpr; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col;
        if (cheese) { ctx.beginPath(); ctx.moveTo(-p.w / 2, p.h / 2); ctx.lineTo(p.w / 2, p.h / 2); ctx.lineTo(p.w / 2, -p.h / 2); ctx.closePath(); ctx.fill(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(p.w * 0.18, p.h * 0.2, p.w * 0.1, 0, 7); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore(); });
      if (now - start < duration) requestAnimationFrame(frame); else c.remove();
    })(start);
  }

  // Reactions a phone can send to the big screen (drawn, not emoji).
  const REACTIONS = [
    { name: 'Love', html: g('<path fill="currentColor" d="M24 42C10 31 5 24 5 16.5A9.5 9.5 0 0 1 24 12a9.5 9.5 0 0 1 19 4.5C43 24 38 31 24 42z"/>') },
    { name: 'Cheese', html: GLYPHS.cheese },
    { name: 'Ha ha', html: '<b>HA HA</b>' },
    { name: 'No', html: '<b>NOOO</b>' },
  ];

  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  window.SQ = { cfg, params, isLocal, escapeHtml, uid, hash, C, GLYPHS, ANSWERS, TF, answerStyle, ratSVG, birthdayRat, playerRat, avatar, isBirthday, normalizeQuestions, pointsFor, streakBonus, BETS, stake, WRITE_MAX, REACTIONS, pickLine, connect, keepAwake, confetti, ordinal, fmt };
})();
