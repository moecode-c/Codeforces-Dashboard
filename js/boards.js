/* Renderers for every board except Live contest (see live.js).
   Each takes (sectionElement, state) and rewrites the board's HTML. */
(function () {
  CF.boards = {};
  const esc = CF.esc;
  const prevNums = {};

  /* Number that counts up from its last shown value. */
  function num(id, value) {
    const from = prevNums[id] != null ? prevNums[id] : 0;
    prevNums[id] = value;
    return '<span data-count="' + value + '" data-from="' + from + '">' + CF.fmtNum(from) + '</span>';
  }
  CF.boards.num = num;

  function panel(title, body, cls, extra) {
    return '<div class="panel ' + (cls || '') + '">' +
      (title ? '<div class="panel-title">' + title + (extra || '') + '</div>' : '') +
      '<div class="panel-body">' + body + '</div></div>';
  }
  CF.boards.panel = panel;

  function bar(pct, color, segs) {
    segs = segs || 20;
    const on = Math.round(Math.max(0, Math.min(1, pct)) * segs);
    let s = '<div class="pbar">';
    for (let i = 0; i < segs; i++) s += '<i' + (i < on ? ' style="background:' + (color || 'var(--rank)') + '"' : '') + '></i>';
    return s + '</div>';
  }
  CF.boards.bar = bar;

  function link(p, text) {
    const u = CF.problemUrl(p);
    return u ? '<a href="' + u + '" target="_blank" rel="noopener">' + text + '</a>' : text;
  }
  function probLabel(p) {
    return esc((p.contestId || '') + p.index + ' · ' + p.name);
  }
  function ratingTag(r) {
    if (!r) return '<span class="rtag">??</span>';
    return '<span class="rtag" style="color:' + CF.rankFor(r).color + '">' + r + '</span>';
  }
  CF.boards.ratingTag = ratingTag;

  function flame(streak) {
    const size = streak >= 30 ? 'xl' : streak >= 14 ? 'l' : streak >= 7 ? 'm' : streak >= 1 ? 's' : 'off';
    return '<span class="flame flame-' + size + '">🔥</span>';
  }

  /* ============ OVERVIEW ============ */
  CF.boards.overview = function (el, st) {
    const s = st.stats, info = st.info || {};
    const rank = CF.rankFor(s.rating), next = CF.nextRank(s.rating);
    const toNext = next && s.rating != null ? next.min - s.rating : null;
    const rankPct = next && s.rating != null ? (s.rating - Math.max(rank.min, 0)) / (next.min - Math.max(rank.min, 0)) : 1;
    const lv = s.level;
    const sinceCls = s.daysSinceAc == null ? '' : s.daysSinceAc >= 3 ? 'danger blink' : s.daysSinceAc >= 1 ? 'warn' : 'good';

    const hero =
      '<div class="hero">' +
        '<div class="avatar-frame">' + CF.avatarImg(info.titlePhoto || info.avatar, info.handle || st.handle, rank.color) + '</div>' +
        '<div class="hero-main">' +
          '<div class="hero-handle" style="color:' + rank.color + '">' + esc(info.handle || st.handle) + '</div>' +
          '<div class="hero-rank" style="color:' + rank.color + '">' + esc(rank.name.toUpperCase()) +
            (info.country ? ' <span class="dim">· ' + esc(info.country) + '</span>' : '') + '</div>' +
          '<div class="hero-rating"><span class="big" style="color:' + rank.color + '">' +
            (s.rating != null ? num('rating', s.rating) : '----') + '</span>' +
            '<span class="dim"> MAX ' + (s.maxRating != null ? s.maxRating : '-') + '</span></div>' +
          (next ? '<div class="hero-next">' + bar(rankPct, rank.color, 24) +
            '<span class="dim small">' + (toNext != null ? toNext + ' TO ' : 'NEXT: ') +
            '<b style="color:' + next.color + '">' + esc(next.name.toUpperCase()) + '</b></span></div>' : '') +
        '</div>' +
        '<div class="hero-level">' +
          '<div class="lv-badge"><small>LV</small>' + lv.level + '</div>' +
          '<div class="xp">' + bar(lv.pct, '#ffd23f', 14) +
            '<span class="small dim">' + CF.fmtNum(lv.into) + ' / ' + CF.fmtNum(lv.need) + ' XP</span></div>' +
        '</div>' +
      '</div>';

    const tiles =
      '<div class="tiles">' +
        tile('SOLVED', num('solved', s.solvedCount), '⚔') +
        tile('7 DAYS', num('week', s.solvedWeek), '★') +
        tile('STREAK', num('streak', s.streak) + flame(s.streak), '') +
        tile('CONTESTS', num('contests', s.contests), '⚑') +
      '</div>';

    const up = (st.upcoming || []).slice(0, 5);
    const nextC = up[0];
    const contestsHtml = nextC ?
      '<div class="next-contest">' +
        '<div class="small dim">NEXT BATTLE <button class="btn mini ghost" data-action="mark" data-id="' + nextC.id + '">' + (CF.marks.has(nextC.id) ? '★ MARKED' : '☆ MARK') + '</button></div>' +
        '<div class="nc-name">' + esc(nextC.name) + '</div>' +
        '<div class="countdown" data-countdown="' + nextC.startTimeSeconds + '">--:--:--</div>' +
        '<div class="small dim">' + CF.fmtDate(nextC.startTimeSeconds) + ' · ' + Math.round(nextC.durationSeconds / 3600 * 10) / 10 + 'H</div>' +
      '</div>' +
      '<ul class="clist">' + up.slice(1).map(c =>
        '<li data-action="mark" data-id="' + c.id + '"><span class="cl-name">' + (CF.marks.has(c.id) ? '<b class="bell">★</b> ' : /Div\. ?[23]/.test(c.name) ? '<b class="bell">♪</b> ' : '') + esc(c.name) + '</span>' +
        '<span class="cl-time" data-countdown-short="' + c.startTimeSeconds + '"></span></li>').join('') + '</ul>'
      : '<div class="dim center pad">NO UPCOMING CONTESTS</div>';

    const last = s.lastContest;
    const side =
      '<div class="since ' + sinceCls + '">' +
        '<div class="small dim">DAYS SINCE LAST AC</div>' +
        '<div class="big">' + (s.daysSinceAc == null ? '-' : s.daysSinceAc) + '</div>' +
      '</div>' +
      (last ? '<div class="lastc"><div class="small dim">LAST CONTEST</div>' +
        '<div class="lc-name">' + esc(last.contestName) + '</div>' +
        '<div>#' + CF.fmtNum(last.rank) + ' <b class="' + (last.newRating >= last.oldRating ? 'good' : 'danger') + '">' +
        (last.newRating >= last.oldRating ? '+' : '') + (last.newRating - last.oldRating) + '</b></div></div>' :
        '<div class="lastc"><div class="small dim">LAST CONTEST</div><div class="dim">NONE YET</div></div>');

    el.innerHTML =
      '<div class="grid g-overview">' +
        panel('', hero, 'a-hero') +
        panel('⏰ CONTESTS', contestsHtml, 'a-contests') +
        panel('', tiles, 'a-tiles flat') +
        panel('↗ RATING', '<canvas class="chart" id="c-rating"></canvas>', 'a-rating') +
        panel('▓ SOLVED BY DIFFICULTY', '<canvas class="chart" id="c-diff"></canvas>', 'a-diff') +
        panel('▦ ACTIVITY', '<canvas class="chart" id="c-heat"></canvas>', 'a-heat') +
        panel('✦ STATUS', side, 'a-side') +
      '</div>';
    CF.fx.countUps(el);
    el._draw = () => {
      CF.charts.rating(el.querySelector('#c-rating'), s.history);
      CF.charts.difficulty(el.querySelector('#c-diff'), s.byRating);
      CF.charts.heatmap(el.querySelector('#c-heat'), s.newSolvesByDay);
    };
    el._draw();
  };
  function tile(label, value, icon) {
    return '<div class="tile"><div class="tile-label">' + (icon ? icon + ' ' : '') + label + '</div><div class="tile-val">' + value + '</div></div>';
  }

  /* ============ PRACTICE ============ */
  CF.boards.practice = function (el, st) {
    const s = st.stats;
    const unf = s.unfinished.slice(0, 9);
    const unfHtml = unf.length ? '<ul class="list">' + unf.map(a =>
      '<li><span class="v ' + CF.verdictClass(a.lastVerdict) + '">' + CF.verdictShort(a.lastVerdict) + '</span>' +
      ratingTag(a.problem.rating) + '<span class="grow">' + link(a.problem, probLabel(a.problem)) + '</span>' +
      '<span class="dim small">' + a.count + (a.count > 1 ? ' TRIES' : ' TRY') + ' · ' + CF.timeAgo(a.last) + '</span></li>').join('') + '</ul>'
      : '<div class="dim center pad">NO UNFINISHED BUSINESS. CLEAN RUN!</div>';

    const feed = s.recent.slice(0, 12).map(x =>
      '<li><span class="v ' + CF.verdictClass(x.verdict) + '">' + CF.verdictShort(x.verdict) + '</span>' +
      ratingTag(x.problem.rating) + '<span class="grow">' + link(x.problem, probLabel(x.problem)) + '</span>' +
      '<span class="dim small">' + CF.timeAgo(x.creationTimeSeconds) + '</span></li>').join('');

    const tags = Object.entries(s.tags).sort((a, b) => b[1] - a[1]);
    const strong = tags.slice(0, 4), weak = tags.slice(-4).reverse().filter(t => !strong.includes(t));
    const tagHtml =
      '<div class="tagcols"><div><div class="small good">STRONGEST</div>' +
      strong.map(([t, n]) => '<div class="tagrow"><span>' + esc(t) + '</span><b>' + n + '</b></div>').join('') + '</div>' +
      '<div><div class="small danger">NEEDS TRAINING</div>' +
      weak.map(([t, n]) => '<div class="tagrow"><span>' + esc(t) + '</span><b>' + n + '</b></div>').join('') + '</div></div>';

    const verdicts = {};
    for (const x of s.subs) if (CF.isFinalVerdict(x.verdict)) verdicts[x.verdict] = (verdicts[x.verdict] || 0) + 1;
    const vlist = Object.entries(verdicts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const vHtml = '<div class="vstats">' + vlist.map(([v, n]) =>
      '<div class="vstat"><span class="v ' + CF.verdictClass(v) + '">' + CF.verdictShort(v) + '</span>' +
      bar(n / s.totalSubs, v === 'OK' ? 'var(--ac)' : v === 'COMPILATION_ERROR' ? 'var(--warn)' : 'var(--wa)', 16) +
      '<b>' + n + '</b></div>').join('') +
      '<div class="small dim">ACCURACY ' + Math.round(s.acRate * 100) + '% · ' + CF.fmtNum(s.totalSubs) + ' SUBMISSIONS</div></div>';

    el.innerHTML =
      '<div class="grid g-practice">' +
        panel('☠ UNFINISHED BUSINESS', unfHtml, 'p-unf') +
        panel('✦ TAG RADAR', '<canvas class="chart" id="c-radar"></canvas>', 'p-radar') +
        panel('▶ RECENT SUBMISSIONS', '<ul class="list">' + feed + '</ul>', 'p-feed') +
        panel('⚔ SKILLS', tagHtml, 'p-tags') +
        panel('≡ VERDICTS', vHtml, 'p-verd') +
      '</div>';
    el._draw = () => CF.charts.radar(el.querySelector('#c-radar'), s.tags);
    el._draw();
  };

  /* ============ ACHIEVEMENTS ============ */
  CF.boards.achievements = function (el, st) {
    const list = st.stats.achievements;
    const got = list.filter(a => a.unlocked).length;
    const groups = {};
    for (const a of list) (groups[a.group] = groups[a.group] || []).push(a);
    const nextUp = list.filter(a => !a.unlocked).sort((a, b) => b.pct - a.pct).slice(0, 3);

    el.innerHTML = '<div class="ach">' +
      '<div class="ach-head panel"><div class="panel-body row">' +
        '<div><div class="small dim">TROPHY CASE</div><div class="big">' + got + '<span class="dim"> / ' + list.length + '</span></div></div>' +
        '<div class="grow">' + bar(got / list.length, '#ffd23f', 30) + '</div>' +
        '<div class="next-ach">' + nextUp.map(a =>
          '<div class="small"><span class="tier-' + a.tier + '">' + a.icon + '</span> ' + esc(a.title) +
          ' <span class="dim">' + Math.floor(a.current) + '/' + a.target + '</span></div>').join('') + '</div>' +
      '</div></div>' +
      // One grid that always fits the screen; badges stay in group order.
      '<div class="ach-grid">' + Object.values(groups).flat().map(a =>
        '<div class="badge ' + (a.unlocked ? 'on tier-' + a.tier : 'off') + '" title="' + esc(a.group + ': ' + a.desc) + '">' +
          '<div class="badge-icon">' + a.icon + '</div>' +
          '<div class="badge-title">' + esc(a.title) + '</div>' +
          '<div class="badge-desc">' + esc(a.desc) + '</div>' +
          (a.unlocked ? '' : bar(a.pct, '#8a8aa8', 8)) +
        '</div>').join('') + '</div></div>';
  };

  /* ============ GOALS ============ */
  CF.boards.goals = function (el, st) {
    const s = st.stats, g = st.profile.goal, quests = st.quests || [];
    const rating = s.rating || 0;
    const target = g.target || (CF.nextRank(s.rating) || { min: rating + 100 }).min;
    const start = g.start != null ? g.start : Math.max(0, rating - 100);
    const rPct = target > start ? (rating - start) / (target - start) : 1;
    const rank = CF.rankFor(target);

    const rings = '<div class="rings">' +
      '<div class="ringbox">' + CF.charts.ring(rPct, rank.color, String(rating || '-'), '/ ' + target) + '<div class="small">TARGET RATING</div></div>' +
      '<div class="ringbox">' + CF.charts.ring(s.solvedToday / g.daily, 'var(--ac)', s.solvedToday + '/' + g.daily, 'TODAY') + '<div class="small">DAILY GOAL</div></div>' +
      '<div class="ringbox">' + CF.charts.ring(s.solvedWeek / g.weekly, '#ffd23f', s.solvedWeek + '/' + g.weekly, '7 DAYS') + '<div class="small">WEEKLY GOAL</div></div>' +
    '</div>';

    const qHtml = '<ul class="quests">' + quests.map(q =>
      '<li class="' + (q.done ? 'done' : '') + '"><span class="qbox">' + (q.done ? '✔' : '') + '</span>' +
      '<span class="grow">' + esc(q.title) + '<br>' + bar(q.cur / q.target, q.done ? 'var(--ac)' : 'var(--rank)', 12) + '</span>' +
      '<span class="coin">● ' + q.reward + '</span></li>').join('') + '</ul>' +
      '<div class="small dim center">NEW QUESTS AT MIDNIGHT · <span data-countdown="' + midnight() + '"></span></div>';

    const days = [];
    for (let i = 13; i >= 0; i--) days.push(CF.addDays(CF.todayKey(), -i));
    const maxD = Math.max(g.daily, ...days.map(d => s.newSolvesByDay[d] || 0));
    const hist = '<div class="dayhist">' + days.map(d => {
      const n = s.newSolvesByDay[d] || 0;
      return '<div class="dh"><div class="dh-col"><div class="dh-fill ' + (n >= g.daily ? 'hit' : '') + '" style="height:' +
        Math.round((n / maxD) * 100) + '%"></div><div class="dh-goal" style="bottom:' + Math.round((g.daily / maxD) * 100) + '%"></div></div>' +
        '<span>' + Number(d.slice(8)) + '</span></div>';
    }).join('') + '</div>';

    el.innerHTML =
      '<div class="grid g-goals">' +
        panel('◎ GOALS', rings, 'gl-rings', '<button class="btn mini" data-action="settings">EDIT</button>') +
        panel('⚑ DAILY QUESTS', qHtml, 'gl-quests', '<span class="coin">● ' + st.profile.coins + '</span>') +
        panel('▓ LAST 14 DAYS', hist, 'gl-hist') +
      '</div>';
  };
  function midnight() {
    const d = new Date(); d.setHours(24, 0, 0, 0); return Math.floor(d / 1000);
  }

  /* ============ HALL OF RECORDS ============ */
  CF.boards.records = function (el, st) {
    const s = st.stats;
    const rec = (icon, label, value, sub) =>
      '<div class="record"><div class="rec-icon">' + icon + '</div><div class="small dim">' + label + '</div>' +
      '<div class="rec-val">' + value + '</div><div class="small dim">' + (sub || '&nbsp;') + '</div></div>';
    const rk = CF.rankFor(s.maxRating);
    const fav = s.langList[0];
    el.innerHTML =
      '<div class="records">' +
        rec('♛', 'MAX RATING', '<span style="color:' + rk.color + '">' + (s.maxRating || '-') + '</span>', esc(rk.name.toUpperCase())) +
        rec('♕', 'BEST CONTEST RANK', s.bestRank ? '#' + CF.fmtNum(s.bestRank.rank) : '-', s.bestRank ? esc(s.bestRank.contestName) : '') +
        rec('↑', 'BIGGEST GAIN', s.biggestGain ? '<span class="good">+' + s.biggestGain.d + '</span>' : '-', s.biggestGain ? esc(s.biggestGain.contestName) : '') +
        rec('↓', 'BIGGEST DROP', s.biggestDrop ? '<span class="danger">' + s.biggestDrop.d + '</span>' : '-', s.biggestDrop ? esc(s.biggestDrop.contestName) : 'NEVER DROPPED') +
        rec('★', 'HARDEST SOLVE', s.hardest ? ratingTag(s.hardest.problem.rating) : '-', s.hardest ? link(s.hardest.problem, esc(s.hardest.problem.name)) : '') +
        rec('⏱', 'FASTEST CONTEST AC', s.fastestContestAc ? CF.fmtRel(s.fastestContestAc.sec) : '-', s.fastestContestAc ? esc(s.fastestContestAc.problem.index + ' · ' + s.fastestContestAc.problem.name) : '') +
        rec('🔥', 'LONGEST STREAK', s.longestStreak + ' DAYS', 'NOW: ' + s.streak) +
        rec('⚡', 'BUSIEST DAY', s.busiest ? s.busiest.n + ' SOLVES' : '-', s.busiest ? s.busiest.day : '') +
        rec('❤', 'NEVER GAVE UP', s.mostWrongSolved ? s.mostWrongSolved.wrongBefore + ' MISSES' : '-', s.mostWrongSolved ? link(s.mostWrongSolved.problem, esc(s.mostWrongSolved.problem.name)) : '') +
        rec('◎', 'FIRST-TRY ACs', CF.fmtNum(s.firstTry), s.solvedCount ? Math.round((s.firstTry / s.solvedCount) * 100) + '% OF SOLVES' : '') +
        rec('⚙', 'MAIN WEAPON', fav ? esc(fav[0].replace(/\(.*\)/, '').trim()) : '-', fav ? fav[1] + ' ACs' : '') +
        rec('⚐', 'JOURNEY START', s.firstSolve ? new Date(s.firstSolve * 1000).toLocaleDateString() : '-', 'FIRST AC') +
      '</div>';
  };
})();
