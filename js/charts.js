/* Pixel-style charts drawn on <canvas>. Each chart redraws on resize. */
(function () {
  CF.charts = {};
  const FONT = '"Press Start 2P", monospace';

  function prep(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, Math.floor(r.width)), h = Math.max(10, Math.floor(r.height));
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function empty(ctx, w, h, text) {
    ctx.fillStyle = '#6c6c8a';
    ctx.font = '10px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, h / 2);
  }
  const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

  CF.charts.rating = function (canvas, history) {
    const { ctx, w, h } = prep(canvas);
    if (!history || !history.length) return empty(ctx, w, h, 'NO RATED CONTESTS YET');
    const pts = history.map(x => ({ t: x.ratingUpdateTimeSeconds, r: x.newRating }));
    let lo = Math.min(...pts.map(p => p.r)), hi = Math.max(...pts.map(p => p.r));
    lo = Math.floor((lo - 100) / 100) * 100; hi = Math.ceil((hi + 100) / 100) * 100;
    const padL = 44, padR = 10, padT = 8, padB = 18;
    const X = i => padL + (pts.length === 1 ? (w - padL - padR) / 2 : (i / (pts.length - 1)) * (w - padL - padR));
    const Y = r => padT + (1 - (r - lo) / (hi - lo)) * (h - padT - padB);

    // Rank colour bands
    const bounds = CF.RANKS.map((k, i) => [Math.max(k.min, lo), i + 1 < CF.RANKS.length ? CF.RANKS[i + 1].min : 1e9, k]);
    ctx.font = '8px ' + FONT;
    ctx.textAlign = 'right';
    for (const [a, b, k] of bounds) {
      const top = Math.min(b, hi), bot = Math.max(a, lo);
      if (top <= bot) continue;
      ctx.fillStyle = alpha(k.color, 0.13);
      ctx.fillRect(padL, Y(top), w - padL - padR, Y(bot) - Y(top));
      if (k.min > lo && k.min < hi) {
        ctx.fillStyle = alpha(k.color, 0.5);
        for (let x = padL; x < w - padR; x += 8) ctx.fillRect(x, Math.round(Y(k.min)), 4, 1);
        ctx.fillStyle = k.color;
        ctx.fillText(String(k.min), padL - 6, Y(k.min) + 3);
      }
    }
    ctx.fillStyle = '#6c6c8a';
    ctx.fillText(String(hi), padL - 6, Y(hi) + 8);
    ctx.fillText(String(lo), padL - 6, Y(lo));

    // Line
    ctx.strokeStyle = '#e8e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.r)) : ctx.moveTo(X(i), Y(p.r))));
    ctx.stroke();
    pts.forEach((p, i) => {
      const s = i === pts.length - 1 ? 8 : 6;
      ctx.fillStyle = '#0b0b14';
      ctx.fillRect(X(i) - s / 2 - 1, Y(p.r) - s / 2 - 1, s + 2, s + 2);
      ctx.fillStyle = CF.rankFor(p.r).color;
      ctx.fillRect(X(i) - s / 2, Y(p.r) - s / 2, s, s);
    });
    // X labels: first and last dates
    ctx.fillStyle = '#6c6c8a';
    const lbl = t => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    ctx.textAlign = 'left'; ctx.fillText(lbl(pts[0].t), padL, h - 4);
    ctx.textAlign = 'right'; ctx.fillText(lbl(pts[pts.length - 1].t), w - padR, h - 4);
  };

  CF.charts.difficulty = function (canvas, byRating) {
    const { ctx, w, h } = prep(canvas);
    const rated = Object.keys(byRating).filter(k => k !== 'unrated').map(Number);
    if (!rated.length) return empty(ctx, w, h, 'SOLVE RATED PROBLEMS');
    const maxR = Math.max(1500, Math.max(...rated));
    const buckets = [];
    for (let r = 800; r <= maxR; r += 100) buckets.push([r, byRating[r] || 0]);
    const top = Math.max(...buckets.map(b => b[1]), 1);
    const padB = 16, padT = 14;
    const bw = (w - 4) / buckets.length;
    ctx.font = '7px ' + FONT;
    ctx.textAlign = 'center';
    buckets.forEach(([r, n], i) => {
      const bh = Math.round(((h - padB - padT) * n) / top);
      const x = Math.round(2 + i * bw), bwid = Math.max(2, Math.floor(bw) - 3);
      const col = CF.rankFor(r).color;
      ctx.fillStyle = alpha(col, 0.07);
      ctx.fillRect(x, padT, bwid, h - padB - padT);
      // stacked "blocks"
      ctx.fillStyle = col;
      for (let y = h - padB - 4; y >= h - padB - bh; y -= 5) ctx.fillRect(x, y, bwid, 4);
      if (n) { ctx.fillStyle = '#e8e8f0'; ctx.fillText(String(n), x + bwid / 2, h - padB - bh - 4); }
      if (r % 200 === 0 || buckets.length < 10) {
        ctx.fillStyle = '#6c6c8a';
        ctx.fillText(String(r), x + bwid / 2, h - 4);
      }
    });
  };

  CF.charts.heatmap = function (canvas, dayCounts) {
    const { ctx, w, h } = prep(canvas);
    const gap = 3;
    const byHeight = Math.floor((h - 12 - gap * 6) / 7);
    const weeks = Math.max(4, Math.min(26, Math.floor((w + gap) / (Math.max(6, byHeight) + gap))));
    const cell = Math.max(6, Math.min(byHeight, Math.floor((w + gap) / weeks) - gap));
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end); start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
    const max = Math.max(1, ...Object.values(dayCounts));
    const rank = getComputedStyle(document.documentElement).getPropertyValue('--rank').trim() || '#4ddb5c';
    ctx.font = '7px ' + FONT;
    ctx.fillStyle = '#6c6c8a';
    let lastMonth = -1;
    for (let wk = 0; wk < weeks; wk++) {
      for (let d = 0; d < 7; d++) {
        const day = new Date(start); day.setDate(start.getDate() + wk * 7 + d);
        if (day > end) continue;
        const n = dayCounts[CF.dayKey(day)] || 0;
        const x = wk * (cell + gap), y = 12 + d * (cell + gap);
        if (d === 0 && day.getMonth() !== lastMonth) {
          lastMonth = day.getMonth();
          ctx.fillStyle = '#6c6c8a';
          ctx.fillText(day.toLocaleDateString(undefined, { month: 'short' }), x, 8);
        }
        ctx.fillStyle = n ? alpha(rank, 0.25 + 0.75 * Math.min(1, n / max)) : '#1d1d36';
        ctx.fillRect(x, y, cell, cell);
        if (CF.dayKey(day) === CF.todayKey()) {
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
        }
      }
    }
  };

  CF.charts.radar = function (canvas, tags) {
    const { ctx, w, h } = prep(canvas);
    const list = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (list.length < 3) return empty(ctx, w, h, 'SOLVE MORE TO UNLOCK');
    const cx = w / 2, cy = h / 2 + 4, R = Math.min(w * 0.26, h / 2 - 26);
    const max = list[0][1];
    const ang = i => -Math.PI / 2 + (i / list.length) * Math.PI * 2;
    const rank = getComputedStyle(document.documentElement).getPropertyValue('--rank').trim() || '#4ddb5c';
    ctx.strokeStyle = '#2a2a4a'; ctx.lineWidth = 1;
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      list.forEach((_, i) => {
        const x = cx + Math.cos(ang(i)) * R * ring / 4, y = cy + Math.sin(ang(i)) * R * ring / 4;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath(); ctx.stroke();
    }
    ctx.beginPath();
    list.forEach(([, n], i) => {
      const k = 0.15 + 0.85 * (n / max);
      const x = cx + Math.cos(ang(i)) * R * k, y = cy + Math.sin(ang(i)) * R * k;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = alpha(rank, 0.3); ctx.fill();
    ctx.strokeStyle = rank; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = '8px ' + FONT;
    list.forEach(([t, n], i) => {
      const x = cx + Math.cos(ang(i)) * (R + 12), y = cy + Math.sin(ang(i)) * (R + 12);
      ctx.textAlign = Math.abs(Math.cos(ang(i))) < 0.2 ? 'center' : Math.cos(ang(i)) > 0 ? 'left' : 'right';
      ctx.fillStyle = '#e8e8f0';
      const short = t.length > 11 ? t.slice(0, 10) + '.' : t;
      ctx.fillText(short.toUpperCase(), x, y + 3);
      ctx.fillStyle = rank;
      ctx.fillText(String(n), x, y + 14);
    });
  };

  /* Segmented ring as an SVG string. */
  CF.charts.ring = function (pct, color, label, sub) {
    const segs = 24, r = 52, c = 64;
    const on = Math.round(Math.max(0, Math.min(1, pct)) * segs);
    let out = '<svg viewBox="0 0 128 128" class="ring">';
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2 - Math.PI / 2;
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      out += '<rect x="' + (x - 5).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" width="10" height="10" fill="' +
        (i < on ? color : '#1d1d36') + '"/>';
    }
    out += '<text x="64" y="66" text-anchor="middle" class="ring-label">' + CF.esc(label) + '</text>';
    if (sub) out += '<text x="64" y="84" text-anchor="middle" class="ring-sub">' + CF.esc(sub) + '</text>';
    return out + '</svg>';
  };
})();
