/* App controller: loads data, schedules refreshes, switches boards,
   fires game effects and runs the settings and night-mode screens. */
(function () {
  const BOARDS = [
    { id: 'overview', title: 'OVERVIEW', icon: '⌂' },
    { id: 'live', title: 'LIVE CONTEST', icon: '⚔' },
    { id: 'calendar', title: 'CONTEST CALENDAR', icon: '▦' },
    { id: 'practice', title: 'PRACTICE', icon: '⚒' },
    { id: 'teammates', title: 'TEAMMATES', icon: '☺' },
    { id: 'goals', title: 'GOALS & QUESTS', icon: '◎' },
    { id: 'boss', title: 'WEEKLY BOSS', icon: '☠' },
    { id: 'stopwatch', title: 'STOPWATCH', icon: '⏱' },
  ];

  const st = {
    handle: null, settings: null, profile: null, info: null, subs: null, history: null,
    stats: null, contestsAll: [], upcoming: [], quests: [], error: null,
    ready: false, lastUpdate: 0, board: 0,
  };
  CF.state = st;
  const known = new Map();   // submission id -> verdict (to detect new verdicts)
  let combo = 0;
  const due = { full: 0, quick: 0, live: 0, team: 0, detect: 0 };
  const $ = s => document.querySelector(s);

  CF.app = {};

  /* ---------------- Boot ---------------- */
  function init() {
    st.settings = CF.loadSettings();
    const urlHandle = new URLSearchParams(location.search).get('handle');
    if (urlHandle) {
      st.settings.handle = urlHandle.trim();
      if (!st.settings.savedHandles.some(h => h.toLowerCase() === urlHandle.toLowerCase())) st.settings.savedHandles.push(urlHandle.trim());
      CF.saveSettings(st.settings);
    }
    st.handle = st.settings.handle || CF.DEFAULT_HANDLE;
    st.profile = CF.loadProfile(st.handle);
    // Remembered by name, so adding or removing boards doesn't move you to a different one.
    let saved = CF.store.get('board', 0);
    if (saved === 'rivals') saved = 'teammates';
    st.board = typeof saved === 'string' ? Math.max(0, BOARDS.findIndex(b => b.id === saved)) : Math.min(BOARDS.length - 1, saved);
    CF.sound.enabled = st.settings.sound;
    document.body.classList.toggle('crt', st.settings.crt);

    CF.radio.station = st.settings.radio.station;
    CF.radio.volume = st.settings.radio.volume;
    CF.radio.onchange = () => { renderRadio(); renderHud(); };
    buildShell();
    renderBoard('stopwatch');
    $('#radio-panel').addEventListener('input', e => {
      if (e.target.id !== 'radio-vol') return;
      CF.radio.setVolume(Number(e.target.value) / 100);
      st.settings.radio.volume = CF.radio.volume; CF.saveSettings(st.settings);
    });
    $('#start-handle').textContent = st.handle;
    loadFromCache();
    CF.team.loadCache(st);
    goTo(st.board, true);

    $('#start-screen').addEventListener('click', start, { once: true });
    setInterval(tick, 1000);
    setInterval(scheduler, 2000);
    fastLoop();
    addEventListener('resize', debounce(() => { if (st.stats) renderAll(); }, 250));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { requestWakeLock(); due.quick = 0; } });
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  function start() {
    CF.sound.unlock();
    CF.sound.start();
    $('#start-screen').classList.add('out');
    setTimeout(() => $('#start-screen').remove(), 600);
    goFullscreen();
    requestWakeLock();
    if (st.settings.radio.on) setTimeout(() => CF.radio.play(), 1200);
    scheduler();
  }

  function goFullscreen() {
    const d = document.documentElement;
    if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
  let wakeLock = null;
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !document.hidden) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
  }

  /* ---------------- Shell ---------------- */
  function buildShell() {
    const track = $('#track');
    track.innerHTML = BOARDS.map(b => '<section class="board" id="board-' + b.id + '"><div class="center pad blink">LOADING...</div></section>').join('');
    $('#dots').innerHTML = BOARDS.map((b, i) => '<button class="dot" data-action="goto" data-i="' + i + '" aria-label="' + b.title + '"><span>' + b.icon + '</span></button>').join('');

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', e => {
      if ($('#settings').classList.contains('open')) { if (e.key === 'Escape') closeSettings(); return; }
      if ($('#vmodal').classList.contains('open')) {
        if (e.key === 'Escape') closeVirtual();
        if (e.key === 'Enter') startVirtual();
        return;
      }
      if (e.key === 'Escape') toggleRadioPanel(false);
      if ((BOARDS[st.board].id === 'stopwatch' || CF.stopwatch.focusOpen()) && CF.stopwatch.keydown(e)) return;
      if (document.getElementById('card').classList.contains('open')) return;
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') goTo(st.board + 1);
      if (e.key === 'ArrowLeft') goTo(st.board - 1);
    });
    // Swipe
    const vp = $('#viewport');
    let sx = 0, sy = 0, t0 = 0, tracking = false;
    vp.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now(); tracking = true;
    }, { passive: true });
    vp.addEventListener('touchend', e => {
      if (!tracking) return; tracking = false;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t0 < 800) goTo(st.board + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  function onClick(e) {
    const panel = $('#radio-panel');
    if (panel.classList.contains('open') && !e.target.closest('#radio-panel, [data-action="radio"]')) toggleRadioPanel(false);
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    CF.sound.click();
    if (a.startsWith('sw-') && CF.stopwatch.handleAction(a, t)) return;
    if (CF.extras.handleAction(a, t)) return;
    if (CF.team.handleAction(a, t, st)) return;
    if (a === 'goto') goTo(Number(t.dataset.i));
    else if (a === 'prev') goTo(st.board - 1);
    else if (a === 'next') goTo(st.board + 1);
    else if (a === 'settings') { openSettings(); setTab('form'); }
    else if (a === 'close-settings') closeSettings();
    else if (a === 'set-tab') setTab(t.dataset.tab);
    else if (a === 'save-settings') saveSettingsForm();
    else if (a === 'sound') { st.settings.sound = CF.sound.enabled = !CF.sound.enabled; CF.saveSettings(st.settings); renderHud(); }
    else if (a === 'night') toggleNight(true);
    else if (a === 'wake') toggleNight(false);
    else if (a === 'fullscreen') { document.fullscreenElement ? document.exitFullscreen() : goFullscreen(); }
    else if (a === 'switch-handle') switchHandle(t.dataset.handle);
    else if (a === 'remove-handle') {
      e.stopPropagation();
      st.settings.savedHandles = st.settings.savedHandles.filter(h => h !== t.dataset.handle);
      CF.saveSettings(st.settings); openSettings();
    }
    else if (a === 'live-tab') {
      CF.live.tab = t.dataset.tab; renderBoard('live');
      if (CF.live.tab === 'standings' && !CF.live.summary && !CF.live.rows) CF.live.loadStandings(st).then(() => renderBoard('live'));
    }
    else if (a === 'live-view') { CF.live.view = t.dataset.view; renderBoard('live'); }
    else if (a === 'goto-live') goTo(1);
    else if (a === 'virtual-open') openVirtual();
    else if (a === 'close-virtual') closeVirtual();
    else if (a === 'virtual-pick') { $('#v-contest').value = t.dataset.id; }
    else if (a === 'virtual-start') startVirtual();
    else if (a === 'virtual-end') {
      if (confirm('End this virtual contest now? Your result so far is kept.')) { CF.live.endVirtual(); detectLive(); }
    }
    else if (a === 'radio') toggleRadioPanel();
    else if (a === 'radio-play') { CF.radio.toggle(); saveRadio(); }
    else if (a === 'radio-skip') CF.radio.skip();
    else if (a === 'radio-station') { CF.radio.setStation(Number(t.dataset.i)); saveRadio(); }
  }

  function goTo(i, instant) {
    i = (i + BOARDS.length) % BOARDS.length;
    st.board = i;
    CF.store.set('board', BOARDS[i].id);
    const track = $('#track');
    track.style.transition = instant ? 'none' : '';
    track.style.transform = 'translateX(' + (-i * 100) + '%)';
    document.querySelectorAll('.dot').forEach((d, k) => d.classList.toggle('on', k === i));
    $('#hud-title').innerHTML = '<span class="hud-icon">' + BOARDS[i].icon + '</span> ' + BOARDS[i].title;
    document.querySelectorAll('.board').forEach((b, k) => b.classList.toggle('active', k === i));
    CF.live.boardActive = BOARDS[i].id === 'live';
    if (CF.live.boardActive) { due.live = 0; renderBoard('live'); }
    if (BOARDS[i].id === 'teammates' && st.ready) CF.team.tick(st);
  }

  /* ---------------- Data ---------------- */
  function loadFromCache() {
    const h = st.handle;
    const info = CF.api.cached('user.info', { handles: h });
    const subs = CF.api.cached('user.status', { handle: h });
    const hist = CF.api.cached('user.rating', { handle: h });
    const cl = CF.api.cached('contest.list', { gym: false });
    if (cl) setContests(cl);
    if (info && subs) {
      st.info = info[0]; st.subs = subs; st.history = hist || [];
      for (const s of subs) known.set(s.id, s.verdict);
      recompute(true);
    }
  }

  function setContests(list) {
    st.contestsAll = list;
    const t = Date.now() / 1000;
    st.upcoming = list.filter(c => c.phase === 'BEFORE' && c.startTimeSeconds > t)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  }

  async function fullRefresh() {
    const h = st.handle;
    try {
      const [info] = await CF.api.call('user.info', { handles: h }, { cache: true });
      if (h !== st.handle) return;
      const subs = await CF.api.call('user.status', { handle: h }, { cache: true });
      const hist = await CF.api.call('user.rating', { handle: h }, { cache: true }).catch(() => []);
      if (h !== st.handle) return;
      const firstLoad = !st.subs;
      st.info = info; st.history = hist;
      st.subs = subs;
      if (firstLoad) for (const s of subs) known.set(s.id, s.verdict);
      else noticeSubs(subs.slice(0, 15), { live: false });
      st.error = null;
      st.lastUpdate = Date.now();
      recompute(firstLoad && !st.ready);
      st.ready = true;
      setTimeout(() => CF.extras.checkMorning(st), 2500);
    } catch (e) {
      st.error = e.message;
      if (!st.stats) showError(e.message);
      renderHud();
    }
    try {
      setContests(await CF.api.call('contest.list', { gym: false }, { cache: true }));
      renderBoard('overview');
    } catch (e) { /* keep cached list */ }
    await detectLive();
  }

  async function quickCheck() {
    if (!st.subs) return;
    const h = st.handle;
    try {
      const recent = await CF.api.call('user.status', { handle: h, from: 1, count: 15 });
      if (h !== st.handle) return;
      const byId = new Map(st.subs.map(s => [s.id, s]));
      let changed = false;
      for (const s of recent) {
        const old = byId.get(s.id);
        if (!old || old.verdict !== s.verdict) { byId.set(s.id, s); changed = true; }
      }
      noticeSubs(recent, { live: CF.live.inGame() });
      if (changed) {
        st.subs = [...byId.values()].sort((a, b) => b.creationTimeSeconds - a.creationTimeSeconds);
        recompute(false);
        const runningIds = new Set(st.contestsAll.filter(c => c.phase === 'CODING').map(c => c.id));
        if (CF.live.mode !== 'live' && recent.some(x => runningIds.has(x.contestId))) await detectLive();
        else if (!CF.live.inGame() && recent.some(x => CF.live.isVirtual(x) && x.creationTimeSeconds > Date.now() / 1000 - 6 * 3600)) await detectLive();
      }
      st.lastUpdate = Date.now();
      renderHud();
    } catch (e) { renderHud(); }
  }

  async function detectLive() {
    const wasMode = CF.live.mode, wasContest = CF.live.contest;
    const changed = await CF.live.detect(st);
    if (CF.live.mode === 'live' && wasMode !== 'live') {
      CF.sound.levelUp();
      CF.fx.toast('<span class="toast-icon">⚔</span><div><b>CONTEST LIVE!</b><br>' + CF.esc(CF.live.contest.name) +
        '<br><button class="btn mini" data-action="goto-live">OPEN LIVE BOARD</button></div>', '#ff4d4d');
    }
    if (CF.live.mode === 'virtual' && wasMode !== 'virtual') {
      CF.sound.levelUp();
      CF.fx.toast('<span class="toast-icon">⚔</span><div><b>VIRTUAL CONTEST STARTED</b><br>' + CF.esc(CF.live.contest.name) +
        '<br><button class="btn mini" data-action="goto-live">OPEN LIVE BOARD</button></div>', '#ffd23f');
    }
    if (wasMode === 'virtual' && CF.live.mode !== 'virtual' && wasContest) {
      CF.sound.achievement();
      CF.fx.toast('<span class="toast-icon">⚑</span><div><b>VIRTUAL OVER</b><br>' + CF.esc(wasContest.name) +
        '<br>See your ghost rank on the Live board.</div>', '#ffd23f');
    }
    document.querySelectorAll('.dot')[1].classList.toggle('alert', CF.live.inGame());
    if (changed || !CF.live.lastLoad) { await CF.live.refresh(st, true); }
    renderBoard('live');
  }

  async function scheduler() {
    if (CF.scheduling) return;
    CF.scheduling = true;
    const t = Date.now();
    try {
      if (t >= due.full) { due.full = t + st.settings.refreshMin * 60000; due.quick = t + 60000; due.detect = t + 60000; await fullRefresh(); }
      if (t >= due.quick) {
        // Faster while a contest is running or one of your submissions is still being judged.
        const now = t / 1000;
        const running = st.contestsAll.some(c => c.phase === 'CODING' ||
          (c.startTimeSeconds <= now && c.startTimeSeconds + c.durationSeconds > now));
        due.quick = t + (running || CF.live.inGame() ? 8000 : 60000);
        await quickCheck();
        if (st.subs && st.subs.slice(0, 5).some(x => !x.verdict || x.verdict === 'TESTING')) due.quick = Date.now() + 3000;
      }
      if (t >= due.detect) { due.detect = t + 60000; await detectLive(); }
      if (t >= due.live) {
        due.live = t + CF.live.pollSeconds() * 1000;
        await CF.live.refresh(st);
        renderBoard('live');
      }
      // Runs in the background: a first full team download takes a while and must not hold up your own verdicts.
      if (t >= due.team && st.ready) { due.team = t + 60000; CF.team.tick(st); }
    } finally { CF.scheduling = false; }
  }

  /* Verdict loop for live contests. Runs on its own so the big
     5-minute refresh or a standings download can never delay a verdict. */
  let fastTimer = null;
  function kickFast() { clearTimeout(fastTimer); fastLoop(); }   // check right now
  async function fastLoop() {
    clearTimeout(fastTimer);
    let delay = CF.live.fastDelay();
    try {
      if (delay && st.ready && !document.hidden) {
        const changed = await CF.live.pollVerdicts(st);
        if (changed) renderBoard('live');
        delay = CF.live.fastDelay();
      }
    } finally {
      fastTimer = setTimeout(fastLoop, delay || 3000);
    }
  }

  /* ---------------- Effects ---------------- */
  CF.app.noticeSubs = noticeSubs;
  CF.app.renderBoard = renderBoard;
  CF.app.goToBoard = id => goTo(BOARDS.findIndex(b => b.id === id));
  CF.app.currentBoard = () => BOARDS[st.board].id;
  function noticeSubs(subs, ctx) {
    const fresh = [];
    for (const s of subs) {
      const prev = known.get(s.id);
      known.set(s.id, s.verdict);
      if (!st.ready) continue;
      if (CF.isFinalVerdict(s.verdict) && (prev === undefined || !CF.isFinalVerdict(prev))) fresh.push(s);
      else if (prev === undefined && !CF.isFinalVerdict(s.verdict) && !ctx.fromFast) {
        if (ctx.live || CF.live.inGame()) setTimeout(kickFast, 0);
        CF.fx.toast('<span class="toast-icon">⌛</span><div><b>SUBMITTED ' + CF.esc(s.problem.index) + '</b><br>Testing...</div>');
      }
    }
    // After being offline, only celebrate the newest few.
    fresh.sort((a, b) => a.id - b.id).slice(-3).forEach(s => {
      const label = (ctx.live ? 'PROBLEM ' : (s.problem.contestId || '')) + s.problem.index + (ctx.live ? '' : ' · ' + s.problem.name);
      if (s.verdict === 'OK') {
        CF.stopwatch.onAccepted(s);
        const firstSolve = !st.stats || !st.stats.solvedMap.has(CF.problemKey(s.problem));
        CF.fx.accepted(label, ctx.live ? CF.verdictLabel(s).toUpperCase() : firstSolve ? '+' + (s.problem.rating || 500) + ' XP' : 'ACCEPTED AGAIN');
        if (ctx.live) { combo++; if (combo >= 2) CF.fx.combo(combo); }
      } else {
        if (ctx.live) combo = 0;
        CF.fx.rejected(label, CF.verdictLabel(s), s.verdict);
      }
    });
  }

  function recompute(silent) {
    const prev = st.stats;
    st.stats = CF.computeStats(st.info, st.subs, st.history);
    st.quests = CF.dailyQuests(st.handle, st.stats);
    applyTheme();
    checkProgress(prev, silent);
    CF.extras.boss.check(st, silent);
    renderAll();
  }

  function checkProgress(prev, silent) {
    const s = st.stats, p = st.profile;
    // New rating change from a contest
    const lc = s.lastContest;
    if (lc && !p.seenRatingChanges.includes(lc.contestId)) {
      p.seenRatingChanges = p.seenRatingChanges.concat(lc.contestId).slice(-50);
      if (!silent && Date.now() / 1000 - lc.ratingUpdateTimeSeconds < 3 * 86400)
        CF.fx.ratingChange(lc.newRating - lc.oldRating, lc.contestName);
    }
    // Rank up
    const ri = CF.rankIndex(s.rating);
    if (p.lastRankIdx != null && ri > p.lastRankIdx && !silent) CF.fx.rankUp(CF.rankFor(s.rating));
    p.lastRankIdx = ri;
    // Level up
    if (p.lastLevel != null && s.level.level > p.lastLevel && !silent) CF.fx.levelUp(s.level.level);
    p.lastLevel = s.level.level;
    // Achievements
    const unlocked = s.achievements.filter(a => a.unlocked).map(a => a.id);
    if (p.seenAch == null) p.seenAch = unlocked;
    else {
      const fresh = s.achievements.filter(a => a.unlocked && !p.seenAch.includes(a.id));
      fresh.slice(0, 4).forEach((a, i) => setTimeout(() => CF.fx.achievement(a), 3000 + i * 1800));
      p.seenAch = unlocked;
    }
    // Quests and coins
    const today = CF.todayKey();
    const done = p.quests[today] || [];
    for (const q of st.quests) {
      if (q.done && !done.includes(q.id)) {
        done.push(q.id);
        p.coins += q.reward;
        if (!silent || prev) setTimeout(() => {
          CF.sound.coin();
          CF.fx.toast('<span class="toast-icon coin">●</span><div><b>QUEST COMPLETE +' + q.reward + '</b><br>' + CF.esc(q.title) + '</div>', '#ffd23f');
        }, 2600);
      }
    }
    p.quests = { [today]: done };
    CF.saveProfile(st.handle, p);
  }

  function applyTheme() {
    const color = CF.rankFor(st.stats ? st.stats.rating : null).color;
    document.documentElement.style.setProperty('--rank', color);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = '#0b0b14';
  }

  /* ---------------- Rendering ---------------- */
  function renderBoard(id) {
    if (id === setTabId) return renderSetTab();   // a page shown as a settings tab
    const el = document.getElementById('board-' + id);
    if (!el || (!st.stats && id !== 'stopwatch')) return;
    const scroll = el.scrollTop;
    try { CF.boards[id](el, st); } catch (e) {
      console.error(id, e);
      el.innerHTML = '<div class="center pad danger">BOARD CRASHED: ' + CF.esc(e.message) + '</div>';
    }
    el.scrollTop = scroll;
    fitLists(el);
    tick();
  }
  /* Drop whole rows from lists that don't fit, so nothing is cut in half and nothing scrolls. */
  function fitLists(root) {
    root.querySelectorAll('.list, .clist, .quests, .board-list').forEach(list => {
      const box = list.closest('.panel-body, .live-body');
      if (!box) return;
      while (list.children.length > 1 && box.scrollHeight > box.clientHeight + 1) list.lastElementChild.remove();
    });
  }
  function renderAll() {
    BOARDS.forEach(b => renderBoard(b.id));
    renderSetTab();
    renderHud();
  }
  function showError(msg) {
    const nice = /not found/i.test(msg) ? 'HANDLE "' + st.handle + '" NOT FOUND' : msg.toUpperCase();
    document.querySelectorAll('.board:not(#board-stopwatch)').forEach(b => {
      b.innerHTML = '<div class="center pad"><div class="big danger">GAME OVER</div><p>' + CF.esc(nice) +
        '</p><button class="btn" data-action="settings">CHANGE HANDLE</button></div>';
    });
  }

  function renderHud() {
    const s = st.stats, info = st.info;
    const rank = CF.rankFor(s ? s.rating : null);
    $('#hud-left').innerHTML = (info ? CF.avatarImg(info.avatar, info.handle, rank.color) : '') +
      '<div><div class="hud-handle" style="color:' + rank.color + '">' + CF.esc(info ? info.handle : st.handle) + '</div>' +
      '<div class="small dim">' + (s ? 'LV ' + s.level.level + ' · ' + (s.rating != null ? s.rating : 'UNRATED') : '...') + '</div></div>';
    const ago = st.lastUpdate ? Math.floor((Date.now() - st.lastUpdate) / 60000) : null;
    $('#hud-right').innerHTML =
      '<span class="coin" title="Quest coins">● ' + st.profile.coins + '</span>' +
      '<span class="small ' + (CF.api.online ? 'dim' : 'danger blink') + '" id="hud-updated">' +
        (CF.api.online ? (ago == null ? 'SYNCING' : ago === 0 ? 'LIVE' : ago + 'M AGO') : 'OFFLINE') + '</span>' +
      '<button class="icon-btn fm-btn' + (CF.radio.playing ? ' on' : '') + '" data-action="radio" aria-label="Radio">' +
        (CF.radio.playing ? '<span class="eq"><i></i><i></i><i></i></span>' : 'FM') + '</button>' +
      '<button class="icon-btn" data-action="sound" aria-label="Sound effects">' + (CF.sound.enabled ? '♫' : '✕') + '</button>' +
      '<button class="icon-btn" data-action="night" aria-label="Night mode">☾</button>' +
      '<button class="icon-btn" data-action="fullscreen" aria-label="Full screen">⛶</button>' +
      '<button class="icon-btn" data-action="settings" aria-label="Settings">⚙</button>';
  }

  /* Every second: countdowns, contest alerts, night mode. */
  const alerted = new Set();
  function tick() {
    const t = Date.now() / 1000;
    document.querySelectorAll('[data-countdown]').forEach(el => {
      const left = Number(el.dataset.countdown) - t;
      el.textContent = left > 0 ? CF.fmtClock(left) : '00:00:00';
      el.classList.toggle('urgent', left > 0 && left < 3600);
    });
    document.querySelectorAll('[data-ago]').forEach(el => { el.textContent = CF.timeAgo(Number(el.dataset.ago)).toUpperCase(); });
    document.querySelectorAll('[data-countdown-short]').forEach(el => {
      const left = Number(el.dataset.countdownShort) - t;
      const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60);
      el.textContent = left <= 0 ? 'NOW' : d ? d + 'D ' + h + 'H' : h ? h + 'H ' + m + 'M' : m + 'M';
    });
    const nc = st.upcoming[0];
    if (nc) {
      const left = nc.startTimeSeconds - t;
      if (left < 600 && left > 590 && !alerted.has(nc.id + 'w')) {
        alerted.add(nc.id + 'w'); CF.sound.tick();
        CF.fx.toast('<span class="toast-icon">⏰</span><div><b>10 MINUTES TO GO</b><br>' + CF.esc(nc.name) + '</div>', '#ffd23f');
      }
      if (left <= 0 && left > -5 && !alerted.has(nc.id + 's')) {
        alerted.add(nc.id + 's');
        CF.fx.banner({ kind: 'level', title: 'FIGHT!', top: nc.name, sub: 'CONTEST STARTED', sound: CF.sound.rankUp });
        setTimeout(() => { due.full = 0; }, 30000);
      }
    }
    if (Math.floor(t) % 30 === 0) { checkNight(); CF.extras.checkWarmup(st); CF.extras.checkMorning(st); }
  }

  /* ---------------- Night mode ---------------- */
  let nightSnoozeUntil = 0, nightForced = false, nightPausedRadio = false;
  function inNightWindow() {
    const n = st.settings.night;
    if (!n.enabled) return false;
    const d = new Date(), cur = d.getHours() * 60 + d.getMinutes();
    const [sh, sm] = n.start.split(':').map(Number), [eh, em] = n.end.split(':').map(Number);
    const a = sh * 60 + sm, b = eh * 60 + em;
    return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
  }
  function checkNight() {
    const on = nightForced || (inNightWindow() && Date.now() > nightSnoozeUntil && CF.live.mode !== 'live');
    const ov = $('#night');
    const was = ov.classList.contains('open');
    ov.classList.toggle('open', on);
    if (on && !was && CF.radio.playing && st.settings.radio.nightPause) { CF.radio.stop(); nightPausedRadio = true; }
    if (!on && was && nightPausedRadio) { nightPausedRadio = false; CF.radio.play(); }
    if (on) renderNight();
  }
  function toggleNight(on) {
    nightForced = on;
    if (!on) nightSnoozeUntil = Date.now() + 15 * 60000;
    checkNight();
  }
  function renderNight() {
    const d = new Date();
    const s = st.stats, rank = CF.rankFor(s ? s.rating : null), nc = st.upcoming[0];
    $('#night').innerHTML =
      '<div class="night-clock">' + CF.pad(d.getHours()) + '<span class="blink">:</span>' + CF.pad(d.getMinutes()) + '</div>' +
      '<div class="night-line" style="color:' + rank.color + '">' + CF.esc(st.handle) + ' · ' + (s && s.rating != null ? s.rating : '') + '</div>' +
      (nc ? '<div class="night-line dim">NEXT: ' + CF.esc(nc.name) + ' · <span data-countdown-short="' + nc.startTimeSeconds + '"></span></div>' : '') +
      '<div class="night-hint dim">TAP TO WAKE</div>';
  }
  document.addEventListener('DOMContentLoaded', () => $('#night').addEventListener('click', () => toggleNight(false)));

  /* ---------------- CF FM radio ---------------- */
  let vizRaf = null;
  function saveRadio() {
    st.settings.radio.on = CF.radio.playing;
    st.settings.radio.station = CF.radio.station;
    CF.saveSettings(st.settings);
  }
  function toggleRadioPanel(force) {
    const p = $('#radio-panel');
    const open = force != null ? force : !p.classList.contains('open');
    p.classList.toggle('open', open);
    if (open) { renderRadio(); drawViz(); } else { cancelAnimationFrame(vizRaf); vizRaf = null; }
  }
  function renderRadio() {
    const p = $('#radio-panel');
    if (!p.classList.contains('open')) return;
    const R = CF.radio;
    p.innerHTML =
      '<div class="rp-head"><span>◉ CF FM</span><span class="small ' + (R.playing ? 'good blink-soft' : 'dim') + '">' +
        (R.playing ? 'ON AIR' : 'OFF AIR') + '</span></div>' +
      '<canvas id="rp-viz"></canvas>' +
      '<div class="rp-now"><div class="small dim">' + (R.playing ? 'NOW PLAYING · TRACK ' + R.trackNo : 'PRESS PLAY') + '</div>' +
        '<div class="rp-title">' + CF.esc(R.playing ? R.title : R.STATIONS[R.station].name) + '</div></div>' +
      '<div class="rp-controls">' +
        '<button class="btn" data-action="radio-play">' + (R.playing ? '❚❚ PAUSE' : '▶ PLAY') + '</button>' +
        '<button class="btn ghost" data-action="radio-skip">⏭ NEW TRACK</button>' +
      '</div>' +
      '<div class="rp-stations">' + R.STATIONS.map((s, i) =>
        '<button class="' + (i === R.station ? 'on' : '') + '" data-action="radio-station" data-i="' + i + '">' + s.name + '</button>').join('') + '</div>' +
      '<label class="rp-vol small">VOLUME <input id="radio-vol" type="range" min="0" max="100" value="' + Math.round(R.volume * 100) + '"></label>' +
      '<div class="small dim">COMPOSED LIVE ON THIS DEVICE · 0 KB DATA</div>' +
      '<a class="small rp-cfm" href="https://clau.de/radio" target="_blank" rel="noopener">↗ OPEN CLAUDE FM (YOUTUBE, USES DATA)</a>';
  }
  function drawViz() {
    const c = document.getElementById('rp-viz');
    if (c) {
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w) { c.width = w; c.height = h; }
      const g = c.getContext('2d');
      g.clearRect(0, 0, w, h);
      const lv = CF.radio.levels();
      const bars = 16, bw = Math.floor(w / bars);
      const color = getComputedStyle(document.documentElement).getPropertyValue('--rank').trim();
      for (let i = 0; i < bars; i++) {
        const v = lv ? lv[i + 1] / 255 : 0.04;
        const blocks = Math.max(1, Math.round(v * (h / 6)));
        for (let b = 0; b < blocks; b++) {
          g.fillStyle = b > h / 6 * 0.75 ? '#ff4d4d' : b > h / 6 * 0.5 ? '#ffd23f' : color;
          g.fillRect(i * bw + 1, h - (b + 1) * 6 + 1, bw - 3, 4);
        }
      }
    }
    vizRaf = requestAnimationFrame(drawViz);
  }

  /* ---------------- Settings ---------------- */
  function openSettings() {
    const s = st.settings, g = st.profile.goal;
    const f = $('#settings .set-form');
    f.innerHTML =
      '<label>HANDLE<div class="row"><input id="f-handle" value="' + CF.esc(st.handle) + '" autocomplete="off" autocapitalize="off" spellcheck="false"></div></label>' +
      '<div class="chips">' + s.savedHandles.map(h =>
        '<span class="chip ' + (h.toLowerCase() === st.handle.toLowerCase() ? 'on' : '') + '" data-action="switch-handle" data-handle="' + CF.esc(h) + '">' + CF.esc(h) +
        (h.toLowerCase() === st.handle.toLowerCase() ? '' : ' <b data-action="remove-handle" data-handle="' + CF.esc(h) + '">✕</b>') + '</span>').join('') + '</div>' +
      '<label>TEAMMATES <span class="dim">(comma separated handles, max 12)</span><input id="f-team" value="' + CF.esc(s.teammates.join(', ')) + '" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
      '<div class="row3">' +
        '<label>TARGET RATING<input id="f-target" type="number" step="50" placeholder="auto" value="' + (g.target || '') + '"></label>' +
        '<label>DAILY GOAL<input id="f-daily" type="number" min="1" value="' + g.daily + '"></label>' +
        '<label>WEEKLY GOAL<input id="f-weekly" type="number" min="1" value="' + g.weekly + '"></label>' +
      '</div>' +
      '<div class="row3">' +
        '<label class="check"><input id="f-night" type="checkbox"' + (s.night.enabled ? ' checked' : '') + '> AUTO NIGHT MODE</label>' +
        '<label>FROM<input id="f-nstart" type="time" value="' + s.night.start + '"></label>' +
        '<label>TO<input id="f-nend" type="time" value="' + s.night.end + '"></label>' +
      '</div>' +
      '<div class="row3">' +
        '<label class="check"><input id="f-sound" type="checkbox"' + (s.sound ? ' checked' : '') + '> SOUND</label>' +
        '<label class="check"><input id="f-crt" type="checkbox"' + (s.crt ? ' checked' : '') + '> CRT SCANLINES</label>' +
        '<label class="check"><input id="f-rnight" type="checkbox"' + (s.radio.nightPause ? ' checked' : '') + '> PAUSE RADIO AT NIGHT</label>' +
        '<label>REFRESH<select id="f-refresh">' + [3, 5, 10].map(m => '<option value="' + m + '"' + (s.refreshMin === m ? ' selected' : '') + '>EVERY ' + m + ' MIN</option>').join('') + '</select></label>' +
      '</div>' +
      '<div class="small dim">TIP: share <b>' + CF.esc(location.origin + location.pathname) + '?handle=' + CF.esc(st.handle) + '</b> to open any handle directly.</div>' +
      '<div class="form-error danger" id="f-error"></div>';
    $('#settings').classList.add('open');
  }
  function closeSettings() { $('#settings').classList.remove('open'); }
  /* The settings window also holds the Achievements and Hall of Records pages, as tabs. */
  let setTabId = 'form';
  function setTab(id) {
    setTabId = id;
    const m = $('#settings');
    m.querySelectorAll('[data-action="set-tab"]').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    m.querySelectorAll('.set-pane').forEach(p => { p.hidden = p.dataset.pane !== id; });
    m.querySelector('.modal-box').classList.toggle('wide', id !== 'form');
    m.querySelector('.modal-foot').hidden = id !== 'form';
    renderSetTab();
    m.querySelector('.modal-body').scrollTop = 0;
  }
  function renderSetTab() {
    if (setTabId === 'form' || !$('#settings').classList.contains('open')) return;
    const el = $('#settings .set-pane[data-pane="' + setTabId + '"]');
    if (!st.stats) { el.innerHTML = '<div class="center pad blink">LOADING...</div>'; return; }
    try { CF.boards[setTabId](el, st); } catch (e) {
      console.error(setTabId, e);
      el.innerHTML = '<div class="center pad danger">PAGE CRASHED: ' + CF.esc(e.message) + '</div>';
    }
  }

  /* ---------------- Virtual contest dialog ---------------- */
  function openVirtual() {
    const done = new Set((st.subs || []).map(s => s.contestId));
    // A few recent finished contests you haven't touched, as quick picks.
    const picks = (st.contestsAll || []).filter(c => c.phase === 'FINISHED' && !done.has(c.id))
      .sort((a, b) => b.startTimeSeconds - a.startTimeSeconds).slice(0, 8);
    $('#vmodal .modal-body').innerHTML =
      '<p class="small dim">1. On Codeforces open the contest → <b>Virtual participation</b> → register and start.<br>' +
      '2. Enter the same contest here and press START. The board then tracks your verdicts, time left and ghost rank.<br>' +
      'Forgot? It also starts by itself after your first virtual submission.</p>' +
      '<div class="row3"><label>CONTEST ID OR LINK<input id="v-contest" placeholder="e.g. 1900" autocomplete="off" inputmode="url"></label>' +
      '<label>MINUTES ALREADY PLAYED<input id="v-mins" type="number" min="0" value="0"></label></div>' +
      (picks.length ? '<div class="small dim">RECENT CONTESTS YOU HAVEN’T PLAYED</div><div class="chips">' + picks.map(c =>
        '<span class="chip" data-action="virtual-pick" data-id="' + c.id + '">' + c.id + ' · ' + CF.esc(c.name.replace(/Codeforces Round/i, 'CF Round')) + '</span>').join('') + '</div>' : '') +
      '<div id="v-err" class="danger small"></div>';
    $('#vmodal').classList.add('open');
    setTimeout(() => $('#v-contest').focus(), 50);
  }
  function closeVirtual() { $('#vmodal').classList.remove('open'); }
  function startVirtual() {
    const raw = $('#v-contest').value;
    const m = raw.match(/contest\/(\d+)/) || raw.match(/(\d+)/);
    const err = $('#v-err');
    if (!m) { err.textContent = 'ENTER A CONTEST ID OR LINK'; return; }
    const mins = Math.max(0, Number($('#v-mins').value) || 0);
    const problem = CF.live.startVirtual(st, Number(m[1]), mins);
    if (problem) { err.textContent = problem; return; }
    closeVirtual();
    goTo(BOARDS.findIndex(b => b.id === 'live'));
    detectLive();
  }

  async function saveSettingsForm() {
    const s = st.settings, g = st.profile.goal;
    const handle = $('#f-handle').value.trim();
    const seenH = new Set();
    s.teammates = $('#f-team').value.split(/[,;\s]+/).map(x => x.trim()).filter(x => x && !seenH.has(x.toLowerCase()) && seenH.add(x.toLowerCase())).slice(0, 12);
    CF.team.sync(st);
    const target = parseInt($('#f-target').value, 10);
    if (target && target !== g.target) { g.target = target; g.start = st.stats ? st.stats.rating || 0 : 0; }
    if (!target) { g.target = null; g.start = null; }
    g.daily = Math.max(1, parseInt($('#f-daily').value, 10) || 2);
    g.weekly = Math.max(1, parseInt($('#f-weekly').value, 10) || 10);
    s.night = { enabled: $('#f-night').checked, start: $('#f-nstart').value || '23:30', end: $('#f-nend').value || '07:00' };
    s.sound = CF.sound.enabled = $('#f-sound').checked;
    s.crt = $('#f-crt').checked;
    s.radio.nightPause = $('#f-rnight').checked;
    document.body.classList.toggle('crt', s.crt);
    s.refreshMin = Number($('#f-refresh').value) || 5;
    CF.saveSettings(s);
    CF.saveProfile(st.handle, st.profile);
    if (handle && handle.toLowerCase() !== st.handle.toLowerCase()) {
      const ok = await switchHandle(handle);
      if (!ok) return;
    } else {
      due.team = 0;
      if (st.stats) renderAll();
    }
    closeSettings();
  }

  async function switchHandle(handle) {
    const err = $('#f-error');
    if (err) err.textContent = 'CHECKING ' + handle.toUpperCase() + '...';
    let info;
    try { [info] = await CF.api.call('user.info', { handles: handle }, { priority: true }); }
    catch (e) { if (err) err.textContent = /not found/i.test(e.message) ? 'HANDLE NOT FOUND' : e.message.toUpperCase(); return false; }
    handle = info.handle;
    const s = st.settings;
    s.handle = handle;
    if (!s.savedHandles.some(h => h.toLowerCase() === handle.toLowerCase())) s.savedHandles.push(handle);
    CF.saveSettings(s);
    // Reset everything for the new player.
    Object.assign(st, { handle, profile: CF.loadProfile(handle), info: null, subs: null, history: null, stats: null, ready: false, lastUpdate: 0 });
    Object.assign(CF.live, { contest: null, mode: 'none', problems: [], myRow: null, mySubs: [], ratingChange: null, standings: null, lastLoad: 0, lastProbe: 0, verdictsLoadedFor: null });
    known.clear(); combo = 0;
    if (history.replaceState) history.replaceState(null, '', location.pathname + '?handle=' + encodeURIComponent(handle));
    document.querySelectorAll('.board').forEach(b => { b.innerHTML = '<div class="center pad blink">LOADING ' + CF.esc(handle) + '...</div>'; });
    loadFromCache();
    renderHud();
    closeSettings();
    due.full = due.team = due.live = 0;
    scheduler();
    return true;
  }

  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  document.addEventListener('DOMContentLoaded', init);
})();
