/* Teammates: tracks every teammate's Codeforces data and draws the Teammates board.
   For each handle it loads the profile (incl. last online), all submissions, the rating
   history and blog posts, keeps them in IndexedDB so the board fills instantly, and then
   refreshes only what can have changed: profiles every 1-2 minutes (one call for the whole
   team) and submissions only after a teammate has been online since the last check. */
(function () {
  const esc = CF.esc;
  const T = CF.team = {
    data: {}, sel: null, tab: 'overview', sort: 'online', filter: 'all',
    busy: false, errors: {}, lastInfo: 0, ready: Promise.resolve(),
  };
  const lc = h => String(h).toLowerCase();
  const nowS = () => Date.now() / 1000;
  const MIN = 60000;
  const EVERY = { info: 2 * MIN, infoActive: MIN, subs: 30 * MIN, rating: 30 * MIN, blogs: 6 * 60 * MIN };
  const ONLINE = 300;   // Codeforces shows "online" for about 5 minutes after the last action

  /* ---------------- Storage (IndexedDB: submissions are too big for localStorage) ---------------- */
  const idb = (function () {
    let dbp = null;
    function open() {
      if (!dbp) dbp = new Promise((res, rej) => {
        const r = indexedDB.open('cf-arcade', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    function tx(mode, fn) {
      return open().then(db => new Promise((res, rej) => {
        const t = db.transaction('kv', mode);
        const req = fn(t.objectStore('kv'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = t.onabort = () => rej(t.error);
      }));
    }
    return {
      get: k => tx('readonly', s => s.get(k)).catch(() => null),
      set: (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => null),
      del: k => tx('readwrite', s => s.delete(k)).catch(() => null),
    };
  })();

  function save(d) {
    idb.set('team.' + d.key, { key: d.key, info: d.info, subs: d.subs, history: d.history, blogs: d.blogs, at: d.at });
  }

  T.loadCache = function (st) {
    T.ready = Promise.all(st.settings.teammates.map(h => idb.get('team.' + lc(h)).then(c => {
      if (c && c.info && !T.data[lc(h)]) { T.data[lc(h)] = c; compute(c); }
    }))).then(() => CF.app.renderBoard('teammates'));
    return T.ready;
  };

  /* Forget teammates that were removed in settings and refetch profiles soon. */
  T.sync = function (st) {
    const keep = new Set(st.settings.teammates.map(lc));
    for (const k of Object.keys(T.data)) if (!keep.has(k)) { delete T.data[k]; idb.del('team.' + k); }
    for (const k of Object.keys(T.errors)) if (!keep.has(k)) delete T.errors[k];
    if (T.sel && !keep.has(T.sel) && T.sel !== lc(st.handle)) T.sel = null;
    T.lastInfo = 0;
    T.loadCache(st);
  };

  /* Only what the boards use, so the stored copy stays small. */
  function slim(s) {
    const p = s.problem || {};
    return {
      id: s.id, contestId: s.contestId, creationTimeSeconds: s.creationTimeSeconds, relativeTimeSeconds: s.relativeTimeSeconds,
      problem: { contestId: p.contestId, problemsetName: p.problemsetName, index: p.index, name: p.name, rating: p.rating, tags: p.tags || [] },
      author: { participantType: s.author && s.author.participantType },
      programmingLanguage: s.programmingLanguage, verdict: s.verdict, testset: s.testset,
      passedTestCount: s.passedTestCount, timeConsumedMillis: s.timeConsumedMillis, memoryBytes: s.memoryBytes,
    };
  }

  function compute(d) {
    d.stats = CF.computeStats(d.info, d.subs || [], d.history || []);
  }

  /* ---------------- Loading ---------------- */
  T.tick = function (st) {
    if (T.busy || !st.settings.teammates.length) return;
    T.busy = true;
    run(st).catch(e => { T.error = e.message; })
      .finally(() => { T.busy = false; CF.app.renderBoard('teammates'); });
  };

  async function run(st) {
    await T.ready;
    const list = st.settings.teammates.slice();
    const active = CF.app.currentBoard && CF.app.currentBoard() === 'teammates';
    if (Date.now() - T.lastInfo >= (active ? EVERY.infoActive : EVERY.info)) {
      await loadInfo(list);
      CF.app.renderBoard('teammates');
    }
    for (const h of list) {
      if (st.settings.teammates.indexOf(h) < 0) return;   // settings changed meanwhile
      const d = T.data[lc(h)];
      if (!d || !d.info) continue;
      const handle = d.info.handle;
      let changed = false;
      const seen = (d.info.lastOnlineTimeSeconds || 0) * 1000;
      const last = d.at.subs || 0;
      if (!d.subs || d.partial || Date.now() - last >= EVERY.subs || (seen > last - 3 * MIN && Date.now() - last >= MIN)) {
        try { changed = (await loadSubs(st, d)) || changed; } catch (e) { T.errors[d.key] = e.message; }
      }
      if (!d.history || Date.now() - (d.at.rating || 0) >= EVERY.rating) {
        try { d.history = await CF.api.call('user.rating', { handle }); changed = true; } catch (e) { d.history = d.history || []; }
        d.at.rating = Date.now();
      }
      if (!d.blogs || Date.now() - (d.at.blogs || 0) >= EVERY.blogs) {
        try {
          d.blogs = (await CF.api.call('user.blogEntries', { handle }))
            .map(b => ({ id: b.id, title: String(b.title || '').replace(/<[^>]*>/g, '').trim(), t: b.creationTimeSeconds, rating: b.rating }));
          changed = true;
        } catch (e) { d.blogs = d.blogs || []; }
        d.at.blogs = Date.now();
      }
      if (changed) { compute(d); save(d); CF.app.renderBoard('teammates'); }
    }
  }

  /* One call for the whole team. A wrong handle fails the whole call, so drop it and retry. */
  async function loadInfo(list) {
    let handles = list.slice();
    for (let tries = 0; tries < 5 && handles.length; tries++) {
      try {
        const infos = await CF.api.call('user.info', { handles: handles.join(';') });
        infos.forEach((u, i) => {
          const k = lc(handles[i]);
          const d = T.data[k] || (T.data[k] = { key: k, at: {} });
          d.info = u;
          d.at.info = Date.now();
          delete T.errors[k];
          if (d.subs) { d.stats = CF.computeStats(d.info, d.subs, d.history || []); save(d); }
        });
        T.lastInfo = Date.now();
        return;
      } catch (e) {
        const m = e.message.match(/handle (\S+) not found/i);
        if (!m) { T.error = e.message; T.lastInfo = Date.now(); return; }
        T.errors[lc(m[1])] = 'HANDLE NOT FOUND';
        handles = handles.filter(h => lc(h) !== lc(m[1]));
      }
    }
  }

  async function loadSubs(st, d) {
    const handle = d.info.handle;
    let subs;
    if (d.subs && d.subs.length && !d.partial) {
      const recent = (await CF.api.call('user.status', { handle, from: 1, count: 50 })).map(slim);
      const byId = new Map(d.subs.map(s => [s.id, s]));
      if (recent.length < 50 || recent.some(s => byId.has(s.id))) {
        const fresh = [];
        for (const s of recent) {
          const o = byId.get(s.id);
          if (!o || o.verdict !== s.verdict) fresh.push(s);
          byId.set(s.id, s);
        }
        d.at.subs = Date.now();
        if (!fresh.length) return false;
        announce(d, fresh);
        subs = [...byId.values()].sort((a, b) => b.id - a.id);
      }
    }
    if (!subs) subs = (await CF.api.call('user.status', { handle })).map(slim);
    d.subs = subs; d.partial = false; d.at.subs = Date.now();
    return true;
  }

  /* Toast when a teammate gets a new problem accepted. */
  function announce(d, fresh) {
    const solved = d.stats ? d.stats.solvedMap : new Map();
    fresh.filter(s => s.verdict === 'OK' && !solved.has(CF.problemKey(s.problem)) && nowS() - s.creationTimeSeconds < 6 * 3600)
      .slice(0, 2).forEach(s => CF.fx.toast('<span class="toast-icon">☺</span><div><b>' + esc(d.info.handle) + ' SOLVED ' +
        esc((s.problem.contestId || '') + s.problem.index) + '</b><br>' + esc(s.problem.name) +
        (s.problem.rating ? ' · ' + s.problem.rating : '') + '</div>', CF.rankFor(d.info.rating).color));
  }

  /* ---------------- Members ---------------- */
  function members(st) {
    const out = [];
    if (st.stats) out.push({ key: lc(st.handle), me: true, handle: st.info ? st.info.handle : st.handle,
      info: st.info, subs: st.subs, history: st.history, blogs: null, stats: st.stats });
    for (const h of st.settings.teammates) {
      const k = lc(h);
      if (out.some(m => m.key === k)) continue;
      const d = T.data[k] || {};
      out.push({ key: k, handle: d.info ? d.info.handle : h, info: d.info, subs: d.subs, history: d.history,
        blogs: d.blogs, stats: d.subs ? d.stats : null, err: T.errors[k] });
    }
    for (const m of out) m.x = derive(m, st);
    return out;
  }

  function derive(m, st) {
    const info = m.info || {}, s = m.stats, now = nowS();
    const seen = info.lastOnlineTimeSeconds || null;
    const status = seen == null ? 'off' : now - seen < ONLINE ? 'on' : now - seen < 3600 ? 'away' : 'off';
    const x = { seen, status, last: null, doing: null, d30: 0, active30: 0 };
    if (!s) return x;
    x.last = m.subs && m.subs.length ? m.subs.reduce((a, b) => (b.creationTimeSeconds > a.creationTimeSeconds ? b : a)) : null;
    const today = CF.todayKey();
    for (let i = 0; i < 30; i++) {
      const day = CF.addDays(today, -i);
      x.d30 += s.newSolvesByDay[day] || 0;
      if (s.acDays.has(day)) x.active30++;
    }
    const l = x.last;
    if (l && now - l.creationTimeSeconds < 3 * 3600) {
      const pt = l.author && l.author.participantType;
      const running = (st.contestsAll || []).some(c => c.id === l.contestId && c.phase === 'CODING');
      if (running && (pt === 'CONTESTANT' || pt === 'OUT_OF_COMPETITION')) x.doing = { kind: 'contest', text: 'IN CONTEST' };
      else if (pt === 'VIRTUAL') x.doing = { kind: 'virtual', text: 'VIRTUAL' };
      else if (now - l.creationTimeSeconds < 1800) x.doing = { kind: 'practice', text: 'PRACTISING' };
    }
    return x;
  }

  const SORTS = [
    ['online', 'ONLINE'], ['rating', 'RATING'], ['today', 'TODAY'], ['week', '7 DAYS'], ['solved', 'SOLVED'], ['streak', 'STREAK'],
  ];
  const statusRank = { on: 0, away: 1, off: 2 };
  function sortMembers(list) {
    const v = {
      online: m => -(statusRank[m.x.status] * 1e12) + (m.x.seen || 0),
      rating: m => (m.info && m.info.rating) || 0,
      today: m => (m.stats ? m.stats.solvedToday : -1),
      week: m => (m.stats ? m.stats.solvedWeek : -1),
      solved: m => (m.stats ? m.stats.solvedCount : -1),
      streak: m => (m.stats ? m.stats.streak : -1),
    }[T.sort];
    return list.slice().sort((a, b) => v(b) - v(a));
  }

  /* ---------------- Small render helpers ---------------- */
  const panel = (t, b, c, e) => CF.boards.panel(t, b, c, e);
  const bar = (p, c, n) => CF.boards.bar(p, c, n);
  const rtag = r => CF.boards.ratingTag(r);
  const ago = (ts, cls) => (ts ? '<span class="' + (cls || '') + '" data-ago="' + ts + '">' + CF.timeAgo(ts).toUpperCase() + '</span>' : '-');
  const pid = p => esc((p.contestId || '') + p.index);
  function plink(p, text) {
    const u = CF.problemUrl(p);
    return u ? '<a href="' + u + '" target="_blank" rel="noopener">' + text + '</a>' : text;
  }
  const vchip = v => '<span class="v ' + CF.verdictClass(v) + '">' + CF.verdictShort(v) + '</span>';
  const signed = d => (d == null ? '' : '<b class="' + (d >= 0 ? 'good' : 'danger') + '">' + (d >= 0 ? '+' : '') + d + '</b>');
  const shortLang = l => String(l || '-').replace(/\s*\(.*\)\s*/g, '').replace(/^GNU /, '');
  const fmtMem = b => (b == null ? '-' : b >= 1048576 ? Math.round(b / 104857.6) / 10 + ' MB' : Math.round(b / 1024) + ' KB');
  const PTYPE = { CONTESTANT: 'CONTEST', VIRTUAL: 'VIRTUAL', PRACTICE: 'PRACTICE', OUT_OF_COMPETITION: 'UNOFFICIAL', MANAGER: 'MANAGER' };
  const dateOnly = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const years = ts => { const y = (nowS() - ts) / (365.25 * 86400); return y >= 1 ? Math.floor(y) + 'Y' : Math.floor(y * 12) + ' MONTHS'; };
  const contestUrl = id => 'https://codeforces.com/' + (id >= 100000 ? 'gym/' : 'contest/') + id;

  function seenLine(m) {
    const x = m.x;
    if (m.err) return '<span class="danger">' + esc(m.err) + '</span>';
    if (x.status === 'on') return '<span class="good blink-soft">● ONLINE NOW</span>';
    if (!x.seen) return '<span class="dim">LOADING...</span>';
    return '<span class="' + (x.status === 'away' ? 'warn' : 'dim') + '">SEEN ' + ago(x.seen) + '</span>';
  }
  function avatar(m, big) {
    const info = m.info || {}, rk = CF.rankFor(info.rating);
    return '<span class="tm-av st-' + m.x.status + (big ? ' big' : '') + '">' +
      CF.avatarImg(big ? info.titlePhoto || info.avatar : info.avatar, m.handle, rk.color) + '<i></i></span>';
  }
  const doingTag = x => (x.doing ? ' <span class="tm-tag ' + x.doing.kind + '">' + x.doing.text + '</span>' : '');

  /* ---------------- Board ---------------- */
  CF.boards.teammates = function (el, st) {
    // Keep the scroll position of each scrolling area across refreshes.
    const keep = {};
    el.querySelectorAll('[data-keep]').forEach(n => { keep[n.dataset.keep] = n.scrollTop; });

    if (!st.settings.teammates.length) {
      el.innerHTML = panel('☺ TEAMMATES', '<div class="center pad">' +
        '<div class="big">NO TEAMMATES YET</div><p class="dim">Add your teammates’ handles in ⚙ settings to track their solves, ' +
        'contests, activity and when they were last online.</p>' +
        '<button class="btn" data-action="settings">OPEN SETTINGS</button></div>', 'full');
      return;
    }
    const all = members(st);
    const sel = T.sel && all.find(m => m.key === T.sel);
    el.innerHTML = sel ? detail(sel, all, st) : roster(all, st);
    el.querySelectorAll('[data-keep]').forEach(n => { if (keep[n.dataset.keep]) n.scrollTop = keep[n.dataset.keep]; });
    el._draw = () => {
      const c = id => el.querySelector('#' + id);
      if (!sel || !sel.stats) return;
      const s = sel.stats;
      if (c('tm-c-rating')) CF.charts.rating(c('tm-c-rating'), s.history);
      if (c('tm-c-heat')) CF.charts.heatmap(c('tm-c-heat'), s.newSolvesByDay);
      if (c('tm-c-diff')) CF.charts.difficulty(c('tm-c-diff'), s.byRating);
      if (c('tm-c-radar')) CF.charts.radar(c('tm-c-radar'), s.tags);
    };
    el._draw();
  };

  /* ----- Squad view: everyone at a glance ----- */
  function roster(all, st) {
    const list = sortMembers(all);
    const online = all.filter(m => m.x.status === 'on').length;
    const sortSeg = '<span class="seg tm-sort">' + SORTS.map(([k, l]) =>
      '<button class="' + (T.sort === k ? 'on' : '') + '" data-action="tm-sort" data-sort="' + k + '">' + l + '</button>').join('') + '</span>';

    const head = '<div class="tm-thead"><span></span><span>PLAYER</span><span class="tm-clast">LAST SUBMISSION</span>' +
      '<span>RATING</span><span>TODAY</span><span>7D</span><span class="tm-c30">30D</span><span>SOLVED</span><span class="tm-cstreak">STREAK</span></div>';
    const rows = list.map(m => {
      const info = m.info || {}, rk = CF.rankFor(info.rating), s = m.stats, x = m.x;
      const lc_ = s && s.lastContest, d = lc_ ? lc_.newRating - lc_.oldRating : null;
      const n = v => (s ? v : '<span class="dim">··</span>');
      const last = x.last
        ? vchip(x.last.verdict) + ' <b>' + pid(x.last.problem) + '</b> <span class="dim">' + esc(x.last.problem.name) + '</span> · ' + ago(x.last.creationTimeSeconds, 'dim')
        : '<span class="dim">' + (s ? 'NO SUBMISSIONS' : m.err ? '' : 'LOADING...') + '</span>';
      return '<div class="tm-row' + (m.me ? ' me' : '') + '" data-action="tm-open" data-h="' + esc(m.key) + '">' +
        avatar(m) +
        '<span class="tm-who"><b style="color:' + rk.color + '">' + esc(m.handle) + '</b>' + (m.me ? ' <span class="you">YOU</span>' : '') + doingTag(x) +
          '<br><span class="small">' + seenLine(m) + '</span></span>' +
        '<span class="tm-last tm-clast">' + last + '</span>' +
        '<span class="tm-n" style="color:' + rk.color + '">' + (info.rating != null ? info.rating : '----') +
          (d != null ? '<small class="' + (d >= 0 ? 'good' : 'danger') + '">' + (d >= 0 ? '+' : '') + d + '</small>' : '') + '</span>' +
        '<span class="tm-n' + (s && s.solvedToday ? ' good' : '') + '">' + n(s && s.solvedToday) + '</span>' +
        '<span class="tm-n">' + n(s && s.solvedWeek) + '</span>' +
        '<span class="tm-n tm-c30">' + n(x.d30) + '</span>' +
        '<span class="tm-n">' + n(s && CF.fmtNum(s.solvedCount)) + '</span>' +
        '<span class="tm-n tm-cstreak">' + n(s && s.streak) + '</span>' +
      '</div>';
    }).join('');

    // Everyone's newest submissions, merged into one feed.
    const feed = [];
    for (const m of all) for (const s of (m.subs || []).slice(0, 40)) feed.push({ m, s });
    feed.sort((a, b) => b.s.creationTimeSeconds - a.s.creationTimeSeconds);
    const feedHtml = feed.length ? '<ul class="tm-list">' + feed.slice(0, 60).map(({ m, s }) => {
      const rk = CF.rankFor(m.info && m.info.rating);
      return '<li class="' + (m.me ? 'me' : '') + '"><span class="tm-fh" style="color:' + rk.color + '">' + esc(m.handle) + '</span>' +
        vchip(s.verdict) + rtag(s.problem.rating) + '<span class="grow">' + plink(s.problem, pid(s.problem) + ' · ' + esc(s.problem.name)) + '</span>' +
        ago(s.creationTimeSeconds, 'dim small') + '</li>';
    }).join('') + '</ul>' : '<div class="center pad dim blink">LOADING SUBMISSIONS...</div>';

    const loaded = all.filter(m => m.stats);
    const sum = f => loaded.reduce((a, m) => a + f(m), 0);
    const weekTop = Math.max(1, ...loaded.map(m => m.stats.solvedWeek));
    const pulse = '<div class="tm-pulse">' +
      '<div class="tm-ptiles">' +
        ptile('ONLINE NOW', online + '<small>/' + all.length + '</small>', online ? 'good' : '') +
        ptile('TEAM TODAY', sum(m => m.stats.solvedToday)) +
        ptile('TEAM 7 DAYS', sum(m => m.stats.solvedWeek)) +
        ptile('TEAM 30 DAYS', sum(m => m.x.d30)) +
      '</div>' +
      '<div class="small dim">SOLVED IN THE LAST 7 DAYS</div>' +
      '<div class="weekbars">' + loaded.slice().sort((a, b) => b.stats.solvedWeek - a.stats.solvedWeek).map(m =>
        '<div class="wb ' + (m.me ? 'me' : '') + '"><span>' + esc(m.handle) + '</span>' +
        bar(m.stats.solvedWeek / weekTop, m.me ? 'var(--rank)' : CF.rankFor(m.info && m.info.rating).color, 18) +
        '<b>' + m.stats.solvedWeek + '</b></div>').join('') + '</div></div>';

    return '<div class="grid g-team">' +
      panel('☺ SQUAD · ' + online + ' ONLINE', '<div class="tm-table-wrap" data-keep="roster">' + head + rows + '</div>', 'tm-roster', sortSeg) +
      panel('▶ TEAM ACTIVITY', '<div class="tm-scroll" data-keep="feed">' + feedHtml + '</div>', 'tm-feed',
        '<button class="btn mini ghost" data-action="tm-refresh">' + (T.busy ? 'SYNCING' : '⟳ SYNC') + '</button>') +
      panel('★ TEAM PULSE', pulse, 'tm-pulsep') +
    '</div>';
  }
  const ptile = (l, v, cls) => '<div class="tile"><div class="tile-label">' + l + '</div><div class="tile-val ' + (cls || '') + '">' + v + '</div></div>';

  /* ----- One teammate: everything Codeforces has on them ----- */
  const TABS = [['overview', 'OVERVIEW'], ['solving', 'SOLVING'], ['subs', 'SUBMISSIONS'], ['contests', 'CONTESTS'], ['vs', 'VS YOU']];
  function detail(m, all, st) {
    const info = m.info || {}, rk = CF.rankFor(info.rating);
    const tabs = TABS.filter(([k]) => !(m.me && k === 'vs'));
    if (!tabs.some(([k]) => k === T.tab)) T.tab = 'overview';
    const name = [info.firstName, info.lastName].filter(Boolean).join(' ');
    const head = '<div class="tm-head" style="border-left-color:' + rk.color + '">' +
      '<button class="btn mini ghost" data-action="tm-back">◀ SQUAD</button>' +
      avatar(m, true) +
      '<div class="tm-hmain"><div class="tm-hname"><b style="color:' + rk.color + '">' + esc(m.handle) + '</b>' +
        (m.me ? ' <span class="you">YOU</span>' : '') + doingTag(m.x) + '</div>' +
        '<div class="small"><span style="color:' + rk.color + '">' + esc((info.rank || rk.name).toUpperCase()) + '</span>' +
        (name ? ' <span class="dim">· ' + esc(name.toUpperCase()) + '</span>' : '') + ' · ' + seenLine(m) + '</div></div>' +
      '<div class="tm-hrating"><span class="big" style="color:' + rk.color + '">' + (info.rating != null ? info.rating : '----') + '</span>' +
        '<span class="small dim">MAX ' + (info.maxRating != null ? info.maxRating : '-') + '</span></div>' +
      '<span class="tm-hnav"><button class="icon-btn" data-action="tm-prev" aria-label="Previous teammate">◀</button>' +
        '<button class="icon-btn" data-action="tm-next" aria-label="Next teammate">▶</button>' +
        '<a class="icon-btn" href="https://codeforces.com/profile/' + encodeURIComponent(m.handle) + '" target="_blank" rel="noopener" aria-label="Codeforces profile">↗</a></span>' +
    '</div>' +
    '<div class="seg tm-tabs">' + tabs.map(([k, l]) =>
      '<button class="' + (T.tab === k ? 'on' : '') + '" data-action="tm-tab" data-tab="' + k + '">' + l + '</button>').join('') + '</div>';

    let body;
    if (!m.stats) body = '<div class="panel full"><div class="center pad ' + (m.err ? 'danger' : 'dim blink') + '">' +
      (m.err ? esc(m.err) : 'LOADING ' + esc(m.handle).toUpperCase() + '...') + '</div></div>';
    else body = { overview: tOverview, solving: tSolving, subs: tSubs, contests: tContests, vs: tVs }[T.tab](m, st, all);
    return '<div class="tm-detail">' + head + '<div class="tm-body">' + body + '</div></div>';
  }

  function tOverview(m) {
    const s = m.stats, x = m.x, info = m.info || {};
    const lv = s.level, got = s.achievements.filter(a => a.unlocked).length;
    const tiles = '<div class="tm-tiles">' +
      ptile('SOLVED', CF.fmtNum(s.solvedCount)) +
      ptile('TODAY', s.solvedToday, s.solvedToday ? 'good' : '') +
      ptile('7 DAYS', s.solvedWeek) +
      ptile('30 DAYS', x.d30) +
      ptile('STREAK', s.streak + '<small>/' + s.longestStreak + '</small>') +
      ptile('CONTESTS', s.contests) +
      ptile('ACCURACY', Math.round(s.acRate * 100) + '<small>%</small>') +
      ptile('LEVEL', lv.level) +
      ptile('TROPHIES', got + '<small>/' + s.achievements.length + '</small>') +
    '</div>';

    const kv = [];
    const add = (k, v) => { if (v != null && v !== '') kv.push('<div class="tm-kv"><span class="small dim">' + k + '</span><span>' + v + '</span></div>'); };
    const name = [info.firstName, info.lastName].filter(Boolean).join(' ');
    add('NAME', esc(name));
    add('COUNTRY', esc([info.city, info.country].filter(Boolean).join(', ')));
    add('ORGANIZATION', esc(info.organization));
    add('EMAIL', info.email ? esc(info.email) : null);
    add('RANK', '<span style="color:' + CF.rankFor(info.rating).color + '">' + esc(info.rank || 'unrated') + '</span>');
    add('MAX RANK', info.maxRating != null ? '<span style="color:' + CF.rankFor(info.maxRating).color + '">' + esc(info.maxRank || '') + ' · ' + info.maxRating + '</span>' : null);
    add('LAST ONLINE', x.seen ? CF.fmtDate(x.seen) + ' · ' + ago(x.seen, 'dim') : null);
    add('LAST SUBMISSION', x.last ? vchip(x.last.verdict) + ' ' + plink(x.last.problem, pid(x.last.problem) + ' ' + esc(x.last.problem.name)) +
      ' · ' + esc(shortLang(x.last.programmingLanguage)) + ' · ' + ago(x.last.creationTimeSeconds, 'dim') : 'NONE');
    add('LAST AC', s.lastAc ? CF.fmtDate(s.lastAc) + ' · ' + ago(s.lastAc, 'dim') : 'NONE');
    add('ACTIVE DAYS (30D)', x.active30 + ' / 30');
    add('SUBMISSIONS', CF.fmtNum(s.totalSubs) + ' · ' + CF.fmtNum(s.acSubs) + ' ACCEPTED');
    add('FIRST TRY ACs', s.solvedCount ? s.firstTry + ' (' + Math.round(s.firstTry / s.solvedCount * 100) + '%)' : null);
    add('HARDEST SOLVE', s.hardest ? rtag(s.hardest.problem.rating) + plink(s.hardest.problem, pid(s.hardest.problem) + ' ' + esc(s.hardest.problem.name)) : null);
    add('BUSIEST DAY', s.busiest ? s.busiest.n + ' SOLVED · ' + esc(s.busiest.day) : null);
    add('FAVOURITE LANGUAGE', s.langList[0] ? esc(shortLang(s.langList[0][0])) + ' · ' + s.langList[0][1] + ' ACs' : null);
    add('LAST CONTEST', s.lastContest ? '<a href="' + contestUrl(s.lastContest.contestId) + '" target="_blank" rel="noopener">' + esc(s.lastContest.contestName) + '</a> · #' +
      CF.fmtNum(s.lastContest.rank) + ' ' + signed(s.lastContest.newRating - s.lastContest.oldRating) + ' · ' + ago(s.lastContest.ratingUpdateTimeSeconds, 'dim') : null);
    add('BEST RANK', s.bestRank ? '#' + CF.fmtNum(s.bestRank.rank) + ' · ' + esc(s.bestRank.contestName) : null);
    add('BIGGEST GAIN', s.biggestGain ? signed(s.biggestGain.d) + ' · ' + esc(s.biggestGain.contestName) : null);
    add('BIGGEST DROP', s.biggestDrop ? signed(s.biggestDrop.d) + ' · ' + esc(s.biggestDrop.contestName) : null);
    add('FASTEST CONTEST AC', s.fastestContestAc ? CF.fmtClock(s.fastestContestAc.sec).replace(/^00:/, '') + ' · ' + pid(s.fastestContestAc.problem) : null);
    add('FIRST SOLVE', s.firstSolve ? dateOnly(s.firstSolve) : null);
    add('CONTRIBUTION', info.contribution != null ? signed(info.contribution) : null);
    add('FRIEND OF', info.friendOfCount != null ? CF.fmtNum(info.friendOfCount) + ' USERS' : null);
    add('REGISTERED', info.registrationTimeSeconds ? dateOnly(info.registrationTimeSeconds) + ' · ' + years(info.registrationTimeSeconds) + ' AGO' : null);
    if (m.blogs) {
      const b = m.blogs.slice().sort((p, q) => q.t - p.t)[0];
      add('BLOG POSTS', m.blogs.length + (b ? ' · LAST: <a href="https://codeforces.com/blog/entry/' + b.id + '" target="_blank" rel="noopener">' +
        esc(b.title || 'untitled') + '</a> ' + ago(b.t, 'dim') : ''));
    }

    return '<div class="grid g-mate-ov">' +
      panel('', tiles, 'mo-tiles flat') +
      panel('↗ RATING', '<canvas class="chart" id="tm-c-rating"></canvas>', 'mo-rating') +
      panel('▦ ACTIVITY', '<canvas class="chart" id="tm-c-heat"></canvas>', 'mo-heat') +
      panel('☰ DOSSIER', '<div class="tm-scroll" data-keep="dossier">' + kv.join('') + '</div>', 'mo-dos') +
    '</div>';
  }

  function tSolving(m) {
    const s = m.stats;
    const tags = Object.entries(s.tags).sort((a, b) => b[1] - a[1]);
    const tagTop = Math.max(1, ...tags.map(t => t[1]));
    const tagHtml = tags.length ? tags.map(([t, n]) =>
      '<div class="vstat"><span class="tm-tagname">' + esc(t) + '</span>' + bar(n / tagTop, 'var(--rank)', 14) + '<b>' + n + '</b></div>').join('')
      : '<div class="dim center pad">NO SOLVES YET</div>';
    const langTop = Math.max(1, ...s.langList.map(l => l[1]));
    const langHtml = s.langList.length ? s.langList.map(([l, n]) =>
      '<div class="vstat"><span class="tm-tagname">' + esc(shortLang(l)) + '</span>' + bar(n / langTop, '#ffd23f', 12) + '<b>' + n + '</b></div>').join('')
      : '<div class="dim center pad">-</div>';
    const verdicts = {};
    for (const x of s.subs) if (CF.isFinalVerdict(x.verdict)) verdicts[x.verdict] = (verdicts[x.verdict] || 0) + 1;
    const vHtml = Object.entries(verdicts).sort((a, b) => b[1] - a[1]).map(([v, n]) =>
      '<div class="vstat">' + vchip(v) + bar(n / (s.totalSubs || 1), v === 'OK' ? 'var(--ac)' : v === 'COMPILATION_ERROR' ? 'var(--warn)' : 'var(--wa)', 14) +
      '<b>' + n + '</b></div>').join('') +
      '<div class="small dim">ACCURACY ' + Math.round(s.acRate * 100) + '% · ' + CF.fmtNum(s.totalSubs) + ' SUBMISSIONS</div>';
    const unf = s.unfinished.length ? '<ul class="tm-list">' + s.unfinished.slice(0, 60).map(a =>
      '<li>' + vchip(a.lastVerdict) + rtag(a.problem.rating) + '<span class="grow">' + plink(a.problem, pid(a.problem) + ' · ' + esc(a.problem.name)) + '</span>' +
      '<span class="dim small">' + a.count + 'x · ' + CF.timeAgo(a.last).toUpperCase() + '</span></li>').join('') + '</ul>'
      : '<div class="dim center pad">NOTHING LEFT UNSOLVED</div>';

    return '<div class="grid g-mate-solve">' +
      panel('▓ BY DIFFICULTY', '<canvas class="chart" id="tm-c-diff"></canvas>', 'ms-diff') +
      panel('✦ TAG RADAR', '<canvas class="chart" id="tm-c-radar"></canvas>', 'ms-radar') +
      panel('⚔ TOPICS · ' + tags.length, '<div class="vstats tm-scroll" data-keep="tags">' + tagHtml + '</div>', 'ms-tags') +
      panel('≡ VERDICTS', '<div class="vstats">' + vHtml + '</div>', 'ms-verd') +
      panel('⌨ LANGUAGES', '<div class="vstats tm-scroll" data-keep="langs">' + langHtml + '</div>', 'ms-langs') +
      panel('☠ UNSOLVED ATTEMPTS · ' + s.unfinished.length, '<div class="tm-scroll" data-keep="unf">' + unf + '</div>', 'ms-unf') +
    '</div>';
  }

  const FILTERS = [['all', 'ALL'], ['ac', 'ACCEPTED'], ['wrong', 'REJECTED'], ['contest', 'CONTEST'], ['virtual', 'VIRTUAL'], ['practice', 'PRACTICE']];
  function tSubs(m) {
    const f = {
      all: () => true, ac: s => s.verdict === 'OK', wrong: s => CF.isFinalVerdict(s.verdict) && s.verdict !== 'OK',
      contest: s => s.author && (s.author.participantType === 'CONTESTANT' || s.author.participantType === 'OUT_OF_COMPETITION'),
      virtual: s => s.author && s.author.participantType === 'VIRTUAL',
      practice: s => s.author && s.author.participantType === 'PRACTICE',
    }[T.filter] || (() => true);
    const list = (m.subs || []).filter(f);
    const seg = '<span class="seg tm-sort">' + FILTERS.map(([k, l]) =>
      '<button class="' + (T.filter === k ? 'on' : '') + '" data-action="tm-filter" data-f="' + k + '">' + l + '</button>').join('') + '</span>';
    const rows = list.slice(0, 300).map(s =>
      '<tr><td class="dim">' + CF.fmtDate(s.creationTimeSeconds) + '</td>' +
      '<td class="tl">' + plink(s.problem, pid(s.problem) + ' · ' + esc(s.problem.name)) + '</td>' +
      '<td>' + (s.problem.rating ? rtag(s.problem.rating) : '<span class="dim">-</span>') + '</td>' +
      '<td><span class="' + (s.verdict === 'OK' ? 'good' : CF.isFinalVerdict(s.verdict) ? 'danger' : 'warn') + '">' + esc(CF.verdictLabel(s)) + '</span></td>' +
      '<td>' + esc(shortLang(s.programmingLanguage)) + '</td>' +
      '<td>' + (s.timeConsumedMillis != null ? s.timeConsumedMillis + ' ms' : '-') + '</td>' +
      '<td>' + fmtMem(s.memoryBytes) + '</td>' +
      '<td class="dim">' + (PTYPE[s.author && s.author.participantType] || '-') + '</td></tr>').join('');
    return '<div class="grid g-mate-one">' +
      panel('▶ SUBMISSIONS · ' + CF.fmtNum(list.length), '<div class="tm-scroll" data-keep="subs-' + T.filter + '"><table class="tm-table"><thead><tr>' +
        '<th>WHEN</th><th class="tl">PROBLEM</th><th>★</th><th>VERDICT</th><th>LANG</th><th>TIME</th><th>MEMORY</th><th>TYPE</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="8" class="dim center pad">NOTHING HERE</td></tr>') + '</tbody></table>' +
        (list.length > 300 ? '<div class="small dim center pad">SHOWING NEWEST 300</div>' : '') + '</div>', '', seg) +
    '</div>';
  }

  function tContests(m) {
    const s = m.stats, h = (m.history || []).slice().reverse();
    const ups = h.filter(c => c.newRating > c.oldRating).length;
    const tiles = '<div class="tm-tiles">' +
      ptile('RATED', s.contests) +
      ptile('UP / DOWN', '<span class="good">' + ups + '</span><small>/</small><span class="danger">' + (h.length - ups) + '</span>') +
      ptile('BEST RANK', s.bestRank ? '#' + CF.fmtNum(s.bestRank.rank) : '-') +
      ptile('BEST GAIN', s.biggestGain ? '+' + s.biggestGain.d : '-', 'good') +
      ptile('WORST DROP', s.biggestDrop ? s.biggestDrop.d : '-', 'danger') +
      ptile('MAX', (m.info && m.info.maxRating) || '-') +
    '</div>';
    const rows = h.map(c => {
      const d = c.newRating - c.oldRating;
      return '<tr><td class="dim">' + dateOnly(c.ratingUpdateTimeSeconds) + '</td>' +
        '<td class="tl"><a href="' + contestUrl(c.contestId) + '" target="_blank" rel="noopener">' + esc(c.contestName) + '</a></td>' +
        '<td>#' + CF.fmtNum(c.rank) + '</td>' +
        '<td><span style="color:' + CF.rankFor(c.oldRating).color + '">' + c.oldRating + '</span> → <span style="color:' + CF.rankFor(c.newRating).color + '">' + c.newRating + '</span></td>' +
        '<td>' + signed(d) + '</td></tr>';
    }).join('');
    return '<div class="grid g-mate-con">' +
      panel('', tiles, 'flat') +
      panel('⚑ CONTEST HISTORY', h.length ? '<div class="tm-scroll" data-keep="contests"><table class="tm-table"><thead><tr>' +
        '<th>DATE</th><th class="tl">CONTEST</th><th>RANK</th><th>RATING</th><th>Δ</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="dim center pad">NO RATED CONTESTS YET</div>') +
    '</div>';
  }

  function tVs(m, st, all) {
    const me = all.find(x => x.me);
    if (!me || !me.stats) return '<div class="panel full"><div class="center pad dim blink">LOADING YOUR DATA...</div></div>';
    const a = me.stats, b = m.stats;
    const ra = (me.info && me.info.rating) || 0, rb = (m.info && m.info.rating) || 0;
    const line = (label, va, vb) => {
      const top = Math.max(1, va, vb);
      return '<div class="vs-row"><b class="' + (va > vb ? 'good' : '') + '">' + CF.fmtNum(va) + '</b>' +
        '<div class="vs-bar l">' + bar(va / top, 'var(--rank)', 12) + '</div><span class="small dim">' + label + '</span>' +
        '<div class="vs-bar">' + bar(vb / top, CF.rankFor(rb || null).color, 12) + '</div>' +
        '<b class="' + (vb > va ? 'good' : '') + '">' + CF.fmtNum(vb) + '</b></div>';
    };
    const vs = '<div class="vs-names"><b style="color:var(--rank)">' + esc(me.handle) + '</b><span class="small dim">VS</span>' +
      '<b style="color:' + CF.rankFor(m.info && m.info.rating).color + '">' + esc(m.handle) + '</b></div>' +
      line('RATING', ra, rb) + line('MAX', (me.info && me.info.maxRating) || 0, (m.info && m.info.maxRating) || 0) +
      line('SOLVED', a.solvedCount, b.solvedCount) + line('7 DAYS', a.solvedWeek, b.solvedWeek) +
      line('STREAK', a.streak, b.streak) + line('CONTESTS', a.contests, b.contests) +
      line('HARDEST', a.hardest ? a.hardest.problem.rating : 0, b.hardest ? b.hardest.problem.rating : 0);

    // Contests you both took part in.
    const mine = new Map((me.history || []).map(c => [c.contestId, c]));
    const common = (m.history || []).filter(c => mine.has(c.contestId)).reverse();
    let wins = 0;
    const cRows = common.map(c => {
      const y = mine.get(c.contestId), won = y.rank < c.rank;
      if (won) wins++;
      return '<tr><td class="tl"><a href="' + contestUrl(c.contestId) + '" target="_blank" rel="noopener">' + esc(c.contestName) + '</a></td>' +
        '<td class="' + (won ? 'good' : '') + '">#' + CF.fmtNum(y.rank) + ' ' + signed(y.newRating - y.oldRating) + '</td>' +
        '<td class="' + (!won && y.rank !== c.rank ? 'good' : '') + '">#' + CF.fmtNum(c.rank) + ' ' + signed(c.newRating - c.oldRating) + '</td></tr>';
    }).join('');

    const probList = (list, empty) => list.length ? '<ul class="tm-list">' + list.slice(0, 150).map(x =>
      '<li>' + rtag(x.problem.rating) + '<span class="grow">' + plink(x.problem, pid(x.problem) + ' · ' + esc(x.problem.name)) + '</span>' +
      '<span class="dim small">' + CF.timeAgo(x.time).toUpperCase() + '</span></li>').join('') + '</ul>'
      : '<div class="dim center pad">' + empty + '</div>';
    const theyOnly = b.solvedList.filter(x => !a.solvedMap.has(CF.problemKey(x.problem))).sort((p, q) => q.time - p.time);
    const youOnly = a.solvedList.filter(x => !b.solvedMap.has(CF.problemKey(x.problem))).sort((p, q) => q.time - p.time);
    const both = b.solvedList.length - theyOnly.length;

    return '<div class="grid g-mate-vs">' +
      panel('⚔ HEAD TO HEAD', '<div class="tm-scroll">' + vs + '</div>', 'mv-vs') +
      panel('⚑ SAME CONTESTS · ' + wins + 'W ' + (common.length - wins) + 'L', common.length
        ? '<div class="tm-scroll" data-keep="common"><table class="tm-table"><thead><tr><th class="tl">CONTEST</th><th>YOU</th><th>' + esc(m.handle) +
          '</th></tr></thead><tbody>' + cRows + '</tbody></table></div>'
        : '<div class="dim center pad">NO CONTESTS IN COMMON YET</div>', 'mv-common') +
      panel('★ THEY SOLVED, YOU DIDN’T · ' + theyOnly.length, '<div class="tm-scroll" data-keep="they">' + probList(theyOnly, 'NOTHING: YOU HAVE IT ALL') + '</div>', 'mv-they') +
      panel('✔ YOU SOLVED, THEY DIDN’T · ' + youOnly.length, '<div class="tm-scroll" data-keep="you">' +
        '<div class="small dim">BOTH SOLVED: ' + both + '</div>' + probList(youOnly, 'NOTHING YET') + '</div>', 'mv-you') +
    '</div>';
  }

  /* ---------------- Clicks ---------------- */
  T.handleAction = function (a, t, st) {
    if (!a.startsWith('tm-')) return false;
    if (a === 'tm-open') { T.sel = t.dataset.h; T.tab = 'overview'; T.filter = 'all'; }
    else if (a === 'tm-back') T.sel = null;
    else if (a === 'tm-prev' || a === 'tm-next') {
      const keys = sortMembers(members(st)).map(m => m.key);
      const i = keys.indexOf(T.sel);
      T.sel = keys[(i + (a === 'tm-next' ? 1 : -1) + keys.length) % keys.length];
    }
    else if (a === 'tm-tab') T.tab = t.dataset.tab;
    else if (a === 'tm-sort') T.sort = t.dataset.sort;
    else if (a === 'tm-filter') T.filter = t.dataset.f;
    else if (a === 'tm-refresh') {
      T.lastInfo = 0;
      for (const d of Object.values(T.data)) if (d.at) d.at.subs = 0;
      T.tick(st);
    }
    CF.app.renderBoard('teammates');
    return true;
  };
})();
