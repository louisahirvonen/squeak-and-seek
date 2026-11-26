// Music + sound effects for the host screen. Phones stay silent.
(function () {
  const STORE = 'squeak-audio';
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  const state = {
    volume: saved.volume ?? 0.7,
    muted: saved.muted ?? false,
    slots: Object.assign({ lobby: 'synth:lobby', question: 'synth:question', podium: 'synth:podium', dance: 'synth:dance' }, saved.slots || {}),
  };
  const localFiles = {}; // slot -> {name, url} chosen from this computer (not saved across reloads)
  let tracks = []; // from music/music.json
  const save = () => localStorage.setItem(STORE, JSON.stringify({ volume: state.volume, muted: state.muted, slots: state.slots }));

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
    applyVolume();
  }
  function applyVolume() {
    const v = state.muted ? 0 : state.volume;
    if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    if (audioEl) audioEl.volume = v * 0.8;
  }

  // ---------- Sound effects (synthesised, short and quiet) ----------
  function tone({ type = 'sine', f0, f1 = f0, dur = 0.15, gain = 0.15, at = 0, filter = null }) {
    if (!ctx || state.muted) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise({ dur = 0.3, gain = 0.08, from = 400, to = 2000, at = 0, q = 1.5 }) {
    if (!ctx || state.muted) return;
    const t = ctx.currentTime + at;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + dur);
  }
  const sfx = {
    squeak() { const p = 1 + Math.random() * 0.25; tone({ f0: 1700 * p, f1: 2600 * p, dur: 0.07, gain: 0.07 }); tone({ f0: 2600 * p, f1: 2000 * p, dur: 0.07, gain: 0.06, at: 0.07 }); },
    // n = seconds left: the tick climbs in pitch and gets a low thump under it as time runs out.
    tick(n = 5) { const up = 1 + (5 - Math.max(1, Math.min(n, 5))) * 0.09; tone({ type: 'square', f0: 1300 * up, dur: 0.04, gain: 0.04, filter: 3400 }); tone({ f0: 90, f1: 55, dur: 0.12, gain: 0.1 }); },
    // Snare-style roll that swells for `dur` seconds.
    roll(dur = 1) { for (let t = 0; t < dur; t += 0.045) noise({ dur: 0.05, gain: 0.025 + 0.06 * (t / dur), from: 1800, to: 900, at: t, q: 0.6 }); },
    blip(i = 0) { tone({ type: 'triangle', f0: 520 * Math.pow(1.12, i), dur: 0.09, gain: 0.05 }); },
    fanfare() { [[523, 0, 0.14], [659, 0.14, 0.14], [784, 0.28, 0.14], [1047, 0.42, 0.7]].forEach(([f, at, dur]) => { tone({ type: 'sawtooth', f0: f, dur, gain: 0.06, at, filter: 2600 }); tone({ type: 'triangle', f0: f * 2, dur, gain: 0.03, at }); }); },
    chime() { tone({ f0: 880, dur: 0.5, gain: 0.08 }); tone({ f0: 1320, dur: 0.7, gain: 0.07, at: 0.11 }); tone({ f0: 1760, dur: 0.8, gain: 0.04, at: 0.22 }); },
    womp() { tone({ type: 'sawtooth', f0: 240, f1: 120, dur: 0.35, gain: 0.06, filter: 900 }); tone({ type: 'sawtooth', f0: 180, f1: 80, dur: 0.55, gain: 0.06, at: 0.32, filter: 700 }); },
    whoosh() { noise({ dur: 0.45, gain: 0.05, from: 300, to: 2500 }); },
    pop() { noise({ dur: 0.08, gain: 0.08, from: 1500, to: 600, q: 0.8 }); },
    horn() { [0, 0.18].forEach((at, i) => tone({ type: 'sawtooth', f0: i ? 523 : 392, f1: i ? 540 : 400, dur: i ? 0.6 : 0.16, gain: 0.07, at, filter: 2200 })); noise({ dur: 0.15, gain: 0.1, from: 2000, to: 500, at: 0.85, q: 0.7 }); },
    go() { tone({ type: 'triangle', f0: 660, dur: 0.12, gain: 0.07 }); tone({ type: 'triangle', f0: 990, dur: 0.18, gain: 0.07, at: 0.1 }); },
    timeUp() { tone({ type: 'triangle', f0: 520, f1: 500, dur: 0.4, gain: 0.07 }); },
  };

  // ---------- Built-in wonky synth music ----------
  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const SONGS = {
    lobby: { bpm: 116, swing: 0.18,
      bass: [48, null, 55, null, 52, null, 55, 54, 50, null, 57, null, 53, null, 57, 56],
      mel: [72, 74, 76, null, 79, 78, 76, null, 74, 77, 81, null, 80, 79, 77, 74,
            72, null, 76, 75, 76, 79, null, 84, 83, 81, 79, 77, 76, 74, 72, null],
      wonk: 0.012 },
    question: { bpm: 152, swing: 0.08,
      bass: [45, 45, 52, 45, 44, 44, 51, 44, 43, 43, 50, 43, 44, 45, 46, 47],
      mel: [69, null, 72, 71, 69, null, 76, 75, 74, 72, 71, null, 68, 69, 71, 72,
            74, null, 77, 76, 74, null, 81, 80, 79, 77, 76, 74, 72, 71, 69, 68],
      wonk: 0.02 },
    podium: { bpm: 124, swing: 0.12,
      bass: [48, 48, 55, 55, 53, 53, 55, 55, 48, 52, 55, 60, 53, 57, 55, 43],
      mel: [72, 76, 79, 84, null, 79, 84, null, 81, 79, 77, 76, 77, 79, 76, null,
            72, 76, 79, 84, null, 86, 88, null, 86, 84, 83, 81, 79, 83, 84, null],
      wonk: 0.008 },
    // Goofy oom-pah for a dance dare: fast, bouncy and a bit out of tune on purpose.
    dance: { bpm: 172, swing: 0.3,
      bass: [48, null, 55, null, 43, null, 55, null, 50, null, 57, null, 43, null, 55, 47],
      mel: [76, 76, 79, 76, 72, null, 74, 75, 76, null, 84, null, 83, 81, 79, null,
            77, 77, 81, 77, 74, null, 73, 74, 79, 78, 79, 83, 84, null, 72, null],
      wonk: 0.045 },
  };
  let synth = null;
  function startSynth(name) {
    ensure();
    const song = SONGS[name] || SONGS.lobby;
    const out = ctx.createGain(); out.gain.value = 0.9; out.connect(musicBus);
    const s = { step: 0, next: ctx.currentTime + 0.08, out, timer: null, rate: 1 };
    const base = 60 / song.bpm / 4;
    const note = (type, freq, t, len, gain, cutoff) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); const f = ctx.createBiquadFilter();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      o.frequency.setValueAtTime(freq * (1 + (Math.random() - 0.5) * song.wonk), t + len * 0.3); // a little wobble
      f.type = 'lowpass'; f.frequency.value = cutoff;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + len + 0.02);
    };
    const hat = (t, gain) => {
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.03), ctx.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ctx.createBufferSource(); src.buffer = buf; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = ctx.createGain(); g.gain.value = gain; src.connect(f); f.connect(g); g.connect(out); src.start(t);
    };
    const kick = (t) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.16); };
    function schedule() {
      while (s.next < ctx.currentTime + 0.15) {
        const sixteenth = base / s.rate;
        const i = s.step; const t = s.next + (i % 2 ? sixteenth * song.swing : 0);
        const b = song.bass[i % song.bass.length]; if (b) note('square', N(b), t, sixteenth * 0.8, 0.07, 900);
        const m = song.mel[i % song.mel.length]; if (m) note('triangle', N(m), t, sixteenth * 0.9, 0.09, 4000);
        if (m && i % 4 === 2) note('square', N(m + 12), t, sixteenth * 0.4, 0.015, 3000);
        if (i % 4 === 0) kick(t);
        hat(t, i % 2 ? 0.02 : 0.035);
        s.step++; s.next += sixteenth;
      }
    }
    schedule(); s.timer = setInterval(schedule, 40);
    synth = s;
  }
  function stopSynth() { if (!synth) return; clearInterval(synth.timer); const g = synth.out; g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08); setTimeout(() => g.disconnect(), 600); synth = null; }

  // ---------- Music player ----------
  let audioEl = null; let currentSlot = null;
  // Last seconds of a question: the music speeds up a little.
  function hurry(on) { if (synth) synth.rate = on ? 1.22 : 1; if (audioEl) audioEl.playbackRate = on ? 1.12 : 1; }
  function stopMusic() { stopSynth(); if (audioEl) { audioEl.playbackRate = 1; audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } currentSlot = null; }
  function playSlot(slot) {
    ensure();
    if (currentSlot === slot) return;
    stopMusic(); currentSlot = slot;
    const choice = state.slots[slot] || 'none';
    if (choice === 'none') return;
    if (choice.startsWith('synth:')) return startSynth(choice.slice(6));
    let src = null;
    if (choice === 'local') src = localFiles[slot]?.url; else src = 'music/' + choice;
    if (!src) return startSynth(slot);
    if (!audioEl) { audioEl = new Audio(); audioEl.loop = true; }
    audioEl.src = src; audioEl.currentTime = 0; applyVolume();
    audioEl.play().catch((e) => console.warn('Music could not play', e));
  }
  function pauseMusic() { if (audioEl && !audioEl.paused) audioEl.pause(); if (synth) synth.out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05); }
  function resumeMusic() { if (audioEl && audioEl.src && currentSlot) audioEl.play().catch(() => {}); if (synth) synth.out.gain.setTargetAtTime(0.9, ctx.currentTime, 0.05); }

  async function loadTracks() {
    try { const r = await fetch('music/music.json', { cache: 'no-store' }); tracks = (await r.json()).tracks || []; } catch (e) { tracks = []; }
    return tracks;
  }
  const credits = () => {
    const used = Object.values(state.slots);
    return tracks.filter((t) => used.includes(t.file) && t.credit).map((t) => t.credit);
  };

  // ---------- Settings panel ----------
  const SLOT_NAMES = { lobby: 'Lobby', question: 'Questions (countdown)', podium: 'Podium', dance: 'Dance dare' };
  function panelHTML() {
    const opt = (slot, value, label) => `<option value="${value}" ${state.slots[slot] === value ? 'selected' : ''}>${SQ.escapeHtml(label)}</option>`;
    const rows = Object.keys(SLOT_NAMES).map((slot) => `
      <label class="slot"><span>${SLOT_NAMES[slot]}</span>
        <select data-slot="${slot}">
          ${opt(slot, 'synth:' + slot, 'Built-in: wonky synth (' + slot + ')')}
          ${['lobby', 'question', 'podium', 'dance'].filter((s) => s !== slot).map((s) => opt(slot, 'synth:' + s, 'Built-in: wonky synth (' + s + ')')).join('')}
          ${tracks.map((t) => opt(slot, t.file, t.title || t.file)).join('')}
          ${opt(slot, 'local', localFiles[slot] ? 'This computer: ' + localFiles[slot].name : 'Choose a file from this computer…')}
          ${opt(slot, 'none', 'No music')}
        </select>
        <button class="btn small ghost" data-preview="${slot}" type="button">▶ Preview</button>
      </label>`).join('');
    return `<div class="audio-panel">
      <h3>Music &amp; sound</h3>
      ${rows}
      <label class="slot"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value="${state.volume}" data-volume></label>
      <label class="check"><input type="checkbox" data-muted ${state.muted ? 'checked' : ''}> Mute everything</label>
      <p class="hint">Add your own MP3s to the <code>music</code> folder and list them in <code>music/music.json</code>, or pick a file from this computer on the night.</p>
      <input type="file" accept="audio/*" hidden data-file>
    </div>`;
  }
  function bindPanel(root, onChange = () => {}) {
    const fileInput = root.querySelector('[data-file]');
    let pendingSlot = null;
    root.querySelectorAll('select[data-slot]').forEach((sel) => sel.addEventListener('change', () => {
      const slot = sel.dataset.slot;
      if (sel.value === 'local') { pendingSlot = slot; fileInput.click(); return; }
      state.slots[slot] = sel.value; save(); if (currentSlot === slot) { currentSlot = null; playSlot(slot); } onChange();
    }));
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0]; if (!f || !pendingSlot) return;
      localFiles[pendingSlot] = { name: f.name, url: URL.createObjectURL(f) };
      state.slots[pendingSlot] = 'local'; save(); fileInput.value = '';
      if (currentSlot === pendingSlot) { currentSlot = null; playSlot(pendingSlot); }
      onChange(true);
    });
    root.querySelectorAll('[data-preview]').forEach((b) => b.addEventListener('click', () => {
      const slot = b.dataset.preview;
      if (currentSlot === slot) { stopMusic(); b.textContent = '▶ Preview'; return; }
      root.querySelectorAll('[data-preview]').forEach((x) => (x.textContent = '▶ Preview'));
      playSlot(slot); b.textContent = '■ Stop';
    }));
    root.querySelector('[data-volume]').addEventListener('input', (e) => { ensure(); state.volume = Number(e.target.value); save(); applyVolume(); });
    root.querySelector('[data-muted]').addEventListener('change', (e) => { ensure(); state.muted = e.target.checked; save(); applyVolume(); onChange(); });
  }
  function toggleMute() { ensure(); state.muted = !state.muted; save(); applyVolume(); return state.muted; }

  window.SQAudio = { ensure, sfx, playSlot, hurry, stopMusic, pauseMusic, resumeMusic, loadTracks, panelHTML, bindPanel, toggleMute, credits, get muted() { return state.muted; }, get current() { return currentSlot; } };
})();
