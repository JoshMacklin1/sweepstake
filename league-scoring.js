// ═════════════════════════════════════════════════════════════════════════════
// league-scoring.js — scoring/data logic for the LEAGUE SEASON sweepstake
// (Premier League + Championship 2026-27). Sibling of scoring.js (World Cup);
// deliberately shares no globals with it — everything here is prefixed
// LEAGUE_/league/lg so both files could coexist on a page without collision.
//
// Single source of truth for:
//   - the 44 teams (LEAGUE_TEAMS, keyed by football-data.org numeric id — NOT
//     TLA: Sheffield Utd and Sheffield Wed have both been served as "SHE")
//   - pots (3-season weighted composite seeding, see LEAGUE_TEAMS comment)
//   - points matrices (LEAGUE_WIN_PTS/LEAGUE_DRAW_PTS, LEAGUE_BONUS)
//   - all pure derive*/score* functions
//
// Data source: football-data.org via the existing CORS Worker (free tier
// covers PL + ELC incl. Championship playoff fixtures; FA Cup is NOT free —
// season-outcome bonuses are the "knockout drama" layer instead, and the
// bonus system is designed so a cup competition can be added as another
// outcome source later without touching match scoring).
// ═════════════════════════════════════════════════════════════════════════════

var LEAGUE_WORKER_URL = "https://football-proxy.joshmacklin7.workers.dev";

// Live-draft backend (separate Worker — see worker/). Powers create / invite /
// lobby / snake draft for user-made leagues. Update this if you deploy the
// Worker under a different name or subdomain.
var LEAGUE_API_URL = "https://sweepstake.joshmacklin7.workers.dev";

// Competitions a created league can draft from: the domestic top flights that
// have a scoring matrix. CL is a gamble layer laid over league points, not a
// draw pool, so it's deliberately excluded.
function lgDraftableCompetitions() {
  if (typeof LEAGUE_COMPETITIONS === "undefined") return [];
  return Object.keys(LEAGUE_COMPETITIONS).filter(function (c) {
    return lgScoringLeague(c);
  });
}

// Every eligible team id for a set of competition codes (scoring leagues only).
// This is the roster pool the draft picks from — sent to the Worker at create
// time so LEAGUE_TEAMS stays the single source of truth for football data.
function lgPoolTeamIds(comps) {
  if (typeof LEAGUE_TEAMS === "undefined") return [];
  var set = {};
  (comps || []).forEach(function (c) { set[c] = 1; });
  var ids = [];
  Object.keys(LEAGUE_TEAMS).forEach(function (id) {
    var t = LEAGUE_TEAMS[id];
    if (set[t.league] && lgScoringLeague(t.league)) {
      ids.push(Number(id));
    }
  });
  return ids;
}

// Replay/testing season. The 2025-26 season is fully played and free-tier
// accessible, so the whole app can be exercised on real historical data.
// Flip to 2026 for the live 2026-27 season (PL starts 2026-08-21, ELC 08-14).
var LEAGUE_SEASON = 2026;

// `type` selects the season-outcome shape (see deriveSeasonOutcomes):
//   "top" → WINNER / TOP_4 / TOP_7 / RELEGATED (a country's first tier)
//   "cup" → no league outcomes; scored as an overlay gamble (Champions League)
// The pool is the five biggest European first divisions plus the Champions
// League as an overlay. (The English Championship used to be here too; it was
// dropped when the continental leagues came in.) Order = Leagues-tab pill order.
var LEAGUE_COMPETITIONS = {
  PL:  { code: "PL",  label: "Premier League", games: 38, size: 20, potSize: 5, relegated: 3, type: "top" },
  PD:  { code: "PD",  label: "La Liga",        games: 38, size: 20, potSize: 5, relegated: 3, type: "top" },
  SA:  { code: "SA",  label: "Serie A",        games: 38, size: 20, potSize: 5, relegated: 3, type: "top" },
  BL1: { code: "BL1", label: "Bundesliga",     games: 34, size: 18, potSize: 5, relegated: 3, type: "top" },
  FL1: { code: "FL1", label: "Ligue 1",        games: 34, size: 18, potSize: 5, relegated: 3, type: "top" },
  // Champions League — a knockout competition, not a domestic table, and NOT a
  // separate draft: owning a club that also plays in the CL is a pot-relative
  // GAMBLE laid on top of its league points (see CL_GAMBLE / deriveCLProgress).
  // type "cup" makes deriveSeasonOutcomes skip it; the Leagues tab still shows
  // its league phase as a table.
  CL:  { code: "CL",  label: "Champions League", type: "cup", size: 36 },
};

// ─────────────────────────────────────────────────────────────────────────────
// EDITION — the page sets window.SWEEP_MODE before loading this file:
//   "top5" (league.html, Sweepstaker Top 5): the five domestic leagues only —
//          the Champions League is dropped from LEAGUE_COMPETITIONS, so it's
//          never fetched, scored, drawn on or shown.
//   "cl"   (ucl.html, Champions League Edition): see the CL edition block.
// Defaults to "top5". lgHasCL() is the single check the UI uses.
// ─────────────────────────────────────────────────────────────────────────────
var SWEEP_MODE = (typeof window !== "undefined" && window.SWEEP_MODE) || "top5";
if (SWEEP_MODE === "top5") delete LEAGUE_COMPETITIONS.CL;
if (SWEEP_MODE === "cl") Object.keys(LEAGUE_COMPETITIONS).forEach(function (c) { if (c !== "CL") delete LEAGUE_COMPETITIONS[c]; });
function lgHasCL() { return !!LEAGUE_COMPETITIONS.CL; }
function lgIsCLEdition() { return SWEEP_MODE === "cl"; }
// Leagues whose clubs can be drawn/scored: the domestic leagues with a points
// matrix, or — in the CL Edition — the Champions League itself.
function lgScoringLeague(L) { return !!(typeof LEAGUE_MATCH_PTS !== "undefined" && LEAGUE_MATCH_PTS[L]) || (L === "CL" && SWEEP_MODE === "cl"); }
// A game that counts as a "league game" for W/D/L, form and badges: domestic
// regular-season fixtures, or — in the CL Edition — any CL fixture.
function lgIsLeagueGame(m) { return m.stage === "REGULAR_SEASON" || (SWEEP_MODE === "cl" && !!(m.competition && m.competition.code === "CL")); }

// ─────────────────────────────────────────────────────────────────────────────
// TEAMS & POTS
//
// Pot = quarter of each league's 2026-27 lineup, seeded by a weighted
// composite of the last three seasons' finishing positions (50% 2025-26,
// 30% 2024-25, 20% 2023-24; position = English-pyramid rank: PL 1-20,
// ELC 21-44, notional 47/56/71 for League One promoted / League One / League
// Two seasons the API doesn't cover). Smooths one-season blips: Man Utd's
// 3rd in 25-26 doesn't erase their 15th in 24-25, Wrexham's rise still
// remembers League Two.
// ─────────────────────────────────────────────────────────────────────────────
var LEAGUE_TEAMS = {
  // Premier League — Pot 1
  57:   { id: 57,   name: "Arsenal",         tla: "ARS", league: "PL",  pot: 1 },
  65:   { id: 65,   name: "Man City",        tla: "MCI", league: "PL",  pot: 1 },
  64:   { id: 64,   name: "Liverpool",       tla: "LIV", league: "PL",  pot: 1 },
  58:   { id: 58,   name: "Aston Villa",     tla: "AVL", league: "PL",  pot: 1 },
  61:   { id: 61,   name: "Chelsea",         tla: "CHE", league: "PL",  pot: 1 },
  // Premier League — Pot 2
  66:   { id: 66,   name: "Man United",      tla: "MUN", league: "PL",  pot: 2 },
  1044: { id: 1044, name: "Bournemouth",     tla: "BOU", league: "PL",  pot: 2 },
  397:  { id: 397,  name: "Brighton",        tla: "BHA", league: "PL",  pot: 2 },
  67:   { id: 67,   name: "Newcastle",       tla: "NEW", league: "PL",  pot: 2 },
  402:  { id: 402,  name: "Brentford",       tla: "BRE", league: "PL",  pot: 2 },
  // Premier League — Pot 3
  63:   { id: 63,   name: "Fulham",          tla: "FUL", league: "PL",  pot: 3 },
  62:   { id: 62,   name: "Everton",         tla: "EVE", league: "PL",  pot: 3 },
  354:  { id: 354,  name: "Crystal Palace",  tla: "CRY", league: "PL",  pot: 3 },
  351:  { id: 351,  name: "Nottm Forest",    tla: "NOT", league: "PL",  pot: 3 },
  73:   { id: 73,   name: "Tottenham",       tla: "TOT", league: "PL",  pot: 3 },
  // Premier League — Pot 4
  71:   { id: 71,   name: "Sunderland",      tla: "SUN", league: "PL",  pot: 4 },
  341:  { id: 341,  name: "Leeds United",    tla: "LEE", league: "PL",  pot: 4 },
  349:  { id: 349,  name: "Ipswich Town",    tla: "IPS", league: "PL",  pot: 4, p25: { league: "ELC", pot: 1 } },
  1076: { id: 1076, name: "Coventry City",   tla: "COV", league: "PL",  pot: 4, p25: { league: "ELC", pot: 2 } },
  322:  { id: 322,  name: "Hull City",       tla: "HUL", league: "PL",  pot: 4, p25: { league: "ELC", pot: 3 } },

  // Championship — Pot 1
  563:  { id: 563,  name: "West Ham",        tla: "WHU", league: "ELC", pot: 1, p25: { league: "PL",  pot: 3 } },
  76:   { id: 76,   name: "Wolves",          tla: "WOL", league: "ELC", pot: 1, p25: { league: "PL",  pot: 4 } },
  328:  { id: 328,  name: "Burnley",         tla: "BUR", league: "ELC", pot: 1, p25: { league: "PL",  pot: 4 } },
  340:  { id: 340,  name: "Southampton",     tla: "SOU", league: "ELC", pot: 1 },
  384:  { id: 384,  name: "Millwall",        tla: "MIL", league: "ELC", pot: 1 },
  343:  { id: 343,  name: "Middlesbrough",   tla: "MID", league: "ELC", pot: 1 },
  // Championship — Pot 2
  356:  { id: 356,  name: "Sheffield Utd",   tla: "SHU", league: "ELC", pot: 2 },
  68:   { id: 68,   name: "Norwich",         tla: "NOR", league: "ELC", pot: 2 },
  387:  { id: 387,  name: "Bristol City",    tla: "BRC", league: "ELC", pot: 2 },
  72:   { id: 72,   name: "Swansea",         tla: "SWA", league: "ELC", pot: 2 },
  74:   { id: 74,   name: "West Brom",       tla: "WBA", league: "ELC", pot: 2 },
  1081: { id: 1081, name: "Preston NE",      tla: "PNE", league: "ELC", pot: 2 },
  // Championship — Pot 3
  342:  { id: 342,  name: "Derby County",    tla: "DER", league: "ELC", pot: 3 },
  346:  { id: 346,  name: "Watford",         tla: "WAT", league: "ELC", pot: 3 },
  69:   { id: 69,   name: "QPR",             tla: "QPR", league: "ELC", pot: 3 },
  59:   { id: 59,   name: "Blackburn",       tla: "BLA", league: "ELC", pot: 3 },
  70:   { id: 70,   name: "Stoke",           tla: "STK", league: "ELC", pot: 3 },
  332:  { id: 332,  name: "Birmingham",      tla: "BIR", league: "ELC", pot: 3 },
  // Championship — Pot 4
  325:  { id: 325,  name: "Portsmouth",      tla: "POR", league: "ELC", pot: 4 },
  404:  { id: 404,  name: "Wrexham",         tla: "WRE", league: "ELC", pot: 4 },
  715:  { id: 715,  name: "Cardiff",         tla: "CAR", league: "ELC", pot: 4, p25: { league: "L1", pot: 4 } },
  348:  { id: 348,  name: "Charlton",        tla: "CHA", league: "ELC", pot: 4 },
  60:   { id: 60,   name: "Bolton",          tla: "BOL", league: "ELC", pot: 4, p25: { league: "L1", pot: 4 } },
  1126: { id: 1126, name: "Lincoln City",    tla: "LIN", league: "ELC", pot: 4, p25: { league: "L1", pot: 4 } },

  // ── CONTINENTAL LEAGUES — the four other big European first divisions, on the
  //    SAME pot method as the Premier League: 2026-27 lineups (verified against
  //    football-data 2026 standings), pots = quarters of a weighted composite of
  //    the last three finishes (50% 2025-26, 30% 2024-25, 20% 2023-24). Position
  //    = national-pyramid rank: top flight 1..N, second tier N+pos, third tier
  //    N+S2+pos. Pot sizes 5/5/5/5 (20 teams) or 4/5/4/5 (18 teams). 2025-26
  //    positions use each league's real tiebreak (head-to-head for PD/SA). The
  //    Champions League is an overlay (see CL_GAMBLE), not a roster here.
  //    Trailing comment = composite score (lower = stronger).

  // La Liga — Pot 1
  81:   { id: 81,   name: "Barcelona",          tla: "BAR", league: "PD",  pot: 1 }, // 1.2
  86:   { id: 86,   name: "Real Madrid",        tla: "RMA", league: "PD",  pot: 1 }, // 1.8
  78:   { id: 78,   name: "Atlético Madrid",    tla: "ATM", league: "PD",  pot: 1 }, // 3.7
  94:   { id: 94,   name: "Villarreal",         tla: "VIL", league: "PD",  pot: 1 }, // 4.6
  90:   { id: 90,   name: "Real Betis",         tla: "BET", league: "PD",  pot: 1 }, // 5.7
  // La Liga — Pot 2
  558:  { id: 558,  name: "Celta Vigo",         tla: "CEL", league: "PD",  pot: 2 }, // 7.7
  77:   { id: 77,   name: "Athletic Club",      tla: "ATH", league: "PD",  pot: 2 }, // 8.2
  92:   { id: 92,   name: "Real Sociedad",      tla: "RSO", league: "PD",  pot: 2 }, // 9.5
  82:   { id: 82,   name: "Getafe",             tla: "GET", league: "PD",  pot: 2 }, // 9.8
  87:   { id: 87,   name: "Rayo Vallecano",     tla: "RAY", league: "PD",  pot: 2 }, // 9.8
  // La Liga — Pot 3
  95:   { id: 95,   name: "Valencia",           tla: "VAL", league: "PD",  pot: 3 }, // 9.9
  79:   { id: 79,   name: "Osasuna",            tla: "OSA", league: "PD",  pot: 3 }, // 13.4
  263:  { id: 263,  name: "Alavés",             tla: "ALA", league: "PD",  pot: 3 }, // 13.5
  559:  { id: 559,  name: "Sevilla",            tla: "SEV", league: "PD",  pot: 3 }, // 14.4
  80:   { id: 80,   name: "Espanyol",           tla: "ESP", league: "PD",  pot: 3 }, // 14.5
  // La Liga — Pot 4
  285:  { id: 285,  name: "Elche",              tla: "ELH", league: "PD",  pot: 4 }, // 19.9
  88:   { id: 88,   name: "Levante",            tla: "LEV", league: "PD",  pot: 4 }, // 19.9
  5335: { id: 5335, name: "Racing Santander",tla: "SAN", league: "PD",  pot: 4 }, // 22.8 (promoted)
  560:  { id: 560,  name: "Deportivo",tla: "DEP", league: "PD",  pot: 4 }, // 29.8 (promoted)
  84:   { id: 84,   name: "Málaga",          tla: "MAL", league: "PD",  pot: 4 }, // 30.9 (promoted)

  // Serie A — Pot 1
  108:  { id: 108,  name: "Inter",              tla: "INT", league: "SA",  pot: 1 }, // 1.3
  113:  { id: 113,  name: "Napoli",             tla: "NAP", league: "SA",  pot: 1 }, // 3.3
  100:  { id: 100,  name: "Roma",               tla: "ROM", league: "SA",  pot: 1 }, // 4.2
  109:  { id: 109,  name: "Juventus",           tla: "JUV", league: "SA",  pot: 1 }, // 4.8
  102:  { id: 102,  name: "Atalanta",           tla: "ATA", league: "SA",  pot: 1 }, // 5.2
  // Serie A — Pot 2
  98:   { id: 98,   name: "AC Milan",           tla: "MIL", league: "SA",  pot: 2 }, // 5.3
  103:  { id: 103,  name: "Bologna",            tla: "BOL", league: "SA",  pot: 2 }, // 7.7
  110:  { id: 110,  name: "Lazio",              tla: "LAZ", league: "SA",  pot: 2 }, // 8
  7397: { id: 7397, name: "Como",               tla: "COM", league: "SA",  pot: 2 }, // 9.4
  99:   { id: 99,   name: "Fiorentina",         tla: "FIO", league: "SA",  pot: 2 }, // 10.9
  // Serie A — Pot 3
  586:  { id: 586,  name: "Torino",             tla: "TOR", league: "SA",  pot: 3 }, // 11.1
  115:  { id: 115,  name: "Udinese",            tla: "UDI", league: "SA",  pot: 3 }, // 11.6
  107:  { id: 107,  name: "Genoa",              tla: "GEN", league: "SA",  pot: 3 }, // 14.1
  104:  { id: 104,  name: "Cagliari",           tla: "CAG", league: "SA",  pot: 3 }, // 14.7
  112:  { id: 112,  name: "Parma",              tla: "PAR", league: "SA",  pot: 3 }, // 15.5
  // Serie A — Pot 4
  471:  { id: 471,  name: "Sassuolo",           tla: "SAS", league: "SA",  pot: 4 }, // 15.6
  5890: { id: 5890, name: "Lecce",              tla: "LEC", league: "SA",  pot: 4 }, // 16.4
  5911: { id: 5911, name: "Monza",              tla: "MON", league: "SA",  pot: 4 }, // 19.9 (promoted)
  454:  { id: 454,  name: "Venezia",            tla: "VEN", league: "SA",  pot: 4 }, // 20.8 (promoted)
  470:  { id: 470,  name: "Frosinone",          tla: "FRO", league: "SA",  pot: 4 }, // 25.7 (promoted)

  // Bundesliga — Pot 1
  5:    { id: 5,    name: "Bayern München",     tla: "FCB", league: "BL1", pot: 1 }, // 1.4
  4:    { id: 4,    name: "Dortmund",           tla: "BVB", league: "BL1", pot: 1 }, // 3.2
  3:    { id: 3,    name: "Bayer Leverkusen",   tla: "B04", league: "BL1", pot: 1 }, // 3.8
  721:  { id: 721,  name: "RB Leipzig",         tla: "RBL", league: "BL1", pot: 1 }, // 4.4
  // Bundesliga — Pot 2
  10:   { id: 10,   name: "VfB Stuttgart",      tla: "VFB", league: "BL1", pot: 2 }, // 5.1
  19:   { id: 19,   name: "Eintracht Frankfurt",tla: "SGE", league: "BL1", pot: 2 }, // 6.1
  17:   { id: 17,   name: "SC Freiburg",        tla: "SCF", league: "BL1", pot: 2 }, // 7
  2:    { id: 2,    name: "Hoffenheim",         tla: "TSG", league: "BL1", pot: 2 }, // 8.4
  15:   { id: 15,   name: "Mainz 05",           tla: "M05", league: "BL1", pot: 2 }, // 9.4
  // Bundesliga — Pot 3
  16:   { id: 16,   name: "FC Augsburg",        tla: "FCA", league: "BL1", pot: 3 }, // 10.3
  12:   { id: 12,   name: "Werder Bremen",      tla: "SVW", league: "BL1", pot: 3 }, // 11.7
  18:   { id: 18,   name: "M'gladbach",         tla: "BMG", league: "BL1", pot: 3 }, // 11.8
  28:   { id: 28,   name: "Union Berlin",       tla: "FCU", league: "BL1", pot: 3 }, // 12.4
  // Bundesliga — Pot 4
  1:    { id: 1,    name: "1. FC Köln",         tla: "KOE", league: "BL1", pot: 4 }, // 16.1
  7:    { id: 7,    name: "Hamburger SV",       tla: "HSV", league: "BL1", pot: 4 }, // 16.9
  719:  { id: 719,  name: "Elversberg",      tla: "ELV", league: "BL1", pot: 4 }, // 22.1 (promoted)
  29:   { id: 29,   name: "Paderborn",       tla: "SCP", league: "BL1", pot: 4 }, // 22.7 (promoted)
  6:    { id: 6,    name: "Schalke 04",         tla: "S04", league: "BL1", pot: 4 }, // 24.7 (promoted)

  // Ligue 1 — Pot 1
  524:  { id: 524,  name: "Paris SG",           tla: "PSG", league: "FL1", pot: 1 }, // 1
  521:  { id: 521,  name: "Lille",              tla: "LOS", league: "FL1", pot: 1 }, // 3.8
  516:  { id: 516,  name: "Marseille",          tla: "OM",  league: "FL1", pot: 1 }, // 4.7
  546:  { id: 546,  name: "Lens",               tla: "RCL", league: "FL1", pot: 1 }, // 4.8
  // Ligue 1 — Pot 2
  548:  { id: 548,  name: "Monaco",             tla: "ASM", league: "FL1", pot: 2 }, // 4.8
  523:  { id: 523,  name: "Lyon",               tla: "OL",  league: "FL1", pot: 2 }, // 5
  529:  { id: 529,  name: "Rennes",             tla: "REN", league: "FL1", pot: 2 }, // 8.6
  576:  { id: 576,  name: "Strasbourg",         tla: "RCS", league: "FL1", pot: 2 }, // 8.7
  512:  { id: 512,  name: "Brest",              tla: "BRE", league: "FL1", pot: 2 }, // 9.3
  // Ligue 1 — Pot 3
  511:  { id: 511,  name: "Toulouse",           tla: "TFC", league: "FL1", pot: 3 }, // 9.7
  522:  { id: 522,  name: "Nice",               tla: "NIC", league: "FL1", pot: 3 }, // 10.2
  525:  { id: 525,  name: "Lorient",            tla: "FCL", league: "FL1", pot: 3 }, // 14.1
  533:  { id: 533,  name: "Le Havre",           tla: "HAC", league: "FL1", pot: 3 }, // 14.5
  // Ligue 1 — Pot 4
  519:  { id: 519,  name: "Auxerre",            tla: "AJA", league: "FL1", pot: 4 }, // 14.6
  532:  { id: 532,  name: "Angers",             tla: "ANG", league: "FL1", pot: 4 }, // 14.7
  1045: { id: 1045, name: "Paris FC",           tla: "PFC", league: "FL1", pot: 4 }, // 16.1
  531:  { id: 531,  name: "Troyes",             tla: "ETR", league: "FL1", pot: 4 }, // 22.9 (promoted)
  535:  { id: 535,  name: "Le Mans",            tla: "LMF", league: "FL1", pot: 4 }, // 24.9 (promoted)
};

// ─────────────────────────────────────────────────────────────────────────────
// SEASON-CORRECT POT/LEAGUE
//
// The base entries above are the 2026-27 lineup. Nine teams changed division
// between 2025-26 and 2026-27, so scoring/pricing them by their 2026-27
// league/pot would be wrong when replaying 2025-26 (e.g. Wolves are a 2026-27
// Championship Pot 1 side but spent 2025-26 in the Premier League). Each such
// team carries a `p25` override with its actual 2025-26 league + pot; the three
// promoted from League One (Cardiff/Bolton/Lincoln) map to a notional "L1" and
// never score in the replay (they have no PL/ELC fixtures).
//
// Applied once at load, keyed on LEAGUE_SEASON, so every downstream scoring and
// UI read of `.league`/`.pot` gets the season-correct value with no further
// changes. Flip LEAGUE_SEASON to 2026 for the live season and the base
// (2026-27) values are used untouched.
// ─────────────────────────────────────────────────────────────────────────────
if (LEAGUE_SEASON === 2025) {
  Object.keys(LEAGUE_TEAMS).forEach(function (id) {
    var t = LEAGUE_TEAMS[id];
    if (t.p25) { t.league = t.p25.league; t.pot = t.p25.pot; }
  });
}

function leagueCrest(teamId) {
  return "https://crests.football-data.org/" + teamId + ".png";
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING
//
// Two layers, mirroring the WC app's group-stage + flat-knockout structure:
//
// 1. MATCH POINTS — every settled league game, W/D by pot (index = pot - 1).
//    Losses score 0. Live matches count at the current score (isSettled
//    treats IN_PLAY/PAUSED as settled).
//
// 2. SEASON BONUS — a FLAT value for the single highest outcome a team
//    achieves (like PTS_INC: highest row only, never summed). Awarded the
//    moment it is mathematically settled (conservative pairwise clinch
//    maths mid-season; exact table once a league's regular season is
//    complete; Championship playoff fixtures upgrade playoff teams live).
//
// CALIBRATION (do not tweak casually): every value below was fitted to the
// last three seasons' actual per-pot W/D/L rates and outcome frequencies
// (pots re-seeded pre-season by the same quartile rule each year), so that
// EXPECTED season total (match + bonus) is flat across pots — within 2.8%
// in the PL and 4.9% in the ELC. No pot is a systematically better draw;
// underdogs keep the variance (a P4 win pays more, and the near-impossible
// outcomes pay jackpots) without the WC group-stage multipliers, which over
// a 38/46-game season would have handed Pot 4 the title by default (a
// mid-table P4 team would have out-scored the champions ~3:1).
// Notable empirical facts baked in: Championship pots 2-4 win at almost
// identical rates (~15.5/46 — the ELC is a coin-flip below its top quarter,
// hence flat 5-pt wins and fat 3-pt draws there), and ELC P4 teams got
// promoted 11% of the time, which is why PROMOTED[P4] is 180, not a
// jackpot. Jackpot values sit only where 3 seasons produced zero cases
// (P4 league title, P4 top-4). Calibration data/scripts: standings 2023-25
// + calibrate.js/tune.js (session scratchpad; regenerate from the API).
// ─────────────────────────────────────────────────────────────────────────────
var LEAGUE_MATCH_PTS = {
  PL:  { win: [4, 5, 6, 9], draw: [1, 2, 2, 3] },
  // The four continental top flights reuse the PL matrix — same competition
  // shape (a first tier with a clear top quartile), and the PL calibration
  // scripts need the API to re-fit per league. Refine once per-league W/D/L
  // rates are available. (The Championship's ELC matrix was removed with it.)
  PD:  { win: [4, 5, 6, 9], draw: [1, 2, 2, 3] },
  SA:  { win: [4, 5, 6, 9], draw: [1, 2, 2, 3] },
  BL1: { win: [4, 5, 6, 9], draw: [1, 2, 2, 3] },
  FL1: { win: [4, 5, 6, 9], draw: [1, 2, 2, 3] },
};

// Outcome keys are ordered highest-first per competition; a team receives
// exactly one row (the first that applies). RELEGATED is the only negative.
var LEAGUE_BONUS = {
  PL: {
    WINNER:    [100, 300, 600, 1200], // Premier League champions
    TOP_4:     [40, 120, 250, 500],   // Champions League places
    TOP_7:     [15, 50, 100, 200],    // European places
    RELEGATED: [-120, -60, -30, -10],
  },
  // Continental top flights share the PL bonus shape (title / top 4 / European
  // places / relegation). TOP_4 and TOP_7 stand in for each league's European
  // and relegation-adjacent cutoffs; refine per competition if desired.
  PD:  { WINNER: [100, 300, 600, 1200], TOP_4: [40, 120, 250, 500], TOP_7: [15, 50, 100, 200], RELEGATED: [-120, -60, -30, -10] },
  SA:  { WINNER: [100, 300, 600, 1200], TOP_4: [40, 120, 250, 500], TOP_7: [15, 50, 100, 200], RELEGATED: [-120, -60, -30, -10] },
  BL1: { WINNER: [100, 300, 600, 1200], TOP_4: [40, 120, 250, 500], TOP_7: [15, 50, 100, 200], RELEGATED: [-120, -60, -30, -10] },
  FL1: { WINNER: [100, 300, 600, 1200], TOP_4: [40, 120, 250, 500], TOP_7: [15, 50, 100, 200], RELEGATED: [-120, -60, -30, -10] },
};

var LEAGUE_OUTCOME_LABEL = {
  WINNER: "Champions", TOP_4: "Top 4", TOP_7: "Top 7",
  PROMOTED: "Promoted", PLAYOFF_FINAL: "Playoff finalist",
  PLAYOFFS: "Made playoffs", RELEGATED: "Relegated",
};

// ─────────────────────────────────────────────────────────────────────────────
// CHAMPIONS LEAGUE — the overlay gamble
//
// Owning a club that ALSO plays in the Champions League is a bet laid on top
// of its league points. Everything here is priced by the club's CL TIER — its
// pot in UEFA's own league-phase draw (CL_TIER), i.e. European pedigree, NOT
// its domestic pot (Como/Lens/Stuttgart are domestic heavyweights but CL
// minnows). Three layers, summed into a club's clPts by clTeamPts():
//   1. Match points (CL_MATCH_PTS): every CL game, scaled by the tier gap to
//      the opponent — upsets pay big, a favourite beating a minnow pays little.
//   2. Giant-killer bonus (CL_GIANT_KILL_PER_TIER): knock a higher-tier club
//      out of a knockout tie → +N per tier of gap.
//   3. Stage reached (CL_GAMBLE below): pot-relative — a T1 favourite earns
//      little for a deep run and loses a little for an early exit; a T4 side
//      is mostly upside. Penalties were softened when match points arrived
//      (they now carry most of the drama).
//
// Rows = furthest CL stage reached; columns = CL tier (1-4). Hand-set for feel.
var CL_GAMBLE = {
  WINNER:      [120, 220, 360, 500],  // won the final
  FINAL:       [70, 140, 250, 380],   // runner-up
  SEMI:        [35, 90, 170, 280],    // lost in the semis
  QF:          [10, 45, 110, 200],    // lost in the quarters
  R16:         [0, 15, 60, 130],      // lost in the round of 16
  PLAYOFF:     [-20, 0, 30, 90],      // lost the knockout play-off round
  LEAGUE_EXIT: [-40, -20, 0, 20],     // eliminated in the league phase
};

// Per-match CL points: win = base + perGap × gap, draw likewise, loss = 0,
// where gap = max(0, ownTier − oppTier) (how many tiers BELOW the opponent).
// T4 beating T1 = 18, T4 drawing T1 = 10; a favourite's win = 3.
var CL_MATCH_PTS = { winBase: 3, winPerGap: 5, drawBase: 1, drawPerGap: 3 };
var CL_GIANT_KILL_PER_TIER = 25;

// UEFA 2026-27 league-phase draw pots (football-data ids). Sources: SI / Sky /
// ESPN / beIN draw coverage (ESPN alone had AEK in pot 3). Refresh each season.
var CL_TIER = {
  // Pot 1
  524: 1, 5: 1, 86: 1, 64: 1, 108: 1, 65: 1, 57: 1, 81: 1, 78: 1,
  // Pot 2 — Dortmund, Roma, Sporting, Villa, Porto, Man Utd, Brugge, Betis, PSV
  4: 2, 100: 2, 498: 2, 58: 2, 503: 2, 66: 2, 851: 2, 90: 2, 674: 2,
  // Pot 3 — Napoli, Leipzig, Villarreal, Lille, Feyenoord, Shakhtar, Galatasaray, Fenerbahçe, Bodø/Glimt
  113: 3, 721: 3, 94: 3, 521: 3, 675: 3, 1887: 3, 610: 3, 613: 3, 5721: 3,
  // Pot 4 — Como, Stuttgart, Lens, Slavia, AEK, Slovan, LASK, Viking, Sabah
  7397: 4, 10: 4, 546: 4, 930: 4, 1899: 4, 7509: 4, 2016: 4, 5720: 4, 10233: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// CHAMPIONS LEAGUE EDITION (SWEEP_MODE "cl") — the draw pool becomes the 36
// clubs in CL_TIER, each with league "CL" and pot = its UEFA tier (the World
// Cup Edition's pots, in CL form). Clubs from the big five keep their names;
// the rest come from CL_EXTRA_CLUBS. `domestic` keeps the home league for
// labels. Scoring is CL-only (clTeamPts: tier-gap match points + giant kills +
// stage reached) — domestic points/bonuses have nothing to apply to.
// ─────────────────────────────────────────────────────────────────────────────
var CL_EXTRA_CLUBS = {
  851: { name: "Club Brugge", tla: "BRU", country: "Belgium" },
  498: { name: "Sporting CP", tla: "SPO", country: "Portugal" },
  503: { name: "Porto", tla: "POR", country: "Portugal" },
  674: { name: "PSV", tla: "PSV", country: "Netherlands" },
  675: { name: "Feyenoord", tla: "FEY", country: "Netherlands" },
  1887: { name: "Shakhtar", tla: "SHA", country: "Ukraine" },
  610: { name: "Galatasaray", tla: "GAL", country: "Türkiye" },
  613: { name: "Fenerbahçe", tla: "FEN", country: "Türkiye" },
  5721: { name: "Bodø/Glimt", tla: "BOD", country: "Norway" },
  930: { name: "Slavia Praha", tla: "SLA", country: "Czechia" },
  1899: { name: "AEK Athens", tla: "AEK", country: "Greece" },
  7509: { name: "Slovan Bratislava", tla: "SLO", country: "Slovakia" },
  2016: { name: "LASK", tla: "LAS", country: "Austria" },
  5720: { name: "Viking", tla: "VIK", country: "Norway" },
  10233: { name: "Sabah", tla: "SAB", country: "Azerbaijan" },
};
if (SWEEP_MODE === "cl") {
  var clRegistry = {};
  Object.keys(CL_TIER).forEach(function (k) {
    var id = Number(k), base = LEAGUE_TEAMS[id], extra = CL_EXTRA_CLUBS[id];
    clRegistry[id] = {
      id: id, name: base ? base.name : (extra ? extra.name : "#" + id),
      tla: base ? base.tla : (extra ? extra.tla : ""),
      league: "CL", pot: CL_TIER[id],
      domestic: base ? base.league : null, country: extra ? extra.country : null,
    };
  });
  LEAGUE_TEAMS = clRegistry;
}

var CL_OUTCOME_LABEL = {
  WINNER: "CL winners", FINAL: "CL final", SEMI: "CL semis", QF: "CL quarters",
  R16: "CL last 16", PLAYOFF: "CL play-off", LEAGUE_EXIT: "CL group exit",
};

// football-data.org stage → depth rank (higher = further). Synonyms included
// because the API's labels have drifted across seasons/competitions.
var CL_STAGE_RANK = {
  LEAGUE_STAGE: 0, LEAGUE_PHASE: 0, GROUP_STAGE: 0, REGULAR_SEASON: 0,
  PLAYOFFS: 1, PLAY_OFFS: 1, PLAYOFF_ROUND: 1, KNOCKOUT_PLAYOFFS: 1, PRELIMINARY_ROUND: 1,
  LAST_16: 2, ROUND_OF_16: 2,
  QUARTER_FINALS: 3, QUARTER_FINAL: 3,
  SEMI_FINALS: 4, SEMI_FINAL: 4,
  FINAL: 5,
};
var CL_RANK_OUTCOME = ["LEAGUE_EXIT", "PLAYOFF", "R16", "QF", "SEMI", "FINAL"];

// ─────────────────────────────────────────────────────────────────────────────
// GROUPS / PLAYERS
//
// Same multi-group pattern as the WC app: LEAGUE_PLAYERS is a mutable global
// reassigned by the group gate before first render. Players hold team ids
// (not TLAs), drawn from the five top divisions; the draw spreads pots evenly
// so no one is loaded with weak teams.
//
// Every group — RODENTS included — now lists players only; their league teams
// are drawn on demand by lgEnsureTeams (deterministic per group code, pot-
// balanced, teams split evenly with any remainder left unowned). Families/bots
// are flattened to plain players since the league app has no family view.
// ─────────────────────────────────────────────────────────────────────────────
var LEAGUE_GROUPS = {
  RODENTS: {
    // Re-drawn by lgEnsureTeams from the five-league pool. The old hand-draft
    // held Championship teams, which left the pool when it was dropped, so the
    // placeholder assignment is gone; the real draft happens before kickoff.
    code: "RODENTS", label: "Rodents",
    players: [
      { name: "George" }, { name: "Christoph" }, { name: "Sam" }, { name: "Toby" },
      { name: "Dollie" }, { name: "Elliott" }, { name: "Paul" }, { name: "Auz" },
      { name: "Josh" },
    ],
  },
  SILVERSTREAM: {
    code: "SILVERSTREAM", label: "Silverstream",
    players: [
      { name: "Alex B" }, { name: "Ben" }, { name: "Craig" },
      { name: "Ahmet" }, { name: "Dharma" }, { name: "Henry" },
      { name: "Katrina" }, { name: "Luke DF" }, { name: "Michelle" },
      { name: "Nick S" }, { name: "Ollie P" },
      { name: "Ramon" }, { name: "Sam" }, { name: "Stephen" },
      { name: "Stuart" }, { name: "Wes" }, { name: "Will A" }, { name: "Will B" },
      { name: "Peter H" }, { name: "Alex DL" },
      { name: "Josh" },
    ],
  },
  CORNWALL: {
    code: "CORNWALL", label: "Cornwall",
    players: [
      { name: "Paul" }, { name: "Auz" }, { name: "Candice" }, { name: "Charlotte" },
      { name: "Elliott" }, { name: "Emily" }, { name: "Iain" }, { name: "Izzy" },
      { name: "Kate" }, { name: "Katie" }, { name: "Lucy" }, { name: "Naomi" },
      { name: "Rory" }, { name: "Sam" }, { name: "Tom" }, { name: "Tori" },
      { name: "Josh" },
    ],
  },
  MACKLINS: {
    code: "MACKLINS", label: "Macklins",
    players: [
      { name: "Maggie" }, { name: "Julian" }, { name: "Molly" }, { name: "Josh" },
      { name: "Candice" }, { name: "Jasper" }, { name: "Taco" },
    ],
  },
  CAVERSHAM: {
    code: "CAVERSHAM", label: "Caversham",
    // Family pools (same as the WC app). Families are ranked by AVERAGE member
    // points so bigger households don't win by headcount.
    families: [
      { name: "Hampson",        members: ["Jon", "India", "Delilah"] },
      { name: "Campbell",       members: ["Aaron", "Katie", "Lily", "Freya C"] },
      { name: "Macklin",        members: ["Josh", "Candice", "Jasper"] },
      { name: "Baldwin-Renton", members: ["Yan", "Freya R", "Nora"] },
      { name: "Rukin",          members: ["Jake", "Helen", "Frank", "Ivo"] },
    ],
    players: [
      { name: "Aaron" }, { name: "Candice" }, { name: "Katie" }, { name: "Jon" },
      { name: "India" }, { name: "Yan" }, { name: "Freya R" }, { name: "Jake" },
      { name: "Helen" }, { name: "Frank" }, { name: "Ivo" }, { name: "Jasper" },
      { name: "Delilah" }, { name: "Nora" }, { name: "Freya C" }, { name: "Lily" },
      { name: "Josh" },
    ],
  },
};

var LEAGUE_PLAYERS = LEAGUE_GROUPS.RODENTS.players; // reassigned at runtime by the group gate
// Active group's families (only family groups, e.g. Caversham, have them) — set
// by App from group.families, same pattern as LEAGUE_PLAYERS. null = no families.
var LEAGUE_FAMILIES = null;

// ─────────────────────────────────────────────────────────────────────────────
// FAMILIES — pooled standings for family groups.
//
// lgFamilyStandings(ranked, families, weekWindow, hist) → rows sorted by avg:
//   { name, members: [{ name, total, rank }], total, avg, weekPts, move,
//     combinedHist }
// avg = mean member total (rounded); move = 7-day change in FAMILY rank
// (positive = up), computed from each member's total a week ago (total −
// weekWindow pts) — the same window the player pills use.
// ─────────────────────────────────────────────────────────────────────────────
function lgFamilyStandings(ranked, families, weekWindow, hist) {
  if (!families || !families.length) return [];
  var byName = {};
  ranked.forEach(function (p, i) { byName[p.name] = { p: p, rank: i + 1 }; });
  var rows = families.map(function (f) {
    var members = f.members.map(function (n) {
      var e = byName[n];
      return { name: n, total: e ? e.p.total : 0, rank: e ? e.rank : null };
    }).sort(function (a, b) { return b.total - a.total; });
    var total = 0, weekPts = 0;
    members.forEach(function (m) { total += m.total; weekPts += (weekWindow && weekWindow[m.name]) ? weekWindow[m.name].pts : 0; });
    var hs = members.map(function (m) { return (hist && hist[m.name]) || []; }).filter(function (h) { return h.length; });
    var len = hs.reduce(function (mx, h) { return Math.max(mx, h.length); }, 0);
    var combinedHist = [];
    for (var i = 0; i < len; i++) {
      var sum = 0;
      hs.forEach(function (h) { sum += (h[i] != null ? h[i] : h[h.length - 1]) || 0; });
      combinedHist.push(Math.round(sum / Math.max(1, members.length)));
    }
    var n = Math.max(1, members.length);
    return { name: f.name, members: members, total: total, avg: Math.round(total / n),
      avgBefore: (total - weekPts) / n, weekPts: weekPts, combinedHist: combinedHist.length ? combinedHist : [0] };
  });
  var before = rows.slice().sort(function (a, b) { return b.avgBefore - a.avgBefore; });
  var rankBefore = {};
  before.forEach(function (r, i) { rankBefore[r.name] = i; });
  rows.sort(function (a, b) { return (b.avg - a.avg) || (b.total - a.total); });
  rows.forEach(function (r, i) { r.move = rankBefore[r.name] - i; });
  return rows;
}

// The family a player belongs to in the active group (or null).
function lgFamilyOf(name, families) {
  var fams = families || LEAGUE_FAMILIES;
  if (!fams) return null;
  for (var i = 0; i < fams.length; i++) if (fams[i].members.indexOf(name) !== -1) return fams[i];
  return null;
}

function leagueMatchGroupCode(input) {
  var q = String(input || "").trim().toUpperCase();
  for (var key in LEAGUE_GROUPS) if (LEAGUE_GROUPS[key].code.toUpperCase() === q) return key;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAGUE DRAW — assign league teams to a group's players on demand.
//
// Every preset group (and any league created in-app) is FAIR-drawn here:
// deterministic (seeded by the group code, so a code always shows the same
// squads on every phone) and balanced within ±1 per player on each pot, CL
// clubs, CL tier-1 giants and league. A group whose players already carry
// teamIds (a frozen draw) is left untouched. NB: changing LEAGUE_TEAMS pots or
// rosters re-deals every un-frozen group — freeze squads before sharing.
// ─────────────────────────────────────────────────────────────────────────────
function lgHashStr(s) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function lgMulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function lgShuffle(arr, rng) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
function lgEnsureTeams(group) {
  if (!group || !group.players) return;
  var real = group.players.slice(); // every player is drafted a squad
  // Already drafted (frozen teamIds, or a group drawn earlier this session) → leave be.
  if (real.length && real.every(function (p) { return p.teamIds && p.teamIds.length; })) return;
  real.forEach(function (p) { p.teamIds = []; });
  var N = real.length;
  if (!N) return;
  var rng = lgMulberry32(lgHashStr("LGFAIR::" + (group.code || group.label || "")));
  var pool = [];
  Object.keys(LEAGUE_TEAMS).forEach(function (id) {
    if (lgScoringLeague(LEAGUE_TEAMS[id].league)) pool.push(Number(id)); // scoring leagues only
  });
  var tierOf = function (id) { return (lgHasCL() && typeof CL_TIER !== "undefined" && CL_TIER[id]) || 0; };
  var leagueOf = function (id) { return LEAGUE_TEAMS[id].league; };
  // Same squad size as the live draft (lgDraftPerPlayer): a multiple of the
  // league count whenever every league can give each player the same number.
  var k = (typeof lgDraftPerPlayer === "function") ? lgDraftPerPlayer(pool, N, leagueOf) : Math.floor(pool.length / N);
  if (k >= 1) {
    // FAIR, LEAGUE-BALANCED DRAW. Each player gets k clubs with an EQUAL count
    // per league (k / leagues) when possible, otherwise floor/ceil of k /
    // leagues per league (quotas fixed up front so nobody comes up short). Spare clubs (not dealt) are each league's
    // weakest non-CL sides. Clubs are dealt strongest-first (pot asc; CL tier
    // 1→4 then non-CL), each to an eligible player with the fewest so far of
    // — in priority order — that pot, CL clubs, that CL tier, clubs overall;
    // seeded random breaks ties. Result: equal per league, and every pot / CL
    // count within ±1 across players.
    var Ls = [], size = {};
    pool.forEach(function (id) { var L = leagueOf(id); if (!size[L]) { size[L] = 0; Ls.push(L); } size[L]++; });
    // Per-player league quotas: everyone gets `base` from every league, plus
    // one extra from `extra` leagues (0 when k divides evenly). Which leagues
    // get the extras is spread so no league is asked for more clubs than it
    // has (e.g. Silverstream: 21 players × 4 clubs, but BL1/FL1 have only 18).
    var base = Math.floor(k / Ls.length), extra = k - base * Ls.length;
    var eL = {};
    Ls.forEach(function (L) { eL[L] = 0; });
    for (var x = 0; x < N * extra; x++) { // hand out extras to leagues with the most spare capacity
      var bestL = null;
      lgShuffle(Ls.slice(), rng).forEach(function (L) {
        var spareCap = size[L] - N * base - eL[L];
        if (spareCap > 0 && eL[L] < N && (bestL === null || spareCap > size[bestL] - N * base - eL[bestL])) bestL = L;
      });
      if (bestL === null) break;
      eL[bestL]++;
    }
    var quota = {}; // quota[playerIndex][league]
    real.forEach(function (p, i) { quota[i] = {}; Ls.forEach(function (L) { quota[i][L] = base; }); });
    var extrasOf = real.map(function () { return 0; });
    Ls.slice().sort(function (a, b) { return eL[b] - eL[a]; }).forEach(function (L) {
      var idxs = lgShuffle(real.map(function (_, i) { return i; }), rng)
        .sort(function (a, b) { return extrasOf[a] - extrasOf[b]; })
        .filter(function (i) { return extrasOf[i] < extra; })
        .slice(0, eL[L]);
      idxs.forEach(function (i) { quota[i][L]++; extrasOf[i]++; });
    });
    // Spare clubs: each league keeps exactly what its quotas need; the rest
    // (weakest non-CL first) go undealt.
    var weakFirst = function (arr) {
      return lgShuffle(arr.slice(), rng).sort(function (a, b) {
        return (LEAGUE_TEAMS[b].pot - LEAGUE_TEAMS[a].pot) || ((tierOf(a) ? 1 : 0) - (tierOf(b) ? 1 : 0));
      });
    };
    var spare = [];
    Ls.forEach(function (L) {
      var need = 0; real.forEach(function (_, i) { need += quota[i][L]; });
      var inL = pool.filter(function (id) { return leagueOf(id) === L; });
      spare = spare.concat(weakFirst(inL).slice(0, Math.max(0, inL.length - need)));
    });
    pool = pool.filter(function (id) { return spare.indexOf(id) === -1; });
    var order = [];
    [1, 2, 3, 4].forEach(function (pot) {
      [1, 2, 3, 4, 0].forEach(function (tier) {
        order = order.concat(lgShuffle(pool.filter(function (id) {
          return LEAGUE_TEAMS[id].pot === pot && tierOf(id) === tier;
        }), rng));
      });
    });
    var count = function (p, f) { var n = 0; p.teamIds.forEach(function (i) { if (f(i)) n++; }); return n; };
    order.forEach(function (id) {
      var t = LEAGUE_TEAMS[id], tier = tierOf(id);
      var best = null, bestKey = null;
      lgShuffle(real.map(function (p, i) { return i; }), rng).forEach(function (pi) { // shuffled so exact ties fall randomly
        var p = real[pi];
        if (p.teamIds.length >= k) return;
        if (count(p, function (i) { return leagueOf(i) === t.league; }) >= quota[pi][t.league]) return;
        var key = [
          count(p, function (i) { return LEAGUE_TEAMS[i].pot === t.pot; }),
          tier ? count(p, function (i) { return tierOf(i) > 0; }) : 0,
          tier ? count(p, function (i) { return tierOf(i) === tier; }) : 0,
          p.teamIds.length,
        ];
        var better = !bestKey;
        for (var j = 0; !better && j < key.length; j++) {
          if (key[j] !== bestKey[j]) { better = key[j] < bestKey[j]; break; }
        }
        if (better) { best = p; bestKey = key; }
      });
      if (best) best.teamIds.push(id);
    });
    return;
  }
  // More players than clubs (never hit by the preset groups): two each,
  // co-owned round-robin from a shuffled pool.
  var seq = lgShuffle(pool.slice(), rng);
  for (var i = 0; i < 2 * N; i++) {
    var pl = real[i % N], pick = seq[i % seq.length];
    if (pl.teamIds.indexOf(pick) === -1) pl.teamIds.push(pick);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANCED LIVE DRAFT — a player can't take a second club from a league until
// they hold one from every league (that still has clubs left), so squads end
// with an equal number from each league. Mirrored in worker/src/index.js
// (server-side enforcement + autopick); keep the two in sync.
//
// lgDraftAllowedLeagues(leagueOf, myIds, takenIds, poolIds) → { league: true }
// lgDraftPerPlayer(poolIds, nPlayers, leagueOf) → picks per player: the
//   largest EQUAL split (a multiple of the league count) every league can
//   supply; if even one-from-each doesn't fit (too many players), the largest
//   squad with league counts within one of each other.
// ─────────────────────────────────────────────────────────────────────────────
function lgDraftAllowedLeagues(leagueOf, myIds, takenIds, poolIds) {
  var taken = {}, avail = {}, count = {}, allowed = {};
  (takenIds || []).forEach(function (id) { taken[id] = 1; });
  (poolIds || []).forEach(function (id) { if (!taken[id]) avail[leagueOf(id)] = 1; });
  Object.keys(avail).forEach(function (L) { count[L] = 0; });
  (myIds || []).forEach(function (id) { var L = leagueOf(id); if (count[L] != null) count[L]++; });
  var min = Infinity;
  Object.keys(count).forEach(function (L) { if (count[L] < min) min = count[L]; });
  Object.keys(count).forEach(function (L) { if (count[L] === min) allowed[L] = true; });
  return allowed;
}
function lgDraftPerPlayer(poolIds, nPlayers, leagueOf) {
  if (!nPlayers) return 0;
  var size = {};
  (poolIds || []).forEach(function (id) { var L = leagueOf(id); size[L] = (size[L] || 0) + 1; });
  var Ls = Object.keys(size);
  if (!Ls.length) return 0;
  // k is dealable if every player can hold floor(k/L) from each league plus
  // one extra from (k mod L) leagues without any league running out.
  var feasible = function (k) {
    var base = Math.floor(k / Ls.length), extra = k - base * Ls.length, ok = true, room = 0;
    Ls.forEach(function (L) {
      if (size[L] < base * nPlayers) ok = false;
      else room += Math.min(nPlayers, size[L] - base * nPlayers);
    });
    return ok && room >= nPlayers * extra;
  };
  var max = Math.floor((poolIds || []).length / nPlayers), k;
  // Prefer an EQUAL split (a multiple of the league count)…
  for (k = max - (max % Ls.length); k >= Ls.length; k -= Ls.length) if (feasible(k)) return k;
  // …else (too many players for one each) the largest within-one split.
  for (k = Math.min(max, Ls.length - 1); k >= 1; k--) if (feasible(k)) return k;
  return 0;
}

// Throwaway "preview" draw for the lobby's Preview-app button: deal each of the
// given names a random, pot-fair squad from the chosen competitions' pool so
// players can explore a simulated season before the real draft. Not persisted;
// `seed` lets the caller re-roll a fresh assignment. Same pot-balancing model as
// lgEnsureTeams but restricted to `comps` (the lobby's selected leagues).
function lgPreviewDraw(names, comps, seed) {
  var players = (names || []).map(function (n) { return { name: n, teamIds: [] }; });
  if (!players.length || typeof LEAGUE_TEAMS === "undefined") {
    return { code: "PREVIEW", label: "Preview", players: players };
  }
  var rng = lgMulberry32(lgHashStr("LGPREVIEW::" + (seed || "") + "::" + players.map(function (p) { return p.name; }).join(",")));
  var poolIds = (typeof lgPoolTeamIds === "function") ? lgPoolTeamIds(comps) : [];
  // Group the eligible pool by league|pot so we can deal pot-fairly.
  var pools = {};
  poolIds.forEach(function (id) {
    var t = LEAGUE_TEAMS[id]; if (!t) return;
    (pools[t.league + "|" + t.pot] = pools[t.league + "|" + t.pot] || []).push(Number(id));
  });
  var poolArrs = Object.keys(pools).map(function (k) { return lgShuffle(pools[k].slice(), rng); });
  var maxLen = poolArrs.reduce(function (m, a) { return Math.max(m, a.length); }, 0);
  var seq = [];
  for (var r = 0; r < maxLen; r++) {
    lgShuffle(poolArrs, rng).forEach(function (pool) { if (pool[r] !== undefined) seq.push(pool[r]); });
  }
  if (!seq.length) return { code: "PREVIEW", label: "Preview", players: players };
  var perPlayer = Math.max(1, Math.floor(seq.length / players.length));
  var start = Math.floor(rng() * players.length);
  var toAssign = perPlayer * players.length;
  for (var i = 0; i < toAssign; i++) players[(start + i) % players.length].teamIds.push(seq[i]);
  return { code: "PREVIEW", label: "Preview", players: players };
}

function leagueOwnerOfTeamId(teamId, players) {
  var roster = players || LEAGUE_PLAYERS;
  for (var i = 0; i < roster.length; i++) {
    if ((roster[i].teamIds || []).indexOf(teamId) !== -1) return roster[i];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function lgIsSettled(m) {
  return m.status === "FINISHED" || m.status === "AWARDED" || m.status === "IN_PLAY" || m.status === "PAUSED";
}

function lgResultFor(m, teamId) {
  // "W" | "D" | "L" from teamId's perspective, or null if not their game.
  var hs = (m.score && m.score.fullTime && m.score.fullTime.home) || 0;
  var as = (m.score && m.score.fullTime && m.score.fullTime.away) || 0;
  if (m.homeTeam && m.homeTeam.id === teamId) return hs > as ? "W" : hs < as ? "L" : "D";
  if (m.awayTeam && m.awayTeam.id === teamId) return as > hs ? "W" : as < hs ? "L" : "D";
  return null;
}

function lgRegularSeason(matches, compCode) {
  var cfg = (typeof LEAGUE_COMPETITIONS !== "undefined") ? LEAGUE_COMPETITIONS[compCode] : null;
  var isCup = cfg && cfg.type === "cup";
  return matches.filter(function (m) {
    if (!m.competition || m.competition.code !== compCode) return false;
    // A cup's "regular season" is its league phase — everything that isn't a
    // knockout round (rank >= 1). Domestic leagues use the API's REGULAR_SEASON.
    if (isCup) return !(CL_STAGE_RANK[m.stage] >= 1);
    return m.stage === "REGULAR_SEASON";
  });
}

// Filter for replay mode: the world as of a given date.
function leagueMatchesUpTo(matches, isoDate) {
  return matches.filter(function (m) { return m.utcDate <= isoDate; });
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveLeagueTable(matches, compCode) → sorted standings
// [{ teamId, played, w, d, l, gf, ga, gd, pts }] — pts/gd/gf tiebreak (both
// the PL and the EFL resolve equal points by goal difference then goals
// scored). Includes every team that appears in the fixtures, whether or not
// it's in LEAGUE_TEAMS — replays of past seasons contain since-relegated
// clubs, and the table must still add up.
// ─────────────────────────────────────────────────────────────────────────────
function deriveLeagueTable(matches, compCode) {
  var rows = {};
  function row(id) {
    if (!rows[id]) rows[id] = { teamId: id, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
    return rows[id];
  }
  lgRegularSeason(matches, compCode).forEach(function (m) {
    if (m.homeTeam && m.homeTeam.id) row(m.homeTeam.id);
    if (m.awayTeam && m.awayTeam.id) row(m.awayTeam.id);
    if (!lgIsSettled(m)) return;
    var hs = (m.score && m.score.fullTime && m.score.fullTime.home) || 0;
    var as = (m.score && m.score.fullTime && m.score.fullTime.away) || 0;
    var h = row(m.homeTeam.id), a = row(m.awayTeam.id);
    h.played++; a.played++;
    h.gf += hs; h.ga += as; a.gf += as; a.ga += hs;
    if (hs > as)      { h.w++; a.l++; h.pts += 3; }
    else if (as > hs) { a.w++; h.l++; a.pts += 3; }
    else              { h.d++; a.d++; h.pts++; a.pts++; }
  });
  var table = Object.keys(rows).map(function (id) {
    var r = rows[id]; r.gd = r.gf - r.ga; return r;
  });
  table.sort(function (x, y) { return y.pts - x.pts || y.gd - x.gd || y.gf - x.gf; });
  return table;
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveSeasonOutcomes(matches) → { [teamId]: { comp, outcome } }
//
// Awards each team AT MOST one outcome key, and only once it is
// mathematically settled — same "definite-only" philosophy as the WC app's
// clinchedR32. Mid-season it uses conservative pairwise bounds (ties assumed
// against the team), so it can be late but never wrong; a complete regular
// season settles everything exactly from the final table. Championship
// playoff fixtures upgrade the 3rd-6th placed teams as the semis/final play
// out. Live (IN_PLAY) games count at the current score and self-correct at
// full time, matching how match points behave.
// ─────────────────────────────────────────────────────────────────────────────
function deriveSeasonOutcomes(matches) {
  var out = {};
  function award(teamId, comp, outcome) {
    if (!out[teamId]) out[teamId] = { comp: comp, outcome: outcome };
  }

  Object.keys(LEAGUE_COMPETITIONS).forEach(function (comp) {
    var cfg = LEAGUE_COMPETITIONS[comp];
    if (cfg.type === "cup") return; // Champions League scored via deriveCLProgress, not here
    var table = deriveLeagueTable(matches, comp);
    if (table.length === 0) return;
    var complete = table.length >= cfg.size && table.every(function (r) { return r.played >= cfg.games; });
    var maxPts = {};
    table.forEach(function (r) { maxPts[r.teamId] = r.pts + 3 * Math.max(0, cfg.games - r.played); });
    // Teams absent from the table (no fixtures in the data yet, or dropped
    // by a partial API response) could still finish anywhere — they count
    // against every clinch.
    var unseen = Math.max(0, cfg.size - table.length);

    // teamId guaranteed to finish in the top K places (pessimistic on ties)
    function clinchedTop(r, K) {
      if (complete) return table.indexOf(r) < K;
      var couldFinishAbove = unseen + table.filter(function (u) {
        return u.teamId !== r.teamId && maxPts[u.teamId] >= r.pts;
      }).length;
      return couldFinishAbove < K;
    }
    // teamId guaranteed to finish in the bottom `relegated` places
    function condemned(r) {
      var n = Math.max(table.length, cfg.size);
      if (complete) return table.indexOf(r) >= n - cfg.relegated;
      var definitelyAbove = table.filter(function (u) {
        return u.teamId !== r.teamId && u.pts > maxPts[r.teamId];
      }).length;
      return definitelyAbove >= n - cfg.relegated;
    }

    if (comp === "ELC") {
      // Playoff fixtures are the strongest signal — process before the table.
      // The API's stage labels vary by season ("SEMI_FINALS"/"FINAL" in
      // 2024-25, a flat "PLAYOFFS" in 2025-26), so identify the final
      // structurally: semis are two-legged (the same pairing appears twice
      // in the fixture list), the final is a one-off. TBD fixtures (null
      // team ids, e.g. the final before the semis resolve) are ignored.
      var po = matches.filter(function (m) {
        return m.competition && m.competition.code === "ELC" &&
          m.stage !== "REGULAR_SEASON" &&
          m.homeTeam && m.homeTeam.id && m.awayTeam && m.awayTeam.id;
      });
      var pairCount = {}, teamPairs = {};
      po.forEach(function (m) {
        var key = [m.homeTeam.id, m.awayTeam.id].sort().join("-");
        if (!pairCount[key]) {
          [m.homeTeam.id, m.awayTeam.id].forEach(function (id) {
            teamPairs[id] = (teamPairs[id] || 0) + 1;
          });
        }
        pairCount[key] = (pairCount[key] || 0) + 1;
      });
      var final_ = po.filter(function (m) {
        if (m.stage === "FINAL") return true;
        // One-off pairing between two teams that have each already played a
        // (two-legged) semi — a lone first leg never qualifies.
        var key = [m.homeTeam.id, m.awayTeam.id].sort().join("-");
        return pairCount[key] === 1 && teamPairs[m.homeTeam.id] >= 2 && teamPairs[m.awayTeam.id] >= 2;
      }).sort(function (a, b) { return b.utcDate.localeCompare(a.utcDate); })[0];
      if (final_) {
        if (final_.status === "FINISHED" && final_.score && final_.score.winner && final_.score.winner !== "DRAW") {
          award(final_.score.winner === "HOME_TEAM" ? final_.homeTeam.id : final_.awayTeam.id, "ELC", "PROMOTED");
        }
        award(final_.homeTeam.id, "ELC", "PLAYOFF_FINAL"); // winner already PROMOTED; first-write-wins
        award(final_.awayTeam.id, "ELC", "PLAYOFF_FINAL");
      }
      po.forEach(function (m) {
        award(m.homeTeam.id, "ELC", "PLAYOFFS");
        award(m.awayTeam.id, "ELC", "PLAYOFFS");
      });
    }

    table.forEach(function (r) {
      if (cfg.type === "top") {
        if (clinchedTop(r, 1))      award(r.teamId, comp, "WINNER");
        else if (clinchedTop(r, 4)) award(r.teamId, comp, "TOP_4");
        else if (clinchedTop(r, 7)) award(r.teamId, comp, "TOP_7");
        else if (condemned(r))      award(r.teamId, comp, "RELEGATED");
      } else {
        if (clinchedTop(r, 1))      award(r.teamId, comp, "WINNER");
        else if (clinchedTop(r, 2)) award(r.teamId, comp, "PROMOTED");
        else if (clinchedTop(r, 6)) award(r.teamId, comp, "PLAYOFFS");
        else if (condemned(r))      award(r.teamId, comp, "RELEGATED");
      }
    });
  });
  return out;
}

function leagueBonusPts(teamId, outcomes) {
  var o = outcomes[teamId];
  var team = LEAGUE_TEAMS[teamId];
  if (!o || !team) return 0;
  var matrix = LEAGUE_BONUS[o.comp];
  if (!matrix || !matrix[o.outcome]) return 0;
  return matrix[o.outcome][team.pot - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveCLProgress(matches) → { [teamId]: CL_OUTCOME }
//
// The furthest Champions League stage each club has reached. Deep runs (>= QF)
// are credited on reaching the stage; earlier exits (league phase / play-off /
// R16) are only credited once the tournament has FINISHED a later round, so a
// club still alive mid-competition isn't prematurely scored as "out". For a
// completed season (the replay) every club gets its true final stage.
// ─────────────────────────────────────────────────────────────────────────────
function deriveCLProgress(matches) {
  var cl = matches.filter(function (m) {
    return m.competition && m.competition.code === "CL" &&
      m.homeTeam && m.homeTeam.id && m.awayTeam && m.awayTeam.id;
  });
  if (cl.length === 0) return {};
  function rankOf(m) { var r = CL_STAGE_RANK[m.stage]; return typeof r === "number" ? r : 0; }

  var maxFinishedRank = 0;
  cl.forEach(function (m) { if (m.status === "FINISHED") maxFinishedRank = Math.max(maxFinishedRank, rankOf(m)); });

  var furthest = {}; // id → furthest stage rank reached (any status = drawn into it)
  cl.forEach(function (m) {
    var r = rankOf(m);
    [m.homeTeam.id, m.awayTeam.id].forEach(function (id) {
      if (furthest[id] == null || r > furthest[id]) furthest[id] = r;
    });
  });

  // Champion = winner of the latest FINISHED final.
  var finalWin = cl.filter(function (m) {
    return rankOf(m) === 5 && m.status === "FINISHED" && m.score && m.score.winner && m.score.winner !== "DRAW";
  }).sort(function (a, b) { return b.utcDate.localeCompare(a.utcDate); })[0];
  var champion = finalWin ? (finalWin.score.winner === "HOME_TEAM" ? finalWin.homeTeam.id : finalWin.awayTeam.id) : null;

  var out = {};
  Object.keys(furthest).forEach(function (key) {
    var id = Number(key), r = furthest[id];
    if (r === 5) { out[id] = (champion === id) ? "WINNER" : "FINAL"; return; }
    // An early-stage exit only counts once a later round has actually finished
    // (confirming elimination); QF/SF are positive milestones, credited on reach.
    if (r < 3 && maxFinishedRank <= r) return;
    out[id] = CL_RANK_OUTCOME[r];
  });
  return out;
}

// A club's CL tier (UEFA draw pot); falls back to its domestic pot, then 4,
// so a club missing from CL_TIER (e.g. a stale season) still scores sensibly.
function clTierOf(teamId) {
  if (CL_TIER[teamId]) return CL_TIER[teamId];
  var t = LEAGUE_TEAMS[teamId];
  return t ? t.pot : 4;
}

// Stage-reached points for one club's CL run (0 if it isn't in the CL).
function clGamblePts(teamId, clProgress) {
  var o = clProgress && clProgress[teamId];
  if (!o || !LEAGUE_TEAMS[teamId]) return 0;
  var row = CL_GAMBLE[o];
  return row ? (row[clTierOf(teamId) - 1] || 0) : 0;
}

function lgIsCL(m) { return m.competition && m.competition.code === "CL"; }

// Points one side earned from one settled CL match (0 for non-CL / losses).
function clMatchPtsFor(m, teamId) {
  if (!lgIsCL(m) || !lgIsSettled(m)) return 0;
  var r = lgResultFor(m, teamId);
  if (r !== "W" && r !== "D") return 0;
  var opp = m.homeTeam.id === teamId ? m.awayTeam.id : m.homeTeam.id;
  var gap = Math.max(0, clTierOf(teamId) - clTierOf(opp));
  return r === "W" ? CL_MATCH_PTS.winBase + CL_MATCH_PTS.winPerGap * gap
                   : CL_MATCH_PTS.drawBase + CL_MATCH_PTS.drawPerGap * gap;
}

// { teamId: giant-killer bonus } from decided knockout ties (deriveCLBracket).
function clGiantKills(matches) {
  var out = {};
  if (typeof deriveCLBracket !== "function") return out;
  deriveCLBracket(matches).rounds.forEach(function (round) {
    round.ties.forEach(function (t) {
      if (!t.winner) return;
      var loser = t.winner === t.a ? t.b : t.a;
      var gap = clTierOf(t.winner) - clTierOf(loser);
      if (gap > 0) out[t.winner] = (out[t.winner] || 0) + CL_GIANT_KILL_PER_TIER * gap;
    });
  });
  return out;
}

// Total CL points for one club: match points + giant kills + stage reached.
// Pass precomputed clProgress / giantKills when scoring many clubs at once.
function clTeamPts(matches, teamId, clProgress, giantKills) {
  if (!LEAGUE_TEAMS[teamId]) return 0;
  var prog = clProgress || deriveCLProgress(matches);
  var gk = giantKills || clGiantKills(matches);
  var mp = 0;
  matches.forEach(function (m) { mp += clMatchPtsFor(m, teamId); });
  return mp + (gk[teamId] || 0) + clGamblePts(teamId, prog);
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveCLBracket(matches) → { rounds: [{ stage, label, ties: [...] }] }
//
// The Champions League knockout bracket for the CL tab. Each round groups its
// fixtures into ties by the unordered team pair (two-legged for R16-SF, a
// single match for the final), summing legs into an aggregate. The tie winner
// is whoever advanced (reached a later round) — robust to away goals /
// penalties / format quirks without parsing them — falling back to the
// aggregate, or the final's own result for the trophy.
// ─────────────────────────────────────────────────────────────────────────────
function deriveCLBracket(matches) {
  var ko = matches.filter(function (m) {
    return m.competition && m.competition.code === "CL" && CL_STAGE_RANK[m.stage] >= 1 &&
      m.homeTeam && m.homeTeam.id && m.awayTeam && m.awayTeam.id;
  });
  if (ko.length === 0) return { rounds: [] };

  var furthest = {};
  ko.forEach(function (m) {
    var r = CL_STAGE_RANK[m.stage] || 0;
    [m.homeTeam.id, m.awayTeam.id].forEach(function (id) {
      if (furthest[id] == null || r > furthest[id]) furthest[id] = r;
    });
  });
  var finalWin = ko.filter(function (m) {
    return CL_STAGE_RANK[m.stage] === 5 && m.status === "FINISHED" && m.score && m.score.winner && m.score.winner !== "DRAW";
  }).sort(function (a, b) { return b.utcDate.localeCompare(a.utcDate); })[0];
  var champion = finalWin ? (finalWin.score.winner === "HOME_TEAM" ? finalWin.homeTeam.id : finalWin.awayTeam.id) : null;

  var STAGES = [
    ["PLAYOFFS", 1, "Play-offs"], ["LAST_16", 2, "Round of 16"],
    ["QUARTER_FINALS", 3, "Quarter-finals"], ["SEMI_FINALS", 4, "Semi-finals"], ["FINAL", 5, "Final"],
  ];
  var rounds = [];
  STAGES.forEach(function (st) {
    var rank = st[1];
    var ms = ko.filter(function (m) { return CL_STAGE_RANK[m.stage] === rank; });
    if (ms.length === 0) return;
    var groups = {};
    ms.forEach(function (m) {
      var key = [m.homeTeam.id, m.awayTeam.id].sort(function (a, b) { return a - b; }).join("-");
      (groups[key] = groups[key] || []).push(m);
    });
    var ties = Object.keys(groups).map(function (key) {
      var legs = groups[key].slice().sort(function (a, b) { return a.utcDate.localeCompare(b.utcDate); });
      var a = legs[0].homeTeam.id, b = legs[0].awayTeam.id;
      var aggA = 0, aggB = 0, anyFinished = false, played = false;
      legs.forEach(function (m) {
        if (!m.score || !m.score.fullTime || !lgIsSettled(m)) return;
        played = true;
        if (m.status === "FINISHED") anyFinished = true;
        var hs = m.score.fullTime.home || 0, as = m.score.fullTime.away || 0;
        if (m.homeTeam.id === a) { aggA += hs; aggB += as; } else { aggA += as; aggB += hs; }
      });
      var winner = null;
      if (furthest[a] > rank) winner = a;
      else if (furthest[b] > rank) winner = b;
      else if (rank === 5 && champion) winner = champion;
      else if (anyFinished && aggA !== aggB) winner = aggA > aggB ? a : b;
      return { a: a, b: b, aggA: aggA, aggB: aggB, legs: legs.length, winner: winner, played: played };
    });
    rounds.push({ stage: st[0], label: st[2], ties: ties });
  });
  return { rounds: rounds };
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveLeagueWDL / deriveLeagueMatchPts
// ─────────────────────────────────────────────────────────────────────────────
function deriveLeagueWDL(matches, teamId) {
  var wdl = { w: 0, d: 0, l: 0 };
  matches.forEach(function (m) {
    if (!lgIsLeagueGame(m) || !lgIsSettled(m)) return;
    var r = lgResultFor(m, teamId);
    if (r === "W") wdl.w++; else if (r === "D") wdl.d++; else if (r === "L") wdl.l++;
  });
  return wdl;
}

// Match points a team has earned (W/D by pot and league across settled
// games). Priced by the team's OWN league/pot (what the player drafted),
// not the competition a fixture happens to be in.
function lgTeamMatchPts(matches, teamId) {
  var team = LEAGUE_TEAMS[teamId];
  if (!team) return 0;
  var pts = LEAGUE_MATCH_PTS[team.league];
  if (!pts) return 0; // team not in a covered league this season (e.g. 2025-26 League One)
  var wdl = deriveLeagueWDL(matches, teamId);
  return wdl.w * pts.win[team.pot - 1] + wdl.d * pts.draw[team.pot - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// scoreLeaguePlayers(matches) → ranked array (the main scorer)
// [{ name, total, w, d, l, tiebreak, teams: [{ teamId, tla, name, pot, league,
//    w, d, l, matchPts, bonusPts, clPts, outcome, total }] }]
// Sorted: total desc → tiebreak desc (W×3 + D − L, as WC).
// ─────────────────────────────────────────────────────────────────────────────
function scoreLeaguePlayers(matches) {
  var outcomes = deriveSeasonOutcomes(matches);
  var clProgress = deriveCLProgress(matches);
  var giantKills = clGiantKills(matches);
  var ranked = LEAGUE_PLAYERS.map(function (p) {
    // Skip ids no longer in LEAGUE_TEAMS (e.g. a club drafted before it was
    // relegated out of the pool) rather than crash on t.tla.
    var teams = (p.teamIds || []).filter(function (id) { return LEAGUE_TEAMS[id]; }).map(function (id) {
      var t = LEAGUE_TEAMS[id];
      var wdl = deriveLeagueWDL(matches, id);
      var matchPts = lgTeamMatchPts(matches, id);
      var bonusPts = leagueBonusPts(id, outcomes);
      var clPts = clTeamPts(matches, id, clProgress, giantKills);
      return {
        teamId: id, tla: t.tla, name: t.name, pot: t.pot, league: t.league,
        w: wdl.w, d: wdl.d, l: wdl.l,
        matchPts: matchPts, bonusPts: bonusPts,
        clPts: clPts, clOutcome: clProgress[id] || null,
        outcome: outcomes[id] ? outcomes[id].outcome : null,
        total: matchPts + bonusPts + clPts,
      };
    });
    var w = 0, d = 0, l = 0, total = 0;
    teams.forEach(function (t) { w += t.w; d += t.d; l += t.l; total += t.total; });
    return { name: p.name, teams: teams, total: total, w: w, d: d, l: l, tiebreak: w * 3 + d - l };
  });
  ranked.sort(function (a, b) {
    if (b.total !== a.total) return b.total - a.total;
    return b.tiebreak - a.tiebreak;
  });
  return ranked;
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveLeagueHistory(matches) → { frames: [YYYY-MM-DD], history: { name: [totals] } }
//
// Cumulative player totals at the end of every day that had at least one
// settled match — the league equivalent of the WC app's per-match sparkline
// history (per-day, because a league season has ~950 matches across ~150
// playing days; per-match frames would be noise). Includes season bonuses
// as they clinch, so the final frame always equals the live total.
// ─────────────────────────────────────────────────────────────────────────────
function deriveLeagueHistory(matches) {
  // Single incremental pass (match points accumulate per game; only the
  // season-outcome step rescans, per frame) — the naive score-everything-per-
  // frame version took >1s for a full season, too slow for something recomputed
  // on every fetch. Invariant, checked by the test harness: the final frame must
  // equal scoreLeaguePlayers' totals.
  var settled = matches.filter(lgIsSettled).slice()
    .sort(function (a, b) { return a.utcDate.localeCompare(b.utcDate); });
  var history = {};
  LEAGUE_PLAYERS.forEach(function (p) { history[p.name] = []; });
  var frames = [];
  var matchPts = {};   // teamId → accumulated W/D points
  var clPts = {};     // teamId → accumulated CL match points
  var current = [], idx = 0;
  var days = [];
  settled.forEach(function (m) {
    var d = m.utcDate.slice(0, 10);
    if (days[days.length - 1] !== d) days.push(d);
  });
  days.forEach(function (day) {
    while (idx < settled.length && settled[idx].utcDate.slice(0, 10) <= day) {
      var m = settled[idx++];
      current.push(m);
      if (lgIsCL(m)) {
        [m.homeTeam.id, m.awayTeam.id].forEach(function (id) {
          if (LEAGUE_TEAMS[id]) clPts[id] = (clPts[id] || 0) + clMatchPtsFor(m, id);
        });
      } else if (m.stage === "REGULAR_SEASON") {
        [m.homeTeam.id, m.awayTeam.id].forEach(function (id) {
          var t = LEAGUE_TEAMS[id];
          if (!t) return;
          var r = lgResultFor(m, id);
          var pts = LEAGUE_MATCH_PTS[t.league];
          if (!pts) return; // team not in a scoring league (e.g. replay-only Championship/L1 sides)
          if (r === "W") matchPts[id] = (matchPts[id] || 0) + pts.win[t.pot - 1];
          else if (r === "D") matchPts[id] = (matchPts[id] || 0) + pts.draw[t.pot - 1];
        });
      }
    }
    var outcomes = deriveSeasonOutcomes(current);
    var clProg = deriveCLProgress(current);
    var gk = clGiantKills(current);
    frames.push(day);
    LEAGUE_PLAYERS.forEach(function (p) {
      var total = 0;
      (p.teamIds || []).forEach(function (id) {
        if (!LEAGUE_TEAMS[id]) return;
        total += (matchPts[id] || 0) + leagueBonusPts(id, outcomes) + (clPts[id] || 0) + (gk[id] || 0) + clGamblePts(id, clProg);
      });
      history[p.name].push(total);
    });
  });
  return { frames: frames, history: history };
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveLeagueTeamHistory(matches) → { frames: [YYYY-MM-DD], history: { teamId: [totals] } }
//
// Per-team cumulative sweepstake points (matchPts + season bonus) at the end of
// every settled day — the team-level twin of deriveLeagueHistory, feeding the
// Teams-view sparklines. Same incremental pass and per-frame outcome derivation,
// keyed by teamId instead of player. Invariant: the final frame for a team
// equals that team's `total` in scoreLeaguePlayers. Kept as its own pass (rather
// than folded into deriveLeagueHistory) so the Teams tab can compute it lazily
// only when shown — a per-frame deriveSeasonOutcomes scan isn't free.
// ─────────────────────────────────────────────────────────────────────────────
function deriveLeagueTeamHistory(matches) {
  var settled = matches.filter(lgIsSettled).slice()
    .sort(function (a, b) { return a.utcDate.localeCompare(b.utcDate); });
  var history = {};   // teamId → [cumulative sweepstake pts]
  Object.keys(LEAGUE_TEAMS).forEach(function (id) { history[id] = []; });
  var frames = [];
  var matchPts = {};  // teamId → accumulated W/D points
  var clPts = {};    // teamId → accumulated CL match points
  var current = [], idx = 0;
  var days = [];
  settled.forEach(function (m) {
    var d = m.utcDate.slice(0, 10);
    if (days[days.length - 1] !== d) days.push(d);
  });
  days.forEach(function (day) {
    while (idx < settled.length && settled[idx].utcDate.slice(0, 10) <= day) {
      var m = settled[idx++];
      current.push(m);
      if (lgIsCL(m)) {
        [m.homeTeam.id, m.awayTeam.id].forEach(function (id) {
          if (LEAGUE_TEAMS[id]) clPts[id] = (clPts[id] || 0) + clMatchPtsFor(m, id);
        });
      } else if (m.stage === "REGULAR_SEASON") {
        [m.homeTeam.id, m.awayTeam.id].forEach(function (id) {
          var t = LEAGUE_TEAMS[id];
          if (!t) return;
          var r = lgResultFor(m, id);
          var pts = LEAGUE_MATCH_PTS[t.league];
          if (!pts) return; // team not in a scoring league (e.g. replay-only Championship/L1 sides)
          if (r === "W") matchPts[id] = (matchPts[id] || 0) + pts.win[t.pot - 1];
          else if (r === "D") matchPts[id] = (matchPts[id] || 0) + pts.draw[t.pot - 1];
        });
      }
    }
    var outcomes = deriveSeasonOutcomes(current);
    var clProg = deriveCLProgress(current);
    var gk = clGiantKills(current);
    frames.push(day);
    Object.keys(LEAGUE_TEAMS).forEach(function (id) {
      history[id].push((matchPts[id] || 0) + leagueBonusPts(Number(id), outcomes) + (clPts[id] || 0) + (gk[id] || 0) + clGamblePts(Number(id), clProg));
    });
  });
  return { frames: frames, history: history };
}

// ─────────────────────────────────────────────────────────────────────────────
// GAMEWEEKS — FPL-style week-by-week view. A gameweek is built from calendar
// weeks (Monday 00:00 → Sunday 23:59 UTC, identical for every league; CL
// midweek games land in the week they're played). International breaks and
// other near-empty weeks are folded into the next gameweek (LG_GW_MIN_FIXTURES),
// so GW numbers only count real football weeks.
//
// lgWeeks(matches) → [{ n, start, end, first, last, count }]  (ISO dates; end
//   exclusive; first/last = actual fixture dates, used for the label)
// lgGameweek(matches, ranked, teamHist, matchPtsById, week) → {
//   players: [{ name, pts, clPts, bonusPts, rank, teams: [{ teamId, name, pot,
//     league, pts, matchPts, clPts, bonusPts, results: [{ m, r, earned }] }] }],
//   avg, highest, teamsOfWeek: [{ teamId, name, pot, owner, pts }] (top 10) }
// A club's week pts = its cumulative sweepstake total (deriveLeagueTeamHistory)
// at the week's end minus at its start, so season bonuses / CL stage payouts /
// giant kills count in the week they're confirmed and weekly totals always sum
// to the season total. bonusPts = that delta minus the per-match points.
// ─────────────────────────────────────────────────────────────────────────────
function lgMondayOf(iso) {
  var d = new Date(iso);
  var day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}
// Calendar weeks with fewer than this many fixtures (international breaks, a
// stray rescheduled game) aren't gameweeks: they're folded into the NEXT
// gameweek (or the previous one at season end), so the ranges stay contiguous
// and no points are lost — weeks still sum to the season total.
var LG_GW_MIN_FIXTURES = 5;
function lgWeeks(matches) {
  if (!matches || !matches.length) return [];
  var first = null, last = null;
  matches.forEach(function (m) {
    if (!m.utcDate) return;
    if (first === null || m.utcDate < first) first = m.utcDate;
    if (last === null || m.utcDate > last) last = m.utcDate;
  });
  if (!first) return [];
  var cal = [];
  for (var d = lgMondayOf(first), stop = lgMondayOf(last); d <= stop; d = new Date(d.getTime() + 7 * 864e5)) {
    var e = new Date(d.getTime() + 7 * 864e5);
    cal.push({ start: d.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10), count: 0, first: null, last: null });
  }
  matches.forEach(function (m) {
    if (!m.utcDate) return;
    var day = m.utcDate.slice(0, 10);
    for (var i = 0; i < cal.length; i++) {
      if (day >= cal[i].start && day < cal[i].end) {
        var w = cal[i]; w.count++;
        if (!w.first || day < w.first) w.first = day;
        if (!w.last || day > w.last) w.last = day;
        break;
      }
    }
  });
  var out = [], pending = null; // a sparse run waiting to be folded into the next real week
  cal.forEach(function (w) {
    if (w.count < LG_GW_MIN_FIXTURES) {
      if (!pending) pending = { start: w.start, count: 0, first: null, last: null };
      pending.count += w.count;
      if (w.first && (!pending.first || w.first < pending.first)) pending.first = w.first;
      if (w.last && (!pending.last || w.last > pending.last)) pending.last = w.last;
      return;
    }
    var gw = { start: w.start, end: w.end, count: w.count, first: w.first, last: w.last };
    if (pending) {
      gw.start = pending.start; gw.count += pending.count;
      if (pending.first) gw.first = pending.first < gw.first ? pending.first : gw.first;
      pending = null;
    }
    out.push(gw);
  });
  if (pending) { // sparse tail → fold into the last gameweek
    if (out.length) {
      var lastGw = out[out.length - 1];
      lastGw.end = new Date(new Date(cal[cal.length - 1].end).getTime()).toISOString().slice(0, 10);
      lastGw.count += pending.count;
      if (pending.last && pending.last > lastGw.last) lastGw.last = pending.last;
    } else {
      out.push({ start: pending.start, end: cal[cal.length - 1].end, count: pending.count, first: pending.first, last: pending.last });
    }
  }
  out.forEach(function (w, i) { w.n = i + 1; });
  return out;
}
// Index of the gameweek to open on for date iso: the gameweek containing it,
// unless that one hasn't kicked off yet (e.g. we're in an international break
// folded into it) — then the previous gameweek. Clamped to the season.
function lgWeekIndexOf(weeks, iso) {
  if (!weeks.length) return -1;
  var d = String(iso).slice(0, 10);
  if (d < weeks[0].start) return 0;
  for (var i = 0; i < weeks.length; i++) {
    if (d >= weeks[i].start && d < weeks[i].end) {
      return (weeks[i].first && d < weeks[i].first && i > 0) ? i - 1 : i;
    }
  }
  return weeks.length - 1;
}
function lgCumAt(series, frames, endExclusive) {
  // value of a cumulative per-frame series at the last frame strictly before endExclusive
  var v = 0;
  for (var i = 0; i < frames.length; i++) {
    if (frames[i] < endExclusive) v = series[i] != null ? series[i] : v; else break;
  }
  return v;
}
function lgGameweek(matches, ranked, teamHist, matchPtsById, week) {
  var frames = (teamHist && teamHist.frames) || [], hist = (teamHist && teamHist.history) || {};
  var inWeek = matches.filter(function (m) {
    var d = m.utcDate.slice(0, 10);
    return d >= week.start && d < week.end && lgIsSettled(m);
  });
  var players = ranked.map(function (p) {
    var teams = (p.teams || []).map(function (t) {
      var series = hist[t.teamId] || [];
      var delta = lgCumAt(series, frames, week.end) - lgCumAt(series, frames, week.start);
      var matchPts = 0, clPts = 0, results = [];
      inWeek.forEach(function (m) {
        if (m.homeTeam.id !== t.teamId && m.awayTeam.id !== t.teamId) return;
        var row = matchPtsById && matchPtsById[m.id];
        var earned = row ? (m.homeTeam.id === t.teamId ? row.home : row.away) : 0;
        matchPts += earned;
        if (m.competition && m.competition.code === "CL") clPts += earned;
        results.push({ m: m, r: lgResultFor(m, t.teamId), earned: earned });
      });
      return { teamId: t.teamId, name: t.name, pot: t.pot, league: t.league,
        pts: delta, matchPts: matchPts, clPts: clPts, bonusPts: delta - matchPts, results: results };
    }).sort(function (a, b) { return b.pts - a.pts; });
    var pts = 0, clPts = 0, bonusPts = 0;
    teams.forEach(function (t) { pts += t.pts; clPts += t.clPts; bonusPts += t.bonusPts; });
    return { name: p.name, pts: pts, clPts: clPts, bonusPts: bonusPts, teams: teams };
  }).sort(function (a, b) { return b.pts - a.pts; });
  players.forEach(function (p, i) { p.rank = (i > 0 && players[i - 1].pts === p.pts) ? players[i - 1].rank : i + 1; });
  var sum = 0; players.forEach(function (p) { sum += p.pts; });
  var tow = [];
  players.forEach(function (p) { p.teams.forEach(function (t) { tow.push({ teamId: t.teamId, name: t.name, pot: t.pot, owner: p.name, pts: t.pts }); }); });
  tow.sort(function (a, b) { return b.pts - a.pts; });
  return { players: players, avg: players.length ? Math.round(sum / players.length) : 0,
    highest: (players[0] && players[0].pts !== 0) ? players[0] : null, teamsOfWeek: tow.slice(0, 10), played: inWeek.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7-day window: points gained + table movement per player. The league's
// answer to the WC app's rolling 24h window — a league weekend is the
// natural rhythm, and `anchorIso` keeps it working in replay mode.
// ─────────────────────────────────────────────────────────────────────────────
function lgWeekWindow(ranked, matches, anchorIso) {
  var weekAgo = new Date(new Date(anchorIso).getTime() - 7 * 24 * 3600 * 1000).toISOString();
  var before = scoreLeaguePlayers(leagueMatchesUpTo(matches, weekAgo));
  var beforeRank = {}, beforeTotal = {};
  before.forEach(function (p, i) { beforeRank[p.name] = i; beforeTotal[p.name] = p.total; });
  var out = {};
  ranked.forEach(function (p, i) {
    out[p.name] = {
      pts: p.total - (beforeTotal[p.name] || 0),
      move: (beforeRank[p.name] !== undefined ? beforeRank[p.name] : i) - i,
    };
  });
  return out;
}

// { name: positions moved in the last 7 days } — positive = up the table.
function computeWeekRankChange(matches, ranked, anchorIso) {
  var win = lgWeekWindow(ranked, matches, anchorIso);
  var out = {};
  Object.keys(win).forEach(function (name) { out[name] = win[name].move; });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveLeagueMatchPts(matches) → { matchId: { home, away } }
// Sweepstake points each side earned from that game (W/D by the team's own
// pot/league; 0 for losses and for clubs nobody could own). The league
// cousin of the WC app's deriveMatchPts — feeds the per-match "+Npts" chips
// on Home rows, score cards and the team/player pop-up cards.
// ─────────────────────────────────────────────────────────────────────────────
function deriveLeagueMatchPts(matches) {
  var out = {};
  matches.forEach(function (m) {
    if (lgIsCL(m)) { // CL games: tier-gap points (owned clubs only)
      if (!lgIsSettled(m)) return;
      out[m.id] = {
        home: LEAGUE_TEAMS[m.homeTeam.id] ? clMatchPtsFor(m, m.homeTeam.id) : 0,
        away: LEAGUE_TEAMS[m.awayTeam.id] ? clMatchPtsFor(m, m.awayTeam.id) : 0,
      };
      return;
    }
    if (m.stage !== "REGULAR_SEASON" || !lgIsSettled(m)) return;
    var row = { home: 0, away: 0 };
    [["home", m.homeTeam.id], ["away", m.awayTeam.id]].forEach(function (side) {
      var t = LEAGUE_TEAMS[side[1]];
      if (!t) return;
      var r = lgResultFor(m, side[1]);
      var pts = LEAGUE_MATCH_PTS[t.league];
      if (!pts) return; // team's league isn't scored (e.g. a since-relegated club)
      if (r === "W") row[side[0]] = pts.win[t.pot - 1];
      else if (r === "D") row[side[0]] = pts.draw[t.pot - 1];
    });
    out[m.id] = row;
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeNewLeagueBadges(badgesNow, matches, anchorIso) → [{name, ...badge}]
// Badges assigned within the last 7 days: diff current holders against the
// holders as of a week before the anchor (same rolling window as the pills).
// Mirrors the WC app's computeNewBadges24h.
// ─────────────────────────────────────────────────────────────────────────────
function computeNewLeagueBadges(badgesNow, matches, anchorIso) {
  var weekAgo = new Date(new Date(anchorIso).getTime() - 7 * 24 * 3600 * 1000).toISOString();
  var beforeMatches = leagueMatchesUpTo(matches, weekAgo);
  var beforeRanked = scoreLeaguePlayers(beforeMatches);
  var beforeBadges = computeLeagueBadges(beforeRanked, beforeMatches, weekAgo);
  var had = {};
  Object.keys(beforeBadges).forEach(function (name) {
    beforeBadges[name].forEach(function (b) { had[name + "|" + b.label] = true; });
  });
  var fresh = [];
  Object.keys(badgesNow).forEach(function (name) {
    badgesNow[name].forEach(function (b) {
      if (!had[name + "|" + b.label]) fresh.push({ name: name, icon: b.icon, label: b.label, desc: b.desc, bad: b.bad });
    });
  });
  return fresh;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeLeagueBadges(ranked, matches, anchorIso) → { playerName: [badges] }
//
// The league cousin of the WC app's computeBadges. `anchorIso` is "now" —
// live mode passes the current time, replay mode passes the scrubber date,
// so movement badges (7-day window) work identically in both. Most badges
// are single-winner; each player's list is sorted rarest-first (fewest
// holders across the group), same as the WC app, so a row preview shows
// what's unique to a player. Badge: { icon, label, desc }.
// ─────────────────────────────────────────────────────────────────────────────
function computeLeagueBadges(ranked, matches, anchorIso) {
  var badges = {};
  function give(name, icon, label, desc, bad) {
    (badges[name] = badges[name] || []).push({ icon: icon, label: label, desc: desc, bad: !!bad });
  }
  var real = ranked;
  if (real.length === 0) return badges;

  var played = matches.some(function (m) { return lgIsSettled(m) && lgIsLeagueGame(m); });
  if (played) {
    give(real[0].name, "🏆", "Top Dog", "Top of the table. For now.");
    give(real[real.length - 1].name, "🥄", "Wooden Spoon", "Somebody has to hold it.", true);
  }

  // ── 7-day window: points gained + table movement ──
  var win = lgWeekWindow(ranked, matches, anchorIso);
  var window7 = real.map(function (p) {
    return { name: p.name, pts: win[p.name].pts, move: win[p.name].move };
  });
  var hot = window7.slice().sort(function (a, b) { return b.pts - a.pts; });
  if (hot[0].pts > hot[hot.length - 1].pts) {
    give(hot[0].name, "⚡", "On Fire", "Most points in the last 7 days (+" + hot[0].pts + ").");
    give(hot[hot.length - 1].name, "🥶", "Ice Cold", "Fewest points in the last 7 days (" + (hot[hot.length - 1].pts > 0 ? "+" : "") + hot[hot.length - 1].pts + ").", true);
  }
  var movers = window7.slice().sort(function (a, b) { return b.move - a.move; });
  if (movers[0].move > 0) give(movers[0].name, "🚀", "Climber", "Biggest table climb of the week (up " + movers[0].move + ").");
  if (movers[movers.length - 1].move < 0) give(movers[movers.length - 1].name, "📉", "Sliding", "Biggest table fall of the week (down " + (-movers[movers.length - 1].move) + ").", true);

  // ── per-owned-team aggregates: goals, streaks, upsets ──
  var ownedIds = {};
  real.forEach(function (p) { p.teams.forEach(function (t) { ownedIds[t.teamId] = p.name; }); });
  var gf = {}, ga = {};                    // per player
  var streaks = {};                        // per owned team: current W/unbeaten/loss runs
  var bestUpset = null;                    // biggest pot-gap win by a weaker-pot team
  var chrono = matches.slice().sort(function (a, b) { return a.utcDate.localeCompare(b.utcDate); });
  chrono.forEach(function (m) {
    if (!lgIsLeagueGame(m) || !lgIsSettled(m)) return;
    var hs = (m.score && m.score.fullTime && m.score.fullTime.home) || 0;
    var as = (m.score && m.score.fullTime && m.score.fullTime.away) || 0;
    [[m.homeTeam.id, hs, as], [m.awayTeam.id, as, hs]].forEach(function (side) {
      var id = side[0], f = side[1], a = side[2];
      var owner = ownedIds[id];
      if (owner) { gf[owner] = (gf[owner] || 0) + f; ga[owner] = (ga[owner] || 0) + a; }
      var s = streaks[id] = streaks[id] || { win: 0, unbeaten: 0, loss: 0 };
      if (f > a)      { s.win++; s.unbeaten++; s.loss = 0; }
      else if (f < a) { s.win = 0; s.unbeaten = 0; s.loss++; }
      else            { s.win = 0; s.unbeaten++; s.loss = 0; }
    });
    var hT = LEAGUE_TEAMS[m.homeTeam.id], aT = LEAGUE_TEAMS[m.awayTeam.id];
    if (hT && aT && hs !== as) {
      var winner = hs > as ? hT : aT, loser = hs > as ? aT : hT;
      var gap = winner.pot - loser.pot; // positive = weaker pot beat stronger pot
      if (gap > 0 && ownedIds[winner.id] && (!bestUpset || gap >= bestUpset.gap)) {
        bestUpset = { gap: gap, owner: ownedIds[winner.id], team: winner.name, victim: loser.name };
      }
    }
  });
  if (bestUpset) give(bestUpset.owner, "🔪", "Giant Killer", bestUpset.team + " toppled " + bestUpset.victim + " (Pot " + bestUpset.gap + " gap).");

  var byGf = real.filter(function (p) { return gf[p.name] !== undefined; });
  if (byGf.length > 1) {
    var most = byGf.slice().sort(function (a, b) { return gf[b.name] - gf[a.name]; });
    if (gf[most[0].name] > gf[most[most.length - 1].name]) {
      give(most[0].name, "💥", "Firepower", "Most goals scored by their teams (" + gf[most[0].name] + ").");
      give(most[most.length - 1].name, "💨", "Firing Blanks", "Fewest goals scored by their teams (" + gf[most[most.length - 1].name] + ").", true);
    }
    var tight = byGf.slice().sort(function (a, b) { return ga[a.name] - ga[b.name]; });
    if (ga[tight[0].name] < ga[tight[tight.length - 1].name]) {
      give(tight[0].name, "🧱", "Brick Wall", "Fewest goals conceded by their teams (" + ga[tight[0].name] + ").");
      give(tight[tight.length - 1].name, "🚰", "Leaky", "Most goals conceded by their teams (" + ga[tight[tight.length - 1].name] + ").", true);
    }
  }

  // ── current streaks (need a run of 3+ to be worth bragging about) ──
  var bestRun = null, worstRun = null;
  Object.keys(streaks).forEach(function (id) {
    if (!ownedIds[id]) return;
    var s = streaks[id], t = LEAGUE_TEAMS[id];
    if (s.unbeaten >= 3 && (!bestRun || s.unbeaten > bestRun.n)) bestRun = { n: s.unbeaten, owner: ownedIds[id], team: t.name };
    if (s.loss >= 3 && (!worstRun || s.loss > worstRun.n)) worstRun = { n: s.loss, owner: ownedIds[id], team: t.name };
  });
  if (bestRun) give(bestRun.owner, "🛡️", "Unbreakable", bestRun.team + " are " + bestRun.n + " games unbeaten.");
  if (worstRun) give(worstRun.owner, "🚑", "Crisis Club", worstRun.team + " have lost " + worstRun.n + " on the bounce.", true);

  // ── misc flavour ──
  if (played) {
    real.forEach(function (p) { if (p.w === 0) give(p.name, "🦆", "Still Quacking", "Yet to see a single win.", true); });
    var gaps = real.map(function (p) {
      var totals = p.teams.map(function (t) { return t.total; });
      return { name: p.name, gap: Math.max.apply(null, totals) - Math.min.apply(null, totals) };
    }).sort(function (a, b) { return b.gap - a.gap; });
    if (gaps[0].gap > 0) give(gaps[0].name, "🎸", "One Man Band", "One team doing all the work (" + gaps[0].gap + " pt gap to their worst).");
  }

  // 🍞 Bread Winner / 🐑 Black Sheep — family groups only. Each family's
  // top/bottom contributor by SHARE of the family's combined points is a
  // candidate; the single highest share across all families wins Bread Winner,
  // the single lowest wins Black Sheep (as the WC app). Families with a
  // non-positive total or fewer than 2 members are skipped (shares meaningless).
  if (LEAGUE_FAMILIES && played) {
    var totalOf = {};
    real.forEach(function (p) { totalOf[p.name] = p.total; });
    var tops = [], bottoms = [];
    LEAGUE_FAMILIES.forEach(function (f) {
      if (f.members.length < 2) return;
      var famTotal = 0;
      f.members.forEach(function (n) { famTotal += totalOf[n] || 0; });
      if (famTotal <= 0) return;
      var shares = f.members.map(function (n) { return { name: n, family: f.name, share: (totalOf[n] || 0) / famTotal }; })
        .sort(function (a, b) { return b.share - a.share; });
      tops.push(shares[0]); bottoms.push(shares[shares.length - 1]);
    });
    tops.sort(function (a, b) { return b.share - a.share; });
    bottoms.sort(function (a, b) { return a.share - b.share; });
    if (tops[0]) give(tops[0].name, "🍞", "Bread Winner", "Carrying the " + tops[0].family + " family (" + Math.round(tops[0].share * 100) + "% of their points).");
    if (bottoms[0]) give(bottoms[0].name, "🐑", "Black Sheep", "Contributing the least to the " + bottoms[0].family + " family (" + Math.round(bottoms[0].share * 100) + "% of their points).", true);
  }

  // rarest-first within each player, mirroring the WC app
  var holders = {};
  Object.keys(badges).forEach(function (name) {
    badges[name].forEach(function (b) { holders[b.label] = (holders[b.label] || 0) + 1; });
  });
  Object.keys(badges).forEach(function (name) {
    badges[name].sort(function (a, b) { return holders[a.label] - holders[b.label]; });
  });
  return badges;
}
