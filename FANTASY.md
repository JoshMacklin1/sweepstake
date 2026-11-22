# Sweepstaker Fantasy — spec (v1, practice + live beta)

FPL-style game played with **clubs instead of footballers**. Separate game mode:
`fantasy.html` + `fantasy-scoring.js` (engine), reusing `league-scoring.js` for
clubs, crests, CL tiers and gameweeks. Linked from the league app's More menu.

## Modes
| Mode | Data | Gameweek advance | Storage |
|---|---|---|---|
| **Practice** | Real 2025-26 results (`league-data-2025.js`) | You press "Play Gameweek N" | `localStorage` `fp_save_practice` |
| **Live (beta)** | 2026-27 via the football-proxy Worker | By date — first GW whose deadline hasn't passed | `localStorage` `fp_save_live` (phone only, no server lock yet) |

## Rules
- **Squad:** 15 clubs, exactly 3 per league (PL, La Liga, Serie A, Bundesliga, Ligue 1), £100.0m.
- **Line-up:** XI of 11 with ≥2 per league; 4 on the bench, ordered.
- **Scoring (identical for every club):** win 3 · draw 1 · +1 per goal · clean sheet +2 · conceded 3+ −1 · won by 3+ +1 · CL win +2 extra. All league + CL matches in the gameweek count.
- **Captain** ×2 (vice if captain had no game). **Auto-subs:** first bench club that played, keeping ≥2 starters per league.
- **Transfers:** 1 free/GW, bank up to 5, extras −4 pts.
- **Chips (once each):** Wildcard ×2 (one per half), Free Hit (squad reverts next GW), Bench Boost, Triple Captain.
- **Gameweeks:** `lgWeeks` (Mon–Sun, international breaks folded in). Deadline = first kick-off.

## Prices
- **Start:** domestic pot (P1 £8.5m · P2 £7.0m · P3 £5.5m · P4 £4.5m) + CL premium by CL tier (T1 +£6.5m · T2 +£3.5m · T3 +£1.5m · T4 +£0.5m). Range £4.5m–£15.0m.
- **Calibration (2025-26):** every price band earns ≈17–19 pts per £1m, so value comes from over-performers (Como, Sunderland), like FPL.
- **Movement:** form-driven, not demand-driven (too few managers): an Elo rating updated by every result (K 24, margin-scaled, home +50); each 25 Elo vs the club's start = £0.1m; max ±£0.2m per GW; floor £3.5m.
- **Selling:** FPL rule — purchase price + half of any rise (rounded down to £0.1m), or the full fall.

## Phase 2 (not built yet)
- Server-side deadline lock + pick history on the Cloudflare Worker (extend the `sweepstake` draft Worker), identity = device token + backup code.
- Mini-leagues (reuse group codes), weekly / overall standings.
- Proxy caching so many managers don't trip the 10 req/min data limit.
