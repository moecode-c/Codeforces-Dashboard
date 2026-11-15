/* Live contest board.
   - Finds the contest you're in right now (or your most recent one).
   - While live, polls your submissions every 20s and your standings row every 60s.
   - Has a Problems tab and a Standings tab (around me / top 10 / friends).
   - Virtual contests: started from the board (+ VIRTUAL) or picked up from your first
     VIRTUAL submission. Codeforces never shares virtual rows through the API, so your
     score and "ghost rank" (vs. official contestants at the same moment) are computed here. */
(function () {
  const esc = CF.esc;
  const L = CF.live = {
    contest: null, mode: 'none', problems: [], myRow: null, mySubs: [], ratingChange: null,
    tab: 'problems', view: 'around', standings: null, standingsAt: 0, loading: false,
    lastLoad: 0, lastProbe: 0, liveElsewhere: null, kind: 'official', vstart: 0,
  };
  const FINISHED_PHASES = ['FINISHED'];
  const now = () => Date.now() / 1000;

  function runningContests(all) {
    const t = now();
    return (all || []).filter(c => c.phase === 'CODING' ||
      (c.phase === 'BEFORE' && c.startTimeSeconds <= t && c.startTimeSeconds + c.durationSeconds > t));
  }
  function isContestant(s) {
    const pt = s.author && s.author.participantType;
    return pt === 'CONTESTANT' || pt === 'OUT_OF_COMPETITION';
  }
  const isVirtual = s => !!(s.author && s.author.participantType === 'VIRTUAL');
  L.isVirtual = isVirtual;
  /* True while you're in a contest right now (official or virtual). */
  L.inGame = () => L.mode === 'live' || L.mode === 'virtual';

  /* A virtual participation that is still running: from your submissions, or one you started here. */
  function runningVirtual(st, all, subs) {
    const t = now();
    const ended = CF.store.get('virtualEnded', null);
    const skip = (id, start) => ended && ended.contestId === id && start < ended.at;
    for (const s of subs.slice(0, 60)) {
      if (!isVirtual(s) || !s.author.startTimeSeconds) continue;
      const c = all.find(x => x.id === s.contestId);
      if (c && s.author.startTimeSeconds + c.durationSeconds > t && !skip(c.id, s.author.startTimeSeconds))
        return { c, start: s.author.startTimeSeconds };
    }
    const man = CF.store.get('virtual', null);
    if (man && man.handle.toLowerCase() === st.handle.toLowerCase()) {
      const c = all.find(x => x.id === man.contestId);
      if (c && man.start + c.durationSeconds > t && !skip(c.id, man.start)) return { c, start: man.start };
    }
    return null;
  }

  /* Start a virtual contest from the dashboard. minutesIn = how long ago you started it on Codeforces.
     Returns an error message, or null when it worked. */
  L.startVirtual = function (st, contestId, minutesIn) {
    const c = (st.contestsAll || []).find(x => x.id === contestId);
    if (!c) return 'CONTEST ' + contestId + ' NOT FOUND';
    if (c.phase !== 'FINISHED') return 'THAT CONTEST HAS NOT FINISHED YET';
    if (minutesIn * 60 >= c.durationSeconds) return 'THAT VIRTUAL WOULD ALREADY BE OVER';
    CF.store.set('virtual', { handle: st.handle, contestId, start: Math.floor(now() - minutesIn * 60) });
    const ended = CF.store.get('virtualEnded', null);
    if (ended && ended.contestId === contestId) CF.store.set('virtualEnded', null);
    return null;
  };
  L.endVirtual = function () {
    if (L.mode !== 'virtual' || !L.contest) return;
    CF.store.set('virtualEnded', { contestId: L.contest.id, at: Math.floor(now()) + 1 });
    CF.store.set('virtual', null);
  };

  /* Decide which contest the board should show. */
  L.detect = async function (st) {
    const all = st.contestsAll || [];
    const running = runningContests(all);
    const subs = st.stats ? st.stats.subs : [];
    let pick = null, mode = 'none';

    // You count as "in" a running contest once you've submitted something to it.
    for (const c of running) {
      if (subs.some(s => s.contestId === c.id && isContestant(s))) { pick = c; mode = 'live'; break; }
    }
    if (!pick && L.mode === 'live' && L.contest && running.some(c => c.id === L.contest.id)) {
      pick = L.contest; mode = 'live';
    }
    let kind = 'official', vstart = 0;
    if (!pick) {
      const v = runningVirtual(st, all, subs);
      if (v) { pick = v.c; mode = 'virtual'; kind = 'virtual'; vstart = v.start; }
    }
    L.liveElsewhere = mode !== 'live' && running.length ? running[0] : null;

    if (!pick) {
      // Most recent contest you competed in (officially or virtually).
      let bestId = null, bestT = 0, bestV = 0;
      const last = st.stats && st.stats.lastContest;
      if (last) { bestId = last.contestId; bestT = last.ratingUpdateTimeSeconds; }
      for (const s of subs) if ((isContestant(s) || isVirtual(s)) && s.creationTimeSeconds > bestT) {
        bestT = s.creationTimeSeconds; bestId = s.contestId; bestV = isVirtual(s) ? s.author.startTimeSeconds : 0;
      }
      if (bestId) {
        pick = all.find(c => c.id === bestId) || { id: bestId, name: last ? last.contestName : 'Contest ' + bestId };
        mode = 'recent';
        if (bestV) { kind = 'virtual'; vstart = bestV; }
      }
    }
    const changed = !L.contest || !pick || L.contest.id !== pick.id || L.mode !== mode || L.kind !== kind;
    L.mode = mode; L.kind = kind;
    // Keep a start time already corrected from a real submission.
    if (changed || kind !== 'virtual' || Math.abs(vstart - L.vstart) > 3600) L.vstart = vstart;
    if (!pick) { L.contest = null; return changed; }
    if (changed) {
      L.contest = pick; L.problems = []; L.myRow = null; L.mySubs = []; L.ratingChange = null;
      L.rows = null; L.summary = null; L.rowAt = 0; L.lastLoad = 0; L.verdictsLoadedFor = null;
      // Small summary saved from an earlier download, so we don't re-download megabytes.
      const cached = CF.store.get('standings.' + pick.id, null);
      if (cached) {
        L.summary = cached;
        L.problems = cached.problems || [];
        L.myRow = cached.myRow;
        L.contest = Object.assign({}, pick, cached.contest);
        L.rowAt = mode === 'live' ? 0 : cached.at;
      }
    }
    L.ratingChange = kind === 'official' ? (st.history || []).find(h => h.contestId === pick.id) || null : null;
    return changed;
  };

  /* Slow loop (standings etc.): seconds between refreshes. */
  L.pollSeconds = function () {
    if (L.inGame()) return 30;
    if (L.contest && L.contest.phase && !FINISHED_PHASES.includes(L.contest.phase)) return 60;
    return 600;
  };

  const isTesting = s => !s.verdict || s.verdict === 'TESTING';
  L.systemTesting = () => !!(L.contest && (L.contest.phase === 'PENDING_SYSTEM_TEST' || L.contest.phase === 'SYSTEM_TEST'));

  /* Fast loop: milliseconds until the next verdict check, or null when there's nothing to watch.
     2.5s while a submission is being judged, 6s otherwise during a live contest. */
  L.fastDelay = function () {
    if (L.inGame()) return L.mySubs.some(isTesting) ? 2500 : 6000;
    if (L.systemTesting()) return 10000;
    return null;
  };

  /* Fetch only your newest submissions in this contest and merge them in.
     Returns true when anything changed. */
  L.pollVerdicts = async function (st) {
    if (!L.contest || L.verdictLoading) return false;
    const id = L.contest.id, live = L.inGame(), virtual = L.kind === 'virtual';
    L.verdictLoading = true;
    try {
      // First time: all your submissions. After that: just the newest 20 (small and fast).
      const count = L.verdictsLoadedFor === id ? 20 : 200;
      const subs = await CF.api.call('contest.status', { contestId: id, handle: st.handle, from: 1, count }, { priority: true });
      if (!L.contest || L.contest.id !== id) return false;
      const byId = new Map(L.mySubs.map(s => [s.id, s]));
      let changed = L.verdictsLoadedFor !== id;
      // Virtual: only this run's submissions. The first real one also gives the exact start time.
      let mine = subs.filter(isContestant);
      if (virtual) {
        mine = subs.filter(s => isVirtual(s) && s.author.startTimeSeconds > L.vstart - 3600);
        if (mine.length) L.vstart = Math.max(...mine.map(s => s.author.startTimeSeconds));
        mine = mine.filter(s => s.author.startTimeSeconds === L.vstart);
      }
      for (const s of mine) {
        const old = byId.get(s.id);
        if (!old || old.verdict !== s.verdict || old.passedTestCount !== s.passedTestCount) { byId.set(s.id, s); changed = true; }
      }
      L.verdictsLoadedFor = id;
      if (changed) {
        L.mySubs = [...byId.values()].sort((a, b) => b.id - a.id);
        if (CF.app) CF.app.noticeSubs(L.mySubs, { live, contestId: id, fromFast: true });
      }
      L.verdictAt = now();
      return changed;
    } catch (e) {
      console.warn('verdict poll failed', e);
      return false;
    } finally {
      L.verdictLoading = false;
    }
  };

  L.refresh = async function (st, force) {
    if (!L.contest || L.loading) return;
    if (!force && now() - L.lastLoad < L.pollSeconds() - 1) return;
    L.loading = true;
    const id = L.contest.id, live = L.mode === 'live';
    try {
      if (L.verdictsLoadedFor !== id || !L.fastDelay()) await L.pollVerdicts(st);
      if (!L.contest || L.contest.id !== id) return;

      // Codeforces only serves the FULL standings (several MB), so download them
      // rarely: once per contest, or every 2 minutes while you watch a live contest.
      const finished = L.contest.phase === 'FINISHED';
      const age = now() - (L.rowAt || 0);
      const need = !L.problems.length ||
        (L.kind === 'virtual' && !L.rows && (L.mode === 'virtual' || L.boardActive)) ||
        (L.boardActive && ((live && age > 120) || (!finished && age > 300) || (finished && L.summary && !L.summary.final)));
      if (need) await L.loadStandings(st);
      if ((live || L.kind === 'virtual') && L.rows && !(L.sample && L.sample.contestId === id)) await L.loadSample(st);
      L.lastLoad = now();
    } catch (e) {
      console.warn('live refresh failed', e);
    } finally {
      L.loading = false;
    }
  };

  L.loadStandings = async function (st) {
    if (!L.contest || L.standingsLoading) return;
    const id = L.contest.id;
    L.standingsLoading = true;
    try {
      const r = await CF.api.call('contest.standings', { contestId: id }, { priority: L.mode === 'live' });
      if (!L.contest || L.contest.id !== id) return;
      L.contest = Object.assign({}, L.contest, r.contest);
      L.problems = r.problems || [];
      const rows = r.rows || [];
      const me = st.handle.toLowerCase();
      const myIdx = rows.findIndex(row => row.party.members.some(m => m.handle.toLowerCase() === me));
      L.myRow = myIdx >= 0 ? rows[myIdx] : null;
      // Keep the big list in memory only while live, or for virtuals (needed for the ghost rank).
      L.rows = L.mode === 'live' || L.kind === 'virtual' ? rows : null;
      L.rowAt = now();
      L.standingsError = null;
      L.summary = {
        at: L.rowAt, final: r.contest.phase === 'FINISHED', contest: r.contest, problems: L.problems, myRow: L.myRow,
        top: rows.slice(0, 10),
        around: myIdx >= 0 ? rows.slice(Math.max(0, myIdx - 5), myIdx + 6) : [],
        friends: friendRows(rows, st),
      };
      CF.store.set('standings.' + id, L.summary);
    } catch (e) {
      L.standingsError = e.message;
    } finally {
      L.standingsLoading = false;
    }
  };

  function friendRows(rows, st) {
    const set = new Set([st.handle].concat(st.settings.rivals).map(h => h.toLowerCase()));
    return rows.filter(row => row.party.members.some(m => set.has(m.handle.toLowerCase())));
  }
  /* ---------- Rating predictor ----------
     Codeforces' formula needs everyone's rating. Downloading all of them is too much for a
     tablet, so we fetch a spread-out sample of up to 400 contestants once per contest and
     scale it up. The result is an estimate (shown with ≈), usually within a few points. */
  const SAMPLE = 400;
  L.loadSample = async function (st) {
    if (!L.rows || !L.contest || L.sampleLoading) return;
    const id = L.contest.id;
    const have = L.sample && L.sample.contestId === id ? L.sample : CF.store.get('rsample.' + id, null);
    if (have) { L.sample = have; return; }
    const contestants = L.rows.filter(r => r.party.participantType === 'CONTESTANT' && r.party.members.length);
    if (!contestants.length) return;
    const step = Math.max(1, contestants.length / SAMPLE), handles = [];
    for (let i = 0; i < contestants.length && handles.length < SAMPLE; i += step) handles.push(contestants[Math.floor(i)].party.members[0].handle);
    L.sampleLoading = true;
    try {
      const users = await CF.api.call('user.info', { handles: handles.join(';') });
      L.sample = { contestId: id, ratings: users.map(u => u.rating != null ? u.rating : 1400) };
      CF.store.set('rsample.' + id, L.sample);
    } catch (e) {
      console.warn('rating sample failed', e);
    } finally { L.sampleLoading = false; }
  };

  /* Is this contest rated for someone with rating r? */
  function ratedFor(name, r) {
    if (/unrated/i.test(name)) return false;
    const div = CF.contestDiv ? CF.contestDiv(name) : 'other';
    if (div === 'div4') return r < 1400;
    if (div === 'div3') return r < 1600;
    if (div === 'div2' || div === 'edu') return r < 2100;
    if (div === 'div1') return r >= 1900;
    return true;
  }

  /* { delta, perf, rank, n } or { unrated: true } or null when not enough data yet. */
  L.predict = function (st) {
    const s = L.sample;
    if (!L.contest || !L.rows || !s || s.contestId !== L.contest.id || !s.ratings.length) return null;
    const old = st.stats && st.stats.rating != null ? st.stats.rating : 1400;
    if (!ratedFor(L.contest.name || '', old)) return { unrated: true };
    let list, me;
    if (L.kind === 'virtual') { const g = ghostTable(st); if (!g) return null; list = g.list; me = g.me; }
    else {
      list = L.rows;
      const h = st.handle.toLowerCase();
      me = list.find(r => r.party.members.some(m => m.handle.toLowerCase() === h));
      if (!me) return null;
      if (me.party.participantType !== 'CONTESTANT') return { unrated: true };
    }
    // Rank among rated contestants; ties count as the worst place of the tie (like Codeforces).
    let rank = 1, n = 1;
    for (const r of list) {
      if (r === me || r.party.participantType !== 'CONTESTANT') continue;
      n++;
      if (r.points > me.points || (r.points === me.points && r.penalty <= me.penalty)) rank++;
    }
    const w = (n - 1) / s.ratings.length;
    const seed = R => { let x = 1; for (const rj of s.ratings) x += w / (1 + Math.pow(10, (R - rj) / 400)); return x; };
    const ratingForSeed = target => {
      let lo = -1000, hi = 6000;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (seed(mid) < target) hi = mid; else lo = mid; }
      return (lo + hi) / 2;
    };
    const need = ratingForSeed(Math.sqrt(seed(old) * rank));
    return { delta: Math.trunc((need - old) / 2) - 1, perf: Math.round(ratingForSeed(rank)), rank, n };
  };

  /* ---------- Virtual: your score and ghost standings ---------- */
  /* Seconds into the contest that the virtual standings are shown for. */
  function ghostT() {
    const d = L.contest.durationSeconds || 7200;
    return L.mode === 'virtual' ? Math.min(d, Math.max(0, Math.floor(now() - L.vstart))) : d;
  }
  const isIcpc = () => !!(L.contest && L.contest.type && L.contest.type !== 'CF');

  /* Your row, scored by the contest's rules from your virtual submissions up to time T. */
  function myGhostRow(T, st) {
    const icpc = isIcpc();
    const subs = L.mySubs.filter(s => s.relativeTimeSeconds <= T).sort((a, b) => a.relativeTimeSeconds - b.relativeTimeSeconds || a.id - b.id);
    let points = 0, penalty = 0;
    const problemResults = L.problems.map(p => {
      const ps = subs.filter(s => s.problem.index === p.index);
      const acIdx = ps.findIndex(s => s.verdict === 'OK');
      const before = acIdx >= 0 ? ps.slice(0, acIdx) : ps;
      // Compilation errors never count; on CF rounds neither does failing test 1.
      const wrong = before.filter(s => CF.isFinalVerdict(s.verdict) && s.verdict !== 'OK' && s.verdict !== 'COMPILATION_ERROR' &&
        !(!icpc && s.passedTestCount === 0)).length;
      if (acIdx < 0) return { points: 0, rejectedAttemptCount: wrong };
      const t = ps[acIdx].relativeTimeSeconds, m = Math.floor(t / 60);
      let pts = 1;
      if (icpc) penalty += m + 10 * wrong;
      else { const P = p.points || 500; pts = Math.max(Math.round(0.3 * P), Math.round(P - (P / 250) * m - 50 * wrong)); }
      points += pts;
      return { points: pts, rejectedAttemptCount: wrong, bestSubmissionTimeSeconds: t };
    });
    return { me: true, rank: null, points, penalty,
      party: { members: [{ handle: st.info ? st.info.handle : st.handle }], participantType: 'VIRTUAL' }, problemResults };
  }

  /* Official contestants frozen at time T, with you slotted in. Cached per second. */
  let ghostCache = { key: '', g: null };
  function ghostTable(st) {
    if (!L.rows || !L.problems.length) return null;
    const T = ghostT();
    const key = L.contest.id + ':' + T + ':' + L.rows.length + ':' + L.mySubs.map(s => s.id + s.verdict).join(',');
    if (ghostCache.key === key) return ghostCache.g;
    const icpc = isIcpc();
    const list = L.rows.map(r => {
      let points = 0, penalty = 0;
      const problemResults = r.problemResults.map(pr => {
        if (pr.points > 0 && pr.bestSubmissionTimeSeconds != null && pr.bestSubmissionTimeSeconds <= T) {
          points += pr.points;
          if (icpc) penalty += Math.floor(pr.bestSubmissionTimeSeconds / 60) + 10 * pr.rejectedAttemptCount;
          return pr;
        }
        return { points: 0, rejectedAttemptCount: 0 };
      });
      return { party: r.party, points, penalty, problemResults };
    });
    const me = myGhostRow(T, st);
    list.push(me);
    list.sort((a, b) => b.points - a.points || a.penalty - b.penalty || (a.me ? -1 : b.me ? 1 : 0));
    for (let i = 0; i < list.length; i++) {
      const p = list[i - 1];
      list[i].rank = p && p.points === list[i].points && p.penalty === list[i].penalty ? p.rank : i + 1;
    }
    ghostCache = { key, g: { list, me, T } };
    return ghostCache.g;
  }
  L.ghostTable = ghostTable;

  function viewRows(st) {
    if (L.kind === 'virtual') {
      const g = ghostTable(st);
      if (!g) return null;
      if (L.view === 'top') return g.list.slice(0, 10);
      if (L.view === 'friends') {
        const set = new Set(st.settings.rivals.map(h => h.toLowerCase()));
        return g.list.filter(r => r.me || r.party.members.some(m => set.has(m.handle.toLowerCase())));
      }
      const i = g.list.indexOf(g.me);
      return g.list.slice(Math.max(0, i - 5), i + 6);
    }
    if (L.rows) {
      if (L.view === 'top') return L.rows.slice(0, 10);
      if (L.view === 'friends') return friendRows(L.rows, st);
      const me = st.handle.toLowerCase();
      const i = L.rows.findIndex(row => row.party.members.some(m => m.handle.toLowerCase() === me));
      return i >= 0 ? L.rows.slice(Math.max(0, i - 5), i + 6) : [];
    }
    return L.summary ? L.summary[L.view] || [] : null;
  }

  /* ---------- Rendering ---------- */
  function problemState(p, i) {
    const res = L.myRow ? L.myRow.problemResults[i] : null;
    const subs = L.mySubs.filter(s => s.problem.index === p.index).sort((a, b) => b.id - a.id);
    const latest = subs[0];
    const ac = subs.find(s => s.verdict === 'OK');
    if (latest && (!latest.verdict || latest.verdict === 'TESTING')) return { cls: 'testing', icon: '⌛', line: 'TESTING...', sub: latest.passedTestCount ? 'PASSED ' + latest.passedTestCount + ' TESTS' : '', subs };
    if ((res && res.points > 0) || ac) {
      const t = res && res.bestSubmissionTimeSeconds != null ? res.bestSubmissionTimeSeconds : ac ? ac.relativeTimeSeconds : null;
      const pre = ac && ac.testset === 'PRETESTS' && L.contest.phase !== 'FINISHED';
      return { cls: pre ? 'pretest' : 'solved', icon: '✔', line: (t != null && t < 2147483647 ? CF.fmtRel(t) : 'AC') +
        (res && res.points > 1 ? ' · ' + res.points : ''), sub: (pre ? 'PRETESTS PASSED' : 'ACCEPTED') + (res && res.rejectedAttemptCount ? ' -' + res.rejectedAttemptCount : ''),
        wrong: res ? res.rejectedAttemptCount : 0, subs };
    }
    const wrongs = subs.filter(s => CF.isFinalVerdict(s.verdict) && s.verdict !== 'COMPILATION_ERROR').length;
    if (latest) return { cls: 'failed', icon: '✘', line: CF.verdictShort(latest.verdict) +
      (latest.passedTestCount != null && latest.verdict !== 'COMPILATION_ERROR' ? ' T' + (latest.passedTestCount + 1) : ''),
      sub: '-' + (res ? res.rejectedAttemptCount : wrongs), subs };
    return { cls: 'untried', icon: '·', line: '', subs };
  }

  function header(st) {
    const c = L.contest;
    const end = c.startTimeSeconds ? c.startTimeSeconds + c.durationSeconds : null;
    let phase = '', timer = '';
    if (L.mode === 'virtual') {
      phase = '<span class="phase virtual blink">● VIRTUAL</span>';
      timer = '<span class="countdown" data-countdown="' + (L.vstart + (c.durationSeconds || 0)) + '"></span><span class="small dim"> LEFT</span>' +
        '<div><button class="btn mini ghost" data-action="virtual-end">■ END VIRTUAL</button></div>';
    } else if (L.mode === 'live') {
      phase = '<span class="phase live blink">● LIVE</span>';
      timer = end ? '<span class="countdown" data-countdown="' + end + '"></span><span class="small dim"> LEFT</span>' : '';
    } else if (c.phase === 'PENDING_SYSTEM_TEST' || c.phase === 'SYSTEM_TEST') {
      phase = '<span class="phase testing blink">SYSTEM TESTING</span>';
    } else if (L.kind === 'virtual') {
      phase = '<span class="phase">LAST VIRTUAL</span>';
      timer = '<span class="small dim">PLAYED ' + CF.timeAgo(L.vstart).toUpperCase() + '</span>';
    } else {
      phase = '<span class="phase">LAST BATTLE</span>';
      timer = end ? '<span class="small dim">ENDED ' + CF.timeAgo(end).toUpperCase() + '</span>' : '';
    }
    const row = L.myRow;
    const solvedN = row ? row.problemResults.filter(r => r.points > 0).length : 0;
    const rc = L.ratingChange;
    const d = rc ? rc.newRating - rc.oldRating : null;
    return '<div class="live-head">' +
      '<div class="lh-left">' + phase + '<div class="lh-name">' + esc(c.name || 'Contest ' + c.id) + '</div></div>' +
      '<div class="lh-stats">' +
        stat(L.kind === 'virtual' ? 'GHOST RANK' : 'RANK', row && row.rank ? '#' + CF.fmtNum(row.rank) : L.kind === 'virtual' ? '...' : '-') +
        stat('SOLVED', solvedN + '/' + (L.problems.length || '-')) +
        stat(row && row.penalty ? 'PENALTY' : 'POINTS', row ? (row.penalty || Math.round(row.points)) : '-') +
        (rc ? stat('RATING', '<span class="' + (d >= 0 ? 'good' : 'danger') + '">' + (d >= 0 ? '+' : '') + d + '</span>') : predictStat(st)) +
      '</div>' +
      '<div class="lh-timer">' + timer + '</div>' +
    '</div>';
  }
  function predictStat(st) {
    if (!(L.mode === 'live' || L.kind === 'virtual')) return '';
    const p = L.predict(st);
    const label = L.kind === 'virtual' ? 'IF RATED' : 'PREDICTED';
    if (!p) return stat(label, '<span class="dim">' + (L.sampleLoading ? '...' : '-') + '</span>');
    if (p.unrated) return stat(label, '<span class="dim small">UNRATED</span>');
    return stat(label, '<span class="' + (p.delta >= 0 ? 'good' : 'danger') + '">≈' + (p.delta >= 0 ? '+' : '') + p.delta + '</span>' +
      '<div class="tiny dim">PERF ' + p.perf + '</div>');
  }
  function stat(label, v) { return '<div class="lstat"><div class="small dim">' + label + '</div><div class="lval">' + v + '</div></div>'; }

  function problemsTab() {
    if (!L.problems.length) return '<div class="center pad dim' + (L.standingsError ? ' danger">' + esc(L.standingsError) : ' blink">LOADING PROBLEMS...') + '</div>';
    const tiles = L.problems.map((p, i) => {
      const s = problemState(p, i);
      const url = CF.problemUrl(p);
      return '<a class="ptile ' + s.cls + '"' + (url ? ' href="' + url + '" target="_blank" rel="noopener"' : '') + '>' +
        '<div class="pt-idx">' + esc(p.index) + '</div>' +
        '<div class="pt-icon">' + s.icon + '</div>' +
        '<div class="pt-line">' + esc(s.line) + '</div>' +
        '<div class="pt-sub">' + esc(s.sub || '') + '</div>' +
        '<div class="pt-name">' + esc(p.name) + '</div>' +
        (p.rating && !L.inGame() ? CF.boards.ratingTag(p.rating) : '') +
      '</a>';
    }).join('');
    const feed = L.mySubs.slice().sort((a, b) => b.id - a.id).slice(0, 6).map(s =>
      '<li><span class="v ' + CF.verdictClass(s.verdict) + '">' + CF.verdictShort(s.verdict) + '</span>' +
      '<b>' + esc(s.problem.index) + '</b><span class="grow">' + esc(CF.verdictLabel(s)) + '</span>' +
      '<span class="small dim">' + (s.relativeTimeSeconds < 2147483647 ? CF.fmtRel(s.relativeTimeSeconds) : '') + '</span>' +
      '<span class="small dim">' + (s.timeConsumedMillis != null ? s.timeConsumedMillis + 'ms' : '') + '</span></li>').join('');
    return '<div class="ptiles n' + Math.min(L.problems.length, 10) + '">' + tiles + '</div>' +
      '<div class="panel live-feed"><div class="panel-title">▶ YOUR SUBMISSIONS</div><div class="panel-body"><ul class="list">' +
      (feed || '<li class="dim">NO SUBMISSIONS YET. GOOD LUCK!</li>') + '</ul></div></div>';
  }

  function standingsTab(st) {
    const views = [['around', 'AROUND ME'], ['top', 'TOP 10'], ['friends', 'FRIENDS']];
    const sw = '<div class="seg">' + views.map(([v, l]) =>
      '<button class="' + (L.view === v ? 'on' : '') + '" data-action="live-view" data-view="' + v + '">' + l + '</button>').join('') + '</div>';
    if (L.view === 'friends' && !st.settings.rivals.length)
      return sw + '<div class="center pad dim">ADD RIVALS IN ⚙ SETTINGS TO SEE FRIENDS HERE</div>';
    const list = viewRows(st);
    if (!list) return sw + (L.standingsError ? '<div class="center pad danger">' + esc(L.standingsError) + '</div>'
      : '<div class="center pad dim blink">DOWNLOADING STANDINGS...</div>');
    if (!list.length) return sw + '<div class="center pad dim">' +
      (L.view === 'around' ? 'YOU’RE NOT IN THE OFFICIAL STANDINGS' : 'NO MATCHING ROWS') + '</div>';
    const me = st.handle.toLowerCase();
    const age = L.kind === 'virtual'
      ? '<div class="small dim center">GHOSTS AT ' + CF.fmtRel(ghostT()) + ' · OFFICIAL CONTESTANTS AT THE SAME MOMENT</div>'
      : L.rowAt ? '<div class="small dim center">STANDINGS UPDATED ' + CF.timeAgo(L.rowAt).toUpperCase() +
      (L.mode === 'live' ? ' · REFRESHES EVERY 2 MIN' : '') + '</div>' : '';
    const rows = list.map(r => {
      const isMe = L.kind === 'virtual' ? !!r.me : r.party.members.some(m => m.handle.toLowerCase() === me);
      const name = r.party.teamName || r.party.members.map(m => m.handle).join(', ');
      return '<tr class="' + (isMe ? 'me' : '') + '"><td>' + r.rank + '</td><td class="sh">' + esc(name) +
        (r.me ? ' <span class="you">YOU</span>' : r.party.participantType !== 'CONTESTANT' ? ' <span class="dim">*</span>' : '') + '</td>' +
        '<td><b>' + Math.round(r.points) + '</b></td><td class="dim">' + (r.penalty || '') + '</td>' +
        r.problemResults.map(pr => {
          if (pr.points > 0) return '<td class="good">' + (pr.rejectedAttemptCount ? '+' + pr.rejectedAttemptCount : '+') +
            '<br><span class="tiny">' + (pr.bestSubmissionTimeSeconds != null ? CF.fmtRel(pr.bestSubmissionTimeSeconds) : '') + '</span></td>';
          if (pr.rejectedAttemptCount) return '<td class="danger">-' + pr.rejectedAttemptCount + '</td>';
          return '<td class="dim">·</td>';
        }).join('') + '</tr>';
    }).join('');
    return sw + '<div class="stable-wrap"><table class="stable"><thead><tr><th>#</th><th>WHO</th><th>PTS</th><th>PEN</th>' +
      L.problems.map(p => '<th>' + esc(p.index) + '</th>').join('') + '</tr></thead><tbody>' +
      rows + '</tbody></table></div>' + age;
  }

  L.predictStat = predictStat;
  CF.boards.live = function (el, st) {
    if (!L.contest && !st.ready) { el.innerHTML = '<div class="center pad blink">SCANNING FOR CONTESTS...</div>'; return; }
    if (!L.contest) {
      const nc = (st.upcoming || [])[0];
      el.innerHTML = CF.boards.panel('⚔ LIVE CONTEST', '<div class="center pad">' +
        '<div class="big">NO BATTLES YET</div><p class="dim">Join a contest and this board lights up with your verdicts in real time.</p>' +
        '<p><button class="btn" data-action="virtual-open">⚔ START A VIRTUAL CONTEST</button></p>' +
        (nc ? '<div class="small dim">NEXT: ' + esc(nc.name) + '</div><div class="countdown" data-countdown="' + nc.startTimeSeconds + '"></div>' : '') +
        '</div>', 'full');
      return;
    }
    const elsewhere = L.liveElsewhere ?
      '<div class="elsewhere blink-soft">● LIVE NOW: ' + esc(L.liveElsewhere.name) + ' · <span data-countdown="' +
      (L.liveElsewhere.startTimeSeconds + L.liveElsewhere.durationSeconds) + '"></span> LEFT</div>' : '';
    if (L.kind === 'virtual') {
      const g = ghostTable(st);
      L.myRow = g ? g.me : myGhostRow(ghostT(), st);
    }
    el.innerHTML = '<div class="live ' + L.mode + '">' + elsewhere + header(st) +
      '<div class="tabs"><button class="' + (L.tab === 'problems' ? 'on' : '') + '" data-action="live-tab" data-tab="problems">⚔ PROBLEMS</button>' +
      '<button class="' + (L.tab === 'standings' ? 'on' : '') + '" data-action="live-tab" data-tab="standings">≡ ' + (L.kind === 'virtual' ? 'GHOST ' : '') + 'STANDINGS</button>' +
      (L.inGame() ? '' : '<button class="tab-virtual" data-action="virtual-open">+ VIRTUAL</button>') + '</div>' +
      '<div class="live-body">' + (L.tab === 'problems' ? problemsTab() : standingsTab(st)) + '</div></div>';
  };
})();
