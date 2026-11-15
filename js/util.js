/* Shared helpers and constants. Everything hangs off the global CF namespace
   so the site works from GitHub Pages or straight from a file. */
window.CF = window.CF || {};

CF.DEFAULT_HANDLE = 'moecode_1';

CF.RANKS = [
  { min: -1e9, name: 'Newbie', color: '#b0b0b0' },
  { min: 1200, name: 'Pupil', color: '#4ddb5c' },
  { min: 1400, name: 'Specialist', color: '#2fe0cf' },
  { min: 1600, name: 'Expert', color: '#6b8cff' },
  { min: 1900, name: 'Candidate Master', color: '#d36bff' },
  { min: 2100, name: 'Master', color: '#ffb02e' },
  { min: 2300, name: 'International Master', color: '#ffb02e' },
  { min: 2400, name: 'Grandmaster', color: '#ff5252' },
  { min: 2600, name: 'International Grandmaster', color: '#ff5252' },
  { min: 3000, name: 'Legendary Grandmaster', color: '#ff5252' },
];
CF.UNRATED = { min: null, name: 'Unrated', color: '#9a9ab0' };

CF.rankFor = function (rating) {
  if (rating == null) return CF.UNRATED;
  let r = CF.RANKS[0];
  for (const k of CF.RANKS) if (rating >= k.min) r = k;
  return r;
};
CF.nextRank = function (rating) {
  if (rating == null) return CF.RANKS[1];
  for (const k of CF.RANKS) if (k.min > rating) return k;
  return null;
};
CF.rankIndex = function (rating) {
  if (rating == null) return -1;
  return CF.RANKS.indexOf(CF.rankFor(rating));
};

CF.esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};

CF.pad = n => String(n).padStart(2, '0');

CF.dayKey = function (d) {
  if (typeof d === 'number') d = new Date(d * 1000);
  return d.getFullYear() + '-' + CF.pad(d.getMonth() + 1) + '-' + CF.pad(d.getDate());
};
CF.todayKey = () => CF.dayKey(new Date());
CF.addDays = function (key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return CF.dayKey(new Date(y, m - 1, d + n));
};

CF.fmtClock = function (sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return d + 'D ' + CF.pad(h) + ':' + CF.pad(m) + ':' + CF.pad(s);
  return CF.pad(h) + ':' + CF.pad(m) + ':' + CF.pad(s);
};
CF.fmtRel = function (sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h + ':' + CF.pad(m);
};
CF.timeAgo = function (ts) {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};
CF.fmtDate = function (ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' ' + CF.pad(d.getHours()) + ':' + CF.pad(d.getMinutes());
};
CF.fmtNum = n => (n == null ? '-' : Number(n).toLocaleString('en-US'));

CF.problemKey = function (p) {
  return (p.contestId || p.problemsetName || 'x') + '-' + p.index;
};
CF.problemUrl = function (p) {
  if (!p.contestId) return null;
  const kind = p.contestId >= 100000 ? 'gym' : 'contest';
  return 'https://codeforces.com/' + kind + '/' + p.contestId + '/problem/' + p.index;
};

CF.VERDICTS = {
  OK: 'AC', WRONG_ANSWER: 'WA', TIME_LIMIT_EXCEEDED: 'TLE', MEMORY_LIMIT_EXCEEDED: 'MLE',
  RUNTIME_ERROR: 'RE', COMPILATION_ERROR: 'CE', IDLENESS_LIMIT_EXCEEDED: 'ILE',
  PRESENTATION_ERROR: 'PE', CHALLENGED: 'HACKED', SKIPPED: 'SKIP', PARTIAL: 'PART',
  SECURITY_VIOLATED: 'SV', CRASHED: 'CRASH', INPUT_PREPARATION_CRASHED: 'IPC',
  FAILED: 'FAIL', REJECTED: 'REJ', TESTING: '...', TESTING_: '...',
};
CF.verdictShort = v => (v ? (CF.VERDICTS[v] || v.slice(0, 4)) : '...');
CF.isFinalVerdict = v => !!v && v !== 'TESTING';
CF.verdictClass = function (v) {
  if (!v || v === 'TESTING') return 'v-testing';
  if (v === 'OK') return 'v-ac';
  if (v === 'COMPILATION_ERROR' || v === 'SKIPPED') return 'v-ce';
  return 'v-wa';
};
CF.verdictLabel = function (sub) {
  const v = sub.verdict;
  if (!v || v === 'TESTING') return 'Testing...';
  if (v === 'OK') return sub.testset === 'PRETESTS' ? 'Pretests passed' : 'Accepted';
  const t = sub.passedTestCount != null ? ' on test ' + (sub.passedTestCount + 1) : '';
  const names = {
    WRONG_ANSWER: 'Wrong answer', TIME_LIMIT_EXCEEDED: 'Time limit', MEMORY_LIMIT_EXCEEDED: 'Memory limit',
    RUNTIME_ERROR: 'Runtime error', IDLENESS_LIMIT_EXCEEDED: 'Idleness limit',
  };
  if (names[v]) return names[v] + t;
  if (v === 'COMPILATION_ERROR') return 'Compilation error';
  if (v === 'CHALLENGED') return 'Hacked';
  return v.replace(/_/g, ' ').toLowerCase();
};

/* 5x5 mirrored pixel avatar, used when the Codeforces picture can't load. */
CF.pixelAvatar = function (handle, color) {
  const rnd = CF.seeded('avatar:' + String(handle).toLowerCase());
  let rects = '';
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (rnd() < 0.5) continue;
    rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    if (x < 2) rects += '<rect x="' + (4 - x) + '" y="' + y + '" width="1" height="1"/>';
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 7 7" shape-rendering="crispEdges">' +
    '<rect x="-1" y="-1" width="7" height="7" fill="#141428"/><g fill="' + (color || '#4ddb5c') + '">' + rects + '</g></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
};
CF.failedImages = new Set();   // don't re-download pictures that already failed
CF.avatarImg = function (url, handle, color) {
  const src = url && !/no-?avatar|no-title/.test(url) && !CF.failedImages.has(url) ? url : CF.pixelAvatar(handle, color);
  return '<img src="' + CF.esc(src) + '" alt="" referrerpolicy="no-referrer" data-handle="' + CF.esc(handle) +
    '" data-color="' + CF.esc(color || '') + '">';
};
document.addEventListener('error', function (e) {
  const img = e.target;
  if (img.tagName !== 'IMG' || img.dataset.fb) return;
  img.dataset.fb = '1';
  CF.failedImages.add(img.src);
  img.src = CF.pixelAvatar(img.dataset.handle || 'player', img.dataset.color);
}, true);

/* Seeded random so daily quests are the same all day. */
CF.seeded = function (str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return function () {
    h += 0x6D2B79F5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

CF.store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('cfa.' + key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem('cfa.' + key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  },
};

CF.defaultSettings = {
  handle: CF.DEFAULT_HANDLE,
  savedHandles: [CF.DEFAULT_HANDLE],
  rivals: [],
  sound: true,
  crt: true,
  refreshMin: 5,
  night: { enabled: true, start: '23:30', end: '07:00' },
  radio: { on: false, station: 0, volume: 0.5, nightPause: true },
};
CF.loadSettings = function () {
  const s = Object.assign({}, CF.defaultSettings, CF.store.get('settings', {}));
  s.night = Object.assign({}, CF.defaultSettings.night, s.night || {});
  s.radio = Object.assign({}, CF.defaultSettings.radio, s.radio || {});
  return s;
};
CF.saveSettings = s => CF.store.set('settings', s);

/* Per-handle progress (quests, coins, seen achievements, goals). */
CF.loadProfile = function (handle) {
  const p = CF.store.get('profile.' + handle.toLowerCase(), {});
  return Object.assign({
    coins: 0, quests: {}, seenAch: null, lastRankIdx: null, lastLevel: null,
    seenRatingChanges: [], goal: { target: null, start: null, daily: 2, weekly: 10 },
  }, p);
};
CF.saveProfile = (handle, p) => CF.store.set('profile.' + handle.toLowerCase(), p);
