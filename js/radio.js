/* CF FM: a background radio that composes music live in the browser.
   Nothing is streamed or downloaded, so it uses zero data. Each "track" is
   32 bars in a random key and chord progression, then a new one starts. */
(function () {
  const R = CF.radio = { playing: false, station: 0, volume: 0.5, title: '', trackNo: 0 };

  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const MINOR = [0, 2, 3, 5, 7, 8, 10];
  const PENTA_MAJ = [0, 2, 4, 7, 9];
  const PENTA_MIN = [0, 3, 5, 7, 10];

  R.STATIONS = [
    { id: 'lofi', name: 'LO-FI BEATS', bpm: [72, 84], scale: MAJOR, penta: PENTA_MAJ, sevenths: true, swing: 0.28,
      progs: [[1, 4, 0, 5], [0, 5, 1, 4], [3, 2, 5, 1], [0, 3, 2, 5], [5, 1, 4, 0]], cutoff: 2600 },
    { id: 'chip', name: '8-BIT ARCADE', bpm: [128, 146], scale: MINOR, penta: PENTA_MIN, sevenths: false, swing: 0,
      progs: [[0, 5, 2, 6], [0, 3, 6, 2], [0, 6, 5, 4], [5, 6, 0, 0]], cutoff: 9000 },
    { id: 'synth', name: 'NIGHT DRIVE', bpm: [96, 108], scale: MINOR, penta: PENTA_MIN, sevenths: false, swing: 0,
      progs: [[0, 5, 2, 6], [0, 6, 5, 6], [5, 3, 0, 6], [0, 2, 5, 4]], cutoff: 5000 },
  ];

  const WORDS_A = ['Midnight', 'Lazy', 'Recursive', 'Greedy', 'Infinite', 'Quiet', 'Binary', 'Rainy', 'Sleepy', 'Neon',
    'Lucky', 'Hidden', 'Rated', 'Golden', 'Late-Night', 'Silent', 'Frozen', 'Electric'];
  const WORDS_B = ['Segment Tree', 'Two Pointers', 'Dijkstra', 'Bitmask', 'Off-by-One', 'Accepted', 'Prefix Sum',
    'DP Table', 'Binary Search', 'Union-Find', 'Pretests', 'Hack Phase', 'Sweep Line', 'Penalty', 'Div. 2 C', 'Memo'];

  let ctx, out, duck, filter, analyser, delay, delayFb, noiseBuf, hiss = null;
  let timer = null, nextTime = 0, step = 0, track = null;

  function setupAudio() {
    if (ctx) return true;
    ctx = CF.sound.context();
    if (!ctx) return false;
    out = ctx.createGain(); out.gain.value = R.volume * 0.5;
    duck = ctx.createGain(); duck.gain.value = 1;
    filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 4000;
    analyser = ctx.createAnalyser(); analyser.fftSize = 64;
    filter.connect(out); out.connect(duck); duck.connect(analyser); analyser.connect(ctx.destination);
    // Echo used by lead melodies
    delay = ctx.createDelay(1); delayFb = ctx.createGain(); delayFb.gain.value = 0.3;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    delay.connect(delayFb); delayFb.connect(delay); delay.connect(wet); wet.connect(filter);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function tone(type, midi, t, dur, vol, opts) {
    opts = opts || {};
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = mtof(midi);
    if (opts.detune) o.detune.value = opts.detune;
    const a = opts.attack || 0.005, r = opts.release || 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, Math.max(t + a, t + dur - r));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    if (opts.lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp;
      g.connect(f); f.connect(filter); if (opts.echo) f.connect(delay);
    } else { g.connect(filter); if (opts.echo) g.connect(delay); }
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(t, dur, vol, type, freq) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(filter);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  function kick(t, vol, len) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (len || 0.35));
    o.connect(g); g.connect(filter); o.start(t); o.stop(t + 0.4);
  }

  /* ---------- Composition ---------- */
  function newTrack() {
    const s = R.STATIONS[R.station];
    const rnd = Math.random;
    R.trackNo++;
    track = {
      s,
      root: 55 + Math.floor(rnd() * 9),          // key: G3..D#4
      bpm: s.bpm[0] + Math.floor(rnd() * (s.bpm[1] - s.bpm[0])),
      prog: s.progs[Math.floor(rnd() * s.progs.length)],
      bar: 0,
      melodyNote: 0,
      density: 0.25 + rnd() * 0.3,
    };
    R.title = WORDS_A[Math.floor(rnd() * WORDS_A.length)] + ' ' + WORDS_B[Math.floor(rnd() * WORDS_B.length)];
    filter.frequency.setTargetAtTime(s.cutoff, ctx.currentTime, 0.5);
    if (s.id === 'lofi') startHiss(); else stopHiss();
    if (R.onchange) R.onchange();
  }
  function chordNotes(degree) {
    const sc = track.s.scale, n = [];
    const count = track.s.sevenths ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const idx = degree + i * 2;
      n.push(track.root + sc[idx % 7] + 12 * Math.floor(idx / 7));
    }
    return n;
  }
  function startHiss() {
    if (hiss) return;
    hiss = ctx.createBufferSource(); hiss.buffer = noiseBuf; hiss.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000;
    const g = ctx.createGain(); g.gain.value = 0.012;
    hiss.connect(f); f.connect(g); g.connect(out); hiss.start();
  }
  function stopHiss() { if (hiss) { hiss.stop(); hiss = null; } }

  function playStep(t, i) {
    const s = track.s, beat = 60 / track.bpm, six = beat / 4;
    const bar = Math.floor(i / 16), pos = i % 16;
    const degree = track.prog[bar % track.prog.length];
    const chord = chordNotes(degree);
    const rnd = Math.random;
    const swingT = (pos % 2 === 1) ? t + six * s.swing : t;

    if (s.id === 'lofi') {
      if (pos === 0) chord.forEach((m, k) => tone('triangle', m, t + k * 0.012, beat * 4, 0.07,
        { attack: 0.08, release: 0.6, detune: (rnd() - 0.5) * 14, lp: 1400 }));
      if (pos === 0 || pos === 10 || (pos === 7 && rnd() < 0.4)) kick(t, 0.55);
      if (pos === 4 || pos === 12) { noise(swingT, 0.18, 0.18, 'bandpass', 1800); tone('sine', 50, t, 0.08, 0.06); }
      if (pos % 2 === 0 || rnd() < 0.2) noise(swingT, 0.04, 0.05 + rnd() * 0.04, 'highpass', 7000);
      if (pos === 0 || pos === 6 || pos === 10) tone('sine', chord[0] - 24, t, beat * 1.3, 0.22, { attack: 0.01, release: 0.2 });
      if (pos % 2 === 0 && rnd() < track.density) melody(swingT, beat * (rnd() < 0.5 ? 1 : 0.5), 'sine', 0.08, 72);
      if (rnd() < 0.08) noise(t, 0.006, 0.08, 'highpass', 2000);       // vinyl crackle
    } else if (s.id === 'chip') {
      tone('square', chord[pos % chord.length] + 12, t, six * 0.9, 0.025);           // arpeggio
      if (pos % 2 === 0) tone('square', chord[0] - 12 + (pos % 4 === 2 ? 12 : 0), t, six * 1.8, 0.05);
      if (pos === 0 || pos === 8 || (pos === 11 && rnd() < 0.5)) kick(t, 0.5, 0.15);
      if (pos === 4 || pos === 12) noise(t, 0.12, 0.15, 'bandpass', 2500);
      if (pos % 2 === 0) noise(t, 0.03, 0.04, 'highpass', 8000);
      if (bar % 4 >= 1 && rnd() < track.density + 0.15) melody(t, six * (rnd() < 0.6 ? 2 : 1), 'square', 0.035, 74);
    } else {
      if (pos === 0) chord.forEach(m => {
        tone('sawtooth', m, t, beat * 4, 0.025, { attack: 0.4, release: 0.8, detune: -8, lp: 1600 });
        tone('sawtooth', m, t, beat * 4, 0.025, { attack: 0.4, release: 0.8, detune: 8, lp: 1600 });
      });
      tone('sawtooth', chord[0] - 24, t, six * 0.8, 0.07, { lp: 600 });                // driving bass
      if (pos % 4 === 0) kick(t, 0.6, 0.3);
      if (pos === 4 || pos === 12) noise(t, 0.35, 0.2, 'bandpass', 1500);
      if (pos % 2 === 1) noise(t, 0.05, 0.04, 'highpass', 9000);
      if (bar % 8 >= 4 && pos % 2 === 0 && rnd() < track.density) melody(t, beat * (rnd() < 0.5 ? 1 : 0.5), 'square', 0.03, 72, true);
    }
  }
  function melody(t, dur, type, vol, base, echo) {
    const p = track.s.penta;
    track.melodyNote = Math.max(-3, Math.min(8, track.melodyNote + Math.floor(Math.random() * 5) - 2));
    const k = track.melodyNote;
    const m = base + (track.root - 60) + p[((k % 5) + 5) % 5] + 12 * Math.floor(k / 5);
    tone(type, m, t, dur, vol, { attack: 0.01, release: dur * 0.5, echo: echo || track.s.id === 'lofi' });
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + 0.2) {
      playStep(nextTime, step);
      nextTime += 60 / track.bpm / 4;
      step++;
      if (step % (16 * 32) === 0) { newTrack(); step = 0; nextTime += 0.6; }
    }
  }

  /* ---------- Public controls ---------- */
  R.play = function () {
    if (!setupAudio()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    if (R.playing) return true;
    R.playing = true;
    newTrack();
    step = 0;
    nextTime = ctx.currentTime + 0.1;
    out.gain.cancelScheduledValues(ctx.currentTime);
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.linearRampToValueAtTime(R.volume * 0.5, ctx.currentTime + 1.5);
    timer = setInterval(scheduler, 25);
    if (R.onchange) R.onchange();
    return true;
  };
  R.stop = function () {
    if (!R.playing) return;
    R.playing = false;
    clearInterval(timer); timer = null;
    out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
    stopHiss();
    if (R.onchange) R.onchange();
  };
  R.toggle = () => (R.playing ? R.stop() : R.play());
  R.setStation = function (i) {
    R.station = (i + R.STATIONS.length) % R.STATIONS.length;
    if (R.playing) { step = 0; nextTime = ctx.currentTime + 0.3; newTrack(); }
    else if (R.onchange) R.onchange();
  };
  R.skip = function () { if (R.playing) { step = 0; nextTime = ctx.currentTime + 0.3; newTrack(); } };
  R.setVolume = function (v) {
    R.volume = v;
    if (out && R.playing) out.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.05);
  };
  /* Quiet the music while a sound effect plays. */
  R.duck = function (seconds) {
    if (!R.playing || !duck) return;
    const t = ctx.currentTime;
    duck.gain.cancelScheduledValues(t);
    duck.gain.setTargetAtTime(0.25, t, 0.03);
    duck.gain.setTargetAtTime(1, t + (seconds || 1.2), 0.3);
  };
  R.levels = function () {
    if (!analyser || !R.playing) return null;
    const a = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(a);
    return a;
  };
})();
