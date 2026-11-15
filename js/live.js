/* Live contest board.
   - Finds the contest you're in right now (or your most recent one).
   - While live, polls your submissions every 20s and your standings row every 60s.
   - Has a Problems tab and a Standings tab (around me / top 10 / friends). */
(function () {
  const esc = CF.esc;
  const L = CF.live = {
    contest: null, mode: 'none', problems: [], myRow: null, mySubs: [], ratingChange: null,
    tab: 'problems', view: 'around', standings: null, standingsAt: 0, loading: false,
    lastLoad: 0, lastProbe: 0, liveElsewhere: null,
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
    L.liveElsewhere = !pick && running.length ? running[0] : null;

    if (!pick) {
      // Most recent contest you competed in: rating history or contest submissions.
      let bestId = null, bestT = 0;
      const last = st.stats && st.stats.lastContest;
      if (last) { bestId = last.contestId; bestT = last.ratingUpdateTimeSeconds; }
      for (const s of subs) if (isContestant(s) && s.creationTimeSeconds > bestT) { bestT = s.creationTimeSeconds; bestId = s.contestId; }
      if (bestId) {
        pick = all.find(c => c.id === bestId) || { id: bestId, name: last ? last.contestName : 'Contest ' + bestId };
        mode = 'recent';
      }
    }
    const changed = !L.contest || !pick || L.contest.id !== pick.id || L.mode !== mode;
    L.mode = mode;
    if (!pick) { L.contest = null; return changed; }
    if (changed) {
      L.contest = pick; L.problems = []; L.myRow = null; L.mySubs = []; L.ratingChange = null;
      L.rows = null; L.summary = null; L.rowAt = 0; L.lastLoad = 0;
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
    L.ratingChange = (st.history || []).find(h => h.contestId === pick.id) || null;
    return changed;
  };

  /* Interval the app should use for polling this board. */
  L.pollSeconds = function () {
    if (L.mode === 'live') return 20;
    if (L.contest && L.contest.phase && !FINISHED_PHASES.includes(L.contest.phase)) return 60;
    return 600;
  };

  L.refresh = async function (st, force) {
    if (!L.contest || L.loading) return;
    if (!force && now() - L.lastLoad < L.pollSeconds() - 1) return;
    L.loading = true;
    const id = L.contest.id, live = L.mode === 'live';
    try {
      const subs = await CF.api.call('contest.status', { contestId: id, handle: st.handle, from: 1, count: 200 }, { priority: live });
      if (!L.contest || L.contest.id !== id) return;
      L.mySubs = subs.filter(isContestant);
      if (CF.app) CF.app.noticeSubs(L.mySubs, { live, contestId: id });

      // Codeforces only serves the FULL standings (several MB), so download them
      // rarely: once per contest, or every 2 minutes while you watch a live contest.
      const finished = L.contest.phase === 'FINISHED';
      const age = now() - (L.rowAt || 0);
      const need = !L.problems.length ||
        (L.boardActive && ((live && age > 120) || (!finished && age > 300) || (finished && L.summary && !L.summary.final)));
      if (need) await L.loadStandings(st);
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
      L.rows = L.mode === 'live' ? rows : null;   // keep the big list in memory only while live
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
  function viewRows(st) {
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
    if (latest && (!latest.verdict || latest.verdict === 'TESTING')) return { cls: 'testing', icon: '⌛', line: 'TESTING...', subs };
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

  function header() {
    const c = L.contest;
    const end = c.startTimeSeconds ? c.startTimeSeconds + c.durationSeconds : null;
    let phase = '', timer = '';
    if (L.mode === 'live') {
      phase = '<span class="phase live blink">● LIVE</span>';
      timer = end ? '<span class="countdown" data-countdown="' + end + '"></span><span class="small dim"> LEFT</span>' : '';
    } else if (c.phase === 'PENDING_SYSTEM_TEST' || c.phase === 'SYSTEM_TEST') {
      phase = '<span class="phase testing blink">SYSTEM TESTING</span>';
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
        stat('RANK', row ? '#' + CF.fmtNum(row.rank) : '-') +
        stat('SOLVED', solvedN + '/' + (L.problems.length || '-')) +
        stat(row && row.penalty ? 'PENALTY' : 'POINTS', row ? (row.penalty || Math.round(row.points)) : '-') +
        (rc ? stat('RATING', '<span class="' + (d >= 0 ? 'good' : 'danger') + '">' + (d >= 0 ? '+' : '') + d + '</span>') : '') +
      '</div>' +
      '<div class="lh-timer">' + timer + '</div>' +
    '</div>';
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
        (p.rating && L.mode !== 'live' ? CF.boards.ratingTag(p.rating) : '') +
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
    const age = L.rowAt ? '<div class="small dim center">STANDINGS UPDATED ' + CF.timeAgo(L.rowAt).toUpperCase() +
      (L.mode === 'live' ? ' · REFRESHES EVERY 2 MIN' : '') + '</div>' : '';
    const rows = list.map(r => {
      const isMe = r.party.members.some(m => m.handle.toLowerCase() === me);
      const name = r.party.teamName || r.party.members.map(m => m.handle).join(', ');
      return '<tr class="' + (isMe ? 'me' : '') + '"><td>' + r.rank + '</td><td class="sh">' + esc(name) +
        (r.party.participantType !== 'CONTESTANT' ? ' <span class="dim">*</span>' : '') + '</td>' +
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

  CF.boards.live = function (el, st) {
    if (!L.contest && !st.ready) { el.innerHTML = '<div class="center pad blink">SCANNING FOR CONTESTS...</div>'; return; }
    if (!L.contest) {
      const nc = (st.upcoming || [])[0];
      el.innerHTML = CF.boards.panel('⚔ LIVE CONTEST', '<div class="center pad">' +
        '<div class="big">NO BATTLES YET</div><p class="dim">Join a contest and this board lights up with your verdicts in real time.</p>' +
        (nc ? '<div class="small dim">NEXT: ' + esc(nc.name) + '</div><div class="countdown" data-countdown="' + nc.startTimeSeconds + '"></div>' : '') +
        '</div>', 'full');
      return;
    }
    const elsewhere = L.liveElsewhere ?
      '<div class="elsewhere blink-soft">● LIVE NOW: ' + esc(L.liveElsewhere.name) + ' · <span data-countdown="' +
      (L.liveElsewhere.startTimeSeconds + L.liveElsewhere.durationSeconds) + '"></span> LEFT</div>' : '';
    el.innerHTML = '<div class="live ' + L.mode + '">' + elsewhere + header() +
      '<div class="tabs"><button class="' + (L.tab === 'problems' ? 'on' : '') + '" data-action="live-tab" data-tab="problems">⚔ PROBLEMS</button>' +
      '<button class="' + (L.tab === 'standings' ? 'on' : '') + '" data-action="live-tab" data-tab="standings">≡ STANDINGS</button></div>' +
      '<div class="live-body">' + (L.tab === 'problems' ? problemsTab() : standingsTab(st)) + '</div></div>';
  };
})();
