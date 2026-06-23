# WC2026 Sweepstake Tracker — Project Documentation

_Last updated: 23 June 2026 — added push notifications (goal/kickoff/full-time) via a real service worker + extended the `football-proxy` Worker. Previously: added multi-group support (code-gated splash, first-time tour, switch-group) and removed the £5 payment paywall. Originally rebuilt 21 June 2026 from the live source (`index.html` + `scoring.js`), not the prior doc — the player roster and architecture had both moved on._

## Overview

A web app tracking a FIFA World Cup 2026 sweepstake ("Sweepstakes"). Deployed to GitHub Pages. Live match data comes from football-data.org via a Cloudflare Worker CORS proxy. Built with React 18 via Babel CDN — no build step, no `node_modules`.

The app supports **multiple friend groups** sharing the same WC2026 tournament data, each with their own player roster, gated behind a code entered on a splash screen (see "Multi-Group Support" below). The original 26-player roster is the first group, code-named `SILVERSTREAM`.

The app is **no longer a single file**. Logic is split so the same scoring code drives both the app and a daily email digest:

| File | Purpose |
|------|---------|
| `index.html` | The entire UI — React app (Babel-compiled inline), all components, styling, PWA wiring. ~3,665 lines. |
| `scoring.js` | Single source of truth for scoring/data logic — group rosters (`GROUPS`), pots, points matrices, all `derive*`/`score*` functions. Loaded as a plain `<script>` (classic-script globals) **before** the Babel app. ~1,670 lines. |
| `sw.js` | Service worker — network passthrough + push/notificationclick handlers. `importScripts('./scoring.js')` so push notification text can resolve player ownership. See "Push Notifications" below. |
| `manifest.json` | PWA manifest (installable web app). |
| `icon-192*.png`, `icon-512*.png` | PWA icons (standard + maskable). |
| `README.md` | Effectively empty. |

**This was the original intent** — `scoring.js` imported as an ES module by the email Worker, so the daily digest and the app could never disagree. **In practice this is not how it currently works**: the deployed email Worker has its own separately-maintained, manually-pasted bundled copy of the scoring logic with no live link back to this file, and it has already drifted out of sync once (June 2026 — see "Email Worker drift" in Known Issues). Changing `POT`, `PTS_INC`, `PLAYERS`, or any `derive*`/`score*` function here does **not** automatically reach the email — you must manually port the change into the Worker and redeploy it too. Treat this repo's `scoring.js` as the source of truth for the *app*; the email Worker needs its own deliberate sync step.

---

## Infrastructure

| Item | Value |
|------|-------|
| **Live app** | https://joshmacklin1.github.io/sweepstake/ |
| **GitHub repo** | joshmacklin1/sweepstake |
| **CORS proxy Worker** | https://football-proxy.joshmacklin7.workers.dev (`WORKER_URL` in `scoring.js`). **Also hosts push notifications** (subscribe/unsubscribe/test endpoints + a 1-minute Cron Trigger that diffs match state and sends Web Push) — see "Push Notifications" below. Edited via Cloudflare dashboard Quick Edit, same as the email Worker — **not in this repo**. |
| **Daily email Worker** | `sweepstake-email` (Cloudflare Workers & Pages, edited via dashboard Quick Edit). **Not in this repo, and does NOT live-import `scoring.js`** — it has its own manually-pasted bundled copy (`src/scoring.source.js` + `src/index.js`, concatenated by esbuild into one file in the dashboard editor) that **drifts unless manually re-synced**. See "Email Worker drift" under Known Issues. |
| **API** | football-data.org free tier (`WC_CODE = "WC"`, `SEASON = 2026`) |
| **API key** | Lives in the Worker, not the repo. Previous doc recorded `d06d96f284d244ad9f4f190b6273300a` — verify it's still the live key before relying on it. |
| **Push subscriptions** | Cloudflare KV namespace `SWEEPSTAKE` (bound to `football-proxy`), keys prefixed `sub:` (subscriptions) and `state:` (last-seen per-match status/score, used to diff for kickoff/goal/full-time). |
| **VAPID keys** | `VAPID_PUBLIC_KEY` is in `scoring.js` (safe to ship client-side); `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` are `football-proxy` Worker secrets, not in this repo. |
| **Stack** | React 18 via Babel CDN |
| **Deploy** | Replace `index.html`, `scoring.js`, and `sw.js` together via the GitHub UI → Pages rebuilds automatically |

---

## Push Notifications

Added June 2026 — real Web Push (works even if the app/tab is fully closed), not just an in-tab `Notification`. Requires a server watching matches independently of any open browser tab, so this feature spans two places: this repo (service worker + subscribe UI) and the `football-proxy` Worker (push backend), which is **not in this repo** — see Infrastructure above.

### Why `football-proxy`, not `sweepstake-email`
The email Worker already has Cron + KV, but it's the one place already known to drift (see "Email Worker drift" under Known Issues) — adding more hand-maintained logic there felt like asking for a repeat. `football-proxy` already fetches the same match data and had a spare KV binding (`SWEEPSTAKE`), so the push backend was added there instead, as a second `scheduled` Cron Trigger alongside its existing `fetch` handler.

### `sw.js` (this repo)
Replaced the old inline Blob-URL-registered service worker — Blob-registered workers don't reliably support the Push API across browsers. `sw.js` is now a real static file, registered via `navigator.serviceWorker.register('./sw.js')`. It keeps the original network-first/empty-fallback `fetch` behaviour and adds `push`/`notificationclick` listeners.

**Owner-aware goal text without duplicating roster data**: the Worker can't know who owns which team without copying `GROUPS` (roster data) into it — exactly the kind of drift the email Worker already suffered. Instead, `sw.js` does `importScripts('./scoring.js')` (wrapped in try/catch — a failure degrades to generic text, doesn't break the SW) and resolves the player itself, client-side, using the new `ownerOfTeamCode(tla, players)` helper in `scoring.js` (a standalone version of `ownerOf`'s lateB tie-break logic, working against a raw `GROUPS[key].players` roster instead of the computed `ranked` array). For a goal, the Worker sends each subscriber `{type:"goal", code, scoringTeam, home, away, hs, as, groupKey, tag}` — `groupKey` is that specific subscriber's own group, captured at subscribe time — and the SW builds **"⚽ Henry's Netherlands scores! 1-0"**, falling back to **"⚽ GOAL — Netherlands"** if the group/owner can't be resolved. Kickoff and full-time don't need an owner, so those stay server-built generic text (`{type:"kickoff"|"fulltime", title, body, tag}`).

### Subscribe/unsubscribe UI (`PushNotificationsSection`, `index.html`)
Lives in Rules & Info (`InfoContent`), just above the "This Device" section. Feature-detects (`'serviceWorker' in navigator && 'PushManager' in window`) and renders nothing if unsupported — notably **iOS Safari only supports push from an installed PWA** (Add to Home Screen, iOS 16.4+), not a regular tab; the section shows an inline note about this. Subscribing requests Notification permission, calls `pushManager.subscribe()` with `VAPID_PUBLIC_KEY` (from `scoring.js`), then POSTs `{subscription, prefs, groupKey}` to `${WORKER_URL}/push/subscribe` — `groupKey` comes from `localStorage.getItem(GROUP_STORAGE_KEY)` (`"sw_group"`), read directly rather than threaded through as a prop. Three per-event-type toggles (⚽ Goals / 🟢 Kickoff / 🏁 Full time, default all on) re-POST the same endpoint with updated `prefs` whenever changed, so the Worker's stored prefs always match what's shown. Subscribed-state and prefs are mirrored into `localStorage` (`sw_push_subscribed`, `sw_notification_prefs`) purely so the UI shows the right state on next load — the Worker's KV record is the actual source of truth for what gets sent.

### `football-proxy` Worker push backend (not in this repo)
- `POST /push/subscribe` / `POST /push/unsubscribe` — store/delete a subscription record in KV (`sub:<sha256(endpoint)>`).
- `POST /push/test` — debug-only: sends one push to a given `{endpoint}` or `{subscription}`, used to manually verify the crypto path against a real device before ever enabling the Cron Trigger.
- `scheduled` handler (Cron Trigger, every 1 minute — Cloudflare's minimum granularity) — fetches matches, diffs each match's status/score against `state:<matchId>` in KV (same logic `index.html`'s `prevScoresRef` goal-flash detection already does client-side: status → `IN_PLAY` from `SCHEDULED`/`TIMED` = kickoff, score increase = goal, status → `FINISHED` = full time), and sends a push to every subscription whose `prefs` opts into that event type. Applies the same COD→DRC TLA normalization `index.html` does, since the scoring team's code gets matched against `GROUPS` data client-side in the SW.
- **Hand-written VAPID (RFC 8292) + `aes128gcm` payload encryption (RFC 8291/8188)** using only Web Crypto (`crypto.subtle` — ECDH, HKDF via HMAC-SHA256, AES-128-GCM, ECDSA P-256 sign). No npm packages (e.g. the `web-push` library), since this Worker is deployed via dashboard Quick Edit, not bundled — same constraint as the email Worker. This is the fiddliest part of the whole feature; verified end-to-end against a real subscribed device via `/push/test` before the Cron Trigger was ever turned on.
- On a 404/410 from the push service (expired/invalid subscription), the dead KV entry is deleted automatically.

### Known limitation
No tooling catches drift between this repo's CORS-proxy/match-shape assumptions (e.g. the COD→DRC normalization, or the `m.score.fullTime.home/away` shape) and what the Worker's diff logic expects — same caveat as the email Worker, just smaller surface area since no roster data is duplicated. If `index.html`'s match-data handling ever changes shape, check whether the Worker's `checkForMatchUpdates` needs the same update.

---

## Multi-Group Support

Added June 2026 so the same app/codebase can run a sweepstake for more than one friend group, without a backend — everything is still a static site.

### `GROUPS` config (`scoring.js`)
Each group is an entry in `GROUPS`, keyed by a short id (e.g. `SILVERSTREAM`): `{ code, label, players }`. `players` is exactly what `PLAYERS` used to be — the full roster array (`name`/`teams`/`codes`/`lateB`/`grimReaper`). `POT`, `GROUP_ASSIGNMENTS`, `PTS_INC`, `WORKER_URL`/`WC_CODE`/`SEASON`, `MOCK_MATCHES` are **not** per-group — every group shares the same tournament data and scoring rules; only the roster differs. `PLAYERS` itself is now just a mutable pointer, initialised to `GROUPS.SILVERSTREAM.players` and **reassigned at runtime** by the group gate once a code is matched. Every `scoring.js` function and every `index.html` component reads `PLAYERS` live (no caching at module-load time), so reassigning the global before `App` mounts is all that's needed — no per-component plumbing.

**Adding a new group** is a manual edit (same workflow as adding a late player used to be): add an entry to `GROUPS` in `scoring.js` with a roster and a unique `code`, then deploy. There's no in-app group-creation flow, and the codes are a **convenience, not real access control** — this is a public static site, so anyone reading the page source can see every group's roster and code. The point is to keep each group's view tidy, not to keep anything secret.

**Variable team counts (not yet needed, but planned for)**: a player's `teams`/`codes` are already arrays, not fixed `team1`/`team2` fields, so a future group with e.g. 8 players/6 teams each works today at the data-model level with zero changes. What **isn't** ready: the flag-row layouts (`PlayerRow` collapsed/expanded, `PlayerModal`, the Rules & Info team-selection cards, the bar race) use a tight `flex, gap:4` with no wrap, sized for "2 flags fits on one line" — with 6 they'd overflow or squash. The fix (`flexWrap:"wrap"`, likely 2 rows of 3, possibly smaller flag size) was deliberately deferred until a real small group exists to test the layout against, rather than guessing now.

### Group gate (`GroupGate`, `index.html`)
Wraps `App` — it's what actually gets passed to `ReactDOM.createRoot(...).render(...)`, not `App` directly. On load it checks `localStorage.sw_group` for a previously-matched group key; if valid, it reassigns `PLAYERS`/`PLAYER_NAME_ORDER` (see below) and renders `App`. Otherwise it renders a **splash screen**: the app logo, a "Group code" text input, and a Continue button. Matching (`matchGroupCode`) is case-insensitive and trimmed against each group's `code`. A bad code shows an inline error ("Code not recognised — check with whoever shared it with you.") rather than anything alarming. On a valid code it writes `localStorage.sw_group` and renders `App`.

`PLAYER_NAME_ORDER` (`index.html`, drives `playerColor()`'s fixed colour-per-player assignment) used to be a hardcoded array of the 26 Silverstream names — now it's derived from the active `PLAYERS` (`PLAYERS.map(p => p.name)`), recomputed by the group gate whenever the group changes, so a different roster still gets correct, collision-free colours.

**Switching groups**: `App` receives an `onSwitchGroup` callback from `GroupGate` (defined inline where `GroupGate` renders `<App />`) that clears `localStorage.sw_group` and resets `GroupGate`'s own state, dropping back to the splash. Surfaced as a **"Switch group"** button in the "This Device" section at the bottom of Rules & Info (`InfoContent`) — deliberately out of the way, since it's a low-traffic admin action. No confirmation dialog: it's non-destructive, nothing client-side is lost by switching.

### First-time tour (`TourOverlay`, `index.html`)
A 5-step static modal (one step per nav tab: Home, League, Scores, The Race, Rules & Info) shown automatically once per device, the first time `App` mounts with no `localStorage.sw_tour_seen` set. Styled to match the rest of the app's modals — same bordered header/footer treatment as the Rules & Info pop-over, and a circular icon badge matching the League table's rank-badge styling — rather than a generic centred dialog. Skippable at any step (✕, Skip, Escape); "Done" on the last step. Dismissing in any way sets `sw_tour_seen` so it doesn't reappear.

**Tried and reverted**: a "spotlight" version that actually drove `setTab`/`setLeagueView` to switch the live screen behind a dimmed backdrop with a cutout highlighting the real nav button for each step (CSS `box-shadow: 0 0 0 9999px` trick for the cutout, `getBoundingClientRect()` for positioning). It worked, but the user felt it looked disjointed from the rest of the app's visual language and asked to go back to the static modal — reverted same session. Don't re-attempt without checking in first; if revisited, the styling (not the navigation mechanic) was the actual problem.

Replayable any time via a **"↻ Retake the tour"** button at the very top of Rules & Info (above the points matrix) — closes the mobile pop-over first if open, so the tour doesn't stack on top of it.

---

## Players & Team Assignments

The roster for the **Silverstream** group (`GROUPS.SILVERSTREAM.players` in `scoring.js`, the original/default group — see "Multi-Group Support" above for how other groups' rosters work). 26 players, **2 teams each**, plus Josh (the Grim Reaper, no teams). Each entry carries `name`, `teams` (display names), `codes` (TLA codes), and `lateB` (per-team late-entry flag).

| Player | Team 1 | Team 2 |
|--------|--------|--------|
| Alex B | Belgium (BEL) | Paraguay A (PAR) |
| Ben | Brazil (BRA) | Sweden A (SWE) |
| Charlotte | Mexico (MEX) | DR Congo (DRC) |
| Craig | Australia (AUS) | Scotland (SCO) |
| Ahmet | Croatia (CRO) | Egypt (EGY) |
| Dharma | England (ENG) | Uzbekistan (UZB) |
| Gary | Spain (ESP) | Saudi Arabia (KSA) |
| Henry | Netherlands (NED) | Norway (NOR) |
| Katrina | Switzerland (SUI) | Bosnia (BIH) |
| Luke DF | Ecuador (ECU) | New Zealand (NZL) |
| Marco | Japan (JPN) | Ghana A (GHA) |
| Michelle | Argentina (ARG) | Ivory Coast (CIV) |
| Natalie | Senegal (SEN) | Turkey (TUR) |
| Nick S | Morocco (MAR) | Cape Verde (CPV) |
| Ollie P | Uruguay (URU) | Qatar (QAT) |
| Paul H | South Korea (KOR) | Iraq (IRQ) |
| Peter W | Austria (AUT) | Czech Republic (CZE) |
| Ramon | Portugal (POR) | Algeria (ALG) |
| Sam | Canada (CAN) | Curaçao (CUW) |
| Stephen | Colombia (COL) | Panama (PAN) |
| Stuart | Iran (IRN) | Jordan (JOR) |
| Wes | France (FRA) | Haiti (HAI) |
| Will A | Germany A (GER) | South Africa (RSA) |
| Will B | United States (USA) | Tunisia (TUN) |
| **Peter H** _(late)_ | Sweden B (SWE) | Paraguay B (PAR) |
| **Alex DL** _(late)_ | Germany B (GER) | Ghana B (GHA) |
| **Josh** | 💀 Grim Reaper — no teams, special scoring | — |

### A/B shared-team mechanic (`lateB`)

Two players joined late (Peter H, Alex DL) and were assigned teams that were **already owned**. Four teams are therefore double-owned:

| Team | Owner A (original) | Owner B (late, `lateB:true`) |
|------|--------------------|------------------------------|
| Germany (GER) | Will A | Alex DL |
| Ghana (GHA) | Marco | Alex DL |
| Sweden (SWE) | Ben | Peter H |
| Paraguay (PAR) | Alex B | Peter H |

- **Both owners earn full points** from the shared team — points aren't split. `scorePlayers` maps each player's codes independently.
- On match cards, `ownerOf()` displays the **non-`lateB` (original) owner** when a code is shared, falling back to whoever is found if no primary exists.

### Pot Seedings (48 teams)

Defined in `POT` in `scoring.js`. `COD` is included as an alias for `DRC` (DR Congo) — football-data.org's 2026 data uses FIFA's official `COD` code; both keys map to the same pot and flag so lookups work regardless of which the API returns.

```
Pot 1: POR, MEX, ARG, NED, ESP, ENG, FRA, BRA, CAN, GER, USA, BEL
Pot 2: MAR, JPN, URU, SEN, CRO, IRN, SUI, COL, AUT, ECU, KOR, AUS
Pot 3: SCO, EGY, PAR, ALG, QAT, NOR, CIV, KSA, PAN, SWE, UZB, RSA
Pot 4: JOR, CUW, BIH, HAI, GHA, NZL, CPV, IRQ, TUN, CZE, TUR, DRC (=COD)
```

---

## Scoring System

All values live in `scoring.js` (`GROUP_WIN_PTS`, `GROUP_DRAW_PTS`, `PTS_INC`).

### Group Stage (per game, per team)
Pot-scaled to reward underdogs winning:

| Result | Pot 1 | Pot 2 | Pot 3 | Pot 4 |
|--------|-------|-------|-------|-------|
| Win    | +2    | +4    | +8    | +12   |
| Draw   | +1    | +2    | +3    | +5    |
| Loss   | 0     | 0     | 0     | 0     |

### Knockout Stage (flat — `PTS_INC`, single highest stage reached)
A team earns the value for the **single highest stage it has reached**, not a sum of every stage along the way — `ptsTotal`/`pts` is a flat lookup into `PTS_INC`, it does not accumulate. E.g. a Pot 4 team currently in the SF (win or lose) earns **500**, not 0+50+150+300+500=1000. (Match-card per-game point displays in `index.html` show the *delta* between consecutive stages — see `deriveMatchPts` — which is a different, derived concept from this flat total; don't confuse the two.) This was previously misdocumented as cumulative here, which contributed to a real bug: the email digest Worker (`worker-email.js`, see "Known Issues" below) had an old cumulative version of `ptsTotal` that inflated everyone's knockout points.

| Stage | Pot 1 | Pot 2 | Pot 3 | Pot 4 |
|-------|-------|-------|-------|-------|
| Last 32 | +0 | +15 | +25 | +50 |
| Last 16 | +5 | +25 | +50 | +150 |
| Quarter Final | +15 | +50 | +100 | +300 |
| Semi Final | +25 | +100 | +200 | +500 |
| Finalist | +50 | +250 | +500 | +1000 |
| Winner 🏆 | +100 | +500 | +1000 | +2000 |

### Group Stage Penalty (`PTS_INC.GROUP_ELIM`)
| Result | Pot 1 | Pot 2 | Pot 3 | Pot 4 |
|--------|-------|-------|-------|-------|
| Group elim | -50 | -15 | 0 | 0 |

### Live scoring
`isSettled(status)` treats `IN_PLAY` and `PAUSED` the same as `FINISHED`, so live matches score in real time.

### Tiebreak
`W×3 + D − L` across all games. Josh (Grim Reaper) is always sorted **last** on a tie with a regular player.

---

## The Grim Reaper (Josh)

No teams. Earns points two ways (`scorePlayers` grim-reaper branch + `reaperBountyForCode` + `goalDroughtPts`):

1. **Group-stage upsets** — earns the absolute value of the owner's penalty when a favourite goes out in groups:
   - Pot 1 group exit → **+50**
   - Pot 2 group exit → **+15**
   - Pot 3/4 → 0 (no penalty exists, so nothing for Josh)
2. **Goal-drought curse** — **+3** for every **0–0** group-stage match. Profits from boring football.

Calibrated to finish **7th–8th** in a typical tournament; freak-upset years could spike him mid-table. He cannot win. Dark-red UI theme to signal danger.

---

## Architecture — Key Functions (`scoring.js`)

| Function | Purpose |
|----------|---------|
| `groupGamePts(code, result)` | Pot-scaled group points for a single W/D/L result. |
| `deriveGroupPts(matches)` | Group W/D/L points per team across all settled group games. |
| `goalDroughtPts(m)` | Returns 3 for a 0–0, else 0 (Grim Reaper). |
| `deriveStages(matches)` | Replays settled matches → `{ eliminated, winners, stageReached }`. Group elim = 3 group games played AND not present in any knockout fixture. |
| `deriveWDL(matches)` | W/D/L tally per team across all settled games. |
| `scorePlayers(matches)` | **Main scorer.** Returns ranked array: `total`, `teams[]`, `w/d/l`, `tiebreak`, `hist`, `lastChange`, `pctChange` (+ `_eliminated`/`_matches` for Josh). Sorts by total, Grim Reaper last on ties, then tiebreak. |
| `compute24hRankChange(matches, currentRanked)` | **Table-position** movement over a rolling 24h window. Builds a second ranking from matches >24h old and diffs positions. Returns `Map<name, delta>` (positive = moved up). Replaces the old % change. |
| `compute24hPtsChange(matches, currentRanked)` | **Points** gained over the same rolling 24h window as `compute24hRankChange` (kept as a separate function, not folded into that one, since its `Map<name, number>` shape is already relied on by existing callers — see comment in `scoring.js`). Powers the "(+Npts)" shown next to risers in the **Home** tab. |
| `computeNewBadges24h(badgesNow, matches)` | Badges present now that weren't present in a `computeBadges` snapshot from matches as of 24h ago — i.e. "assigned in the last 24h", for the Home tab's **New Accolades**. Reuses the already-computed current badge set rather than recomputing it; the 24h-ago snapshot is computed **without** `rank24hChange`/`winPctPlayers` (no clean "value as of 24h ago" for those windowed/simulated inputs — `computeBadges` already guards their absence), so Climber/Sliding/The Prophecy simply count as "new" the day they first appear. Single-holder badges (Top Dog, Firepower, etc.) naturally surface for whoever holds them *now* if the holder changed within the window, since `computeBadges` only ever assigns them to one current player — no separate "most recent owner" logic needed. |
| `simulateWinProbability(ranked, matches, N=5000)` | Monte Carlo, pot-weighted knockout probabilities. Returns `{ players, teams }` — player sweepstake-win % and per-team World-Cup-win %. Surfaced in the `PlayerModal`. Heuristic ("for fun"), not real odds. |
| `computeBadges(ranked, matches, rank24hChange)` | Accolades per player: `{ name: [{ icon, label, desc, tone }] }`, ordered **rarest-first** (so the row preview highlights unique badges, not common ones like Clean Sheet). Row shows the **top 2** icons; full list in the player pop-over. |
| `deriveHistory(matches)` | **Bucketed** standings (MD1/MD2/MD3 then stage names) → `{ history, bucketLabels }`. Used by `BumpChart` only (~8 columns max). |
| `deriveSparklineHistory(matches)` | **Per-match** history (one point per scoring event). Used by sparklines + bar race. |
| `deriveRaceEliminations(matches)` | Per-frame elimination snapshots for the bar race — array where `[i]` = team codes eliminated as of bar-race frame `i`. Mirrors `deriveSparklineHistory`'s frame-advance gating so the two stay aligned (keep them in sync). |
| `ptsTotal` / `pts` | Points for a team's single highest stage (flat lookup into `PTS_INC`). |
| `ownerOf(tla, ranked)` | Owner name for a team code; prefers the non-`lateB` owner for shared teams. |
| `getBroadcast(home, away)` | UK broadcaster (BBC/ITV) per fixture from the `BROADCAST` map; defaults BBC. |
| `flag(code)` / `FLAG_ISO` | flagcdn.com URL per team. |

### Accolades (`computeBadges`)
Each badge has a `tone` (`good`/`bad`); shown as icons next to the name (top 3) and listed with descriptions in the player pop-over (good = green label, bad = red).

**Good:** 🏆 Top Dog (1st) · 🔮 The Prophecy (favourite — highest sweepstake win %) · 🚀 Climber (biggest 24h rise) · ⚡ On Fire (most pts last round) · 💥 Firepower (most goals scored) · 🔪 Giant Killer (beat a higher-pot team) · 💎 Underdog (Pot 3/4 team into knockouts) · 🧱 Brick Wall (fewest goals conceded) · 🎸 One Man Band (biggest points gap between a player's two teams) · 🥚 Early Bird (first to score).
**Bad:** 📉 Sliding (biggest 24h drop) · 🚰 Leaky (most goals conceded) · 💨 Firing Blanks (fewest goals scored) · 🤡 Big Flop (Pot 1 team out in groups) · 🦆 Still Quacking (0 points) · 🩸 First Casualty (first to lose a team) · ⚰️ Wiped Out (first to lose both teams).
**Grim Reaper only:** 💀 Grim Reaper — Josh's single accolade (he gets no others). Rendered via the badge system (no longer hardcoded in the name), so it shows once next to his name and once in his pop-over accolades. His league row keeps the "Grim Reaper — earns on boring football & eliminations" subtitle where other players show flags (he has no teams).
(Climber/Sliding use the `rank24hChange` map passed in from App. "Rough Night" was removed.)

---

## UI Components (`index.html`)

| Component | Notes |
|-----------|-------|
| `GroupGate` | Actual render root (mounted via `ReactDOM.createRoot(...).render(<GroupGate />)`, not `App` directly). Renders the code-entry splash, or reassigns `PLAYERS`/`PLAYER_NAME_ORDER` and renders `App` once a group is matched/restored. See "Multi-Group Support". |
| `App` | Mounted by `GroupGate` once a group is active. Owns all state, data fetch loop, scroll behaviour, modals. |
| `TourOverlay` | First-time/replayable app walkthrough — static 5-step modal, one step per nav tab. See "Multi-Group Support" → "First-time tour". |
| `Flag` | flagcdn.com image at a **uniform 3:2 aspect** (`width = size×1.5`, `objectFit:"cover"`) so flags are consistent app-wide (schedule, league, info dialog, banner). Self-healing load via the shared `flagHandlers(code, size)` helper (see Known Issues — "Intermittent blank flags"); optional 🐌 snail overlay. (The group/knockout views use their own fixed 34×23 imgs — also wired to `flagHandlers`; the bar race uses 22×15 `background-image` boxes, which **aren't** — CSS background images have no `onError`/`onLoad` hook, so they'd need a different, JS-preload-based fix if this ever shows up there too.) |
| `Sparkline` | SVG, green positive / red negative / grey zero. |
| `PlayerRow` | Collapsed: rank badge, name + badges, flags (sorted winner→alive→eliminated), sparkline, pts, 24h rank-change pill, chevron. Expanded: per-team flag/name/W-D-L/pot/stage/pts; Josh gets a Bounty Board (upset count + drought count). |
| `PlayerModal` | Pop-over (reuses `.info-backdrop`/`.info-card`) opened by tapping a player row. Shows total + sweepstake win %, a points-over-time sparkline, and each team's results + WC-win %. Reaper variant shows the Bounty Board. Replaced the old expand-drawer (the drawer JSX in `PlayerRow` is now dead/never-rendered — `expanded` is never passed). |
| `TeamModal` | Bottom sheet (same `.detail-backdrop`/`.detail-sheet` treatment as `PlayerModal`) opened by tapping a team side (flag + owner + team name + pts) in the Scores tab. Shows the team's name, owner, pot, current stage, total pts, and a per-match results list (W/D/L badge + opponent flag + score + pts earned). Swipe-to-dismiss on mobile. Opened via `onTeamClick` prop on `MatchCard`; `selectedTeam` state in `App`. |
| `MatchCard` | Stage, time, home/away owner + team + pot, score/vs, broadcaster. Rivalry tag on first meetings only: 👑 Title Showdown (1st v 2nd). (🥊 Grudge Match — adjacent positions could leapfrog — was tried and removed at the user's request, June 2026.) |
| `BumpChart` | SVG bump chart over **bucketed** history. RTL-scroll trick starts pinned to the current state; tap a name/legend to highlight. Lives in the **The Race** tab. (No "Rankings Over Time" heading; the Watch-the-Race button + `BarRaceModal` were lifted out to `App`/the header.) |
| `BarRaceModal` | Full-screen bar race over **per-match** history. Stable alphabetical DOM order so CSS `top` transitions fire both ways. Each bar shows the player's two team flags (fixed 22×15 boxes in a fixed-width column so every bar starts/ends at the same x). Elimination is **progressive** — driven by `elimByFrame` (from `deriveRaceEliminations`) at the current frame, not the final state; an eliminated team's flag goes greyscale + dimmed with a small red ✕ (no badge circle). Josh (no teams) shows a 💀 in the flag column instead. |
| `TeamsTab` | Renders the **Groups** and **Knockouts (bracket)** views (`view` = `groups` \| `knockout`). |
| `HomeTab` | The **Home** tab (June 2026) — the app's homepage. Opens on a **"Currently Leading" headline card** (the one big hero element on the page, same visual weight as the live-match banner) showing the #1 player's flags/name/points, then flat digest-style sections in this order: **Top of the Table**, **Recent Results**, **Risers & Fallers**, **New Accolades**, **Up Next**. Order was deliberately put through the user for review (League-style "who's winning" first, since that's what people already default to checking, ahead of "what just happened") rather than just mirroring the email digest's own order. **Top of the Table reuses `PlayerRow`'s rank-badge-circle + `Sparkline` treatment** (not a static medal emoji) so it shares the League tab's visual language instead of reading as a stripped-down report next to it — this was the user's read on why Home "doesn't look as eye catching as the league." Went through several shapes before landing here: a literal 1:1 port of the email with one generic "Open the full table →" CTA; then one card per app area (League/Scores/Race); then a flat digest-matching layout in the email's own order; current shape adds the headline card, the PlayerRow-style Top of the Table rows, and the final Top-of-Table-first ordering. "Yesterday's Results" became "Recent Results" — a rolling **last-24h** window (`recentResults`) matching the same timeframe `rank24hChange`/`rank24hPtsChange` already use, rather than calendar "yesterday". **Recent Results and Up Next render real `MatchCard`s** in the same `league-grid fixture-grid` grid as the Scores tab (at the user's request, to look identical to it) — not wrapped in the `Section` card, since `MatchCard` already draws its own border/background per match; the condensed `DigestMatchRow` component these two used originally is gone. Footer links: Top of the Table → League ("View league"), Recent Results → Scores, Risers & Fallers → The Race — each calls `window.scrollTo(0,0)` before `setTab(...)` so the destination tab opens at its top rather than wherever Home happened to be scrolled; New Accolades and Up Next have no link. Pure read-only summary, built from data `App` already computes (`ranked`, `badges`, `rank24hChange`, `matchPtsById`, `upcoming`) plus the new `rank24hPtsChange`. **Home is the default landing tab** (`useState("home")`, was `useState("table")`). "New Accolades" uses a time-based `computeNewBadges24h` (see `scoring.js`) meaning "badges actually assigned in the last 24h," and shows an explicit "No new accolades in the last 24h" empty state instead of vanishing when empty. |

### Navigation & tabs
- **Main nav** — mobile: bottom bar (BBC Sport style); desktop: the same markup is restyled via CSS into a left **sidebar**. Items: **Home** (house icon), League (trophy icon), **Scores** (football icon), **The Race** (checkered-flag icon), Rules & Info. `tab` state: `home` \| `table` \| `scores` \| `race` \| `info`.
- **Home** (June 2026, see `HomeTab` above) — a new nav item added *alongside* the existing tabs, not a replacement for the default landing tab; the app still opens on League/Sweeps (`useState("home")` was deliberately **not** used for `tab`'s initial value). Nav icon is a plain house outline (`navIconHome`) — went through a newspaper/digest-page icon first, renamed/redrawn to a house at the user's request once the tab itself was renamed "Today" → "Home".
- **Scores** (June 2026 — merged from the old separate **Schedule** + **Scores** tabs into one, BBC Sport app style) shows a single calendar day's matches at a time — past, live, and future all render through the same list (and the same `MatchCard`, which already branched on `fin`/`live`/`scheduled`). Which day is showing is driven by a **day strip** (`DayPicker`) in the sticky header, just like the Sweeps toggle: every calendar day spanned by `matches` (min `utcDate` to max `utcDate`, inclusive — not just days with fixtures, so an idle day still renders an explicit "No matches on this day" rather than being skipped) renders as a tappable date chip; the selected day is bold with an underline, "Today" replaces the weekday label on the actual current date. `selectedDay` state is `null` by default (meaning "today", clamped into the matches' date range if today falls outside it — e.g. before the tournament starts or after it ends); navigating to the Scores tab from elsewhere resets it back to `null`/Today. Helpers `dayKey`/`sameDay` (top-level, outside `App`) do the local-calendar-day comparison. Replaces the old `groupByDay` (grouped headers within one combined list) and `matchView` fixtures/results toggle entirely — both removed as dead code.
  - **Chip colour coding** — a solid green fill (matching the Sweeps-toggle "selected" convention) was tried for the selected day and reverted at the user's request in favour of a gold underline; the underline was then recoloured from gold to `C.accent` green to match the mobile bottom-nav's active-item colour (same green, different shape — the nav uses a filled pill, the day chip keeps the underline). **Today**, when *not* the selected day, keeps a lighter green tint (`rgba(34,197,94,0.18)`) so it stays visible as a "go back here" landmark while browsing other days.
  - **Mobile vs desktop input** — deliberately different per platform, not one shared control. Mobile: pure swipe/touch-scroll (`overflowX:"auto"`, scroll-snap, native scrollbar hidden via the `.day-strip` CSS class — `scrollbar-width:none` + the `::-webkit-scrollbar` hide), with **edge fade gradients** (`C.bg` → transparent, 36px) hinting there's more to scroll; a fade only renders on a side that actually has more days (`atStart`/`atEnd` state from an `onScroll` handler). Desktop has no swipe gesture, so it additionally gets small `.day-nav-arrow` circular buttons overlaid on the fades — same mobile-hidden/desktop-shown CSS convention as the existing `HScrollButtons` used for the bracket and bump chart, kept as a **separate bespoke control** here (not a reuse of `HScrollButtons` itself) since that component's `position:sticky` styling is tailored to floating above tall scrollable content, not sitting inline in the day strip.
  - Selecting a day (tap a chip, or the desktop arrows) auto-centres the chip via `scrollIntoView({ inline:"center" })`; `atStart`/`atEnd` are re-checked ~350ms later once that smooth scroll settles.
- **The Race** tab shows the bump chart; its **🏁 Watch the Race** button sits in the sticky header (where toggles live on other tabs) styled as a green-gradient CTA so it reads as a button, not a toggle. `showRace` state and the `BarRaceModal` render live in `App` (lifted out of `BumpChart`).
  - Active item: mobile shows a green pill behind the icon; **desktop** shows a full-row dark-green highlight (`rgba(34,197,94,0.16)`) + bold white label, driven by `data-active` on the button + desktop CSS. _(Added June 2026.)_
  - Rules & Info icon is a **question mark in a circle**. _(Added June 2026.)_
- **Sub-toggle** (inside the League tab) — **Sweeps / Groups / Knockouts** (`leagueView` state: `league` \| `groups` \| `knockout`). It lives **inside the sticky header** (after the live banner), rendered when `tab === "table" && !loading`. Styled by the `.sweeps-nav` (padding wrapper) / `.sweeps-seg` (segmented control) class pair; segments fill edge-to-edge (`overflow:hidden`, no inner padding); no divider line below it. _("League" relabelled "Sweeps", "League Table" caption removed — June 2026.)_
  - **Tried and reverted (June 2026): moving this toggle to its own sticky block outside `#appHeader`.** The goal was to make the header's bottom border end right under the live banner (matching every other tab, e.g. Home) instead of under the toggle. Implemented via a separate `position:sticky` div pinned with `top: var(--hdr-h)`, tracking the header's live-measured height via the same `ResizeObserver` that drives the desktop `.hscroll-nav` buttons. **Visible bug**: that measurement lags a frame or two behind the title row's `max-height`/`opacity` collapse transition, briefly exposing a sliver of card content (a player row's sparkline) in the gap between the header and the toggle. Reverted — the toggle is back as a normal child of `#appHeader`, and the border was moved onto the **live/next-match banner's own div** instead (`borderBottom` added directly to both banner branches, header's own `borderBottom` removed). Same visual result, no JS measurement, no lag, no seam — don't repeat the separate-sticky-block approach for this.

**Title lockup (mobile + desktop, consistent):** logo on the **left**, vertically centred (`align-items:center`) against a text column — green "FIFA World Cup 2026" eyebrow over "Sweepstakes" (was the two-line "Silverstream Sweepstakes" wordmark via `<br>`, now a single word/line since the title went generic — June 2026). Logo placed left via flex `order` (base64 `<img>` stays put in the DOM). Mobile: in the collapsing title row (logo 30px, wordmark 18px), buttons on the right. Desktop: in the static `#sidebar-header` block (logo 50px, wordmark 20px).

**Rules & Info — desktop tab vs mobile pop-over.** The content lives in a shared `InfoContent` component, rendered two ways depending on `isDesktop` (`window.innerWidth >= 768`):
- **Desktop:** a normal **tab** (`tab === "info"`) rendered in the body like League/Scores/Race. Navigated purely via the sidebar — no pop-up, no ✕. The "Rules & Info" sidebar item highlights when `tab === "info"`.
- **Mobile:** a windowed **pop-over** (`showInfo && !isDesktop`) — `.info-backdrop` scrim (`z-index:25`) → `.info-card` (centred rounded panel, `68vh`, space around it incl. nav clearance) → header (title + ✕) → scrollable `InfoContent`. Closes via ✕, backdrop tap, or tapping another nav item. Highlighted in the nav while open.

The nav button branches: `onNav`/`active` use `isDesktop ? setTab("info") : setShowInfo(true)`. Bottom nav is `z-index:30` (above the mobile dialog) so it stays tappable.

**Player pop-over uses `.detail-card`** (windowed on *both* mobile and desktop — a focused detail card shouldn't go full-screen on desktop). The Rules mobile card uses `.info-card`.

**Desktop dev toggle:** a subtle `.desktop-dev` button fixed bottom-left of the sidebar (desktop only) toggles dev mode (amber when on). The mobile dev `···`/💳/⚽ buttons remain in the (mobile-only) header.

**Knockout bracket — Last 32 order is intentional.** The Last 32 column follows the official FIFA bracket seed order (`R32_FIXED_MATCHES`, matches 73–88), NOT group A–L order. This is deliberate: it keeps the bracket a correctly-connected tree (each later-round card sits at the midpoint of its two feeder matches). Sorting Last 32 by group would break that alignment — don't "fix" it.

### Sticky-header scroll behaviour (the important bit)
The header is **one** `position:sticky; top:0; z-index:20` block containing, top to bottom: the **title row** (logo + "Sweepstakes" + dev/share/info buttons), the **live/next-match banner**, and the **Sweeps toggle**.

- On **scroll-down** (mobile), only the title row collapses (`max-height` → 0, `opacity` → 0, driven by `barsVisible`). The banner + toggle stay pinned at the very top and slide up into the vacated space.
- On **scroll-up**, the title row expands back.
- On **desktop**, the title row is `display:none` (it lives in the sidebar), so the header is just banner + toggle, always pinned.

This replaced an earlier workaround where the whole header slid away and two **duplicate fixed-position "fake sticky" live cards** faked persistence — those duplicates have been **deleted**. `barsVisible` (set by the scroll-direction handler) now drives the title-row collapse and the bottom-nav hide; there is no longer a whole-header transform.

**Scroll handler hysteresis** — the collapse is anti-jitter: always-show when `scrollY < 48`; a **12px dead zone** that ignores small moves without resetting the anchor (so slow scrolling accumulates to one clean toggle); and a **220ms cooldown** after each toggle (`barLockRef`) to absorb the extra scroll events that the title collapse triggers by changing page height. Without these, slow scrolling flickered the bars between states.

---

## Visual Design

The sticky top area (title + live banner + toggle) and the bottom nav share the app background (`#0d1f12`) but are set off by a `1px solid #1e3d28` divider on their app-facing edge — header: bottom border; nav: top border. (An earlier black-background experiment was reverted; the divider lines do the separation.)

### Palette (`C`, dark forest-green theme)
```javascript
bg:      "#0d1f12"   surface: "#122018"   card:   "#162a1c"
border:  "#1e3d28"   muted:   "#6b9e7a"   dim:    "#8fba9a"
text:    "#f0faf3"   accent:  "#22c55e"   green:  "#22c55e"
red:     "#ef4444"   gold:    "#f59e0b"
```
Cards: 14px radius, 10px bottom margin, no special 1st-place treatment.

### Player colours
Each player gets a fixed colour from the `PLAYER_COLORS` array, assigned by alphabetical name order (`PLAYER_NAME_ORDER`) — **not** rank-based. Josh's row uses the dark-red Grim Reaper theme.

### Stage colours (`STAGE_COLOR`)
Winner `#f59e0b`, Finalist `#a78bfa`, Semi `#60a5fa`, QF `#34d399`, L16 `#fb923c`, L32 `#94a3b8`, Group elim `#ef4444`.

---

## App State (`App`)

```javascript
matches      // raw API match array          loading / error / lastUpdated
tab          // "table" | "scores" | "race" | "info"
leagueView   // "league" | "groups" | "knockout"
expanded     // player name or null (expanded card)
refreshing   // manual-refresh spinner        copied // share-button feedback
devMode + devModeRef   // MOCK_MATCHES toggle; ref prevents interval override
goalFlash + prevScoresRef   // goal-detection animation
barsVisible + lastScrollY   // header/nav hide on scroll down
countdown    // next-match countdown string
selectedDay  // Scores tab day strip — null means "today" (clamped into matches' date range)
showTour     // first-time app walkthrough modal; also replayable from Rules & Info
```

`PLAYERS`/`PLAYER_NAME_ORDER` are **not** React state — they're mutable globals (`var`) in `scoring.js`/`index.html`, reassigned by `GroupGate` (see "Multi-Group Support").

---

## Data Flow

```
football-data.org API
  → Cloudflare Worker (CORS proxy)
  → fetchMatches() every 60s (skips in devMode via devModeRef)
  → setMatches(data.matches)
  → scorePlayers(matches) → ranked[]
  → deriveHistory(matches) → bucket history + bucketLabels (BumpChart)
  → deriveSparklineHistory (inside scorePlayers) → p.hist (sparklines + bar race)
  → compute24hRankChange(matches, ranked) → rank movement pill
  → computeBadges(ranked, matches) → badges{}
  → goal-detection useEffect → goalFlash
```

---

## Features & Behaviours

### Dev mode
`···` button in header toggles `DEV`. Uses `MOCK_MATCHES` — a full hardcoded tournament (all 12 groups, L32, L16 with 1 live game, through to England winning the final) for testing scoring/UI offline. Disables auto-refresh via `devModeRef`; toggling resets to the League/Sweeps view.

### Goal flash
`prevScoresRef` stores `{h, a}` per live match and compares against the next refresh to detect **which side** scored. On an increase → `goalFlash` true for 2.5s (green page pulse) and `goalInfo` set to `{ code, team, owner }`. The centred **⚽ GOAL!** overlay shows the scoring team's **flag**, the **owner's name** emblazoned large (green glow), and the team name beneath, with a `goalPop` scale-in entrance.

### Share
`⎘` button copies WhatsApp-ready text (top 3 + biggest mover + link) to clipboard; shows ✓ for 2s.

### Home tab — "New Accolades" timing
`computeNewBadges24h` (in `scoring.js`) diffs the current badge set against a snapshot of badges as of 24h ago, so "new" means **assigned in the last 24h** — a real, time-based window, the same one `rank24hChange`/`rank24hPtsChange` use. Not "since the last 7am email" (the app still has no visibility into the email Worker's own send-history KV); not "since you last opened the tab" either — an earlier `localStorage.sw_seen_badges`/per-device "seen" approach was tried first and replaced with this actual time window at the user's request.

### Info modal (Rules & Info tab)
A **"↻ Retake the tour"** button at the very top, then the points matrix, Grim Reaper explainer, a **Players & Team Selection** list (one card per player with their teams + pots — Josh excluded via `PLAYERS.filter(p => !p.grimReaper)`), and finally a **"This Device"** section at the bottom with a **"Switch group"** button. No top "How Points Work" heading. See "Multi-Group Support" above for what the tour/switch-group buttons actually do.

### PWA
`manifest.json` + maskable icons make it installable. `sw.js` (a real static file, not the old inline Blob-URL worker) does a network-first fetch with a silent empty-response fallback — lightweight, no real offline caching — plus push/notificationclick handlers. See "Push Notifications" above.

---

## Recent Changes — June 2026 (UI pass)

1. **Sticky-header rework** — collapsed the old whole-header-slide + duplicate fixed live cards into a single sticky header (title → banner → toggle). On scroll-down only the title row collapses; banner + toggle stay pinned. Duplicate "fake sticky" cards deleted. (See "Sticky-header scroll behaviour" above.)
2. **Sweeps/Groups/Knockouts toggle** segments fill the bar edge-to-edge; no divider line below it.
3. **"LEAGUE TABLE" caption** removed; toggle label **"League" → "Sweeps"** (internal id stays `league`).
4. **Desktop sidebar** active item highlighted with a full-row dark-green tint + bold white label, via `data-active` on the nav button + scoped desktop CSS.
5. **Rules & Info** icon changed to a question-mark-in-circle.
6. **New "The Race" tab** (checkered-flag icon, between Results and Rules & Info) holding the bump chart + race controls. The **🏁 Watch the Race** button moved to the **top**, above the chart. The bump chart was removed from the Sweeps view.
7. **Fixtures + Results merged** into one **Matches** tab (football icon — circle + central pentagon + 5 seams) with a Fixtures/Results toggle in the sticky header (`matchView`, default Fixtures). The standalone Fixtures and Results tabs were removed.
8. **Top/bottom bar separation** — sticky top area and bottom nav kept on the app background (`#0d1f12`) but separated by a `#1e3d28` divider on their app-facing edge (header bottom border + nav top border). A black-background version was tried and rolled back.
9. **Icons/labels** — League icon → **trophy**; Matches renamed **Schedule** with a **calendar** icon.
10. **Race controls** — "Rankings Over Time" heading removed; **🏁 Watch the Race** moved into the sticky header as a green-gradient CTA button (`showRace`/`BarRaceModal` lifted to `App`).
11. **Info modal** — removed the "How Points Work" title; added a **Players & Team Selection** heading above the team list; dropped Josh's empty card from that list.
12. **Scroll anti-jitter** — added a dead zone + cooldown to the bar show/hide handler to stop the top/bottom bars flickering on slow scroll.
13. **Goal overlay** — GOAL! flash now shows the scoring team's flag + owner name (per-side detection).
14. **Desktop horizontal-scroll buttons** — reusable `HScrollButtons` (‹ ›, desktop-only via `.hscroll-nav`) above the **knockout bracket** (scroll one stage, ~196px) and the **bump chart** (scroll ~2 columns). The buttons are **sticky** — pinned just below the header via `top: calc(var(--hdr-h) + 8px)` (the header measures its own height into `--hdr-h` with a ResizeObserver) so they stay reachable while scrolling a tall chart/bracket. The `dir="rtl"` start-trick was replaced with a scroll-to-end effect so the buttons behave predictably. Mobile keeps touch-scroll.
15. **Pot swap** — Sweden moved to **Pot 3**, Tunisia to **Pot 4** (`POT` in `scoring.js`); all scoring/flags derive from `POT`, so it propagates automatically.
16. **Bump chart fill-width** — desktop columns now stretch to fill the content column down to a `MIN_COL` (80px) floor; only past that (many games) does the chart scroll. (Replaced the earlier fixed-92px approach that left dead space.)
17. **Bar race flags** — each bar now shows the player's two team flags between the name and the bar; eliminated teams render greyscale + 50% opacity with a small red ✕ badge top-right.
18. **Position-change indicator** — the sweeps table pill now reads "▲/▼ N pos" (so it's clearly position, not points); no movement shows a grey "0 pos" pill instead of "No change (24h)".
19. **Share button removed** — the header `⎘` share button is hidden (`.share-btn { display:none }`); it only ever appeared on mobile.
20. **Dev goal trigger** — in dev mode a ⚽ header button fires the goal overlay with example data, for previewing the animation.
21. **Bar race — progressive elimination** — flags now grey out gradually as teams are knocked out across the race frames (via `deriveRaceEliminations`), instead of all showing the final state from the start.
22. **Bar race — alignment + subtle X** — flags render in fixed-width boxes so every bar starts and ends at the same x; the elimination mark is now a small plain red ✕ (no circle badge).
23. **Deploy guard** — `index.html` guards calls to newer `scoring.js` functions (`typeof … === "function"`) so a stale `scoring.js` degrades gracefully instead of blanking the app.
24. **Mobile title bar** — compact single-line lockup (logo left ~30px + one-line wordmark, no eyebrow) to cut vertical space when open.
25. **Desktop scroll buttons** — made the `.hscroll-nav` bar transparent + `pointer-events:none` (buttons keep `pointer-events:auto`) so the sticky toolbar no longer covers/blocks the bracket cards underneath.
26. **Desktop dev toggle** — subtle bottom-left sidebar button (desktop only) to switch dev mode on/off.
27. **Rules & Info → dialog** — opens over the current tab (stays on Race/etc.) with ✕ to close; nav stays tappable to switch away. No longer a tab.
28. **Mobile title bar** — left lockup: logo left, vertically centred against the two-line "FIFA World Cup 2026" (green) + "Sweepstakes" text block. (Tried a centred version first; reverted to left.)
29. **Bump chart fade** — the left history-fade only shows when the chart is actually wide enough to scroll horizontally.
30. **Uniform flags** — `Flag` now renders at a fixed 3:2 aspect (`objectFit:"cover"`), so flags are consistent across the schedule, league table, info dialog and banner (matching the knockout view).
31. **Title lockup** — logo left, vertically centred against the two-line eyebrow + wordmark, on **both** mobile and the desktop sidebar header (consistent).
32. **Rules & Info pop-over** — windowed centred card with space around it on mobile (full-screen on desktop); highlighted in the nav while open; opens from "?" or the nav; closes via ✕, backdrop, or tabbing away.
33. **Bump chart mobile width** — fixed the right-hand gap; the chart now fills the content column (the available-width calc was over-subtracting by ~28px).
34. **League-table flags** — the collapsed `PlayerRow` flags used custom inline `<img>` with `width:auto` (missed by the `Flag` fix); set to `27×18` `objectFit:"cover"` so they're uniform like everywhere else.
35. **Next-match banner** — removed the "All fixtures →" link; moved the countdown to the top-right of the card.
36. **Player pop-over** — tapping a player row opens a `PlayerModal` with points + sweepstake win % + a points-over-time chart + per-team results and WC-win %. The win-probability sim (`simulateWinProbability`) now also returns per-team odds. (Replaced the expand-drawer.)
37. **Card height / slick close** — the info & player cards cap at `68vh` on mobile (was full height) so there's free space below to thumb-close; added a `modalIn` scale-in.
38. **Win-odds fix (shared teams)** — the win sim mapped each team code to a single owner, so A/B shared-team players (Peter H, Alex DL) came out at 0%. Now maps each code to ALL owners (`codeToPlayers`) and credits them all.
39. **Win-chance label** — player pop-over labels it "Sweeps win chance" (vs each team's "% to win WC") to avoid confusion.
40. **Rules & Info: desktop tab** — on desktop it's now a sidebar tab (no pop-up/✕); mobile keeps the windowed pop-over. Shared `InfoContent` component.
41. **Player pop-over windowed on desktop** — `.detail-card` (not full-screen). Player rows get a `.player-card` hover affordance so they read as clickable.
42. **Sub-toggle defaults** — entering the League tab resets to **Sweeps**; entering Schedule resets to **Fixtures** (done in the nav `onNav`). Navigating also closes any open player pop-over.
43. **Player pop-over centring (desktop)** — the `.info-backdrop` is confined to the content column (`left:260px; width:min(760px, 100vw-260px)`) so the card centres over the list behind it rather than the whole viewport.
44. **Accolades** — expanded `computeBadges` to 11 good/bad accolades (Top Dog, Climber, On Fire, Giant Killer, Underdog, Clean Sheet, Early Bird; Wooden Spoon, Sliding, Big Flop, Still Quacking). Shown as icons next to the name in the league row and listed with descriptions in the player pop-over. (Rough Night removed.)
45. **Badge preview limit** — league row shows at most **2** badge icons (was 3, which crowded names on mobile), ordered **rarest-first** so unique accolades win the slots over common ones.
46. **Firepower / Leaky / Brick Wall accolades** — 💥 Firepower (most goals scored), 🚰 Leaky (most conceded), 🧱 Brick Wall (fewest conceded — single best-defence player). All from per-team goals-for/against across settled matches. **Clean Sheet removed** (too many players had it).
49. **The Prophecy / One Man Band** — 🔮 The Prophecy (player with the highest sweepstake win %, via `winPct` now passed into `computeBadges`); 🎸 One Man Band (biggest points gap between a player's two teams). **Wooden Spoon removed.**

48. **Elimination-badge timing** — First Casualty / Wiped Out now time group elimination to when a team is **mathematically locked into 4th** (can't qualify via top-2 or best-third), not just their 3rd group game. Added `GROUP_ASSIGNMENTS` to `scoring.js`. A rival counts as guaranteed-above if their current points already exceed the team's max (points-only), **or** their current points exactly equal the team's max *and* the two have already played a decisive (non-draw) head-to-head — per FIFA's 2026 tiebreak order, head-to-head outranks overall goal difference, and a played result can't change, so this stays gapless without needing to bound future goal difference. (`h2hWinner` map in `computeBadges`, June 2026.)

47. **More accolades** — 💨 Firing Blanks (fewest goals scored); 🩸 First Casualty (first to lose a team) and ⚰️ Wiped Out (first to lose both) via chronological elimination dates — group elimination is timed to the match after which a team is **mathematically locked into 4th** of its group (≥3 teams guaranteed above on points; needs `GROUP_ASSIGNMENTS`, added to scoring.js), knockout elimination to the lost match; 💀 Grim Reaper is now Josh's single accolade (badge-driven, removed the hardcoded skull); his league row keeps the text subtitle (pirate-flag idea tried and reverted — emoji didn't match the photo-flags).

50. **Schedule/Results split, points display, result banners** — bottom nav's combined Schedule tab split into separate **Schedule** (upcoming only) and **Scores** (finished only, football-icon nav button — hand-drawn `fill-rule="evenodd"` cutout SVG, several iterations to get a recognizable ball rather than a star/flower at 22px). Scores cards show each team's sweepstake points earned via new `deriveMatchPts` in `scoring.js` (per-match points: group = that game's W/D/L value; knockout = delta between consecutive stages, so a winner/loser of a non-final tie typically show the *same* value — both "reached" that round). Extended to live matches too (`isSettled`, not just `FINISHED`) so the in-progress banner card shows projected points. Added a 5-tier upset ladder banner (Fairytale → Giant Killer → Heroic Stand → Punched Above → Upset Alert, ranked by pot-gap and win-vs-draw) and a Shock Exit banner (Pot 1/2 favourite lost a knockout match, knockout-only — group-stage elimination timing is the complex `GROUP_ASSIGNMENTS` logic from #48, not duplicated here), with Shock Exit taking priority over the upset ladder when both apply. A "Big Swing" banner (top-3 matches by combined points) was tried and removed at the user's request.

51. **Email digest — New Accolades section** — `sweepstake-email` Worker now ports a simplified subset of `computeBadges` (everything except 🔮 The Prophecy and 🩸/⚰️ First Casualty/Wiped Out — see "Email Worker drift" in Known Issues for why those two were deliberately left out) and shows newly-earned badges since the last email by diffing against badge labels stored in the existing KV snapshot. Done as part of fixing the drift incident in the same Known Issues section.

52. **Schedule + Scores merged back into one "Scores" tab, BBC Sport day-strip style** — reversed #50's split. One tab now shows a single calendar day's matches (mixing past/live/future as appropriate for that day) selected via a swipeable `DayPicker` day strip in the sticky header, instead of two separate "all upcoming" / "all finished" lists. Removed the `matches` tab id, `navIconSchedule`, and the old `groupByDay` day-header grouping. See "Navigation & tabs" above for the full mechanics.

53. **New "Home" tab — in-app homepage, inspired by the email digest** — added as a new bottom-nav item (not a change to the default landing tab), went through three shapes in one sitting before settling: (1) a literal 1:1 port of the email's sections with one generic "Open the full table →" CTA at the bottom; (2) reworked into one `AreaCard` per app area (League/Scores/The Race) once it became clear this tab is the app's **homepage**, not an email clone, each with its own footer link into that area's full tab; (3) settled on a flat digest-matching section layout (`Section` helper, label above a card — closer to the email's actual look than the area-card version), final order **Recent Results (Last 24h) → Risers & Fallers → New Accolades → Top of the Table → Up Next** (the user's preferred order — note Risers & Fallers and New Accolades are swapped relative to the email's own order), keeping a footer link on every section that maps to a real tab (Recent Results/Up Next → Scores, Risers & Fallers → The Race, Top of the Table → League). "Yesterday's Results" became "Recent Results (Last 24h)" — a rolling 24h window (`recentResults`) matching the same timeframe `rank24hChange`/`rank24hPtsChange` already use, rather than calendar "yesterday". Nav item renamed **Today → Home** with a house icon (`navIconHome`) partway through, replacing an earlier newspaper/digest-page icon. New `HomeTab`/`DigestMatchRow` components in `index.html`, plus a new `compute24hPtsChange` in `scoring.js` (points-delta companion to the existing `compute24hRankChange`, needed for the "(+Npts)" next to risers — kept separate rather than changing `compute24hRankChange`'s return shape, which existing callers depend on). "New Accolades" is tracked via a `localStorage` seen-badges set (`sw_seen_badges`) rather than the email Worker's KV snapshot, so it means "new since last opened on this device," not "new since the last email" — see "Home tab" under Features & Behaviours.

54. **Home tab polish + made it the default landing tab** — section order tightened to **Recent Results → Top of the Table → Risers & Fallers → New Accolades → Up Next** (Top of the Table moved up under Recent Results); dropped the "(Last 24h)" suffix from the Recent Results title as redundant; removed the "View all scores" footer link from Up Next (Recent Results keeps the only Scores-tab link). **New Accolades** changed from the `localStorage.sw_seen_badges` "seen since you last opened this tab" approach to a real time window — new `computeNewBadges24h(badgesNow, matches)` in `scoring.js` diffs the current badge set against a snapshot from 24h ago, so "new" now means **assigned in the last 24h**, consistent with every other section on the page (see "Home tab — New Accolades timing" under Features & Behaviours for why single-holder badges don't need special-casing here). The Scores tab's day-strip selected-day underline was recoloured from gold to `C.accent` green to match the mobile bottom nav's active-item colour. Finally, **Home is now the default landing tab** (`tab` state `useState("home")`, was `useState("table")`) — supersedes #53's "added alongside, not a replacement for the default" note.

## Recent Changes — June 2026 (multi-group support)

55. **£5 payment paywall removed entirely** — was already disabled by default (`PAYMENT_PROMPT_ENABLED = false`) after player complaints; removed outright (state, callback, effects, dev re-trigger button, modal JSX, all `sw_paid`/`sw_paid_snooze_until` localStorage reads/writes) rather than left as dead code, ahead of the multi-group work below (which would otherwise have needed it namespaced per group).
56. **Generic title** — "Silverstream Sweepstakes" → "Sweepstakes" everywhere (`<title>`, mobile/desktop wordmarks, `manifest.json`, `scoring.js` header comment), ahead of supporting other friend groups. The old two-line "Silverstream / Sweepstakes" wordmark (via `<br>`) naturally collapsed to one line/word.
57. **`GROUPS` config** — the hardcoded `PLAYERS` roster moved into `GROUPS.SILVERSTREAM.players` in `scoring.js`; `PLAYERS` is now a mutable pointer reassigned at runtime per active group. `index.html`'s hardcoded `PLAYER_NAME_ORDER` array replaced with one derived from the active `PLAYERS`. See "Multi-Group Support" above for the full design.
58. **Group-code splash screen (`GroupGate`)** — gates the whole app behind a code matched against `GROUPS`; persists the choice in `localStorage.sw_group`. Not real access control, just a convenience so each group only sees its own roster (public static site — see "Multi-Group Support").
59. **First-time tour (`TourOverlay`)** — 5-step static walkthrough auto-shown once per device (`localStorage.sw_tour_seen`), replayable via "↻ Retake the tour" in Rules & Info. A "spotlight" version that drove real tab navigation behind a dimmed cutout was built, tested, and reverted in the same session — the user preferred the static modal but asked for it to be restyled to match the app's existing modal/badge visual language rather than read as a generic dialog. See "Multi-Group Support" for what was tried.
60. **Switch group** — "Switch group" button added to a new "This Device" section at the bottom of Rules & Info (deliberately low-key — an admin action, not a player-facing feature); clears `localStorage.sw_group` and drops back to the splash. No confirmation dialog (non-destructive).

## Recent Changes — June 2026 (push notifications)

61. **Real service worker** — `sw.js` replaced the inline Blob-URL-registered one (Blob workers don't reliably support the Push API); same fetch behaviour, plus `push`/`notificationclick` handlers.
62. **`football-proxy` Worker extended with a push backend** — `/push/subscribe`, `/push/unsubscribe`, `/push/test`, and a new 1-minute Cron Trigger that diffs match state (KV) and sends Web Push for kickoff/goal/full-time. Hand-written VAPID + `aes128gcm` encryption via Web Crypto only (no npm packages — Quick Edit deploy, same constraint as the email Worker).
63. **Owner-aware goal notifications without duplicating roster data** — `sw.js` imports `scoring.js` directly (`importScripts`) and resolves the scoring player client-side via a new `ownerOfTeamCode` helper, so the Worker never needs its own copy of `GROUPS`. New `VAPID_PUBLIC_KEY` constant added to `scoring.js`.
64. **Subscribe/unsubscribe UI** — new `PushNotificationsSection` in Rules & Info, with per-event-type prefs (goals/kickoff/fulltime) and an iOS Add-to-Home-Screen note. See "Push Notifications" above for the full design.

---

## Deployment

1. Go to https://github.com/joshmacklin1/sweepstake
2. Replace `index.html`, `scoring.js`, **and `sw.js` together** — all three are coupled now. `index.html` calls functions defined in `scoring.js` (e.g. `deriveRaceEliminations`), so deploying a new `index.html` against an old `scoring.js` will **blank the whole app** (undefined function on render). `sw.js` separately `importScripts('./scoring.js')` for push notification text — a mismatch there degrades to generic notification text rather than breaking anything, but keep them in sync regardless. When in doubt, re-upload all three. (As a safety net, `index.html` guards calls to newer `scoring.js` functions with a `typeof … === "function"` check, but keeping files in sync is the real fix.)
3. GitHub Pages rebuilds automatically (~30s).
4. The CORS proxy Worker (`football-proxy`) doesn't need redeploying unless the API key/endpoint changes, **or** the push notification logic changes (it now also hosts the push backend — see "Push Notifications" above). If you change `normalizeTla`/the COD→DRC handling, the match-data shape assumptions, or anything in `checkForMatchUpdates`'s diff logic, the equivalent needs porting into the Worker's pasted code (dashboard Quick Edit, no auto-sync — same caveat as the email Worker below).
5. The **email digest Worker is different — treat any `scoring.js` change as requiring a manual email-Worker update.** It does not auto-pick-up changes from this repo (see "Email Worker drift" in Known Issues for why). Checklist whenever `POT`, `PTS_INC`, `GROUP_WIN_PTS`/`GROUP_DRAW_PTS`, `PLAYERS`, or any `derive*`/`score*`/`computeBadges` function changes in this repo's `scoring.js`:
   - Open the `sweepstake-email` Worker in the Cloudflare dashboard → Quick Edit.
   - Manually port the equivalent change into its bundled scoring code.
   - Save and Deploy, confirm a new version appears in the Worker's **Versions** tab.
   - Hit `https://sweepstake-email.joshmacklin7.workers.dev/__test-send` to trigger a real send immediately (bypasses the "did anything finish" gate) and sanity-check the numbers against the live app before trusting the next scheduled (7am) run.

---

## Known Issues / Notes

- football-data.org free tier has rate limits; the key lives in the Worker. The push notification Cron Trigger adds one more request per minute against the same key — well within free-tier limits, but worth knowing if rate-limit errors ever show up.
- **Push notifications require an installed PWA on iOS** (Add to Home Screen, iOS 16.4+) — Safari doesn't support the Push API from a regular tab. The subscribe UI doesn't currently detect "installed vs. not" and just shows a static note about this.
- There's no way to test the push Cron Trigger's diff logic against `devMode`/`MOCK_MATCHES` — that's client-side only. The Worker always fetches the real football-data.org API, so the only real end-to-end test is a live match event (the crypto/subscribe/owner-name-resolution parts were each verified independently instead — see "Push Notifications" above).
- **Group codes are not real access control** — this is a public static site, so anyone who views page source can see every group's code and roster in `GROUPS`. The splash screen is a convenience (keeps each group's view tidy) not a security boundary. Don't use this for anything where that distinction matters.
- Group-stage elimination = team has 3 group games played AND appears in no knockout fixture.
- Knockout points are **flat, not cumulative** — `ptsTotal`/`pts` looks up the single highest stage reached in `PTS_INC`; `stageReached` tracks which stage that is. (This line previously said "cumulative" in two places in this doc — that was wrong; see "Scoring System" above for the full correction and why it mattered.)
- Tiebreak `W×3 + D − L`; Josh always loses ties to regular players.
- Win% simulation (`simulateWinProbability`) is computed but not rendered anywhere.
- `BumpChart` `dir="rtl"` trick starts scrolled right — no JS needed.
- Bar race uses stable alphabetical DOM order so CSS `top` transitions fire both up and down.
- **Intermittent blank flags** (DR Congo, later Uruguay/Ollie P on a near-1-minute on/off cadence) — root cause never conclusively isolated. Code-reviewed and ruled out as app-side: the flag URL/code reaching each `<img>` is fully static (hardcoded literals in `PLAYERS`/`FLAG_ISO`, never reassigned), no ISO/TLA collisions, and the league-row reorder animation only touches `style.transform` via a ref (never removes/reinserts DOM nodes, so it can't be forcing image reloads). Presumed cause: flagcdn.com occasionally serving a 200 OK with empty/corrupt image data for one asset (an edge-cache blip) — that doesn't fire `onError`, the image just renders blank. **Mitigated** (not root-caused) via the shared `flagHandlers(code, size)` helper: catches the "loads but blank" case via `onLoad`'s `naturalWidth === 0` check (not just `onError`), retries once with a cache-busting query string, then falls back to the text badge only if the retry also fails. Originally only the `Flag` component had any fallback at all — `PlayerRow`'s own inline flag `<img>`s (the league table, predates `Flag`, never migrated onto it) and the Groups/Knockout views' inline `<img>`s had **none**, so this was very likely where the reported flicker actually showed up; all now wired to `flagHandlers` too. The bar race's flag boxes use a CSS `background-image`, not an `<img>`, so they have no `onError`/`onLoad` hook and are **not** covered by this fix.

### Email Worker drift (June 2026 incident)

The `sweepstake-email` Cloudflare Worker was found to be running a stale, manually-pasted copy of the scoring logic that had drifted from this repo's `scoring.js` in **two** ways simultaneously:

1. **Stale `POT` values** — still had the pre-swap `SWE:4`/`TUN:3` (see Recent Changes #15) instead of the corrected `SWE:3`/`TUN:4`.
2. **Wrong `ptsTotal` formula** — an old **cumulative** version (summing every stage increment a team passed through) instead of the app's actual **flat** version (single highest stage only). This alone inflated every knockout team's points in the email, independent of bug #1.

Root cause: the email Worker is edited via the Cloudflare dashboard's Quick Edit (no Wrangler/local project — confirmed June 2026), so there is **no automatic sync** between this repo's `scoring.js` and what the Worker actually runs, despite earlier docs in this file claiming otherwise (now corrected). Caught because Peter H's email total (20pts) didn't match the live app (16pts).

**Fixed**: both bugs corrected directly in the Worker's bundled code (June 2026) and a "New Accolades" section was added at the same time (see `computeBadges` port in the Worker — deliberately a simplified subset, see comment in that function for what was excluded and why).

**Going forward**: see the Deployment section's email-Worker checklist above. There is currently no tooling to catch this drift automatically — it relies on someone noticing a number looks wrong, same as this time.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | The app UI — deploy to GitHub Pages |
| `scoring.js` | Shared scoring/data logic — deploy alongside `index.html`; also imported by the email worker |
| `sw.js` | Service worker — deploy alongside `index.html`/`scoring.js`; handles push/notificationclick, `importScripts`s `scoring.js` |
| `manifest.json` | PWA manifest |
| `icon-192.png`, `icon-192-maskable.png`, `icon-512.png`, `icon-512-maskable.png` | PWA icons |
| `worker-email.js` | Daily email digest Worker (imports `scoring.js`) — deployed separately, not in this repo |
| `SWEEPSTAKE_PROJECT.md` | This document |

`football-proxy`'s push-notification source (subscribe/unsubscribe/test endpoints, the Cron-triggered diff logic, hand-written VAPID/encryption) is **also not in this repo** — deployed via Cloudflare dashboard Quick Edit, same as `worker-email.js`. See "Push Notifications" above.
