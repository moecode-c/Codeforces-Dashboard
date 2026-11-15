/* 8-bit sound effects generated with the Web Audio API (no audio files).
   Browsers only allow sound after a tap, so unlock() runs on PRESS START. */
(function () {
  let ctx = null;
  let master = null;
  CF.sound = { enabled: true };

  CF.sound.unlock = function () {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  };

  /* The radio shares this audio context. */
  CF.sound.context = function () { CF.sound.unlock(); return ctx; };

  function note(freq, start, dur, type, vol, slideTo) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol || 0.6, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(master);
    o.start(start); o.stop(start + dur + 0.02);
  }

  function play(seq) {
    if (!CF.sound.enabled || !ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.02;
    const end = Math.max(...seq.map(n => n[1] + n[2]));
    if (CF.radio && end > 0.2) CF.radio.duck(end + 0.4);
    for (const [f, at, dur, type, vol, slide] of seq) note(f, t0 + at, dur, type, vol, slide);
  }

  const N = { C4: 262, E4: 330, G4: 392, A4: 440, C5: 523, D5: 587, E5: 659, F5: 698, G5: 784,
    A5: 880, B5: 988, C6: 1047, E6: 1319, G6: 1568 };

  CF.sound.ac = () => play([
    [N.C5, 0, 0.09], [N.E5, 0.09, 0.09], [N.G5, 0.18, 0.09], [N.C6, 0.27, 0.32],
    [N.E5, 0.27, 0.32, 'triangle', 0.4], [N.G5, 0.27, 0.32, 'triangle', 0.4],
  ]);
  CF.sound.wa = () => play([
    [300, 0, 0.16, 'sawtooth', 0.4, 220], [220, 0.17, 0.32, 'sawtooth', 0.4, 110],
  ]);
  CF.sound.ce = () => play([[180, 0, 0.12, 'square', 0.4], [180, 0.16, 0.12, 'square', 0.4]]);
  CF.sound.coin = () => play([[N.B5, 0, 0.07], [N.E6, 0.07, 0.3]]);
  CF.sound.click = () => play([[N.A5, 0, 0.04, 'square', 0.25]]);
  CF.sound.tick = () => play([[N.C6, 0, 0.03, 'square', 0.2]]);
  CF.sound.start = () => play([
    [N.C5, 0, 0.08], [N.G5, 0.08, 0.08], [N.C6, 0.16, 0.08], [N.G6, 0.24, 0.25, 'square', 0.4],
  ]);
  CF.sound.levelUp = () => play([
    [N.C5, 0, 0.07], [N.D5, 0.07, 0.07], [N.E5, 0.14, 0.07], [N.F5, 0.21, 0.07],
    [N.G5, 0.28, 0.07], [N.A5, 0.35, 0.07], [N.B5, 0.42, 0.07], [N.C6, 0.49, 0.4],
  ]);
  CF.sound.achievement = () => play([
    [N.E5, 0, 0.1], [N.G5, 0.1, 0.1], [N.E6, 0.2, 0.1], [N.C6, 0.3, 0.1], [N.G6, 0.4, 0.4, 'triangle', 0.5],
  ]);
  CF.sound.rankUp = () => play([
    [N.G4, 0, 0.12], [N.C5, 0.12, 0.12], [N.E5, 0.24, 0.12], [N.G5, 0.36, 0.3],
    [N.E5, 0.7, 0.12], [N.G5, 0.82, 0.6], [N.C6, 0.82, 0.6, 'triangle', 0.5], [N.E6, 1.0, 0.5, 'triangle', 0.3],
  ]);
  CF.sound.ratingDown = () => play([[N.G5, 0, 0.15], [N.E5, 0.15, 0.15], [N.C5, 0.3, 0.4]]);
})();
