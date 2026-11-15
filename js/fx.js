/* Visual effects: pixel particles, full-screen banners, toasts, shake,
   the rank-up cutscene and number count-ups. Banners play one at a time. */
(function () {
  CF.fx = {};
  let canvas, ctx, parts = [], raf = null;

  function setup() {
    canvas = document.getElementById('fx-canvas');
    ctx = canvas.getContext('2d');
    const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
    resize();
    addEventListener('resize', resize);
  }

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life--;
      ctx.globalAlpha = Math.min(1, p.life / 30);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x / 4) * 4, Math.round(p.y / 4) * 4, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(loop) : null;
  }

  CF.fx.burst = function (x, y, colors, count, power) {
    if (!canvas) setup();
    count = count || 60; power = power || 9;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = Math.random() * power + 2;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, g: 0.25,
        s: Math.random() < 0.3 ? 8 : 4, c: colors[i % colors.length], life: 60 + Math.random() * 50 });
    }
    if (!raf) raf = requestAnimationFrame(loop);
  };

  CF.fx.confetti = function (colors) {
    if (!canvas) setup();
    for (let i = 0; i < 140; i++) {
      parts.push({ x: Math.random() * innerWidth, y: -20 - Math.random() * 300,
        vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3 + 2, g: 0.04,
        s: Math.random() < 0.5 ? 8 : 4, c: colors[i % colors.length], life: 160 + Math.random() * 80 });
    }
    if (!raf) raf = requestAnimationFrame(loop);
  };

  CF.fx.shake = function (el) {
    el = el || document.body;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 500);
  };

  CF.fx.flash = function (color) {
    const f = document.createElement('div');
    f.className = 'flash';
    f.style.background = color;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 600);
  };

  /* ---- Banner queue ---- */
  const bannerQueue = [];
  let bannerBusy = false;
  CF.fx.banner = function (opts) {
    bannerQueue.push(opts);
    if (!bannerBusy) nextBanner();
  };
  function nextBanner() {
    const o = bannerQueue.shift();
    if (!o) { bannerBusy = false; return; }
    bannerBusy = true;
    const layer = document.getElementById('fx-layer');
    const b = document.createElement('div');
    b.className = 'banner ' + (o.kind || '');
    b.style.setProperty('--bc', o.color || 'var(--rank)');
    b.innerHTML = '<div class="banner-box">' +
      (o.top ? '<div class="banner-top">' + CF.esc(o.top) + '</div>' : '') +
      '<div class="banner-title">' + CF.esc(o.title) + '</div>' +
      (o.sub ? '<div class="banner-sub">' + CF.esc(o.sub) + '</div>' : '') + '</div>';
    layer.appendChild(b);
    if (o.sound) o.sound();
    if (o.effect) o.effect();
    const dur = o.duration || 2600;
    setTimeout(() => b.classList.add('out'), dur - 300);
    setTimeout(() => { b.remove(); nextBanner(); }, dur);
  }

  /* ---- Toasts (small notifications at the bottom) ---- */
  CF.fx.toast = function (html, color) {
    const wrap = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast';
    if (color) t.style.setProperty('--tc', color);
    t.innerHTML = html;
    wrap.appendChild(t);
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4600);
  };

  CF.fx.floatText = function (text, x, y, color) {
    const f = document.createElement('div');
    f.className = 'float-text';
    f.textContent = text;
    f.style.left = x + 'px'; f.style.top = y + 'px';
    if (color) f.style.color = color;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1600);
  };

  /* ---- Big moments ---- */
  const center = () => [innerWidth / 2, innerHeight / 2];
  const AC_COLORS = ['#4ddb5c', '#b6ff6a', '#ffffff', '#ffd23f'];

  CF.fx.accepted = function (problemLabel, extra) {
    CF.fx.banner({
      kind: 'ac', color: '#4ddb5c', top: problemLabel, title: 'STAGE CLEAR!', sub: extra || 'ACCEPTED',
      sound: CF.sound.ac,
      effect: () => { CF.fx.flash('rgba(77,219,92,.35)'); CF.fx.burst(...center(), AC_COLORS, 90, 11); },
    });
  };
  CF.fx.rejected = function (problemLabel, label, verdict) {
    const ce = verdict === 'COMPILATION_ERROR';
    CF.fx.banner({
      kind: 'wa', color: ce ? '#ffd23f' : '#ff4d4d', top: problemLabel,
      title: ce ? 'SYNTAX ERROR' : 'MISS!', sub: (label || '').toUpperCase() + ' · CONTINUE?',
      duration: 2200, sound: ce ? CF.sound.ce : CF.sound.wa,
      effect: () => { CF.fx.flash(ce ? 'rgba(255,210,63,.25)' : 'rgba(255,77,77,.3)'); CF.fx.shake(document.getElementById('viewport')); },
    });
  };
  CF.fx.combo = function (n) {
    CF.fx.banner({ kind: 'combo', color: '#ffd23f', title: 'x' + n + ' COMBO!', sub: 'KEEP IT UP', duration: 1600,
      sound: CF.sound.coin, effect: () => CF.fx.burst(...center(), ['#ffd23f', '#ff9f1c', '#fff'], 50, 8) });
  };
  CF.fx.levelUp = function (level) {
    CF.fx.banner({ kind: 'level', title: 'LEVEL UP!', top: 'LV ' + (level - 1) + ' → LV ' + level, sub: 'NEW POWERS UNLOCKED',
      sound: CF.sound.levelUp, effect: () => CF.fx.confetti(['#ffd23f', '#fff', getRank()]) });
  };
  CF.fx.rankUp = function (rank) {
    CF.fx.banner({ kind: 'rankup', color: rank.color, top: 'RANK UP', title: rank.name.toUpperCase(), sub: 'A NEW COLOR HAS BEEN UNLOCKED',
      duration: 4500, sound: CF.sound.rankUp,
      effect: () => { CF.fx.flash(rank.color); CF.fx.confetti([rank.color, '#fff', '#ffd23f']); } });
  };
  CF.fx.ratingChange = function (delta, contestName) {
    const up = delta >= 0;
    CF.fx.banner({ kind: up ? 'ac' : 'wa', color: up ? '#4ddb5c' : '#ff4d4d', top: contestName,
      title: (up ? '+' : '') + delta, sub: up ? 'RATING UP' : 'RATING DOWN · NEXT TIME', duration: 3500,
      sound: up ? CF.sound.levelUp : CF.sound.ratingDown,
      effect: () => { if (up) CF.fx.confetti(['#4ddb5c', '#fff', '#ffd23f']); } });
  };
  CF.fx.achievement = function (a) {
    CF.sound.achievement();
    CF.fx.toast('<span class="toast-icon tier-' + a.tier + '">' + a.icon + '</span><div><b>ACHIEVEMENT UNLOCKED</b><br>' +
      CF.esc(a.title) + ' — ' + CF.esc(a.desc) + '</div>', '#ffd23f');
  };
  function getRank() { return getComputedStyle(document.documentElement).getPropertyValue('--rank').trim() || '#fff'; }

  /* Count numbers up from their previous value. */
  CF.fx.countUps = function (root) {
    root.querySelectorAll('[data-count]').forEach(el => {
      const to = Number(el.dataset.count);
      const from = Number(el.dataset.from || 0);
      if (!isFinite(to) || from === to) { el.textContent = CF.fmtNum(to); return; }
      const t0 = performance.now(), dur = 900;
      const step = now => {
        const k = Math.min(1, (now - t0) / dur);
        el.textContent = CF.fmtNum(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  };
})();
