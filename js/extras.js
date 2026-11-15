/* Extra boards and pop-ups:
   - Contest calendar (month view, tap a contest to mark it ★)
   - Weekly boss fight (a hard problem with an HP bar; your solves deal damage)
   - Year in review
   - Pre-contest warm-up (30 min before a marked contest) and the morning summary card
   Problems for the boss and the warm-up come from a small cached copy of the problemset. */
(function () {
  const esc = CF.esc;
  const X = CF.extras = {};
  const P = (...a) => CF.boards.panel(...a);
  const now = () => Date.now() / 1000;
  const rerender = id => CF.app && CF.app.renderBoard && CF.app.renderBoard(id);

  /* ---------------- Problemset cache ---------------- */
  // Stored compactly: [contestId, index, rating, name, solvedCount]. Refreshed every 3 days.
  const PS = CF.problemset = { list: null, loading: null };
  PS.load = function () {
    if (PS.list) return Promise.resolve(PS.list);
    const c = CF.store.get('pset', null);
    const unpack = arr => arr.map(a => ({ contestId: a[0], index: a[1], rating: a[2], name: a[3], solvedCount: a[4] }));
    if (c && Date.now() - c.t < 3 * 86400e3) { PS.list = unpack(c.p); return Promise.resolve(PS.list); }
    if (PS.loading) return PS.loading;
    PS.loading = CF.api.call('problemset.problems', {}).then(r => {
      const solved = new Map(r.problemStatistics.map(s => [s.contestId + s.index, s.solvedCount]));
      const packed = r.problems.filter(p => p.rating && p.contestId)
        .map(p => [p.contestId, p.index, p.rating, p.name, solved.get(p.contestId + p.index) || 0]);
      CF.store.set('pset', { t: Date.now(), p: packed });
      PS.list = unpack(packed);
      return PS.list;
    }).catch(e => {
      if (c) { PS.list = unpack(c.p); return PS.list; }   // stale copy beats nothing
      throw e;
    }).finally(() => { PS.loading = null; });
    return PS.loading;
  };
  /* n unsolved problems with rating in [lo, hi], favouring popular recent ones; same picks for the same seed. */
  PS.pick = function (st, lo, hi, n, seed, extraSkip) {
    if (!PS.list) return [];
    const solved = st.stats ? st.stats.solvedMap : new Map();
    const tried = new Set(st.stats ? st.stats.unfinished.map(a => CF.problemKey(a.problem)) : []);
    const pool = PS.list.filter(p => p.rating >= lo && p.rating <= hi && p.contestId >= 1200 &&
      !solved.has(CF.problemKey(p)) && !tried.has(CF.problemKey(p)) && !(extraSkip && extraSkip.has(CF.problemKey(p))));
    pool.sort((a, b) => b.solvedCount - a.solvedCount);
    const top = pool.slice(0, Math.max(n * 15, 40));
    const rnd = CF.seeded(seed);
    const out = [];
    while (out.length < n && top.length) out.push(top.splice(Math.floor(rnd() * top.length), 1)[0]);
    return out;
  };
  const round100 = r => Math.round(r / 100) * 100;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function probLink(p, text) {
    return '<a href="' + CF.problemUrl(p) + '" target="_blank" rel="noopener">' + (text || esc(p.contestId + p.index + ' · ' + p.name)) + '</a>';
  }

  /* ---------------- Contest helpers and marks ---------------- */
  CF.contestDiv = function (name) {
    if (/Educational/i.test(name)) return 'edu';
    if (/Div\.? ?1 ?(\+|and|,) ?Div\.? ?2/i.test(name)) return 'div12';
    if (/Div\.? ?4/i.test(name)) return 'div4';
    if (/Div\.? ?3/i.test(name)) return 'div3';
    if (/Div\.? ?2/i.test(name)) return 'div2';
    if (/Div\.? ?1/i.test(name)) return 'div1';
    return 'other';
  };
  const DIV_LABEL = { div1: 'DIV 1', div2: 'DIV 2', div3: 'DIV 3', div4: 'DIV 4', div12: 'DIV 1+2', edu: 'EDU', other: 'OTHER' };
  X.divLabel = name => DIV_LABEL[CF.contestDiv(name)];
  const shortName = n => n.replace(/Codeforces Round/i, 'CF Round').replace(/Educational/i, 'Edu').replace(/\s*\((Div\.[^)]*|Rated[^)]*)\)/gi, '');

  CF.marks = {
    all: () => new Set(CF.store.get('marks', [])),
    has: id => CF.marks.all().has(id),
    toggle(id) {
      const s = CF.marks.all();
      s.has(id) ? s.delete(id) : s.add(id);
      // Forget marks for contests that are long over.
      const t = now(), keep = [...s].filter(x => {
        const c = (CF.state.contestsAll || []).find(cc => cc.id === x);
        return !c || c.startTimeSeconds > t - 86400;
      });
      CF.store.set('marks', keep);
      return s.has(id);
    },
  };

  /* ---------------- Calendar board ---------------- */
  X.calOffset = 0;
  CF.boards.calendar = function (el, st) {
    const base = new Date(); base.setDate(1); base.setHours(0, 0, 0, 0);
    base.setMonth(base.getMonth() + X.calOffset);
    const y = base.getFullYear(), m = base.getMonth();
    const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;                      // Monday first
    const cells = Math.ceil((lead + days) / 7) * 7;
    const marks = CF.marks.all();
    const today = CF.todayKey(), t = now();
    const all = st.contestsAll || [];
    const played = new Map((st.history || []).map(h => [h.contestId, h]));
    const subsIn = new Set((st.subs || []).filter(s => s.author && /CONTESTANT|OUT_OF_COMPETITION/.test(s.author.participantType)).map(s => s.contestId));

    const byDay = {};
    for (const c of all) {
      if (!c.startTimeSeconds) continue;
      const k = CF.dayKey(c.startTimeSeconds);
      if (!k.startsWith(y + '-' + CF.pad(m + 1))) continue;
      const upcoming = c.phase !== 'FINISHED';
      if (!upcoming && !played.has(c.id) && !subsIn.has(c.id)) continue;
      (byDay[k] = byDay[k] || []).push(c);
    }
    let grid = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => '<div class="cal-dow">' + d + '</div>').join('');
    for (let i = 0; i < cells; i++) {
      const d = i - lead + 1;
      if (d < 1 || d > days) { grid += '<div class="cal-cell off"></div>'; continue; }
      const k = y + '-' + CF.pad(m + 1) + '-' + CF.pad(d);
      const list = (byDay[k] || []).sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
      grid += '<div class="cal-cell' + (k === today ? ' today' : '') + (k < today ? ' past' : '') + '"><div class="cal-d">' + d + '</div>' +
        list.slice(0, 3).map(c => {
          const div = CF.contestDiv(c.name), h = played.get(c.id);
          const tm = new Date(c.startTimeSeconds * 1000);
          if (c.phase === 'FINISHED') {
            const dd = h ? h.newRating - h.oldRating : null;
            return '<div class="cal-c done ' + div + '" title="' + esc(c.name) + '">' + DIV_LABEL[div] +
              (dd != null ? ' <b class="' + (dd >= 0 ? 'good' : 'danger') + '">' + (dd >= 0 ? '+' : '') + dd + '</b>' : ' ✔') + '</div>';
          }
          return '<button class="cal-c ' + div + (marks.has(c.id) ? ' marked' : '') + '" data-action="mark" data-id="' + c.id + '" title="' + esc(c.name) + '">' +
            (marks.has(c.id) ? '★ ' : '') + DIV_LABEL[div] + ' <span>' + CF.pad(tm.getHours()) + ':' + CF.pad(tm.getMinutes()) + '</span></button>';
        }).join('') + (list.length > 3 ? '<div class="cal-more">+' + (list.length - 3) + '</div>' : '') + '</div>';
    }
    const monthName = base.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
    const head = '<span class="cal-nav"><button class="btn mini ghost" data-action="cal-prev">◀</button> ' + monthName +
      ' <button class="btn mini ghost" data-action="cal-next">▶</button></span>';

    const up = (st.upcoming || []).slice(0, 9);
    const side = up.length ? '<ul class="list cal-up">' + up.map(c =>
      '<li><button class="star' + (marks.has(c.id) ? ' on' : '') + '" data-action="mark" data-id="' + c.id + '" aria-label="Mark contest">' + (marks.has(c.id) ? '★' : '☆') + '</button>' +
      '<span class="grow"><span class="divtag ' + CF.contestDiv(c.name) + '">' + DIV_LABEL[CF.contestDiv(c.name)] + '</span> ' + esc(shortName(c.name)) +
      '<br><span class="small dim">' + CF.fmtDate(c.startTimeSeconds) + '</span></span>' +
      '<span class="cl-time" data-countdown-short="' + c.startTimeSeconds + '"></span></li>').join('') + '</ul>'
      : '<div class="dim center pad">NO UPCOMING CONTESTS</div>';

    el.innerHTML = '<div class="grid g-cal">' +
      P('▦ CALENDAR', '<div class="cal-grid">' + grid + '</div>', 'cal-a', head) +
      P('★ UPCOMING', side + '<div class="small dim cal-note">TAP ☆ TO MARK. MARKED CONTESTS GET A WARM-UP 30 MIN BEFORE.</div>', 'cal-b') +
      '</div>';
  };

  /* ---------------- Weekly boss fight ---------------- */
  function weekStart() {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d;
  }
  const B = X.boss = {};
  B.state = st => {
    const b = CF.store.get('boss.' + st.handle.toLowerCase(), null);
    return b && b.week === CF.dayKey(weekStart()) ? b : null;
  };
  /* Pick this week's boss once (about 300 above your rating). Needs the problemset. */
  B.ensure = async function (st) {
    if (!st.stats || B.state(st)) return B.state(st);
    await PS.load();
    const week = CF.dayKey(weekStart());
    const target = clamp(round100((st.stats.rating || 1000) + 300), 1000, 3500);
    let pick = PS.pick(st, target, target, 1, 'boss:' + st.handle.toLowerCase() + ':' + week)[0] ||
      PS.pick(st, target - 200, target + 200, 1, 'boss2:' + week)[0];
    if (!pick) return null;
    // HP follows your own pace: a bit more than your average week (last 4 weeks), at least 3x the boss rating.
    const ws = weekStart() / 1000, xp = x => x.problem.rating || 500;
    const avg = st.stats.solvedList.filter(x => x.time >= ws - 28 * 86400 && x.time < ws).reduce((a, x) => a + xp(x), 0) / 4;
    let hp = Math.max(target * 3, avg * 1.3);
    // Your very first boss may appear mid-week: then only later solves count and HP shrinks to the days left.
    // After that, every boss counts the whole week from Monday.
    const first = !CF.store.get('boss.' + st.handle.toLowerCase(), null);
    const from = first ? Math.floor(now()) : Math.floor(ws);
    hp = round100(hp * Math.max(0.25, (ws + 7 * 86400 - from) / (7 * 86400)));
    const b = { week, from, problem: { contestId: pick.contestId, index: pick.index, name: pick.name, rating: pick.rating }, hp };
    CF.store.set('boss.' + st.handle.toLowerCase(), b);
    return b;
  };
  /* Your new solves this week, as hits. Solving the boss itself is a critical hit. */
  B.fight = function (st, b) {
    const from = Math.max(weekStart() / 1000, b.from || 0), key = CF.problemKey(b.problem);
    const hits = st.stats.solvedList.filter(s => s.time >= from).sort((a, c) => c.time - a.time).map(s => {
      const crit = CF.problemKey(s.problem) === key;
      return { s, crit, dmg: crit ? b.hp : (s.problem.rating || 500) };
    });
    const dealt = hits.reduce((a, h) => a + h.dmg, 0);
    return { hits, left: Math.max(0, b.hp - dealt), dead: dealt >= b.hp };
  };
  /* Called after every stats refresh: rewards a defeated boss once. */
  B.check = function (st, silent) {
    const b = B.state(st);
    if (!b) { if (st.ready) B.ensure(st).then(x => x && rerender('boss')).catch(() => {}); return; }
    const f = B.fight(st, b);
    const p = st.profile;
    p.bossWins = p.bossWins || [];
    if (f.dead && !p.bossWins.includes(b.week)) {
      p.bossWins.push(b.week);
      p.coins += 150;
      CF.saveProfile(st.handle, p);
      if (!silent) setTimeout(() => CF.fx.banner({ kind: 'level', title: 'BOSS DEFEATED!', top: b.problem.name, sub: '+150 COINS', sound: CF.sound.rankUp }), 3500);
    }
  };
  function bossSprite(seed, color, dead) {
    const rnd = CF.seeded('boss:' + seed);
    let rects = '';
    for (let y = 0; y < 9; y++) for (let x = 0; x < 5; x++) {
      const edge = (y === 0 || y === 8) && (x === 0);
      if (edge || rnd() < (y > 1 && y < 7 ? 0.32 : 0.55)) continue;
      rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
      if (x < 4) rects += '<rect x="' + (8 - x) + '" y="' + y + '" width="1" height="1"/>';
    }
    const eyes = dead
      ? '<g stroke="#000" stroke-width=".35"><path d="M2.3 2.3l1.4 1.4M3.7 2.3l-1.4 1.4M5.3 2.3l1.4 1.4M6.7 2.3l-1.4 1.4"/></g>'
      : '<rect x="2.5" y="2.5" width="1" height="1" fill="#fff"/><rect x="5.5" y="2.5" width="1" height="1" fill="#fff"/>' +
        '<rect x="2.9" y="2.9" width=".5" height=".5" fill="#000"/><rect x="5.9" y="2.9" width=".5" height=".5" fill="#000"/>';
    return '<svg class="boss-svg" viewBox="-1 -1 11 11" shape-rendering="crispEdges"><g fill="' + (dead ? '#555' : color) + '">' +
      '<rect x="1" y="1" width="7" height="6"/>' + rects + '</g>' + eyes + '</svg>';
  }
  let lastHp = null;
  CF.boards.boss = function (el, st) {
    const b = B.state(st);
    if (!b) {
      el.innerHTML = P('☠ WEEKLY BOSS', '<div class="center pad blink">SUMMONING THIS WEEK’S BOSS...</div>', 'full');
      B.ensure(st).then(x => x && rerender('boss')).catch(e => {
        el.innerHTML = P('☠ WEEKLY BOSS', '<div class="center pad danger">COULD NOT LOAD PROBLEMS: ' + esc(e.message) + '</div>', 'full');
      });
      return;
    }
    const f = B.fight(st, b);
    const color = CF.rankFor(b.problem.rating).color;
    const hit = lastHp != null && f.left < lastHp;
    lastHp = f.left;
    const end = Math.floor(weekStart() / 1000) + 7 * 86400;
    const wins = (st.profile.bossWins || []).length;
    const arena =
      '<div class="boss-arena' + (f.dead ? ' dead' : '') + (hit ? ' hit' : '') + '">' +
        '<div class="boss-name" style="color:' + color + '">' + esc(b.problem.name.toUpperCase()) + '</div>' +
        '<div class="small dim">LV ' + b.problem.rating + ' BOSS · ' + esc(b.problem.contestId + b.problem.index) + '</div>' +
        '<div class="boss-body">' + bossSprite(b.week + b.problem.contestId + b.problem.index, color, f.dead) +
          (f.dead ? '<div class="ko">K.O.!</div>' : '') + '</div>' +
        '<div class="boss-hp"><span class="small">HP</span>' + CF.boards.bar(f.left / b.hp, f.left / b.hp < 0.25 ? 'var(--wa)' : f.left / b.hp < 0.5 ? 'var(--warn)' : 'var(--ac)', 30) +
          '<b>' + CF.fmtNum(f.left) + ' / ' + CF.fmtNum(b.hp) + '</b></div>' +
        '<div class="boss-btns">' + (f.dead ? '<span class="good">DEFEATED · +150 COINS</span> <button class="btn mini ghost" data-action="boss-replay">↻ REPLAY K.O.</button>' :
          '<a class="btn" href="' + CF.problemUrl(b.problem) + '" target="_blank" rel="noopener">⚔ FIGHT THE BOSS (INSTANT K.O.)</a>') + '</div>' +
      '</div>';
    const log = f.hits.length ? '<ul class="list">' + f.hits.map(h =>
      '<li><span class="dmg' + (h.crit ? ' crit' : '') + '">-' + CF.fmtNum(h.dmg) + '</span>' + CF.boards.ratingTag(h.s.problem.rating) +
      '<span class="grow">' + probLink(h.s.problem) + '</span><span class="small dim">' + CF.timeAgo(h.s.time) + '</span></li>').join('') + '</ul>'
      : '<div class="dim center pad">NO HITS YET.<br>EVERY NEW SOLVE THIS WEEK DEALS ITS RATING AS DAMAGE.</div>';
    const info = '<div class="boss-info">' +
      '<div><span class="small dim">ESCAPES IN</span><b data-countdown-short="' + end + '"></b></div>' +
      '<div><span class="small dim">HITS</span><b>' + f.hits.length + '</b></div>' +
      '<div><span class="small dim">BOSSES BEATEN</span><b class="warn">' + wins + '</b></div></div>';
    el.innerHTML = '<div class="grid g-boss">' +
      P('☠ WEEKLY BOSS', arena, 'boss-a') +
      P('⚡ STATUS', info, 'boss-c') +
      P('⚔ DAMAGE LOG', log, 'boss-b') + '</div>';
  };

  /* Replays this week's fight on the arena: the boss comes back, every hit lands in order, then the K.O. */
  B.replay = function (arena) {
    const st = CF.state, b = B.state(st);
    if (!arena || !b || arena.classList.contains('replay')) return;
    const f = B.fight(st, b);
    if (!f.dead) return;
    const color = CF.rankFor(b.problem.rating).color;
    const seed = b.week + b.problem.contestId + b.problem.index;
    const body = arena.querySelector('.boss-body'), hp = arena.querySelector('.boss-hp');
    const hpColor = r => r < 0.25 ? 'var(--wa)' : r < 0.5 ? 'var(--warn)' : 'var(--ac)';
    const setHp = left => {
      hp.innerHTML = '<span class="small">HP</span>' + CF.boards.bar(left / b.hp, hpColor(left / b.hp), 30) +
        '<b>' + CF.fmtNum(left) + ' / ' + CF.fmtNum(b.hp) + '</b>';
    };
    // Oldest hit first, only up to the killing blow; long logs are squeezed into at most 8 hits.
    let hits = f.hits.slice().reverse(), sum = 0;
    hits = hits.filter(h => { if (sum >= b.hp) return false; sum += h.dmg; return true; });
    const per = Math.ceil(hits.length / 8), steps = [];
    for (let i = 0; i < hits.length; i += per) {
      const g = hits.slice(i, i + per);
      steps.push({ dmg: g.reduce((a, h) => a + h.dmg, 0), crit: g.some(h => h.crit) });
    }
    const alive = () => arena.isConnected;
    arena.classList.remove('dead', 'hit', 'ko-in');
    arena.classList.add('replay');
    body.innerHTML = bossSprite(seed, color, false);
    let left = b.hp;
    setHp(left);
    let t = 700;
    steps.forEach(s => {
      setTimeout(() => {
        if (!alive()) return;
        left = Math.max(0, left - s.dmg);
        setHp(left);
        arena.classList.remove('hit'); void arena.offsetWidth; arena.classList.add('hit');
        const pop = document.createElement('div');
        pop.className = 'boss-pop' + (s.crit ? ' crit' : '');
        pop.textContent = '-' + CF.fmtNum(s.dmg);
        pop.style.left = (30 + Math.random() * 40) + '%';
        body.appendChild(pop);
        setTimeout(() => pop.remove(), 900);
        (s.crit ? CF.sound.wa : CF.sound.ce)();
      }, t);
      t += s.crit ? 900 : 650;
    });
    setTimeout(() => {
      if (!alive()) return;
      arena.classList.remove('hit');
      arena.classList.add('dying');
      CF.sound.ratingDown();
    }, t += 300);
    setTimeout(() => {
      if (!alive()) return;
      body.innerHTML = bossSprite(seed, color, true) + '<div class="ko">K.O.!</div>';
      arena.classList.remove('dying', 'replay');
      arena.classList.add('dead', 'ko-in');
    }, t += 1100);
    setTimeout(() => {
      if (!alive()) return;
      CF.fx.banner({ kind: 'level', title: 'BOSS DEFEATED!', top: b.problem.name, sub: '+150 COINS', sound: CF.sound.rankUp });
    }, t += 900);
  };

  /* ---------------- Year in review ---------------- */
  X.year = null;
  CF.boards.year = function (el, st) {
    const s = st.stats;
    const years = [...new Set(s.subs.map(x => new Date(x.creationTimeSeconds * 1000).getFullYear()))].sort((a, b) => b - a).slice(0, 6);
    const Y = X.year && years.includes(X.year) ? X.year : years[0] || new Date().getFullYear();
    const from = new Date(Y, 0, 1) / 1000, to = new Date(Y + 1, 0, 1) / 1000;
    const inY = t => t >= from && t < to;
    const solves = s.solvedList.filter(x => inY(x.time));
    const subsY = s.subs.filter(x => inY(x.creationTimeSeconds));
    const fin = subsY.filter(x => CF.isFinalVerdict(x.verdict));
    const acc = fin.length ? Math.round(fin.filter(x => x.verdict === 'OK').length / fin.length * 100) : 0;
    const months = Array(12).fill(0);
    for (const x of solves) months[new Date(x.time * 1000).getMonth()]++;
    const bestM = months.indexOf(Math.max(...months));
    const tags = {};
    for (const x of solves) for (const t of x.problem.tags || []) tags[t] = (tags[t] || 0) + 1;
    const favTag = Object.entries(tags).sort((a, b) => b[1] - a[1])[0];
    const hardest = solves.filter(x => x.problem.rating).sort((a, b) => b.problem.rating - a.problem.rating)[0];
    const hist = (s.history || []).filter(h => inY(h.ratingUpdateTimeSeconds));
    const jump = hist.map(h => Object.assign({ d: h.newRating - h.oldRating }, h)).filter(h => h.oldRating > 0).sort((a, b) => b.d - a.d)[0];
    const bestRank = hist.slice().sort((a, b) => a.rank - b.rank)[0];
    const days = [...s.acDays].filter(d => d.startsWith(Y + '-')).sort();
    let streak = 0, run = 0, prev = null;
    for (const d of days) { run = prev && CF.addDays(prev, 1) === d ? run + 1 : 1; streak = Math.max(streak, run); prev = d; }
    const xp = solves.reduce((a, x) => a + (x.problem.rating || 500), 0);
    const rStart = hist.length ? hist[0].oldRating : null, rEnd = hist.length ? hist[hist.length - 1].newRating : null;
    const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    const tile = (icon, label, val, sub) => '<div class="yr-tile"><div class="rec-icon">' + icon + '</div><div class="small dim">' + label +
      '</div><div class="yr-val">' + val + '</div><div class="small dim yr-sub">' + (sub || '&nbsp;') + '</div></div>';
    const maxM = Math.max(1, ...months);
    const chart = '<div class="dayhist yr-months">' + months.map((n, i) =>
      '<div class="dh"><div class="dh-col"><div class="dh-fill' + (i === bestM && n ? ' hit' : '') + '" style="height:' + Math.round(n / maxM * 100) + '%"></div></div>' +
      '<span>' + MON[i] + '</span><span class="' + (n ? '' : 'dim') + '">' + n + '</span></div>').join('') + '</div>';

    el.innerHTML = '<div class="grid g-year">' +
      '<div class="yr-head"><div class="yr-title">★ ' + Y + ' · YEAR IN REVIEW ★</div>' +
        '<div class="chips">' + years.map(y => '<button class="chip' + (y === Y ? ' on' : '') + '" data-action="year" data-y="' + y + '">' + y + '</button>').join('') + '</div></div>' +
      '<div class="yr-tiles">' +
        tile('⚔', 'PROBLEMS SOLVED', CF.fmtNum(solves.length), CF.fmtNum(xp) + ' XP EARNED') +
        tile('♛', 'BEST MONTH', months[bestM] ? MON[bestM] : '-', months[bestM] ? months[bestM] + ' SOLVES' : '') +
        tile('♥', 'FAVORITE TAG', favTag ? esc(favTag[0].toUpperCase()) : '-', favTag ? favTag[1] + ' SOLVES' : '') +
        tile('↑', 'BIGGEST JUMP', jump ? '<span class="' + (jump.d >= 0 ? 'good' : 'danger') + '">' + (jump.d >= 0 ? '+' : '') + jump.d + '</span>' : '-', jump ? esc(shortName(jump.contestName)) : 'NO RATED CONTESTS') +
        tile('★', 'HARDEST SOLVE', hardest ? CF.boards.ratingTag(hardest.problem.rating) : '-', hardest ? esc(hardest.problem.name) : '') +
        tile('⚑', 'CONTESTS', hist.length, bestRank ? 'BEST #' + CF.fmtNum(bestRank.rank) : '') +
        tile('↗', 'RATING', rStart != null ? rStart + ' → <span style="color:' + CF.rankFor(rEnd).color + '">' + rEnd + '</span>' : '-', rStart != null ? ((rEnd - rStart >= 0 ? '+' : '') + (rEnd - rStart)) + ' THIS YEAR' : '') +
        tile('🔥', 'ACTIVE DAYS', days.length, 'LONGEST STREAK ' + streak + ' · ' + acc + '% ACC') +
      '</div>' +
      P('▓ SOLVES PER MONTH', chart, 'yr-chart') +
      '</div>';
  };

  /* ---------------- Pop-up card (warm-up, morning) ---------------- */
  X.card = function (title, html, foot) {
    const c = document.getElementById('card');
    c.querySelector('.card-title').innerHTML = title;
    c.querySelector('.modal-body').innerHTML = html;
    c.querySelector('.card-go').textContent = foot || "LET'S GO";
    c.classList.add('open');
  };
  X.closeCard = () => document.getElementById('card').classList.remove('open');

  /* Warm-up: two easy unsolved problems, ~500 under your rating. */
  X.warmup = async function (st, c) {
    try { await PS.load(); } catch (e) { /* show the card anyway */ }
    const target = clamp(round100((st.stats && st.stats.rating || 1100) - 500), 800, 1300);
    const lo = Math.max(800, target - 100);
    const picks = PS.pick(st, lo, target, 2, 'warm:' + c.id);
    CF.sound.levelUp();
    X.card('🔥 WARM-UP', '<div class="center"><div class="small dim">' + esc(c.name) + ' STARTS IN</div>' +
      '<div class="countdown" data-countdown="' + c.startTimeSeconds + '"></div></div>' +
      (picks.length ? '<div class="small dim">TWO QUICK ONES TO WAKE UP YOUR BRAIN (' + (lo === target ? target : lo + '–' + target) + '):</div>' +
        '<ul class="list warm-list">' + picks.map(p => '<li>' + CF.boards.ratingTag(p.rating) + '<span class="grow">' + probLink(p) + '</span>' +
          '<button class="btn mini" data-action="warm-time" data-p="' + esc(p.contestId + p.index + ' · ' + p.name) + '">⏱ TIME IT</button></li>').join('') + '</ul>'
        : '<div class="dim">COULD NOT LOAD PROBLEMS. GRAB AN EASY ONE YOU LIKE!</div>') +
      '<div class="small dim">SET UP YOUR TEMPLATE, DRINK SOME WATER, GOOD LUCK!</div>');
  };
  /* Checked every 30 s: marked contest starting within 30 minutes. */
  X.checkWarmup = function (st) {
    if (!st.ready) return;
    const marks = CF.marks.all(), t = now();
    const shown = new Set(CF.store.get('warmShown', []));
    for (const c of st.upcoming || []) {
      const left = c.startTimeSeconds - t;
      if (!marks.has(c.id) || shown.has(c.id) || left <= 60 || left > 1800) continue;
      shown.add(c.id);
      CF.store.set('warmShown', [...shown].slice(-30));
      X.warmup(st, c);
      break;
    }
  };

  /* Morning summary: first time the dashboard is awake each day (after 05:00). */
  X.checkMorning = function (st) {
    if (!st.ready || !st.stats) return;
    if (document.getElementById('night').classList.contains('open')) return;
    if (document.querySelector('.modal.open') || new Date().getHours() < 5) return;
    const key = 'morning.' + st.handle.toLowerCase(), today = CF.todayKey();
    if (CF.store.get(key, null) === today) return;
    CF.store.set(key, today);
    X.morning(st);
  };
  X.morning = function (st) {
    const s = st.stats, today = CF.todayKey(), yest = CF.addDays(today, -1);
    const ySolves = s.solvedList.filter(x => CF.dayKey(x.time) === yest);
    const end = new Date(); end.setHours(24, 0, 0, 0);
    const todays = (st.upcoming || []).filter(c => c.startTimeSeconds < end / 1000);
    const marks = CF.marks.all();
    const boss = B.state(st), f = boss ? B.fight(st, boss) : null;
    const hr = new Date().getHours();
    const hello = hr < 12 ? 'GOOD MORNING' : hr < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
    const streakLine = s.streak > 0
      ? (s.solvedToday ? '🔥 ' + s.streak + '-DAY STREAK · ALREADY SAFE TODAY' : '🔥 ' + s.streak + '-DAY STREAK · SOLVE 1 TODAY TO KEEP IT')
      : 'NO STREAK RIGHT NOW · ONE SOLVE STARTS A NEW ONE';
    X.card('☀ ' + hello + ', ' + esc((st.info && st.info.handle) || st.handle).toUpperCase(),
      '<div class="morning">' +
        '<div class="mo-sec"><div class="small dim">YESTERDAY</div><div class="mo-big">' + ySolves.length + ' NEW SOLVE' + (ySolves.length === 1 ? '' : 'S') + '</div>' +
          (ySolves.length ? '<ul class="list">' + ySolves.slice(0, 4).map(x => '<li>' + CF.boards.ratingTag(x.problem.rating) + '<span class="grow">' + probLink(x.problem) + '</span></li>').join('') + '</ul>' : '') + '</div>' +
        '<div class="mo-sec"><div class="small dim">STREAK</div><div class="mo-line ' + (s.streak && !s.solvedToday ? 'warn' : 'good') + '">' + streakLine + '</div></div>' +
        '<div class="mo-sec"><div class="small dim">TODAY’S CONTESTS</div>' + (todays.length ? '<ul class="list">' + todays.map(c => {
          const tm = new Date(c.startTimeSeconds * 1000);
          return '<li><b class="warn">' + CF.pad(tm.getHours()) + ':' + CF.pad(tm.getMinutes()) + '</b><span class="grow">' + (marks.has(c.id) ? '★ ' : '') + esc(c.name) + '</span>' +
            (marks.has(c.id) ? '' : '<button class="btn mini ghost" data-action="mark" data-id="' + c.id + '">☆ MARK</button>') + '</li>';
        }).join('') + '</ul>' : '<div class="mo-line dim">NONE TODAY · GOOD DAY TO PRACTICE</div>') + '</div>' +
        '<div class="mo-sec"><div class="small dim">TODAY’S QUESTS</div><div class="mo-line">' + (st.quests || []).map(q => (q.done ? '✔ ' : '□ ') + esc(q.title)).join('<br>') + '</div></div>' +
        (f ? '<div class="mo-sec"><div class="small dim">WEEKLY BOSS</div><div class="mo-line">' + (f.dead ? '<span class="good">DEFEATED ✔</span>' :
          esc(boss.problem.name) + ' · HP ' + CF.fmtNum(f.left) + '/' + CF.fmtNum(boss.hp)) + '</div></div>' : '') +
      '</div>');
  };

  /* ---------------- Actions ---------------- */
  X.handleAction = function (a, t) {
    const st = CF.state;
    if (a === 'mark') {
      const on = CF.marks.toggle(Number(t.dataset.id));
      if (t.closest('#card')) t.outerHTML = '<span class="small good">★ MARKED</span>';
      CF.fx.toast('<span class="toast-icon">' + (on ? '★' : '☆') + '</span><div><b>' + (on ? 'MARKED' : 'UNMARKED') + '</b><br>' +
        (on ? 'Warm-up 30 min before it starts.' : 'No warm-up for this one.') + '</div>', on ? '#ffd23f' : undefined);
      rerender('calendar'); rerender('overview');
    } else if (a === 'cal-prev') { X.calOffset--; rerender('calendar'); }
    else if (a === 'cal-next') { X.calOffset++; rerender('calendar'); }
    else if (a === 'year') { X.year = Number(t.dataset.y); rerender('year'); }
    else if (a === 'card-close') X.closeCard();
    else if (a === 'boss-replay') B.replay(t.closest('.boss-arena'));
    else if (a === 'warm-time') {
      X.closeCard();
      CF.stopwatch.setProblem(t.dataset.p, true);
      if (CF.app.goToBoard) CF.app.goToBoard('stopwatch');
    }
    else return false;
    return true;
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('card').classList.contains('open')) X.closeCard();
  });
})();
