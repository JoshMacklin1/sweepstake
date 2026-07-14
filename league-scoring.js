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

// Replay/testing season. The 2025-26 season is fully played and free-tier
// accessible, so the whole app can be exercised on real historical data.
// Flip to 2026 for the live 2026-27 season (PL starts 2026-08-21, ELC 08-14).
var LEAGUE_SEASON = 2025;

var LEAGUE_COMPETITIONS = {
  PL:  { code: "PL",  label: "Premier League", games: 38, size: 20, potSize: 5, relegated: 3 },
  ELC: { code: "ELC", label: "Championship",   games: 46, size: 24, potSize: 6, relegated: 3 },
};

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
  // Minimalist letter-mark crests, committed to the repo under crests/<id>.svg
  // (self-contained SVGs, club colours + abbreviation) — replaces the external
  // football-data.org PNGs so crests load offline and match the app's look.
  return "crests/" + teamId + ".svg";
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
  ELC: { win: [4, 5, 5, 5], draw: [2, 3, 3, 3] },
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
  ELC: {
    WINNER:        [80, 200, 400, 800],   // Championship champions
    PROMOTED:      [60, 120, 180, 180],   // 2nd place or playoff final winners
    PLAYOFF_FINAL: [35, 100, 120, 150],   // lost the playoff final
    PLAYOFFS:      [15, 60, 80, 80],      // finished 3rd-6th
    RELEGATED:     [-100, -40, -15, -10],
  },
};

var LEAGUE_OUTCOME_LABEL = {
  WINNER: "Champions", TOP_4: "Top 4", TOP_7: "Top 7",
  PROMOTED: "Promoted", PLAYOFF_FINAL: "Playoff finalist",
  PLAYOFFS: "Made playoffs", RELEGATED: "Relegated",
};

// ─────────────────────────────────────────────────────────────────────────────
// GROUPS / PLAYERS
//
// Same multi-group pattern as the WC app: LEAGUE_PLAYERS is a mutable global
// reassigned by the group gate before first render. Players hold team ids
// (not TLAs). Every player must own an EQUAL number of PL and ELC teams —
// the Championship's 46 games vs the PL's 38 would otherwise skew match
// points toward Championship-heavy rosters.
//
// RODENTS: same crew as the WC app's Rodents group (8 players, Josh as the
// Grim Reaper). 4 teams each (2 PL + 2 ELC), pot-balanced so everyone holds
// exactly one team from each pot (a P1+P4 pair in one league, P2+P3 in the
// other), snake-paired best-with-worst within the composite ranking. This is
// a PLACEHOLDER draw for testing — the real draw happens before kickoff.
// Unowned: PL Chelsea/Sunderland/Brentford/Fulham; ELC Millwall/Boro/
// Wrexham/Portsmouth/West Brom/Preston/Watford/Derby.
// ─────────────────────────────────────────────────────────────────────────────
var LEAGUE_GROUPS = {
  RODENTS: {
    code: "RODENTS", label: "Rodents",
    players: [
      { name: "George",    teamIds: [57, 322, 356, 332] },   // ARS HUL | SHU BIR
      { name: "Christoph", teamIds: [65, 1076, 68, 70] },    // MCI COV | NOR STK
      { name: "Sam",       teamIds: [64, 349, 387, 59] },    // LIV IPS | BRC BLA
      { name: "Toby",      teamIds: [58, 341, 72, 69] },     // AVL LEE | SWA QPR
      { name: "Dollie",    teamIds: [66, 73, 563, 1126] },   // MUN TOT | WHU LIN
      { name: "Elliott",   teamIds: [1044, 351, 76, 60] },   // BOU NOT | WOL BOL
      { name: "Paul",      teamIds: [397, 354, 328, 348] },  // BHA CRY | BUR CHA
      { name: "Auz",       teamIds: [67, 62, 340, 715] },    // NEW EVE | SOU CAR
      { name: "Josh", teamIds: [], grimReaper: true },
    ],
  },
};

var LEAGUE_PLAYERS = LEAGUE_GROUPS.RODENTS.players; // reassigned at runtime by the group gate

function leagueMatchGroupCode(input) {
  var q = String(input || "").trim().toUpperCase();
  for (var key in LEAGUE_GROUPS) if (LEAGUE_GROUPS[key].code.toUpperCase() === q) return key;
  return null;
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
  return m.status === "FINISHED" || m.status === "IN_PLAY" || m.status === "PAUSED";
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
  return matches.filter(function (m) {
    return m.competition && m.competition.code === compCode && m.stage === "REGULAR_SEASON";
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
      if (comp === "PL") {
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
// deriveLeagueWDL / deriveLeagueMatchPts
// ─────────────────────────────────────────────────────────────────────────────
function deriveLeagueWDL(matches, teamId) {
  var wdl = { w: 0, d: 0, l: 0 };
  matches.forEach(function (m) {
    if (m.stage !== "REGULAR_SEASON" || !lgIsSettled(m)) return;
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
// THE GRIM REAPER
// Scores from misfortune, cannot own teams:
//   1. Relegation bounty — the absolute value of the owner's penalty when a
//      Pot 1/2 team goes down (PL: +150/+75, ELC: +100/+50).
//   2. Goal drought — +2 for every finished 0-0 involving at least one owned
//      team (a full league season has far more 0-0s than a World Cup, hence
//      +2 not +3, and only games someone in the group actually suffers).
// ─────────────────────────────────────────────────────────────────────────────
function lgReaperBounty(teamId, outcomes) {
  var o = outcomes[teamId];
  var team = LEAGUE_TEAMS[teamId];
  if (!o || !team || o.outcome !== "RELEGATED" || team.pot > 2) return 0;
  return Math.abs(LEAGUE_BONUS[o.comp].RELEGATED[team.pot - 1]);
}

function lgGoalDroughtPts(m, players) {
  if (m.status !== "FINISHED" || m.stage !== "REGULAR_SEASON") return 0;
  var ft = m.score && m.score.fullTime;
  if (!ft || ft.home !== 0 || ft.away !== 0) return 0;
  var owned = leagueOwnerOfTeamId(m.homeTeam.id, players) || leagueOwnerOfTeamId(m.awayTeam.id, players);
  return owned ? 2 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// scoreLeaguePlayers(matches) → ranked array (the main scorer)
// [{ name, total, w, d, l, tiebreak, grimReaper?, teams: [{ teamId, tla,
//    name, pot, league, w, d, l, matchPts, bonusPts, outcome, total }] }]
// Sorted: total desc → reaper last → tiebreak desc (W×3 + D − L, as WC).
// ─────────────────────────────────────────────────────────────────────────────
function scoreLeaguePlayers(matches) {
  var outcomes = deriveSeasonOutcomes(matches);
  var ranked = LEAGUE_PLAYERS.map(function (p) {
    if (p.grimReaper) {
      var bounty = 0;
      Object.keys(LEAGUE_TEAMS).forEach(function (id) {
        bounty += lgReaperBounty(Number(id), outcomes);
      });
      var drought = 0;
      matches.forEach(function (m) { drought += lgGoalDroughtPts(m, LEAGUE_PLAYERS); });
      return {
        name: p.name, grimReaper: true, teams: [],
        total: bounty + drought, bountyPts: bounty, droughtPts: drought,
        w: 0, d: 0, l: 0, tiebreak: -Infinity,
      };
    }
    var teams = (p.teamIds || []).map(function (id) {
      var t = LEAGUE_TEAMS[id];
      var wdl = deriveLeagueWDL(matches, id);
      var matchPts = lgTeamMatchPts(matches, id);
      var bonusPts = leagueBonusPts(id, outcomes);
      return {
        teamId: id, tla: t.tla, name: t.name, pot: t.pot, league: t.league,
        w: wdl.w, d: wdl.d, l: wdl.l,
        matchPts: matchPts, bonusPts: bonusPts,
        outcome: outcomes[id] ? outcomes[id].outcome : null,
        total: matchPts + bonusPts,
      };
    });
    var w = 0, d = 0, l = 0, total = 0;
    teams.forEach(function (t) { w += t.w; d += t.d; l += t.l; total += t.total; });
    return { name: p.name, teams: teams, total: total, w: w, d: d, l: l, tiebreak: w * 3 + d - l };
  });
  ranked.sort(function (a, b) {
    if (b.total !== a.total) return b.total - a.total;
    if (!!a.grimReaper !== !!b.grimReaper) return a.grimReaper ? 1 : -1;
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
  // Single incremental pass (match points and reaper droughts accumulate
  // per game; only the season-outcome step rescans, per frame) — the naive
  // score-everything-per-frame version took >1s for a full season, which is
  // too slow for something recomputed on every fetch. Invariant, checked by
  // the test harness: the final frame must equal scoreLeaguePlayers' totals.
  var settled = matches.filter(lgIsSettled).slice()
    .sort(function (a, b) { return a.utcDate.localeCompare(b.utcDate); });
  var history = {};
  LEAGUE_PLAYERS.forEach(function (p) { history[p.name] = []; });
  var frames = [];
  var matchPts = {};   // teamId → accumulated W/D points
  var drought = 0;     // reaper 0-0 curse, accumulated
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
      if (m.stage === "REGULAR_SEASON") {
        [m.homeTeam.id, m.awayTeam.id].forEach(function (id) {
          var t = LEAGUE_TEAMS[id];
          if (!t) return;
          var r = lgResultFor(m, id);
          var pts = LEAGUE_MATCH_PTS[t.league];
          if (r === "W") matchPts[id] = (matchPts[id] || 0) + pts.win[t.pot - 1];
          else if (r === "D") matchPts[id] = (matchPts[id] || 0) + pts.draw[t.pot - 1];
        });
        drought += lgGoalDroughtPts(m, LEAGUE_PLAYERS);
      }
    }
    var outcomes = deriveSeasonOutcomes(current);
    frames.push(day);
    LEAGUE_PLAYERS.forEach(function (p) {
      if (p.grimReaper) {
        var bounty = 0;
        Object.keys(outcomes).forEach(function (id) { bounty += lgReaperBounty(Number(id), outcomes); });
        history[p.name].push(bounty + drought);
        return;
      }
      var total = 0;
      (p.teamIds || []).forEach(function (id) {
        total += (matchPts[id] || 0) + leagueBonusPts(id, outcomes);
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
      if (m.stage === "REGULAR_SEASON") {
        [m.homeTeam.id, m.awayTeam.id].forEach(function (id) {
          var t = LEAGUE_TEAMS[id];
          if (!t) return;
          var r = lgResultFor(m, id);
          var pts = LEAGUE_MATCH_PTS[t.league];
          if (r === "W") matchPts[id] = (matchPts[id] || 0) + pts.win[t.pot - 1];
          else if (r === "D") matchPts[id] = (matchPts[id] || 0) + pts.draw[t.pot - 1];
        });
      }
    }
    var outcomes = deriveSeasonOutcomes(current);
    frames.push(day);
    Object.keys(LEAGUE_TEAMS).forEach(function (id) {
      history[id].push((matchPts[id] || 0) + leagueBonusPts(Number(id), outcomes));
    });
  });
  return { frames: frames, history: history };
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
    if (m.stage !== "REGULAR_SEASON" || !lgIsSettled(m)) return;
    var row = { home: 0, away: 0 };
    [["home", m.homeTeam.id], ["away", m.awayTeam.id]].forEach(function (side) {
      var t = LEAGUE_TEAMS[side[1]];
      if (!t) return;
      var r = lgResultFor(m, side[1]);
      var pts = LEAGUE_MATCH_PTS[t.league];
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
      if (!had[name + "|" + b.label]) fresh.push({ name: name, icon: b.icon, label: b.label, desc: b.desc });
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
  function give(name, icon, label, desc) {
    (badges[name] = badges[name] || []).push({ icon: icon, label: label, desc: desc });
  }
  var real = ranked.filter(function (p) { return !p.grimReaper; });
  var reaper = ranked.filter(function (p) { return p.grimReaper; })[0];
  if (reaper) give(reaper.name, "💀", "Grim Reaper", "Feeds on relegations and 0-0 draws. Cannot be reasoned with.");
  if (real.length === 0) return badges;

  var played = matches.some(function (m) { return lgIsSettled(m) && m.stage === "REGULAR_SEASON"; });
  if (played) {
    give(real[0].name, "🏆", "Top Dog", "Top of the table. For now.");
    give(real[real.length - 1].name, "🥄", "Wooden Spoon", "Somebody has to hold it.");
  }

  // ── 7-day window: points gained + table movement ──
  var win = lgWeekWindow(ranked, matches, anchorIso);
  var window7 = real.map(function (p) {
    return { name: p.name, pts: win[p.name].pts, move: win[p.name].move };
  });
  var hot = window7.slice().sort(function (a, b) { return b.pts - a.pts; });
  if (hot[0].pts > hot[hot.length - 1].pts) {
    give(hot[0].name, "⚡", "On Fire", "Most points in the last 7 days (+" + hot[0].pts + ").");
    give(hot[hot.length - 1].name, "🥶", "Ice Cold", "Fewest points in the last 7 days (" + (hot[hot.length - 1].pts > 0 ? "+" : "") + hot[hot.length - 1].pts + ").");
  }
  var movers = window7.slice().sort(function (a, b) { return b.move - a.move; });
  if (movers[0].move > 0) give(movers[0].name, "🚀", "Climber", "Biggest table climb of the week (up " + movers[0].move + ").");
  if (movers[movers.length - 1].move < 0) give(movers[movers.length - 1].name, "📉", "Sliding", "Biggest table fall of the week (down " + (-movers[movers.length - 1].move) + ").");

  // ── per-owned-team aggregates: goals, streaks, upsets ──
  var ownedIds = {};
  real.forEach(function (p) { p.teams.forEach(function (t) { ownedIds[t.teamId] = p.name; }); });
  var gf = {}, ga = {};                    // per player
  var streaks = {};                        // per owned team: current W/unbeaten/loss runs
  var bestUpset = null;                    // biggest pot-gap win by a weaker-pot team
  var chrono = matches.slice().sort(function (a, b) { return a.utcDate.localeCompare(b.utcDate); });
  chrono.forEach(function (m) {
    if (m.stage !== "REGULAR_SEASON" || !lgIsSettled(m)) return;
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
      give(most[most.length - 1].name, "💨", "Firing Blanks", "Fewest goals scored by their teams (" + gf[most[most.length - 1].name] + ").");
    }
    var tight = byGf.slice().sort(function (a, b) { return ga[a.name] - ga[b.name]; });
    if (ga[tight[0].name] < ga[tight[tight.length - 1].name]) {
      give(tight[0].name, "🧱", "Brick Wall", "Fewest goals conceded by their teams (" + ga[tight[0].name] + ").");
      give(tight[tight.length - 1].name, "🚰", "Leaky", "Most goals conceded by their teams (" + ga[tight[tight.length - 1].name] + ").");
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
  if (worstRun) give(worstRun.owner, "🚑", "Crisis Club", worstRun.team + " have lost " + worstRun.n + " on the bounce.");

  // ── misc flavour ──
  if (played) {
    real.forEach(function (p) { if (p.w === 0) give(p.name, "🦆", "Still Quacking", "Yet to see a single win."); });
    var gaps = real.map(function (p) {
      var totals = p.teams.map(function (t) { return t.total; });
      return { name: p.name, gap: Math.max.apply(null, totals) - Math.min.apply(null, totals) };
    }).sort(function (a, b) { return b.gap - a.gap; });
    if (gaps[0].gap > 0) give(gaps[0].name, "🎸", "One Man Band", "One team doing all the work (" + gaps[0].gap + " pt gap to their worst).");
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
