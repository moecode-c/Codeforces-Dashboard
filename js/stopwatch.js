/* Stopwatch board: time yourself on a problem.
   - START / PAUSE, LAP, RESET (RESET saves the run to the log).
   - Optional time limit: the clock turns red and beeps when you pass it.
   - Auto-stop: when Codeforces reports an AC while the clock runs, it stops and logs the solve.
   State lives in localStorage, so a reload or a closed tab never loses a running clock.
   The board builds its HTML once and then only updates pieces, so typing in the
   problem box is never interrupted by a data refresh. */
(function () {
  const esc = CF.esc;
  const LIMITS = [0, 15, 30, 45, 60, 90];   // minutes, 0 = no limit
  const sw = CF.stopwatch = {};

  const def = { running: false, startedAt: 0, acc: 0, laps: [], problem: '', limit: 0, beeped: false, autoStop: true, log: [] };
  let S = Object.assign({}, def, CF.store.get('stopwatch', {}));
  let el = null;
  const save = () => CF.store.set('stopwatch', S);

  /* Elapsed milliseconds. */
  function elapsed() { return S.acc + (S.running ? Date.now() - S.startedAt : 0); }
  sw.elapsed = elapsed;

  function fmt(ms, cs) {
    const t = Math.max(0, Math.floor(ms / 10));
    const c = t % 100, s = Math.floor(t / 100) % 60, m = Math.floor(t / 6000) % 60, h = Math.floor(t / 360000);
    const p = n => String(n).padStart(2, '0');
    return (h ? h + ':' + p(m) : p(m)) + ':' + p(s) + (cs === false ? '' : '<small>.' + p(c) + '</small>');
  }
  sw.fmt = fmt;

  /* ---------- Actions ---------- */
  function start() { if (S.running) return; S.running = true; S.startedAt = Date.now(); save(); CF.sound.tick(); update(); }
  function pause() { if (!S.running) return; S.acc = elapsed(); S.running = false; save(); update(); }
  function toggle() { S.running ? pause() : start(); }
  function lap() {
    const t = elapsed();
    if (!t) return;
    S.laps.push(t); S.laps = S.laps.slice(-30); save(); CF.sound.tick(); update(true);
  }
  /* Stop and store the run. result: 'AC' when auto-stopped by a verdict, else 'STOP'. */
  function finish(result, problem) {
    const t = elapsed();
    if (t >= 1000) {
      S.log.unshift({ t, problem: problem || S.problem || '', result, at: Date.now(), limit: S.limit });
      S.log = S.log.slice(0, 50);
    }
    S.running = false; S.acc = 0; S.startedAt = 0; S.laps = []; S.beeped = false;
    if (result === 'AC') S.problem = '';
    save(); update(true);
  }
  function clearLog() { S.log = []; save(); update(true); }

  /* Set what you're solving (used by the warm-up card). */
  sw.setProblem = function (name, andStart) {
    if (S.running || elapsed()) finish('STOP');
    S.problem = name; save();
    const i = el && el.querySelector('#sw-problem'); if (i) i.value = name;
    if (andStart) start(); else update(true);
  };

  /* ---------- Focus screen: just the clock and the problem, huge ---------- */
  let focusEl = null;
  function openFocus() {
    if (!focusEl) {
      focusEl = document.createElement('div');
      focusEl.id = 'focus';
      document.body.appendChild(focusEl);
    }
    focusEl.innerHTML =
      '<div class="fo-problem">' + (S.problem ? esc(S.problem) : 'FOCUS') + '</div>' +
      '<div class="fo-time" id="fo-time"></div>' +
      '<div class="fo-limit"></div>' +
      '<div class="fo-btns">' +
        '<button class="btn ghost fo-go" data-action="sw-toggle"></button>' +
        '<button class="btn ghost" data-action="sw-lap">⚑ LAP</button>' +
        '<button class="btn ghost" data-action="sw-focus-exit">✕ EXIT</button>' +
      '</div>' +
      '<div class="small dim fo-hint">SPACE = START/PAUSE · L = LAP · ESC = EXIT</div>';
    focusEl.classList.add('open');
    update(true);
  }
  function closeFocus() { if (focusEl) focusEl.classList.remove('open'); }
  sw.focusOpen = () => !!(focusEl && focusEl.classList.contains('open'));

  /* Called by app.js when a new AC comes in. */
  sw.onAccepted = function (sub) {
    if (!S.running || !S.autoStop) return;
    const t = elapsed();
    const name = (sub.problem.contestId || '') + sub.problem.index + ' · ' + sub.problem.name;
    finish('AC', name);
    setTimeout(() => CF.fx.toast('<span class="toast-icon">⏱</span><div><b>SOLVED IN ' + fmt(t, false) + '</b><br>' + esc(name) + '</div>', '#4ddb5c'), 2400);
  };

  sw.handleAction = function (a, t) {
    if (a === 'sw-toggle') toggle();
    else if (a === 'sw-lap') lap();
    else if (a === 'sw-reset') finish('STOP');
    else if (a === 'sw-limit') { S.limit = Number(t.dataset.m); S.beeped = false; save(); update(true); }
    else if (a === 'sw-auto') { S.autoStop = !S.autoStop; save(); update(true); }
    else if (a === 'sw-pick') { S.problem = t.dataset.p; save(); const i = el && el.querySelector('#sw-problem'); if (i) i.value = S.problem; }
    else if (a === 'sw-clear') { if (confirm('Clear the whole solve log?')) clearLog(); }
    else if (a === 'sw-focus') openFocus();
    else if (a === 'sw-focus-exit') closeFocus();
    else return false;
    return true;
  };
  sw.keydown = function (e) {
    if (e.target.tagName === 'INPUT') return false;
    if (e.key === 'Escape' && sw.focusOpen()) { closeFocus(); return true; }
    if (e.key === 'f' || e.key === 'F') { sw.focusOpen() ? closeFocus() : openFocus(); return true; }
    if (e.code === 'Space') { e.preventDefault(); toggle(); return true; }
    if (e.key === 'l' || e.key === 'L') { lap(); return true; }
    if (e.key === 'r' || e.key === 'R') { finish('STOP'); return true; }
    return false;
  };

  /* ---------- Rendering ---------- */
  function mount(section) {
    el = section;
    const P = CF.boards.panel;
    el.innerHTML =
      '<div class="grid g-sw">' +
        P('⏱ STOPWATCH',
          '<div class="sw-main">' +
            '<input id="sw-problem" class="sw-problem" maxlength="80" placeholder="WHAT ARE YOU SOLVING? (OPTIONAL)" autocomplete="off">' +
            '<div class="sw-picks"></div>' +
            '<div class="sw-time" id="sw-time"></div>' +
            '<div class="sw-limitbar"></div>' +
            '<div class="sw-btns">' +
              '<button class="btn sw-go" data-action="sw-toggle"></button>' +
              '<button class="btn ghost" data-action="sw-lap">⚑ LAP</button>' +
              '<button class="btn ghost" data-action="sw-reset">■ STOP &amp; SAVE</button>' +
              '<button class="btn ghost" data-action="sw-focus">◉ FOCUS</button>' +
            '</div>' +
            '<div class="sw-opts"></div>' +
          '</div>', 'sw-a') +
        P('⚑ LAPS', '<ol class="sw-laps"></ol>', 'sw-b') +
        P('≡ SOLVE LOG', '<div class="sw-sum"></div><ul class="sw-log"></ul>', 'sw-c', '<button class="btn mini ghost" data-action="sw-clear">CLEAR</button>') +
      '</div>';
    const inp = el.querySelector('#sw-problem');
    inp.value = S.problem;
    inp.addEventListener('input', () => { S.problem = inp.value; save(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { inp.blur(); start(); } });
    el.dataset.sw = '1';
    update(true);
  }

  /* full = also redraw the lists and options (not needed every frame). */
  function update(full) {
    const t = elapsed();
    const over = S.limit && t >= S.limit * 60000;
    if (sw.focusOpen()) {
      const ft = focusEl.querySelector('#fo-time');
      ft.innerHTML = fmt(t);
      ft.className = 'fo-time' + (S.running ? ' running' : t ? ' paused' : '') + (over ? ' over' : '');
      focusEl.querySelector('.fo-go').innerHTML = S.running ? '❚❚ PAUSE' : t ? '▶ RESUME' : '▶ START';
      focusEl.querySelector('.fo-limit').innerHTML = S.limit ? CF.boards.bar(t / (S.limit * 60000), over ? 'var(--wa)' : 'var(--rank)', 40) : '';
      if (full) focusEl.querySelector('.fo-problem').textContent = S.problem || 'FOCUS';
    }
    if (!el || !el.isConnected) return;
    const timeEl = el.querySelector('#sw-time');
    timeEl.innerHTML = fmt(t);
    timeEl.classList.toggle('running', S.running);
    timeEl.classList.toggle('paused', !S.running && t > 0);
    timeEl.classList.toggle('over', !!over);
    if (over && S.running && !S.beeped) {
      S.beeped = true; save();
      CF.sound.wa();
      CF.fx.toast('<span class="toast-icon">⏰</span><div><b>TIME LIMIT ' + S.limit + ' MIN</b><br>Maybe read the editorial?</div>', '#ff4d4d');
    }
    const lb = el.querySelector('.sw-limitbar');
    lb.innerHTML = S.limit ? CF.boards.bar(t / (S.limit * 60000), over ? 'var(--wa)' : 'var(--rank)', 30) +
      '<span class="small ' + (over ? 'danger' : 'dim') + '">' + (over ? '+' + fmt(t - S.limit * 60000, false) + ' OVER' : fmt(S.limit * 60000 - t, false) + ' LEFT') + '</span>' : '';
    el.querySelector('.sw-go').innerHTML = S.running ? '❚❚ PAUSE' : t ? '▶ RESUME' : '▶ START';
    if (!full) return;

    el.querySelector('.sw-opts').innerHTML =
      '<span class="small dim">LIMIT</span>' + LIMITS.map(m =>
        '<button class="chip' + (S.limit === m ? ' on' : '') + '" data-action="sw-limit" data-m="' + m + '">' + (m ? m + 'M' : 'OFF') + '</button>').join('') +
      '<button class="chip' + (S.autoStop ? ' on' : '') + '" data-action="sw-auto">' + (S.autoStop ? '✔' : '✕') + ' AUTO-STOP ON AC</button>';

    const unf = CF.state && CF.state.stats ? CF.state.stats.unfinished.slice(0, 4) : [];
    el.querySelector('.sw-picks').innerHTML = unf.length ? '<span class="small dim">RETRY:</span>' + unf.map(a => {
      const p = (a.problem.contestId || '') + a.problem.index + ' · ' + a.problem.name;
      return '<button class="chip" data-action="sw-pick" data-p="' + esc(p) + '">' + esc((a.problem.contestId || '') + a.problem.index) + '</button>';
    }).join('') : '';

    const laps = S.laps.map((v, i) => ({ v, d: v - (S.laps[i - 1] || 0), i }));
    const best = laps.length > 1 ? Math.min(...laps.map(l => l.d)) : -1;
    const worst = laps.length > 1 ? Math.max(...laps.map(l => l.d)) : -1;
    el.querySelector('.sw-laps').innerHTML = laps.length ? laps.reverse().map(l =>
      '<li class="' + (l.d === best ? 'good' : l.d === worst ? 'danger' : '') + '"><span class="dim">#' + (l.i + 1) + '</span>' +
      '<b>' + fmt(l.d, false) + '</b><span class="dim">' + fmt(l.v, false) + '</span></li>').join('')
      : '<li class="dim sw-empty">TAP LAP TO MARK STEPS<br>(READ · IDEA · CODE · DEBUG)</li>';

    const acs = S.log.filter(r => r.result === 'AC');
    const avg = acs.length ? acs.reduce((a, r) => a + r.t, 0) / acs.length : 0;
    const fastest = acs.length ? Math.min(...acs.map(r => r.t)) : 0;
    el.querySelector('.sw-sum').innerHTML =
      '<div><span class="small dim">RUNS</span><b>' + S.log.length + '</b></div>' +
      '<div><span class="small dim">AVG AC</span><b>' + (avg ? fmt(avg, false) : '--') + '</b></div>' +
      '<div><span class="small dim">FASTEST</span><b class="good">' + (fastest ? fmt(fastest, false) : '--') + '</b></div>';
    el.querySelector('.sw-log').innerHTML = S.log.length ? S.log.slice(0, 20).map(r =>
      '<li><span class="v ' + (r.result === 'AC' ? 'v-ac' : 'v-ce') + '">' + (r.result === 'AC' ? 'AC' : '■') + '</span>' +
      '<span class="grow">' + (r.problem ? esc(r.problem) : '<span class="dim">UNTITLED</span>') + '</span>' +
      '<b class="' + (r.limit && r.t > r.limit * 60000 ? 'danger' : '') + '">' + fmt(r.t, false) + '</b>' +
      '<span class="dim small">' + CF.timeAgo(Math.floor(r.at / 1000)) + '</span></li>').join('')
      : '<li class="dim sw-empty">NO RUNS YET</li>';
  }

  /* Board renderer: build once, afterwards just refresh. */
  CF.boards.stopwatch = function (section) {
    if (section.dataset.sw !== '1' || !section.querySelector('#sw-time')) mount(section);
    else update(true);
  };

  setInterval(() => { if (S.running) update(); }, 50);
  // Keep the time right if the tab was asleep.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(true); });
})();
