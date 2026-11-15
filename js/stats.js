/* Turns raw API data into everything the boards display:
   solves, streaks, XP and level, records, achievements and daily quests. */
(function () {
  const BIG = 2147483647;

  CF.levelFromXp = function (xp) {
    // Level n starts at 500 * n * (n - 1) XP: L2 = 1000, L3 = 3000, L10 = 45000...
    const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xp) / 500)) / 2));
    const cur = 500 * level * (level - 1);
    const next = 500 * (level + 1) * level;
    return { level, xp, cur, next, into: xp - cur, need: next - cur, pct: (xp - cur) / (next - cur) };
  };

  CF.computeStats = function (info, subs, history) {
    subs = (subs || []).slice().sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds);
    history = history || [];
    const now = Date.now() / 1000;
    const today = CF.todayKey();

    const solved = new Map();      // key -> {problem, time, wrongBefore}
    const attempts = new Map();    // key -> {problem, count, last, lastVerdict}
    const acDays = new Set();
    const newSolvesByDay = {};
    const langs = {};
    let acSubs = 0, fastestContestAc = null, nightOwl = false, earlyBird = false;

    for (const s of subs) {
      const key = CF.problemKey(s.problem);
      const a = attempts.get(key) || { problem: s.problem, count: 0, wrong: 0, last: 0, lastVerdict: null };
      a.count++;
      a.last = s.creationTimeSeconds;
      a.lastVerdict = s.verdict;
      attempts.set(key, a);
      if (s.verdict === 'OK') {
        acSubs++;
        const day = CF.dayKey(s.creationTimeSeconds);
        acDays.add(day);
        langs[s.programmingLanguage] = (langs[s.programmingLanguage] || 0) + 1;
        const hr = new Date(s.creationTimeSeconds * 1000).getHours();
        if (hr >= 0 && hr < 4) nightOwl = true;
        if (hr >= 5 && hr < 7) earlyBird = true;
        const pt = s.author && s.author.participantType;
        if ((pt === 'CONTESTANT' || pt === 'OUT_OF_COMPETITION') && s.relativeTimeSeconds < BIG) {
          if (fastestContestAc == null || s.relativeTimeSeconds < fastestContestAc.sec)
            fastestContestAc = { sec: s.relativeTimeSeconds, problem: s.problem };
        }
        if (!solved.has(key)) {
          solved.set(key, { problem: s.problem, time: s.creationTimeSeconds, wrongBefore: a.wrong });
          newSolvesByDay[day] = (newSolvesByDay[day] || 0) + 1;
        }
      } else if (CF.isFinalVerdict(s.verdict) && s.verdict !== 'COMPILATION_ERROR' && !solved.has(key)) {
        a.wrong++;
      }
    }

    const solvedList = [...solved.values()];
    const byRating = {};
    const tags = {};
    let xp = 0, hardest = null, firstTry = 0, mostWrongSolved = null;
    for (const s of solvedList) {
      const r = s.problem.rating;
      const bucket = r || 'unrated';
      byRating[bucket] = (byRating[bucket] || 0) + 1;
      xp += r || 500;
      for (const t of s.problem.tags || []) tags[t] = (tags[t] || 0) + 1;
      if (r && (!hardest || r > hardest.problem.rating)) hardest = s;
      if (s.wrongBefore === 0) firstTry++;
      if (s.wrongBefore > 0 && (!mostWrongSolved || s.wrongBefore > mostWrongSolved.wrongBefore)) mostWrongSolved = s;
    }

    // Streaks are counted on days with at least one accepted submission.
    let current = 0;
    let cursor = acDays.has(today) ? today : CF.addDays(today, -1);
    while (acDays.has(cursor)) { current++; cursor = CF.addDays(cursor, -1); }
    let longest = 0;
    for (const d of acDays) {
      if (acDays.has(CF.addDays(d, -1))) continue;
      let len = 1, c = d;
      while (acDays.has(CF.addDays(c, 1))) { len++; c = CF.addDays(c, 1); }
      longest = Math.max(longest, len);
    }

    let week = 0;
    for (let i = 0; i < 7; i++) week += newSolvesByDay[CF.addDays(today, -i)] || 0;
    let busiest = null;
    for (const [d, n] of Object.entries(newSolvesByDay)) if (!busiest || n > busiest.n) busiest = { day: d, n };

    const lastAc = solvedList.length ? Math.max(...subs.filter(s => s.verdict === 'OK').map(s => s.creationTimeSeconds)) : null;

    const unfinished = [...attempts.entries()]
      .filter(([k, a]) => !solved.has(k) && a.lastVerdict !== 'TESTING')
      .map(([, a]) => a)
      .sort((x, y) => y.last - x.last);

    let bestRank = null, biggestGain = null, biggestDrop = null;
    for (const h of history) {
      const d = h.newRating - h.oldRating;
      if (!bestRank || h.rank < bestRank.rank) bestRank = h;
      if (h.oldRating > 0 && (!biggestGain || d > biggestGain.d)) biggestGain = Object.assign({ d }, h);
      if (!biggestDrop || d < biggestDrop.d) biggestDrop = Object.assign({ d }, h);
    }
    if (biggestDrop && biggestDrop.d >= 0) biggestDrop = null;
    const lastContest = history.length ? history[history.length - 1] : null;

    const langList = Object.entries(langs).sort((a, b) => b[1] - a[1]);

    const stats = {
      info, subs, history,
      rating: info ? info.rating : null,
      maxRating: info ? info.maxRating : null,
      solvedCount: solved.size,
      solvedMap: solved,
      solvedList,
      solvedToday: newSolvesByDay[today] || 0,
      solvedWeek: week,
      newSolvesByDay,
      acDays,
      streak: current,
      longestStreak: longest,
      byRating, tags,
      level: CF.levelFromXp(xp),
      hardest, firstTry, mostWrongSolved, busiest,
      fastestContestAc,
      nightOwl, earlyBird,
      daysSinceAc: lastAc ? Math.floor((now - lastAc) / 86400) : null,
      lastAc,
      totalSubs: subs.length,
      acSubs,
      acRate: subs.length ? acSubs / subs.length : 0,
      langList,
      unfinished,
      recent: subs.slice(-25).reverse(),
      contests: history.length,
      bestRank, biggestGain, biggestDrop, lastContest,
      firstSolve: solvedList.length ? Math.min(...solvedList.map(s => s.time)) : null,
    };
    stats.achievements = CF.evaluateAchievements(stats);
    return stats;
  };

  /* ---------- Achievements ---------- */
  const T = { b: 'bronze', s: 'silver', g: 'gold', d: 'diamond' };
  function series(id, name, icon, tiers, valueFn, unit) {
    return tiers.map(([target, tier, title], i) => ({
      id: id + '-' + target, group: name, icon, tier: T[tier], title,
      desc: unit(target), target, value: valueFn,
    }));
  }
  const maxRankIdx = s => (s.maxRating == null ? -1 : CF.rankIndex(s.maxRating));

  CF.ACHIEVEMENTS = [].concat(
    series('solved', 'Problems solved', '⚔', [
      [1, 'b', 'First Blood'], [10, 'b', 'Warming Up'], [50, 's', 'Problem Hunter'],
      [100, 's', 'Centurion'], [250, 'g', 'Veteran'], [500, 'g', 'Elite'], [1000, 'd', 'Legend'],
    ], s => s.solvedCount, n => 'Solve ' + n + ' problem' + (n > 1 ? 's' : '')),
    series('streak', 'Streak', '♨', [
      [3, 'b', 'On Fire'], [7, 's', 'Week Warrior'], [14, 's', 'Unstoppable'],
      [30, 'g', 'Monthly Grind'], [100, 'd', 'Eternal Flame'],
    ], s => s.longestStreak, n => n + '-day solving streak'),
    series('hard', 'Hardest solve', '★', [
      [1000, 'b', 'Level Up'], [1200, 'b', 'Getting Serious'], [1400, 's', 'Sharp Mind'],
      [1600, 's', 'Problem Crusher'], [1900, 'g', 'Boss Slayer'], [2100, 'g', 'Dragon Slayer'], [2400, 'd', 'Mythic'],
    ], s => (s.hardest ? s.hardest.problem.rating : 0), n => 'Solve a ' + n + '+ rated problem'),
    series('contests', 'Contests', '⚑', [
      [1, 'b', 'Rookie'], [5, 'b', 'Competitor'], [10, 's', 'Regular'],
      [25, 's', 'Tournament Pro'], [50, 'g', 'Arena Veteran'], [100, 'd', 'Gladiator'],
    ], s => s.contests, n => 'Take part in ' + n + ' rated contest' + (n > 1 ? 's' : '')),
    series('rank', 'Rank', '♛', [
      [1, 'b', 'Pupil'], [2, 's', 'Specialist'], [3, 's', 'Expert'],
      [4, 'g', 'Candidate Master'], [5, 'g', 'Master'], [7, 'd', 'Grandmaster'],
    ], maxRankIdx, n => 'Reach ' + CF.RANKS[n].name),
    series('firsttry', 'First try', '◎', [
      [10, 'b', 'Sniper'], [50, 's', 'Sharpshooter'], [150, 'g', 'Deadeye'],
    ], s => s.firstTry, n => n + ' problems accepted on the first try'),
    series('busy', 'Busiest day', '⚡', [
      [5, 'b', 'Grind Day'], [10, 's', 'Marathon'], [20, 'g', 'Speedrunner'],
    ], s => (s.busiest ? s.busiest.n : 0), n => 'Solve ' + n + ' problems in one day'),
    series('tags', 'Topics', '✦', [
      [5, 'b', 'Explorer'], [10, 's', 'All-Rounder'], [20, 'g', 'Polymath'],
    ], s => Object.keys(s.tags).length, n => 'Solve problems in ' + n + ' different topics'),
    series('level', 'Level', '▲', [
      [5, 'b', 'Apprentice'], [10, 's', 'Adept'], [25, 'g', 'Master Coder'], [50, 'd', 'Ascended'],
    ], s => s.level.level, n => 'Reach level ' + n),
    series('gain', 'Rating gain', '↑', [
      [50, 'b', 'Climber'], [100, 's', 'Rocket'], [200, 'g', 'Moonshot'],
    ], s => (s.biggestGain ? s.biggestGain.d : 0), n => 'Gain +' + n + ' rating in one contest'),
    [
      { id: 'fast', group: 'Special', icon: '⏱', tier: T.g, title: 'Speed Demon', desc: 'Contest AC within 5 minutes',
        target: 1, value: s => (s.fastestContestAc && s.fastestContestAc.sec <= 300 ? 1 : 0) },
      { id: 'never', group: 'Special', icon: '❤', tier: T.s, title: 'Never Give Up', desc: 'Solve a problem after 5+ wrong tries',
        target: 5, value: s => (s.mostWrongSolved ? s.mostWrongSolved.wrongBefore : 0) },
      { id: 'owl', group: 'Special', icon: '☾', tier: T.b, title: 'Night Owl', desc: 'Get an AC between 00:00 and 04:00',
        target: 1, value: s => (s.nightOwl ? 1 : 0) },
      { id: 'bird', group: 'Special', icon: '☀', tier: T.b, title: 'Early Bird', desc: 'Get an AC between 05:00 and 07:00',
        target: 1, value: s => (s.earlyBird ? 1 : 0) },
      { id: 'poly', group: 'Special', icon: '⚙', tier: T.s, title: 'Polyglot', desc: 'Get ACs in 3 different languages',
        target: 3, value: s => s.langList.length },
    ]
  );

  CF.evaluateAchievements = function (stats) {
    return CF.ACHIEVEMENTS.map(a => {
      const v = Math.max(0, a.value(stats) || 0);
      return Object.assign({}, a, { current: v, unlocked: v >= a.target, pct: Math.min(1, v / a.target) });
    });
  };

  /* ---------- Daily quests ---------- */
  const QUEST_TAGS = ['greedy', 'math', 'implementation', 'brute force', 'constructive algorithms',
    'sortings', 'strings', 'number theory', 'dp', 'binary search'];

  CF.dailyQuests = function (handle, stats) {
    const today = CF.todayKey();
    const rnd = CF.seeded(handle.toLowerCase() + today);
    const base = Math.max(800, Math.floor((stats.rating || 800) / 100) * 100);
    const todays = stats.subs.filter(s => CF.dayKey(s.creationTimeSeconds) === today);
    const todaysAc = todays.filter(s => s.verdict === 'OK');
    const solvedToday = stats.solvedList.filter(s => CF.dayKey(s.time) === today);

    const n = 1 + Math.floor(rnd() * 3);
    const quests = [{
      id: 'solve' + n, title: 'Solve ' + n + ' new problem' + (n > 1 ? 's' : ''),
      cur: solvedToday.length, target: n, reward: 30 + n * 10,
    }];
    const pool = [
      () => ({ id: 'rated', title: 'Solve a ' + base + '+ problem', reward: 60, target: 1,
        cur: solvedToday.some(s => (s.problem.rating || 0) >= base) ? 1 : 0 }),
      () => ({ id: 'hard', title: 'Boss fight: solve a ' + (base + 200) + '+', reward: 120, target: 1,
        cur: solvedToday.some(s => (s.problem.rating || 0) >= base + 200) ? 1 : 0 }),
      () => ({ id: 'first', title: 'Get an AC on the first try', reward: 50, target: 1,
        cur: solvedToday.some(s => s.wrongBefore === 0) ? 1 : 0 }),
      () => {
        const tag = QUEST_TAGS[Math.floor(rnd() * QUEST_TAGS.length)];
        return { id: 'tag-' + tag, title: 'Solve a "' + tag + '" problem', reward: 50, target: 1,
          cur: solvedToday.some(s => (s.problem.tags || []).includes(tag)) ? 1 : 0 };
      },
      () => ({ id: 'acs', title: 'Get 3 accepted submissions', reward: 40, target: 3, cur: todaysAc.length }),
    ];
    const picks = [];
    while (picks.length < 2) {
      const i = Math.floor(rnd() * pool.length);
      if (!picks.includes(i)) picks.push(i);
    }
    for (const i of picks) quests.push(pool[i]());
    for (const q of quests) { q.cur = Math.min(q.cur, q.target); q.done = q.cur >= q.target; }
    return quests;
  };
})();
