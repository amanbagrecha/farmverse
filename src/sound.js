// FarmVerse sound: effects, the engine loop and ambience synthesised with WebAudio (no files), unlocked on the first user gesture.
export function createSound() {
  const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  const EV = ['pointerdown', 'pointerup', 'touchend', 'keydown'];
  const loops = {}, want = {}, lastAt = {};
  let ac = null, master = null, noiseBuf = null, isMuted = false, wantAmb = null, amb = null, attached = false;

  const ready = () => !!ac && !isMuted && ac.state === 'running';
  const now = () => ac.currentTime;

  function attach() { if (attached || typeof window === 'undefined') return; attached = true; for (const n of EV) window.addEventListener(n, unlock, true); }
  function detach() { if (!attached) return; attached = false; for (const n of EV) window.removeEventListener(n, unlock, true); }
  function settle() { if (ac && ac.state === 'running') { detach(); if (!isMuted) apply(); } }
  function unlock() {
    if (!AC) return detach();
    if (!ac) {
      try { ac = new AC(); } catch (e) { return detach(); }
      master = ac.createGain(); master.gain.value = 0.25; master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (isMuted) { if (ac.state === 'running') ac.suspend(); return; }
    const s = ac.createBufferSource(); s.buffer = ac.createBuffer(1, 1, 22050); s.connect(ac.destination); s.start(0);
    const p = ac.resume();
    if (p && p.then) p.then(settle, () => {}); else settle();
  }

  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, dur));
  }
  function tone(type, f0, t, dur, peak, f1, a = 0.005) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, a, peak, dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, type, f, q, peak, a = 0.01) {
    const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true; fl.type = type; fl.Q.value = q;
    if (Array.isArray(f)) { fl.frequency.setValueAtTime(f[0], t); for (let k = 1; k < f.length; k++) fl.frequency.exponentialRampToValueAtTime(f[k], t + (dur * k) / (f.length - 1)); } else fl.frequency.setValueAtTime(f, t);
    env(g, t, a, peak, dur); s.connect(fl); fl.connect(g); g.connect(master); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return fl;
  }

  const C = [523.25, 659.25, 783.99, 1046.5];
  const SFX = {
    ui: (t) => tone('square', 1800, t, 0.03, 0.06),
    select: (t) => { tone('sine', 660, t, 0.09, 0.3, 990); tone('sine', 1320, t + 0.05, 0.08, 0.1); },
    plant: (t) => { for (let k = 0; k < 4; k++) noise(t + k * 0.075 + Math.random() * 0.02, 0.05 + Math.random() * 0.02, 'highpass', 4500 + Math.random() * 2000, 0.7, 0.32, 0.004); },
    irrigate: (t) => {
      noise(t, 0.75, 'lowpass', [600, 1100, 500], 0.8, 0.1, 0.08);
      for (let k = 0; k < 9; k++) { const f = 260 + Math.random() * 520; tone('sine', f, t + k * 0.07 + Math.random() * 0.03, 0.07, 0.22, f * 2.2, 0.004); }
    },
    spray: (t) => noise(t, 0.6, 'bandpass', [5000, 7000], 0.9, 0.3, 0.06),
    harvest: (t) => C.forEach((f, k) => { tone('triangle', f, t + k * 0.045, 0.9, 0.18); tone('sine', f * 2, t + k * 0.045, 0.45, 0.04); }),
    advance: (t) => noise(t, 0.75, 'bandpass', [300, 1800, 400], 1.2, 0.35, 0.25),
    mission: (t) => {
      [392, 523.25, 659.25, 783.99].forEach((f, k) => tone('square', f, t + k * 0.11, 0.12, 0.07));
      C.forEach((f) => tone('triangle', f, t + 0.46, 1.0, 0.13, 0, 0.02));
    },
    alert: (t) => { for (let k = 0; k < 2; k++) { tone('sine', 880, t + k * 0.32, 0.14, 0.26); tone('sine', 660, t + k * 0.32 + 0.16, 0.14, 0.26); } },
  };

  function fadeOut(g, nodes, s = 0.3) {
    const t = now();
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + s);
    for (const n of nodes) { try { n.stop(t + s + 0.05); } catch (e) { n.disconnect(); } }
    setTimeout(() => g.disconnect(), (s + 0.2) * 1000);
  }
  function noiseSrc() { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(now(), Math.random() * 1.5); return s; }
  function lfo(freq, depth, target) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = freq; g.gain.value = depth; o.connect(g); g.connect(target); o.start(); return o; }

  const LOOPS = {
    engine: () => {
      const t = now(), g = ac.createGain(), lp = ac.createBiquadFilter(), o1 = ac.createOscillator(), o2 = ac.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; lp.frequency.value = 360; lp.Q.value = 2;
      o1.frequency.setValueAtTime(44, t); o1.frequency.linearRampToValueAtTime(58, t + 1.4);
      o2.frequency.setValueAtTime(22, t); o2.frequency.linearRampToValueAtTime(29, t + 1.4);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.2, t + 0.25);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master); o1.start(t); o2.start(t);
      const tr = lfo(7, 0.04, g.gain);
      return { stop: () => fadeOut(g, [o1, o2, tr], 0.25) };
    },
  };
  const AMB = {
    rain: () => {
      const g = ac.createGain(), hp = ac.createBiquadFilter(), lp = ac.createBiquadFilter(), s = noiseSrc();
      hp.type = 'highpass'; hp.frequency.value = 400; lp.type = 'lowpass'; lp.frequency.value = 2600;
      g.gain.setValueAtTime(0, now()); g.gain.linearRampToValueAtTime(0.22, now() + 1.2);
      s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(master);
      return { stop: () => fadeOut(g, [s], 0.8) };
    },
    wind: () => {
      const g = ac.createGain(), bp = ac.createBiquadFilter(), s = noiseSrc();
      bp.type = 'bandpass'; bp.frequency.value = 450; bp.Q.value = 0.9;
      g.gain.setValueAtTime(0, now()); g.gain.linearRampToValueAtTime(0.16, now() + 1.5);
      s.connect(bp); bp.connect(g); g.connect(master);
      const a = lfo(0.13, 260, bp.frequency), b = lfo(0.07, 0.06, g.gain);
      return { stop: () => fadeOut(g, [s, a, b], 0.8) };
    },
    birds: () => {
      let alive = true, timer = 0;
      const chirp = () => {
        if (!alive) return;
        if (ready()) {
          const t = now() + 0.02, n = 2 + Math.floor(Math.random() * 4), base = 2400 + Math.random() * 1800;
          for (let k = 0; k < n; k++) tone('sine', base * (0.9 + Math.random() * 0.2), t + k * 0.09, 0.06, 0.05, base * (1.3 + Math.random() * 0.3), 0.004);
        }
        timer = setTimeout(chirp, 900 + Math.random() * 2600);
      };
      timer = setTimeout(chirp, 300);
      return { stop: () => { alive = false; clearTimeout(timer); } };
    },
  };

  function apply() {
    if (!ready()) return;
    for (const n of Object.keys(want)) {
      if (want[n] && !loops[n] && LOOPS[n]) loops[n] = LOOPS[n]();
      else if (!want[n] && loops[n]) { loops[n].stop(); delete loops[n]; }
    }
    if ((amb && amb.kind) !== wantAmb) {
      if (amb) amb.stop();
      amb = wantAmb ? { kind: wantAmb, ...AMB[wantAmb]() } : null;
    }
  }

  attach();
  return {
    play(name) {
      if (!ready() || !SFX[name]) return;
      const t = now();
      if (lastAt[name] != null && t - lastAt[name] < 0.04) return;
      lastAt[name] = t;
      try { SFX[name](t + 0.01); } catch (e) { console.warn('sound', name, e); }
    },
    loop(name, on) { if (!LOOPS[name]) return; want[name] = !!on; apply(); },
    ambient(kind) { wantAmb = AMB[kind] ? kind : null; apply(); },
    setMuted(b) {
      isMuted = !!b;
      if (!ac) return;
      if (isMuted) { ac.suspend(); return; }
      const p = ac.resume();
      if (p && p.then) p.then(settle, () => attach()); else settle();
      if (ac.state !== 'running') attach();
    },
    muted: () => isMuted,
    destroy() {
      detach();
      for (const n of Object.keys(loops)) { loops[n].stop(); delete loops[n]; }
      if (amb) { amb.stop(); amb = null; }
      if (ac) { ac.close(); ac = null; }
    },
  };
}
