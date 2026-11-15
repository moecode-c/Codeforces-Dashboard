# CF Arcade 🕹️

A retro pixel-arcade Codeforces dashboard made for a tablet on your desk.
It works for **any handle**. The default is `moecode_1`.

No server and no build step: it's plain HTML, CSS and JavaScript that talks to the public
[Codeforces API](https://codeforces.com/apiHelp) straight from the browser.

## Boards

Swipe left/right, tap the icons at the bottom, or use the ◀ ▶ arrows (keyboard arrows work too).
Boards change **only when you change them**.

| # | Board | What's on it |
|---|-------|--------------|
| 1 | **Overview** | Avatar, handle in rank colour, rating and max, progress to next rank, **level + XP**, solved / 7-day / streak 🔥 / contests, rating graph with rank bands, solved-by-difficulty, activity heatmap, **upcoming contests with a countdown**, days since last AC, last contest result |
| 2 | **Live contest** | Auto-detects a contest you're in. Problem tiles (A, B, C…) turn green on AC, red on a miss, yellow while testing. Your submission feed. **Standings tab** with *Around me / Top 10 / Friends*. After the contest: system testing, then your rating change. When you're not in a contest it shows your last battle. **Virtual contests:** tap *+ VIRTUAL*, enter the contest ID (or link) you registered for on Codeforces, and the board runs it like a live contest: countdown, verdicts, your score by the contest's rules and a **ghost rank** against the official contestants at the same moment. It also starts by itself after your first virtual submission. **Rating predictor:** during a live contest (and "if rated" during a virtual) it estimates your rating change and performance from your current rank (≈, usually within ~10 points). |
| 3 | **Calendar** | Month view of upcoming contests, coloured by division (Div. 2/3 stand out), plus your past contests with rating change. Tap a contest (or ☆) to **mark** it: marked contests get a **warm-up** card 30 minutes before the start with two easy unsolved problems (⏱ TIME IT starts the stopwatch). |
| 4 | **Practice** | Unfinished business (tried but never accepted), tag radar, recent submissions, strongest and weakest tags, verdict stats |
| 5 | **Achievements** | 50+ badges in bronze, silver, gold and diamond (solves, streaks, hardest problem, rank, contests, first-try ACs, night owl…) |
| 6 | **Rivals** | Leaderboard against your friends: rating, last change, solves this week |
| 7 | **Goals & quests** | Target-rating, daily and weekly rings, **3 daily quests** that earn coins, last 14 days chart |
| 8 | **Weekly boss** | Each Monday a hard unsolved problem (~300 above your rating) becomes the boss. Its HP follows your usual weekly pace; every new solve hits it for its rating, and solving the boss itself is an instant K.O. Beat it for **+150 coins**. |
| 9 | **Hall of records** | Max rating, best rank, biggest gain/drop, hardest solve, fastest contest AC, longest streak, busiest day… |
| 10 | **Year in review** | Solves, XP, best month, favourite tag, biggest rating jump, hardest solve, contests, rating start → end, active days and a solves-per-month chart. Switch between years. |
| 11 | **Stopwatch** | Time yourself on a problem: start/pause, laps, optional time limit (15–90 min), quick-pick from unfinished problems, auto-stops when you get AC and keeps a solve log with average and fastest times. Keys: Space = start/pause, L = lap, R = stop & save. **◉ FOCUS** (or F) shows only the problem and the clock, huge. |
| 🌙 | **Night mode** | Dims to a big clock between the times you choose (default 23:30–07:00). Tap to wake for 15 minutes. It never kicks in during a live contest. |
| ☀ | **Morning summary** | The first time the dashboard wakes up each day (after 05:00): yesterday's solves, your streak, today's contests, quests and the boss. |

### 📻 CF FM radio (zero data)
Tap **FM** in the top bar. The music is **composed live on the tablet** with the Web Audio API.
Nothing is streamed, so it uses **0 KB of data**.
- **Stations:** LO-FI BEATS (vinyl crackle), 8-BIT ARCADE (chiptune), NIGHT DRIVE (synthwave), JAZZ CAFE (walking bass, brushes), SUNSET BOSSA, DEEP SPACE (ambient, no drums), TURBO BREAKS (drum & bass), MUSIC BOX (calm bells)
- **Endless tracks:** every track is a new key, tempo and chord progression (about 1.5–3 minutes), with made-up competitive-programming titles.
- **Effects stay audible:** the music ducks under sound effects (AC jingle, MISS!, level up…).
- **Remembers your choices:** your station, volume and on/off. It resumes on PRESS START and pauses during night mode (you can change that in settings).
- **Claude FM:** the panel also links to Anthropic's lo-fi stream. That's a YouTube video, so it **does** use data (roughly 100+ MB an hour) and opens in a separate tab.

### Game mechanics
- **XP and levels:** every solved problem gives XP equal to its rating (unrated = 500). Level *n* starts at 500·n·(n−1) XP.
- **Effects:** STAGE CLEAR! on Accepted, MISS! on wrong answers, combo counter in contests, level-up and rank-up
  cutscenes, achievement toasts, quest coins. All sounds are 8-bit and generated in the browser.
- **Theme follows your rank colour**, so the whole dashboard changes colour when you rank up.

## Settings (⚙ in the top-right)
- **Handle:** type any handle. Saved handles show as chips you can tap to switch.
- **Link straight to a handle:** `https://<you>.github.io/<repo>/?handle=tourist`
- **Rivals:** comma-separated handles (max 8)
- **Goals:** target rating, daily goal, weekly goal
- **Night mode** hours, sound, CRT scanlines, refresh interval (3/5/10 min)

## How refreshing works
Codeforces allows about 1 API call every 2 seconds, so every call goes through one queue.

| What | How often |
|------|-----------|
| **Your verdicts in a live contest** | **every 2.5 s while a submission is being judged**, every 6 s otherwise. A new submission triggers an instant check. |
| Your latest 15 submissions (practice verdicts, detecting that you joined a contest) | every 8 s while a contest is running, 3 s while something is testing, otherwise every 60 s |
| System testing after a contest | every 10 s |
| Full contest standings (rank, points) | only while the Live board is open: every 2 min live, once otherwise |
| Full profile (info, all submissions, rating history, contest list) | every 5 min (setting) |
| Rivals | every 10 min |

The verdict checker runs in its own loop, and requests are only spaced apart at the start (Codeforces' limit is
about 1 call every 2 s), so a big standings download or the 5-minute refresh never delays a verdict.

> Codeforces now serves contest standings **only in full** (a Div. 2 can be 5–20 MB), so the
> standings download only when you're looking at the Live board. Your own verdicts don't need it
> and stay fast.

Everything is cached on the device, so the screen still shows data if the Wi-Fi drops (the HUD shows `OFFLINE`).

## Run it on your computer
```bash
python -m http.server 8080
```
Then open http://localhost:8080.

## Put it online for free (GitHub Pages)
1. Create a repo on GitHub (for example `cf-arcade`) and push this folder to it.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**.
3. After about a minute it's live at `https://<your-username>.github.io/cf-arcade/`.

## Set up the Lenovo Idea Tab
1. Open **Chrome** on the tablet and go to your GitHub Pages URL.
2. Chrome menu **⋮ → Add to Home screen → Install**. The icon opens the dashboard **full-screen, without the browser bar**.
3. **Keep the screen on:**
   - The dashboard already asks Android to keep the screen awake while it's open (Wake Lock).
   - As a backup, turn on Developer options: **Settings → About tablet → tap "Build number" 7 times**.
     Then go to **Settings → System → Developer options → Stay awake** (the screen stays on while charging).
   - Keep the tablet plugged in.
4. **Lock it to the app (optional):** **Settings → Security → More security settings → App pinning** (the menu name may vary
   slightly). Open the dashboard, open Recent apps, tap the app icon and choose **Pin**.
5. Turn on **auto-rotate** or lock it to landscape. The layout is designed for landscape, and portrait scrolls.
6. Open the app and tap **PRESS START**. That one tap is needed to enable sound and full screen.

## Files
```
index.html            page shell
css/style.css         pixel-arcade theme
js/util.js            helpers, ranks, settings storage, pixel avatars
js/api.js             rate-limited Codeforces API queue and offline cache
js/stats.js           solves, streaks, XP and levels, records, achievements, daily quests
js/sound.js           8-bit sound effects (Web Audio)
js/fx.js              banners, particles, confetti, toasts, shake
js/charts.js          canvas charts: rating, difficulty, heatmap, radar, rings
js/boards.js          Overview, Practice, Achievements, Rivals, Goals, Records boards
js/live.js            Live contest board
js/stopwatch.js       Stopwatch board (state saved in localStorage)
js/extras.js          Calendar, Weekly boss, Year in review boards; warm-up and morning cards; problemset cache
js/app.js             app controller: refresh scheduler, swiping, effects, settings, night mode
sw.js                 offline support
manifest.webmanifest  install as a full-screen app
```
