# WC2026 Sweepstake Tracker — Project Documentation

## Overview

A web app tracking **multiple** FIFA World Cup 2026 sweepstake pools ("groups"),
deployed to GitHub Pages. Match data comes from football-data.org via a
Cloudflare Worker CORS proxy. Built with React 18 via Babel CDN — **no build
step, no node_modules**. It is a **PWA** (installable, offline-tolerant, with
web-push goal notifications).

The app is no longer a single file: scoring/data logic lives in `scoring.js`,
which is shared verbatim by the web app, the email digest worker, and the
service worker, so none of them can ever disagree on anyone's points.

> **Source-of-truth note:** `CLAUDE.md` designates *this* file as the source of
> truth. Keep it updated as the code changes.

---

## League Season Sweepstake (in progress)

A second sweepstake covering the **2026-27 Premier League + Championship**
season is being built alongside the WC app.

| File | Purpose |
|------|---------|
| `league.html` | The league app shell — **a structural clone of the WC app's UI**, adapted to the league format. **Bottom nav** (Home · Sweeps · Tables · Scores · More, WC pill-highlight style). **Home** mirrors the WC HomeTab section-for-section on a 7-day rhythm: Currently Leading hero, Top of the Table (mini rows + sparklines + pills), Recent Results, Risers & Fallers, New Accolades (`computeNewLeagueBadges` diff), Up Next. **Pop-up cards**: `SnapSheet` (ported drag/snap bottom sheet, 50vh↔92vh, desktop windowed card) hosting `PlayerCardContent` (stat boxes, points-over-time sparkline, teams, accolades, results with 🏅/⚠️ season-bonus milestone rows, upcoming) and `TeamCardContent` (owner card with `playerColor` initial circle, points + season/position boxes, results with per-match pts). Cards swap in place (team↔owner) with **browser-history integration** (back button closes, Escape too). **Sweeps rows = WC PlayerRow anatomy** (rank circle, badges, crest row, sparkline, weekly pill); tapping opens the player card (no inline expansion). Rules & Info is a **pop-over via the More menu** (like the WC app), which also holds the replay toggle and group switch. **Player-first display rule** everywhere: owner name emphasised, club as muted context. Replay scrubber sits under the header when active. Loads `league-scoring.js?v=N` — same cache-bust rule as the WC pair (currently `?v=4`) |
| `league-scoring.js` | Teams (44, keyed by **numeric API id**, not TLA), pots (3-season weighted composite seeding), points matrices, `deriveLeagueTable` / `deriveSeasonOutcomes` / `scoreLeaguePlayers` / `computeLeagueBadges` / `deriveLeagueHistory` (per-day cumulative totals for sparklines, incremental — invariant: final frame == live totals) / `computeWeekRankChange` + `lgWeekWindow` (7-day movement, `anchorIso`-aware so replay works) / `deriveLeagueMatchPts` (per-match points attribution for +pts chips and cards) / `computeNewLeagueBadges` (7-day badge diff for Home). Prefixed `LEAGUE_`/`league`/`lg` — no globals shared with `scoring.js`. `LEAGUE_SEASON` is **2025 for testing; flip to 2026 at launch**. Group: `RODENTS` — same crew as the WC Rodents (8 players + Josh as reaper), 2 PL + 2 ELC teams each covering all four pots; **placeholder draw** until the real one |
| `league-data-2025.js` | Trimmed real 2025-26 PL+ELC results (937 matches) as a `LEAGUE_REPLAY_DATA` global, injected on demand by replay mode (a .js global, not .json, so it works on file:// previews) |

Club **crests** come from `crests.football-data.org/<id>.png` (public, no
auth) in place of the WC app's flagcdn flags. Teams use the WC visual
language otherwise (same `C` palette).

**Scoring is empirically calibrated, not copied from the WC app.** Match
points (win/draw by pot, per league: `LEAGUE_MATCH_PTS`) and season-outcome
bonus values (`LEAGUE_BONUS`) were fitted to the last three seasons' actual
per-pot W/D/L rates and outcome frequencies so the expected season total is
flat across pots (PL within 2.8%, ELC within 4.9%) — WC group-stage
multipliers would have let Pot 4 dominate over 38/46 games. Jackpot values
survive only for outcomes with zero cases in three seasons (e.g. P4 league
title). See the calibration comment block in `league-scoring.js`.

Key facts: football-data.org free tier covers PL + ELC (incl. playoff
fixtures) but **not the FA Cup** — season-outcome bonuses (title / top 4 /
promotion / playoffs / relegation) are the flat "knockout drama" layer
instead. The existing CORS Worker forwards PL/ELC requests unchanged.
Free tier reaches back 3 seasons (2023–2025). Playoff stage labels vary by
season ("SEMI_FINALS"/"FINAL" vs flat "PLAYOFFS"), so the final is identified
structurally. Bonuses award only when **mathematically settled**
(conservative pairwise clinch maths — validated drift-free against daily
replay snapshots of 2025-26). UI (`league.html`) is built out — full
group-gated app (Home / Sweeps / Tables / Scores / More) verified rendering
end-to-end against the 2025-26 replay data.

---

## Infrastructure

| Item | Value |
|------|-------|
| **Live app** | https://joshmacklin1.github.io/sweepstake/ |
| **GitHub repo** | joshmacklin1/sweepstake |
| **CORS / API proxy Worker** | https://football-proxy.joshmacklin7.workers.dev |
| **Email digest Worker** | `worker-email.js` (imports `scoring.js` as ES module) |
| **API** | football-data.org free tier, competition `WC`, season `2026` |
| **API key** | held as a Worker secret (not in the client); legacy key `d06d96f284d244ad9f4f190b6273300a` |
| **Push (VAPID public key)** | `BBuhMJuFwH_TG-NwDHP8JE5iEi5rPfWnv3Qa6gcFNxW7fID5B_N5IYa3KAwZSfr94qrEk0KryC7QcjSxcLtH_vU` (private key = Worker secret) |
| **Stack** | React 18 + Babel via CDN, `index.html` + `scoring.js` |
| **Deploy** | Local clone → feature branch → PR/review → merge to `main` → Pages auto-deploys (~30s) |

### Files

| File | Purpose |
|------|---------|
| `index.html` | The app shell + all React components (Babel-compiled inline) |
| `scoring.js` | **Single source of truth** for rosters, pots, scoring rules, and all `derive*`/`score*`/`compute*` functions. Loaded as a plain `<script>` before the app script |
| `sw.js` | Service worker — registers push, shows goal notifications (uses `GROUPS`/`ownerOfTeamCode` via `importScripts('./scoring.js')`), passthrough fetch |
| `worker-email.js` | Cloudflare Worker for the daily digest email — `import`s `scoring.js` so the email scores identically to the app *(not in this repo snapshot; lives in the Worker)* |
| `manifest.json` | PWA manifest (name, theme `#0d1f12`, icons) |
| `icon-192/512(.maskable).png` | PWA icons |
| `CLAUDE.md` | Claude Code working instructions (stack constraints, git workflow, preview gotchas) |
| `README.md` | One-paragraph repo intro |
| `SWEEPSTAKE_PROJECT.md` | This document |

### Coupling & guard pattern

`index.html` and `scoring.js` **must deploy together**. `index.html` guards
calls to newer `scoring.js` functions with `typeof fn === "function"` checks
(e.g. `compute24hPtsChange`, `deriveRaceEliminations`, `deriveMatchPts`) so a
version mismatch degrades gracefully instead of blanking the app. **Preserve
this pattern** when adding new `scoring.js` functions that the app calls.

---

## Multi-Group System

The app serves several independent friend groups from one codebase. Each group
has its own roster; **the World Cup data, pots, and scoring rules are shared**.

```javascript
var GROUPS = {
  SILVERSTREAM: { code:"SILVERSTREAM", label:"Silverstream", players:[…] },
  RODENTS:      { code:"RODENTS",      label:"Rodents",      players:[…] },
  CORNWALL:     { code:"CORNWALL",     label:"Cornwall",     players:[…] },
  MACKLINS:     { code:"MACKLINS",     label:"Macklins",     players:[…] },
  CAVERSHAM:    { code:"CAVERSHAM",    label:"Caversham",    players:[…] },
};
var PLAYERS = GROUPS.SILVERSTREAM.players;   // default; reassigned at runtime
```

| Group | Code | Real players | Teams each | Grim Reaper | Notes |
|-------|------|-------------|-----------|-------------|-------|
| Silverstream | `SILVERSTREAM` | 26 | 2 | Josh | Default roster. Includes **late-B** players (`lateB:true`) who **share** team codes with an existing owner → a team can be co-owned |
| Rodents | `RODENTS` | 8 | 6 | Josh | The original pool. Draw was predetermined, not randomised |
| Cornwall | `CORNWALL` | 16 | 3 | Josh | Randomised, balanced — each player gets 3 of the 4 pots (misses exactly 1) |
| Macklins | `MACKLINS` | 7 + MACK-BOT | 6 | **anonymous "Grim Reaper"** | Family pool. **Josh is a real player here.** `MACK-BOT` (`isBot:true`) plays normally (can win) — bot flag only drives a flavour badge |
| Caversham | `CAVERSHAM` | 16 | 3 | Josh | Randomised, balanced like Cornwall |

### The group gate (entry flow)

`ReactDOM.createRoot(...).render(<GroupGate />)` — `GroupGate` is the root, **not** `App`.

```
GroupGate
 ├─ reads localStorage["sw_group"] (GROUP_STORAGE_KEY)
 ├─ if valid stored key →
 │     PLAYERS = GROUPS[key].players            ← global reassigned, idempotent, on render
 │     PLAYER_NAME_ORDER = PLAYERS.map(p=>p.name)
 │     render <App onSwitchGroup={…} />
 └─ else → show code-entry form
        matchGroupCode(input): case-insensitive match of input → GROUPS[key].code
        on match → store key, render App
```

- **`PLAYERS` is a mutable global.** Every `scoring.js` function and every
  component reads it live. The gate reassigns it *before* `App`'s first render,
  so no effect/refresh is needed.
- `onSwitchGroup` clears `localStorage["sw_group"]` and returns to the gate
  (reachable from the **More** menu → "Switch group").
- Adding a group = add a `GROUPS` entry by hand with a unique `code`. No other
  wiring needed.
- **Admin quick-switch** (`isAdmin` only): tapping the header logo opens
  `GroupSwitcherMenu`, a popover listing every `GROUPS` key. Picking one calls
  `onQuickSwitchGroup(key, openTarget?)`, which updates
  `localStorage["sw_admin_sim"]` (`ADMIN_SIM_KEY`) and `simGroup` directly —
  no detour through `AdminGroupSelector`. `<App>` is given `key={simGroup}`
  so React fully remounts it on switch (fresh fetch, no stale memoized
  standings from the previous group). The full-screen `AdminGroupSelector`
  (and MoreMenu → "Switch group", which returns to it) still exist as the
  sign-out-capable entry point.
- **Admin cross-group search**: `SearchOverlay` normally only searches the
  active group's `ranked` players/teams. When `isAdmin`, `App` also computes
  `crossGroupRanked` via `scoreAllGroups(matches)` (scoring.js — temporarily
  swaps `PLAYERS`/`POT_OVERRIDES`/`KNOCKOUT_ONLY` per group and restores them
  before returning) and passes it down, so results from every group are
  listed too — tagged with their group name since teams/names duplicate
  across groups — plus family results (any group's `GROUPS[key].families`).
  Picking a result from a **different** group than the one currently active
  calls `onQuickSwitchGroup(key, {type, id})` — the `openTarget` param
  mentioned above. Since the switch remounts `<App>`, GroupGate holds the
  pending target in its own `pendingOpen` state (survives the remount) and
  passes it in as `initialOpen`; the freshly-mounted `App` opens that
  player/team/family modal itself in a mount-only effect, then clears it via
  `onInitialOpenHandled`.

### Player object shape

```javascript
{ name, teams:[…names], codes:[…TLAs], lateB:[…bool],
  grimReaper?:true, isBot?:true }
```

`lateB[i] === true` marks a team the player co-owns as a late addition; owner-
lookup helpers (`ownerOf`, `ownerOfTeamCode`) prefer the **non-lateB** owner
when a code is shared.

---

## Scoring System

> ⚠️ **The single biggest correction vs. the old docs.** Knockout points are
> **FLAT — the value for the highest stage a team reaches**, *not* a cumulative
> sum of every stage. The matrix variable is named `PTS_INC` ("incremental")
> and its header comment describes summing stages — **both are misleading**. In
> the actual code, `scorePlayers` uses `pts()` → `ptsTotal()`, which returns the
> single flat value for the highest stage. A Pot 4 team reaching the SF scores
> **500, not 1000**; a Pot 1 winner scores **100, not 195**.

A player's total = **flat knockout value (highest stage reached)** **+** **group-stage W/D/L points**, summed across their teams. The Grim Reaper scores separately (see below).

### Group stage (per game, per team)

| Result | Pot 1 | Pot 2 | Pot 3 | Pot 4 |
|--------|-------|-------|-------|-------|
| Win    | +2    | +4    | +8    | +12   |
| Draw   | +1    | +2    | +3    | +5    |
| Loss   | 0     | 0     | 0     | 0     |

`GROUP_WIN_PTS = [2,4,8,12]`, `GROUP_DRAW_PTS = [1,2,3,5]`.

**Live vs confirmed split.** A live match's points move the **displayed totals
and table positions** in real time — `scorePlayers`/`deriveStages`/
`deriveGroupPts` use `isSettled()` (which treats `IN_PLAY`/`PAUSED` as
finished). But the **sparklines and the knockout bracket are confirmed-only**:
they only redraw/resolve when a match is `FINISHED`. So during a live game the
big number rises while the sparkline stays flat and the bracket doesn't advance
or eliminate — everything snaps to the confirmed state at the final whistle.
Implemented by: `deriveSparklineHistory` replays FINISHED-only (no live point
appended); `deriveTeamHistory` reconciles its endpoint against a "confirmed
view" (live matches downgraded to `SCHEDULED` first, keeping qualification
credit but dropping live scores); `KnockoutBracket` computes `winner`/✕ only
when `status === "FINISHED"`.

### Knockout stage — FLAT value for highest stage reached (`PTS_INC`)

| Stage (`PTS_INC` key) | Pot 1 | Pot 2 | Pot 3 | Pot 4 |
|-----------------------|-------|-------|-------|-------|
| `LAST_32`        | 0   | 15  | 25   | 50   |
| `LAST_16`        | 5   | 25  | 50   | 150  |
| `QUARTER_FINALS` | 15  | 50  | 100  | 300  |
| `SEMI_FINALS`    | 25  | 100 | 200  | 500  |
| `FINALIST`       | 50  | 250 | 500  | 1000 |
| `WINNER` 🏆      | 100 | 500 | 1000 | 2000 |

A team is awarded **only** the row for its highest stage (e.g. a winner gets the
`WINNER` row, full stop). These numbers are effectively the cumulative totals —
they're just applied flat, not summed.

### Group stage penalty (`PTS_INC.GROUP_ELIM`)

| | Pot 1 | Pot 2 | Pot 3 | Pot 4 |
|---|---|---|---|---|
| Group elim | -50 | -15 | 0 | 0 |

### Tiebreak & sort order

`scorePlayers` sorts by: **total desc → Grim Reaper last → tiebreak desc**,
where `tiebreak = W×3 + D − L` across all the player's games. The reaper always
loses ties to real players (note: the reaper isn't always named "Josh" — Macklins
uses an anonymous "Grim Reaper").

Display ranks **share** on exact ties (same total *and* tiebreak) via
`_displayRank`.

---

## The Grim Reaper

One entry per group with `grimReaper:true` (named "Josh" in most groups, an
anonymous "Grim Reaper" in Macklins/Caversham). No teams; scores from:

1. **Group-stage upsets** — earns the absolute value of the owner penalty when a
   favourite goes out in the groups: **Pot 1 elim → +50**, **Pot 2 elim → +15**,
   Pot 3/4 → 0 (`reaperBountyForCode`).
2. **Goal-drought curse** — **+3** for every **0-0** finished group game
   (`goalDroughtPts`).

Calibrated to finish 7th–8th in a typical tournament; can spike mid-table in a
freak-upset year but **cannot win**. Dark-red card theme (see Visual Design →
danger palette). The win-probability sim keeps the reaper's total fixed (no
future upside once the group stage is done).

---

## Architecture — `scoring.js` functions

### Config / data
| Name | Purpose |
|------|---------|
| `GROUPS`, `PLAYERS`, `PLAYER_NAME_ORDER` | Rosters; active roster (runtime global) |
| `POT` | Team → pot (1–4). Includes **`COD` alias for `DRC`** (real API uses FIFA's "COD") |
| `GROUP_ASSIGNMENTS` | WC groups A–L → team codes (for elimination maths) |
| `PTS_INC`, `GROUP_WIN_PTS`, `GROUP_DRAW_PTS` | Points matrices (see Scoring) |
| `FLAG_ISO`, `flag()` | Team → flagcdn.com ISO code / URL |
| `BROADCAST`, `getBroadcast()` | Fixture → UK broadcaster (BBC/ITV); defaults to BBC |
| `STAGE_ORDER/LABEL/COLOR`, `fmt()` | Stage ordering, display labels/colours, date formatting |
| `MOCK_MATCHES` | Dev-mode fixture set (full group stage + knockouts through a simulated Final) |

### Pure derive / score functions
| Name | Returns / role |
|------|----------------|
| `deriveStages(matches)` | `{ eliminated, winners, stageReached }` — highest stage per team, who's out, who won. Group-elim only flags **unambiguous 4th** (`isDefinitelyFourth`, FINISHED group games only). Also credits teams that have **clinched** a top-2 group spot (`clinchedR32`) as having reached `LAST_32` *before* the real R32 fixtures exist (definite-only). **Knockout rounds (Last 32 → Semis) are live-projected**: whoever's currently ahead in an `IN_PLAY`/`PAUSED` match provisionally advances/is eliminated, same as `deriveMatchPts`'s live "+Npts" and how group matches already score live — self-corrects instantly if the live score (or final result) changes, since this recomputes from scratch every call. The FINAL is the one exception: only `winner && fin` crowns the actual World Cup champion; a live final's loser is still marked `FINALIST`/eliminated in real time, just not "champion" |
| `clinchedR32(matches)` | Set of team codes that have **mathematically** clinched top-2 in their group. Per-group brute force over every remaining-result combo (≤ 3⁶); a team clinches only if top-2 in **every** scenario, ties broken pessimistically. Best-3rd qualifiers deliberately not inferred (credited when real fixtures publish) |
| `deriveWDL(matches)` | Per-team `{w,d,l}` across all settled games |
| `deriveGroupPts(matches)` | Per-team group W/D/L points |
| `scorePlayers(matches)` | **Main scorer.** Ranked array: `total, teams[], w/d/l, tiebreak, hist, lastChange, pctChange` (+ `_eliminated`/`_matches` for reaper). Sort described above |
| `ptsTotal(code, stageKey)` / `pts()` | Flat points for a team at a stage (the real knockout-scoring path) |
| `compute24hRankChange(matches, ranked)` | Map name → **table-position delta over a rolling 24h window** (replaces old "% change"). +ve = moved up |
| `compute24hPtsChange(matches, ranked)` | Map name → points gained in the same 24h window |
| `simulateWinProbability(ranked, matches, N=5000)` | **Now used.** Monte-Carlo, pot-weighted KO matchups, handles shared codes, reaper fixed. Returns `{ players:{name→win%}, teams:{code→%}, predicted:{name→{rank,confidence,field}} }`. `predicted` = modal finishing position across sims among the **real** field (reaper excluded) + % of sims at that position; drives the player card's "Predicted finish (Nth of M) · X% confidence" stat |
| `computeBadges(ranked, matches, rank24hChange, winPctPlayers)` | Per-player badge arrays (see Badges); sorted rarest-first |
| `computeNewBadges24h(badgesNow, matches)` | Badges newly assigned in the last 24h (for the notifications drawer) |
| `deriveHistory(matches)` | **Bucketed** (MD1/MD2/MD3 then stage names) → `{ history, bucketLabels }`. BumpChart only |
| `deriveSparklineHistory(matches)` | **Per-match** (one frame per scoring event). Sparklines + bar race. Credits the **Last 32 clinch bonus** at the frame a team mathematically clinches (computed as-of-that-frame, awarded *silently* so it rides an existing frame and never spawns a new one — keeps overlays frame-aligned). **Best-3rd resolution (`resolveThirds`)** — the top-8 thirds' Last 32 bonus and the 4 non-qualifying thirds' GROUP_ELIM penalty — fires **in-loop the instant every group finishes**, so a group-stage penalty lands chronologically at the end of the group stage, not deferred to a post-loop frame at the very end of the timeline. This also brings its frame count into exact alignment with `deriveRaceEliminations`/`deriveRaceStages` |
| `deriveMatchPts(matches)` | Points attributable to each match id (TeamModal / match detail) |
| `deriveTeamHistory(matches)` | **Per-team** cumulative sweepstake-points history (Teams-table sparklines). Forward-replay of **confirmed events only** — same model as `deriveSparklineHistory`, keyed by team code: group W/D points as earned; the Last-32 qualification (+) via pessimistic `clinchedR32` (top-2) or `resolveThirds` at group completion (best-3rds), and the group-elim penalty (−) for 4th / non-qualifying-3rd; each knockout round reached (winner advances = banks next round). Using confirmed (never "as it stands") states is what avoids phantom rise-then-drop lines — e.g. a team that briefly sat in the provisional top-8 thirds is not credited a bonus it loses. A final reconciliation pins each endpoint to the exact displayed swPts. All series share one timeline; memoized in `TeamsLeagueTab`. *(Earlier "as-of-`deriveStages`" + running-max-clamp approach was replaced — the clamp couldn't undo provisional **over**-crediting that settles back down.)* |
| `deriveRaceEliminations(matches)` | Per-frame elimination snapshots aligned 1:1 with `deriveSparklineHistory` frames (bar-race crosses). **Keep frame-advance gating in sync with that function** |
| `deriveRaceStages(matches)` | Per-frame **tournament-stage label** (Group Stage Game 1–3, Last 32/16, Quarter/Semi Finals, Finals), aligned 1:1 with `deriveSparklineHistory` frames (same change-trigger as `deriveRaceEliminations`). Drives the bar-race stage overlay. **Keep frame-aligned** |
| `goalDroughtPts(m)` | 3 if a finished match is 0-0, else 0 (reaper) |
| `ownerOf(tla, ranked)` / `ownerOfTeamCode(tla, players)` | Owner lookup; prefer non-lateB. The `*TeamCode` form takes a raw roster (used by `sw.js`) |
| `isDefinitelyFourth`, `isSettled`, `groupGamePts`, `reaperBountyForCode`, `teamPts_sim` | Helpers |

---

## UI Components (`index.html`)

### Navigation & tabs

State: `tab` (`home`·`table`·`scores`·`race`) and `leagueView`
(`league`·`teams`·`knockout`). Bottom nav hides on scroll down.

| | Mobile nav (5) | Desktop nav (7) |
|---|---|---|
| Tabs | Home · League · Scores · The Race · More | Home · Players · Teams · Knockouts · Scores · The Race · More |
| League | one tab, inline Players/Teams/Knockouts toggle | flattened into 3 direct destinations |

- **Home** (`HomeTab`/`HomeMatchRow`) — dashboard: Top of the Table, Recent Results, Risers & Fallers, Up Next, each linking into the relevant tab.
- **League → Players** (`leagueView==="league"`) — the `PlayerRow` standings.
- **League → Teams** (`leagueView==="teams"`) — `TeamsLeagueTab`: every team in one list ranked by sweepstake points, styled like the Players table (flag + `Sparkline` + points; pot + owning player as subtitle). Row → team card. Sparkline history from `deriveTeamHistory` (per-team cumulative sweepstake points, endpoint reconciled to the **confirmed** swPts — a live match doesn't move the line, see "Live vs confirmed split").
- **League → Knockouts** — `TeamsTab` (knockout **bracket** via `BracketSlot`/`BracketMatch`/`BracketRound`). `TeamsTab` still contains a dormant `view==="groups"` group-tables block, no longer surfaced by the nav.
- **Scores** (`DayPicker`) — combined day-by-day schedule **+** results, BBC-style day strip.
- **The Race** (`BarRaceModal`) — full-screen animated bar race.
- **More** (`MoreMenu`) — dev toggle, take the tour, view rules, subscribe to notifications, switch group.
- **Header logo** — admin-only: tap opens `GroupSwitcherMenu` to jump directly to another group (see GroupGate section above).

Desktop vs mobile is responsive (`isDesktop`): on desktop, Rules/Info is a tab and nav is a sidebar; on mobile they're bottom sheets.

### Key components
| Component | Notes |
|-----------|-------|
| `PlayerRow` | Collapsed card: rank, name + badges, 2-row flags (winner→alive→eliminated), sparkline, pts, **24h position-change pill**, chevron. Expanded: per-team breakdown; reaper gets a **Bounty Board** |
| `PlayerModal` / `SnapSheet` | Player detail bottom sheet — win %, full badge list, team breakdown |
| `TeamModal` | Per-team detail — results, points earned (`matchPtsById`) |
| `MatchCard` | Fixture/result card. **Rivalry tags** on upcoming first meetings only: 👑 **Title Showdown** (1st v 2nd), 🥊 **Grudge Match** (adjacent table positions); green border when active |
| `BumpChart` | SVG bump chart, **bucketed** history, RTL-scroll trick (starts at "now"), tap to highlight |
| `BarRaceModal` | Per-match history, stable alphabetical DOM order so CSS `top` transitions fire up *and* down; scrubber; elimination crosses from `deriveRaceEliminations` |
| `Sparkline` | 90×28 (default) SVG; green +ve, red reaper/-ve, grey zero |
| `Flag` / `FlagRow` | flagcdn images; `snail` variant flags late-B teams |
| `PushNotificationsSection` / `PushSettingsModal` | Subscribe flow; POSTs `{subscription, prefs, groupKey}` to the Worker |
| `NotificationsDrawer` | Bell — recent match events / new badges |
| `TourOverlay` | First-visit walkthrough (once per device via `localStorage["sw_tour_seen"]`); replayable from More |
| `InfoContent` | Rules: points matrix, Grim Reaper mechanic, team assignments |
| `App` | Root app (mounted by `GroupGate`); `GroupGate` | code entry / group switch |

### Badges (`computeBadges`)

Always-on flavour: 💀 **Grim Reaper**, 🤖 **Definitely Not Human** (MACK-BOT).
Performance: 🏆 Top Dog · 🥄 Wooden Spoon (bottom real player) · 🔮 The Prophecy
(highest win %) · 🚀 Climber / 📉 Sliding (24h table moves) · ⚡ On Fire (biggest
pts last round) · 🔪 Giant Killer (single biggest group upset) · 🐶 Underdog
(first Pot 4 team to reach the knockouts) · 👠 Cinderella (owns the **last**
Pot 4 team still alive — a live current-state badge like Top Dog, not a
"first to..." one; disappears once the last Pot 4 team is itself knocked
out) · 🥚 Early Bird · 🤡 Big Flop (first
Pot 1 favourite eliminated, group **or** knockout) · 🦆 Still Quacking (last
yet to score) · 🎸 One Man Band
(biggest gap between own teams) · 💥 Firepower / 💨 Firing Blanks (most / fewest
goals) · 🧱 Brick Wall / 🚰 Leaky (fewest / most conceded) · 🩸 First Casualty ·
⚰️ Wiped Out (first to have **all** their teams eliminated) · 🍞 Bread Winner /
🐑 Black Sheep — **family groups only** (`FAMILIES` global, set by GroupGate
like `POT_OVERRIDES`/`KNOCKOUT_ONLY`, null otherwise). Single-winner across
the whole group, like every other performance badge: each family's
top/bottom contributor by SHARE of their own family's combined points is a
candidate, but only the single highest share (Bread Winner) and single
lowest share (Black Sheep) across ALL families actually gets the badge. The
Grim Reaper's points DO count toward the family total when he's listed as a
member (e.g. Caversham's Macklin family includes "Josh") — excluding them
shrinks the total and inflates everyone else's share — but he isn't himself
eligible to win either badge.

Most performance badges are **single-winner** (exactly one holder). The full
badge list is sorted **rarest-first**, but the collapsed league row instead
shows the player's two most RECENTLY achieved badges (see "recent badge
ordering" below) — the two aren't the same thing any more.
*(Old `Clean Sheet`/`Rough Night` are gone — Clean Sheet → Brick Wall; 💎 → 🐶.)*

**Recent badge ordering:** most badges have no historical "achieved at" date
— they're just "is this true right now" checks (Top Dog, Firepower, etc.).
`App` tracks first-seen timestamps per `(player, badge label)` in
`localStorage["sw_badge_achieved_<groupKey>"]`, starting from whenever this
shipped — a badge lost and later re-earned gets a fresh timestamp. The
collapsed row (`PlayerRow`) is given the top 2 by that timestamp
(`mostRecentBadges` in `App`) instead of the full rarest-first list.

---

## Visual Design

### Colour palette (dark forest green) — `C` object in `index.html`
```javascript
bg:"#0d1f12"  surface:"#122018"  card:"#162a1c"  border:"#1e3d28"
muted:"#6b9e7a"  dim:"#8fba9a"  text:"#f0faf3"
accent:"#22c55e"  red:"#ef4444"  gold:"#f59e0b"
dangerText:"#f87171"  dangerTextBright:"#fca5a5"   // Grim Reaper / negative
```

### Player colours (fixed by roster index via `PLAYER_NAME_ORDER` → `PLAYER_COLORS`)
Assigned by position in the active roster, not by rank. (The original Rodents
mapping — Auz amber, George indigo, Toby orange, Sam pink, Paul violet, Elliott
red, Christoph emerald, Dollie blue, Josh green — only applies to that group;
other groups index into the same `PLAYER_COLORS` array.)

Cards: 14px radius, 10px bottom margin, no special 1st-place treatment.

---

## Data Flow

```
football-data.org  → Cloudflare Worker (CORS proxy)
  → fetchMatches()  GET /competitions/WC/matches?season=2026   (every 60s, 20s while any match is
     IN_PLAY/PAUSED — self-rescheduling setTimeout, not setInterval, so the cadence can change
     between polls; skipped in devMode)
     ├─ normalize COD → DRC at ingest (single choke point)
     └─ MERGE with existing state (API intermittently drops finished matches → flicker)
  → setMatches()
  → scorePlayers(matches) → ranked[]
  → compute24hRankChange / compute24hPtsChange → position & pts deltas
  → deriveHistory → bump chart;  (deriveSparklineHistory inside scorePlayers → p.hist)
  → deriveRaceEliminations / deriveMatchPts (guarded by typeof checks)
  → simulateWinProbability(ranked, matches, 5000) → winPct  (memoised on [matches])
  → computeBadges(ranked, matches, rank24hChange, winPct.players) → badges
  → goal-detection effect → goalFlash + push (via Worker → sw.js)
```

Most derivations run **unmemoised each render** (`scorePlayers(matches)` is called
directly); the heavier `winPct`, `badges`, `raceElim`, `matchPtsById` are
`useMemo`'d on `[matches]`.

---

## App State (selected)
```javascript
matches, loading, error, lastUpdated, refreshing
tab ("home"|"table"|"scores"|"race")        leagueView ("league"|"teams"|"knockout")
selectedPlayer, selectedTeam, scrollPlayerToBadges
showRace, showInfo, showTour, showMore, showNotifications, showPushSettings
devMode (+ devModeRef), copied, goalFlash, goalInfo (+ prevScoresRef)
barsVisible (+ lastScrollY, barLockRef), countdown, selectedDay
matchesRef, tabRef     // refs to read latest inside intervals/handlers
```
Browser **history integration**: modals/tabs push state so the device back
button closes them; Escape also dismisses the topmost overlay.

---

## PWA & Push Notifications

- `manifest.json` + `sw.js` (registered at the end of `index.html`).
- `sw.js` `importScripts('./scoring.js')` to reuse `GROUPS` + `ownerOfTeamCode`,
  so a goal push reads e.g. **"Henry's Netherlands scores!"** — roster data is
  never duplicated server-side.
- Push payload `{type:'goal', code, scoringTeam, home, away, hs, as, groupKey, tag}`
  → `buildGoalNotification` resolves the owner for that group.
- Subscribe flow (`PushNotificationsSection`) POSTs `{subscription, prefs, groupKey}`
  to the Worker; VAPID public key in `scoring.js`, private key = Worker secret.
- `notificationclick` focuses an existing window or opens the app.

---

## Dev Mode

Toggle from **More** (shows `DEV` when active). Uses `MOCK_MATCHES` (full group
stage + knockouts through a simulated Final). Auto-refresh is suppressed via
`devModeRef`; toggling resets to the League tab.

---

## Goal Flash Animation

`prevScoresRef` compares total goals per live match id between refreshes; an
increase sets `goalFlash` for ~2.5s — the page background pulses green and a
**⚽ GOAL!** overlay fades in/out. (Distinct from the push notification path,
which is server-driven via the Worker + `sw.js`.)

---

## Known Issues / Gotchas

- **`PTS_INC` is a misnomer** — points are flat (highest stage), not summed. See Scoring.
- **`PLAYERS` is a runtime-mutated global** — reassigned by `GroupGate`. Anything
  reading rosters reads it live; don't cache it across a group switch.
- **Shared team codes** (Silverstream late-B players) — a code can have multiple
  owners; `simulateWinProbability`, `deriveHistory`, and owner-lookups all credit
  all owners but prefer non-lateB for single-owner display.
- **COD vs DRC** — DR Congo is `COD` in the live API, `DRC` everywhere in our data.
  Normalised once at fetch ingest; `POT`/`FLAG_ISO` carry both keys as a backstop.
- **Partial API responses** — football-data.org intermittently omits finished
  matches; `fetchMatches` merges with existing state so points don't flicker.
- **Group-stage elimination** needs 3 games played, not in any knockout fixture,
  **and** unambiguous 4th (`isDefinitelyFourth` / `elimDate` h2h logic) — avoids
  false-flagging when a group finishes before the knockouts begin.
- **A group-stage exit isn't always literal 4th place.** A team finishing 3rd
  is only actually out if it misses the best-8-of-12 wildcard cutoff
  (`qualifiedThirdPlacers`) — that can only be known once **every** group has
  played all 3 games (FINISHED, not just `isSettled`/live), since it ranks
  3rd-placed teams against each other across all 12 groups. `computeBadges`'s
  local `elimDate` tracking (for First Casualty/Wiped Out) mirrors
  `deriveStages`'s own bottom-4-thirds pass for this — missing it meant a
  non-qualifying-3rd team (e.g. Uzbekistan finishing 3rd in Group K without
  making the wildcard cutoff) never got an `elimDate` at all, so Wiped Out
  could never fire for whoever owned it, and First Casualty could
  misattribute to a later, unrelated elimination instead.
- **Bar race / race eliminations must stay frame-aligned** — keep the
  frame-advance conditions in `deriveRaceEliminations` (and `deriveRaceStages`)
  in sync with `deriveSparklineHistory`. The clinch bonus is awarded *silently*
  precisely so it doesn't break this.
- **Orphaned Last-32 bonus** — the L32 qualification bonus is earned by finishing
  top-2, so it's the one points source **not tied to a single match** and has no
  natural Results row. Surfaced as a 🎟️ "milestone" row (pinned top of Results in
  player + team cards) via `stageBonusFor(tla, total, matches, matchPtsById)` =
  `team total − Σ(its per-match points)`. Shows only while **> 0**, so it
  **self-heals**: once the real L32 fixture plays, `deriveMatchPts` attaches the
  points to that game, the gap closes to 0, and the row disappears. P1 teams get
  no row (L32 bonus = 0). Group **penalties** (negative orphans) are not surfaced.
- API key + VAPID private key live as **Worker secrets**, not in the client.

---

## Deployment

GitHub Pages serves from `main`. Workflow (per `CLAUDE.md`):

1. Branch off `main`, make the change.
2. Validate logic changes with a Babel parse (headless-screenshot tooling is
   unreliable on this app — see `CLAUDE.md`); for visual changes, hand a throwaway
   copy of `index.html` to the user to preview.
3. Get the diff reviewed/approved, then commit (one commit per approved change).
4. Merge to `main` → Pages rebuilds automatically (~30s).

`index.html` + `scoring.js` deploy **together**. The CORS Worker only needs
redeploying if the API key/endpoint changes; the email Worker only if scoring
logic it imports changes.

> ⚠️ **Cache-bust rule (critical).** `index.html` loads scoring via
> `<script src="scoring.js?v=N">`. The browser caches per-URL, so re-uploading
> `scoring.js` alone does **nothing** until the query string changes — the old
> file keeps being served. **Every `scoring.js` change must bump `?v=N` in
> `index.html`, and both files must be deployed.** (The service worker is
> pass-through / no-cache, so it's not involved — this is plain HTTP caching.)
> Symptom when forgotten: "deployed but no change." Currently at `?v=4`.
