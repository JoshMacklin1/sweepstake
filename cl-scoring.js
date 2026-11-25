// ═════════════════════════════════════════════════════════════════════════════
// cl-scoring.js — Champions League Edition scoring/data (fork of scoring.js)
//
// Same engine and rules as the World Cup Edition, mapped onto the UEFA
// Champions League. Generated from scoring.js, then CL-specific pieces swapped:
//   • Pots = UEFA league-phase pots 1–4 (POT, from CL_CLUBS).
//   • "Group stage" = the 36-club LEAGUE PHASE (8 games each). Feed stage
//     LEAGUE_STAGE is renamed GROUP_STAGE at ingest (clNormalizeMatches) so the
//     engine's group logic applies. GROUP_ASSIGNMENTS = { LP: all 36 }.
//   • Qualification (lpResolve): top 8 → Last 16 directly, 9–24 → knockout
//     play-off (the engine's LAST_32 slot; feed stage PLAYOFFS renamed), 25–36
//     out (GROUP_ELIM). Credited only when mathematically certain.
//   • Two-legged ties: every scoring function sees clScoringView(matches) —
//     leg 1 reads as SCHEDULED (nobody advances on it) and leg 2 carries the
//     AGGREGATE score (+ shoot-out), so single-match knockout logic just works.
//   • Team codes are fixed per football-data id (CL_CODE_BY_ID) — the feed's
//     own TLAs collide (Bayern and Barcelona are both "FCB").
//   • Crests replace flags (flag(code) → crests.football-data.org).
// Rosters are the frozen fair draw from the league app's CL mode.
// ═════════════════════════════════════════════════════════════════════════════

var WORKER_URL = "https://football-proxy.joshmacklin7.workers.dev";
var WC_CODE = "CL";
var SEASON = 2026;
// Public VAPID key for push notifications — safe to ship client-side, pairs
// with the private key held server-side as a football-proxy Worker secret.
var VAPID_PUBLIC_KEY = "BBuhMJuFwH_TG-NwDHP8JE5iEi5rPfWnv3Qa6gcFNxW7fID5B_N5IYa3KAwZSfr94qrEk0KryC7QcjSxcLtH_vU";

// DEV_MODE is now controlled via UI toggle — default off
var DEV_MODE_DEFAULT = false;

// Set to true by index.html for groups that use knockout-only scoring (no group-stage W/D pts).
var KNOCKOUT_ONLY = false;

var MOCK_MATCHES = []; // CL: no hand-written mock season; use the live feed




// ─────────────────────────────────────────────────────────────────────────────
// GROUPS — one entry per friend group, each with its own player↔team roster.
// POT, GROUP_ASSIGNMENTS, PTS_INC and everything else below are shared across
// all groups (same WC2026 tournament, same scoring rules) — only the roster
// differs per group. Add a new group by hand here (same way late players used
// to get added directly to the roster) and give it a memorable `code` that
// the group gate in index.html matches against (case-insensitive).
//
// `PLAYERS` (read by every scoring function below and by index.html) is set
// to the active group's roster — the group gate reassigns it once a code is
// entered/restored. It defaults to the first group below until then.
// ─────────────────────────────────────────────────────────────────────────────
// Frozen fair draw (league app CL mode, lgEnsureTeams — pot-balanced). Josh is
// a real player in every group, so each group's Grim Reaper is anonymous.
var CL_CLUBS = {
  ARS: { id: 57, name: "Arsenal", pot: 1 },
  ATM: { id: 78, name: "Atlético Madrid", pot: 1 },
  BAR: { id: 81, name: "Barcelona", pot: 1 },
  FCB: { id: 5, name: "Bayern München", pot: 1 },
  INT: { id: 108, name: "Inter", pot: 1 },
  LIV: { id: 64, name: "Liverpool", pot: 1 },
  MCI: { id: 65, name: "Man City", pot: 1 },
  PSG: { id: 524, name: "Paris SG", pot: 1 },
  RMA: { id: 86, name: "Real Madrid", pot: 1 },
  AVL: { id: 58, name: "Aston Villa", pot: 2 },
  BRU: { id: 851, name: "Club Brugge", pot: 2 },
  BVB: { id: 4, name: "Dortmund", pot: 2 },
  MUN: { id: 66, name: "Man United", pot: 2 },
  PSV: { id: 674, name: "PSV", pot: 2 },
  POR: { id: 503, name: "Porto", pot: 2 },
  BET: { id: 90, name: "Real Betis", pot: 2 },
  ROM: { id: 100, name: "Roma", pot: 2 },
  SPO: { id: 498, name: "Sporting CP", pot: 2 },
  BOD: { id: 5721, name: "Bodø/Glimt", pot: 3 },
  FEN: { id: 613, name: "Fenerbahçe", pot: 3 },
  FEY: { id: 675, name: "Feyenoord", pot: 3 },
  GAL: { id: 610, name: "Galatasaray", pot: 3 },
  LOS: { id: 521, name: "Lille", pot: 3 },
  NAP: { id: 113, name: "Napoli", pot: 3 },
  RBL: { id: 721, name: "RB Leipzig", pot: 3 },
  SHA: { id: 1887, name: "Shakhtar", pot: 3 },
  VIL: { id: 94, name: "Villarreal", pot: 3 },
  AEK: { id: 1899, name: "AEK Athens", pot: 4 },
  COM: { id: 7397, name: "Como", pot: 4 },
  LAS: { id: 2016, name: "LASK", pot: 4 },
  RCL: { id: 546, name: "Lens", pot: 4 },
  SAB: { id: 10233, name: "Sabah", pot: 4 },
  SLA: { id: 930, name: "Slavia Praha", pot: 4 },
  SLO: { id: 7509, name: "Slovan Bratislava", pot: 4 },
  VFB: { id: 10, name: "VfB Stuttgart", pot: 4 },
  VIK: { id: 5720, name: "Viking", pot: 4 },
};
var CL_CODE_BY_ID = {};
Object.keys(CL_CLUBS).forEach(function (c) { CL_CODE_BY_ID[CL_CLUBS[c].id] = c; });

var GROUPS = {
  SILVERSTREAM: {
    code: "SILVERSTREAM",
    label: "Silverstream",
    players: [
      { name: "Alex B", teams: ["Club Brugge"], codes: ["BRU"], lateB: [false] },
      { name: "Ben", teams: ["Fenerbahçe"], codes: ["FEN"], lateB: [false] },
      { name: "Craig", teams: ["Porto"], codes: ["POR"], lateB: [false] },
      { name: "Ahmet", teams: ["Barcelona"], codes: ["BAR"], lateB: [false] },
      { name: "Dharma", teams: ["PSV"], codes: ["PSV"], lateB: [false] },
      { name: "Henry", teams: ["Aston Villa"], codes: ["AVL"], lateB: [false] },
      { name: "Katrina", teams: ["Galatasaray"], codes: ["GAL"], lateB: [false] },
      { name: "Luke DF", teams: ["Inter"], codes: ["INT"], lateB: [false] },
      { name: "Michelle", teams: ["Real Betis"], codes: ["BET"], lateB: [false] },
      { name: "Nick S", teams: ["Real Madrid"], codes: ["RMA"], lateB: [false] },
      { name: "Ollie P", teams: ["Bayern München"], codes: ["FCB"], lateB: [false] },
      { name: "Ramon", teams: ["Sporting CP"], codes: ["SPO"], lateB: [false] },
      { name: "Sam", teams: ["Shakhtar"], codes: ["SHA"], lateB: [false] },
      { name: "Stephen", teams: ["Man City"], codes: ["MCI"], lateB: [false] },
      { name: "Stuart", teams: ["Roma"], codes: ["ROM"], lateB: [false] },
      { name: "Wes", teams: ["Paris SG"], codes: ["PSG"], lateB: [false] },
      { name: "Will A", teams: ["Liverpool"], codes: ["LIV"], lateB: [false] },
      { name: "Will B", teams: ["Dortmund"], codes: ["BVB"], lateB: [false] },
      { name: "Peter H", teams: ["Man United"], codes: ["MUN"], lateB: [false] },
      { name: "Alex DL", teams: ["Arsenal"], codes: ["ARS"], lateB: [false] },
      { name: "Josh", teams: ["Atlético Madrid"], codes: ["ATM"], lateB: [false] },
      { name: "Grim Reaper", teams: [], codes: [], grimReaper: true },
    ],
  },
  RODENTS: {
    code: "RODENTS",
    label: "Rodents",
    players: [
      { name: "George", teams: ["Arsenal", "Club Brugge", "Villarreal", "Lens"], codes: ["ARS", "BRU", "VIL", "RCL"], lateB: [false, false, false, false] },
      { name: "Christoph", teams: ["Barcelona", "Porto", "Napoli", "Slovan Bratislava"], codes: ["BAR", "POR", "NAP", "SLO"], lateB: [false, false, false, false] },
      { name: "Sam", teams: ["Man City", "Sporting CP", "Bodø/Glimt", "Viking"], codes: ["MCI", "SPO", "BOD", "VIK"], lateB: [false, false, false, false] },
      { name: "Toby", teams: ["Paris SG", "Roma", "Fenerbahçe", "AEK Athens"], codes: ["PSG", "ROM", "FEN", "AEK"], lateB: [false, false, false, false] },
      { name: "Dollie", teams: ["Bayern München", "Man United", "RB Leipzig", "Slavia Praha"], codes: ["FCB", "MUN", "RBL", "SLA"], lateB: [false, false, false, false] },
      { name: "Elliott", teams: ["Liverpool", "Real Betis", "Galatasaray", "VfB Stuttgart"], codes: ["LIV", "BET", "GAL", "VFB"], lateB: [false, false, false, false] },
      { name: "Paul", teams: ["Real Madrid", "PSV", "Shakhtar", "Sabah"], codes: ["RMA", "PSV", "SHA", "SAB"], lateB: [false, false, false, false] },
      { name: "Auz", teams: ["Inter", "Dortmund", "Lille", "LASK"], codes: ["INT", "BVB", "LOS", "LAS"], lateB: [false, false, false, false] },
      { name: "Josh", teams: ["Atlético Madrid", "Aston Villa", "Feyenoord", "Como"], codes: ["ATM", "AVL", "FEY", "COM"], lateB: [false, false, false, false] },
      { name: "Grim Reaper", teams: [], codes: [], grimReaper: true },
    ],
  },
  CORNWALL: {
    code: "CORNWALL",
    label: "Cornwall",
    players: [
      { name: "Paul", teams: ["Arsenal", "RB Leipzig"], codes: ["ARS", "RBL"], lateB: [false, false] },
      { name: "Auz", teams: ["Paris SG", "Slavia Praha"], codes: ["PSG", "SLA"], lateB: [false, false] },
      { name: "Candice", teams: ["Bayern München", "Dortmund"], codes: ["FCB", "BVB"], lateB: [false, false] },
      { name: "Charlotte", teams: ["Liverpool", "Bodø/Glimt"], codes: ["LIV", "BOD"], lateB: [false, false] },
      { name: "Elliott", teams: ["Man United", "Napoli"], codes: ["MUN", "NAP"], lateB: [false, false] },
      { name: "Emily", teams: ["Barcelona", "Galatasaray"], codes: ["BAR", "GAL"], lateB: [false, false] },
      { name: "Iain", teams: ["Atlético Madrid", "Sabah"], codes: ["ATM", "SAB"], lateB: [false, false] },
      { name: "Izzy", teams: ["Real Madrid", "Shakhtar"], codes: ["RMA", "SHA"], lateB: [false, false] },
      { name: "Kate", teams: ["Sporting CP", "Slovan Bratislava"], codes: ["SPO", "SLO"], lateB: [false, false] },
      { name: "Katie", teams: ["Inter", "Viking"], codes: ["INT", "VIK"], lateB: [false, false] },
      { name: "Lucy", teams: ["Club Brugge", "Como"], codes: ["BRU", "COM"], lateB: [false, false] },
      { name: "Naomi", teams: ["Porto", "Feyenoord"], codes: ["POR", "FEY"], lateB: [false, false] },
      { name: "Rory", teams: ["Man City", "Villarreal"], codes: ["MCI", "VIL"], lateB: [false, false] },
      { name: "Sam", teams: ["PSV", "Lens"], codes: ["PSV", "RCL"], lateB: [false, false] },
      { name: "Tom", teams: ["Real Betis", "VfB Stuttgart"], codes: ["BET", "VFB"], lateB: [false, false] },
      { name: "Tori", teams: ["Roma", "Lille"], codes: ["ROM", "LOS"], lateB: [false, false] },
      { name: "Josh", teams: ["Aston Villa", "Fenerbahçe"], codes: ["AVL", "FEN"], lateB: [false, false] },
      { name: "Grim Reaper", teams: [], codes: [], grimReaper: true },
    ],
  },
  MACKLINS: {
    code: "MACKLINS",
    label: "Macklins",
    players: [
      { name: "Maggie", teams: ["Liverpool", "Barcelona", "Man United", "Shakhtar", "Slavia Praha"], codes: ["LIV", "BAR", "MUN", "SHA", "SLA"], lateB: [false, false, false, false, false] },
      { name: "Julian", teams: ["Atlético Madrid", "Aston Villa", "Porto", "Lille", "Viking"], codes: ["ATM", "AVL", "POR", "LOS", "VIK"], lateB: [false, false, false, false, false] },
      { name: "Molly", teams: ["Real Madrid", "Real Betis", "Bodø/Glimt", "AEK Athens", "Como"], codes: ["RMA", "BET", "BOD", "AEK", "COM"], lateB: [false, false, false, false, false] },
      { name: "Josh", teams: ["Arsenal", "PSV", "Club Brugge", "RB Leipzig", "Slovan Bratislava"], codes: ["ARS", "PSV", "BRU", "RBL", "SLO"], lateB: [false, false, false, false, false] },
      { name: "Candice", teams: ["Man City", "Sporting CP", "Fenerbahçe", "Napoli", "LASK"], codes: ["MCI", "SPO", "FEN", "NAP", "LAS"], lateB: [false, false, false, false, false] },
      { name: "Jasper", teams: ["Paris SG", "Dortmund", "Galatasaray", "Feyenoord", "Sabah"], codes: ["PSG", "BVB", "GAL", "FEY", "SAB"], lateB: [false, false, false, false, false] },
      { name: "Taco", teams: ["Bayern München", "Inter", "Roma", "Villarreal", "VfB Stuttgart"], codes: ["FCB", "INT", "ROM", "VIL", "VFB"], lateB: [false, false, false, false, false] },
      { name: "Grim Reaper", teams: [], codes: [], grimReaper: true },
    ],
  },
  CAVERSHAM: {
    code: "CAVERSHAM",
    label: "Caversham",
    families: [
      { name: "Hampson", members: ["Jon", "India", "Delilah"] },
      { name: "Campbell", members: ["Aaron", "Katie", "Lily", "Freya C"] },
      { name: "Macklin", members: ["Josh", "Candice", "Jasper"] },
      { name: "Baldwin-Renton", members: ["Yan", "Freya R", "Nora"] },
      { name: "Rukin", members: ["Jake", "Helen", "Frank", "Ivo"] },
    ],
    players: [
      { name: "Aaron", teams: ["Inter", "Bodø/Glimt"], codes: ["INT", "BOD"], lateB: [false, false] },
      { name: "Candice", teams: ["Atlético Madrid", "Fenerbahçe"], codes: ["ATM", "FEN"], lateB: [false, false] },
      { name: "Katie", teams: ["Liverpool", "VfB Stuttgart"], codes: ["LIV", "VFB"], lateB: [false, false] },
      { name: "Jon", teams: ["Real Betis", "AEK Athens"], codes: ["BET", "AEK"], lateB: [false, false] },
      { name: "India", teams: ["Roma", "Lille"], codes: ["ROM", "LOS"], lateB: [false, false] },
      { name: "Yan", teams: ["Barcelona", "Lens"], codes: ["BAR", "RCL"], lateB: [false, false] },
      { name: "Freya R", teams: ["Club Brugge", "Sabah"], codes: ["BRU", "SAB"], lateB: [false, false] },
      { name: "Jake", teams: ["Aston Villa", "RB Leipzig"], codes: ["AVL", "RBL"], lateB: [false, false] },
      { name: "Helen", teams: ["Bayern München", "Man United"], codes: ["FCB", "MUN"], lateB: [false, false] },
      { name: "Frank", teams: ["Dortmund", "Slavia Praha"], codes: ["BVB", "SLA"], lateB: [false, false] },
      { name: "Ivo", teams: ["Porto", "Viking"], codes: ["POR", "VIK"], lateB: [false, false] },
      { name: "Jasper", teams: ["Man City", "Shakhtar"], codes: ["MCI", "SHA"], lateB: [false, false] },
      { name: "Delilah", teams: ["PSV", "LASK"], codes: ["PSV", "LAS"], lateB: [false, false] },
      { name: "Nora", teams: ["Arsenal", "Napoli"], codes: ["ARS", "NAP"], lateB: [false, false] },
      { name: "Freya C", teams: ["Sporting CP", "Feyenoord"], codes: ["SPO", "FEY"], lateB: [false, false] },
      { name: "Lily", teams: ["Real Madrid", "Villarreal"], codes: ["RMA", "VIL"], lateB: [false, false] },
      { name: "Josh", teams: ["Paris SG", "Galatasaray"], codes: ["PSG", "GAL"], lateB: [false, false] },
      { name: "Grim Reaper", teams: [], codes: [], grimReaper: true },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER → TEAM ASSIGNMENTS — the active group's roster (see GROUPS above)
// ─────────────────────────────────────────────────────────────────────────────
var PLAYERS = GROUPS.SILVERSTREAM.players;

// Grim Reaper — earns the absolute value of negative points when Pot1/2 teams go out in groups
var reaperBountyForCode = (code) => {
  const stage = "GROUP_ELIM";
  const penalty = (PTS_INC.GROUP_ELIM || [0,0,0,0])[potOf(code)-1];
  return penalty < 0 ? Math.abs(penalty) : 0; // only feasts on misfortune
};

// ─────────────────────────────────────────────────────────────────────────────
// POT SEEDINGS  (1 = favourite, 4 = underdog)
// ─────────────────────────────────────────────────────────────────────────────
var POT = {};
Object.keys(CL_CLUBS).forEach(function (c) { POT[c] = CL_CLUBS[c].pot; });

// Per-group pot overrides — set from GROUPS[activeKey].potOverrides by GroupGate
// in index.html before the app renders. Default empty = use global POT table.
var POT_OVERRIDES = {};

// Active group's families roster (only Caversham-style groups have one) —
// set from GROUPS[activeKey].families by GroupGate, same pattern as
// POT_OVERRIDES/KNOCKOUT_ONLY above. null for groups with no family feature.
var FAMILIES = null;

// Pot lookup: check active group's overrides first, fall back to global POT.
function potOf(code) {
  return (code && POT_OVERRIDES[code]) || POT[code] || 4;
}

// Group assignments (A–L) — shared World Cup data. Used for mathematical
// group-stage elimination timing in computeBadges.
var GROUP_ASSIGNMENTS = { LP: Object.keys(CL_CLUBS) }; // one 36-club league phase

// ─────────────────────────────────────────────────────────────────────────────
// POINTS MATRIX  — INCREMENTAL points earned at each stage [Pot1, Pot2, Pot3, Pot4]
// A team earns ALL stages they reach cumulatively
// e.g. a Pot4 team reaching the SF earns: 0(group) + 50(L32) + 150(L16) + 300(QF) + 500(SF) = 1000
// ─────────────────────────────────────────────────────────────────────────────
var PTS_INC = {
  LAST_32:       [0,   15,  25,   50],
  LAST_16:       [5,   25,  50,   150],
  QUARTER_FINALS:[15,  50,  100,  300],
  SEMI_FINALS:   [25,  100, 200,  500],
  FINALIST:      [50,  250, 500,  1000],
  WINNER:        [100, 500, 1000, 2000],
  GROUP_ELIM:    [-50, -15, 0,    0],
};

// Group stage win/draw points by pot [P1, P2, P3, P4]
// League phase is 8 games (WC groups: 3), so per-game values are roughly halved
// to keep the league phase about as weighty as the WC group stage.
var GROUP_WIN_PTS  = [1,  2,  4,  6];
var GROUP_DRAW_PTS = [0,  1,  2,  3];

function groupGamePts(code, result) {
  if (KNOCKOUT_ONLY) return 0;
  const pot = potOf(code) - 1;
  if (result === "W") return GROUP_WIN_PTS[pot];
  if (result === "D") return GROUP_DRAW_PTS[pot];
  return 0;
}

// Compute group stage W/D/L points for all teams from finished group matches
function deriveGroupPts(matches) {
  const groupPts = {};
  matches.filter(m => (m.status === "FINISHED" || m.status === "IN_PLAY" || m.status === "PAUSED") && (m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    if (!h || !a) return;
    let hResult, aResult;
    if (hs > as_)       { hResult = "W"; aResult = "L"; }
    else if (as_ > hs)  { hResult = "L"; aResult = "W"; }
    else                 { hResult = "D"; aResult = "D"; }
    groupPts[h] = (groupPts[h] || 0) + groupGamePts(h, hResult);
    groupPts[a] = (groupPts[a] || 0) + groupGamePts(a, aResult);
  });
  return groupPts;
}
var STAGE_ORDER = ["GROUP_ELIM","LAST_32","LAST_16","QUARTER_FINALS","SEMI_FINALS","FINALIST","WINNER"];

// Treat IN_PLAY and PAUSED same as FINISHED so live matches score in real time
var isSettled = s => s === "FINISHED" || s === "IN_PLAY" || s === "PAUSED";

// Points for a team at a given stage — the value for the HIGHEST stage
// reached only (flat, not cumulative). E.g. a Pot 1 Winner scores 100,
// not the sum of every stage on the way there.
var ptsTotal = (code, stageKey) => {
  if (stageKey === "GROUP_ELIM") return (PTS_INC.GROUP_ELIM || [0,0,0,0])[potOf(code)-1];
  const pot = potOf(code) - 1;
  return (PTS_INC[stageKey]||[0,0,0,0])[pot];
};

// Points matrix for display — incremental points earned AT each stage
var PTS = PTS_INC;

var STAGE_LABEL = {
  WINNER:         "Winner 🏆",
  FINALIST:       "Finalist",
  SEMI_FINALS:    "Semi-Final",
  QUARTER_FINALS: "Quarter-Final",
  LAST_16:        "Last 16",
  LAST_32:        "Play-offs",
  GROUP_ELIM:     "League Phase",
};

var STAGE_COLOR = {
  WINNER:         "#f59e0b",
  FINALIST:       "#a78bfa",
  SEMI_FINALS:    "#60a5fa",
  QUARTER_FINALS: "#34d399",
  LAST_16:        "#fb923c",
  LAST_32:        "#94a3b8",
  GROUP_ELIM:     "#ef4444",
};

// ISO codes for flagcdn.com
var FLAG_ISO = {}; // CL: crests, not flags

var flag = (code) => CL_CLUBS[code] ? `https://crests.football-data.org/${CL_CLUBS[code].id}.png` : null;
var pts  = (code, stage) => ptsTotal(code, stage);

// Grim Reaper goal drought curse — earns on low-scoring group games
function goalDroughtPts(m) {
  const hs = m.score?.fullTime?.home ?? 0;
  const as_ = m.score?.fullTime?.away ?? 0;
  const total = hs + as_;
  if (total === 0) return 3; // 0-0 only
  return 0;
}
// ─────────────────────────────────────────────────────────────────────────────
// LEAGUE PHASE — 36 clubs, 8 games each. Top 8 → Last 16, 9–24 → play-off
// (LAST_32), 25–36 out (GROUP_ELIM). lpResolve says what is CERTAIN from the
// results so far: pessimistic on ties (a club that could still be caught or
// levelled isn't clinched; one that could still escape isn't out). Once every
// club has played 8, it's the final table on pts → GD → GF (exact ties across a
// cut-off stay unresolved until the play-off fixtures publish).
// ─────────────────────────────────────────────────────────────────────────────
var LP_GAMES = 8, LP_QUAL = 24, LP_DIRECT = 8;
function lpResolve(pts, games, gf, ga) {
  const codes = GROUP_ASSIGNMENTS.LP;
  const r32 = new Set(), r16 = new Set(), out = new Set();
  const P = c => pts[c] || 0, G = c => games[c] || 0;
  if (!codes.some(c => G(c) > 0)) return { r32, r16, out, complete: false };
  const MAX = c => P(c) + 3 * Math.max(0, LP_GAMES - G(c));
  const complete = codes.every(c => G(c) >= LP_GAMES);
  const cmp = (x, y) => (P(y) - P(x)) || (((gf[y]||0) - (ga[y]||0)) - ((gf[x]||0) - (ga[x]||0))) || ((gf[y]||0) - (gf[x]||0));
  codes.forEach(t => {
    let aboveOrLevel = 0, strictlyAbove = 0;
    codes.forEach(x => {
      if (x === t) return;
      if (complete) { const c = cmp(x, t); if (c <= 0) aboveOrLevel++; if (c < 0) strictlyAbove++; }
      else { if (MAX(x) >= P(t)) aboveOrLevel++; if (P(x) > MAX(t)) strictlyAbove++; }
    });
    if (aboveOrLevel < LP_QUAL) r32.add(t);
    if (aboveOrLevel < LP_DIRECT) r16.add(t);
    if (strictlyAbove >= LP_QUAL) out.add(t);
  });
  return { r32, r16, out, complete };
}
// League-phase table state from FINISHED league games only.
function lpStateFromMatches(matches) {
  const pts = {}, games = {}, gf = {}, ga = {};
  matches.forEach(m => {
    if (m.status !== "FINISHED" || !(m.stage || "").toUpperCase().includes("GROUP")) return;
    const h = m.homeTeam?.tla?.toUpperCase(), a = m.awayTeam?.tla?.toUpperCase();
    if (!h || !a) return;
    const hs = m.score?.fullTime?.home ?? 0, as_ = m.score?.fullTime?.away ?? 0;
    games[h] = (games[h]||0) + 1; games[a] = (games[a]||0) + 1;
    gf[h] = (gf[h]||0) + hs; ga[h] = (ga[h]||0) + as_; gf[a] = (gf[a]||0) + as_; ga[a] = (ga[a]||0) + hs;
    if (hs > as_) pts[h] = (pts[h]||0) + 3; else if (as_ > hs) pts[a] = (pts[a]||0) + 3;
    else { pts[h] = (pts[h]||0) + 1; pts[a] = (pts[a]||0) + 1; }
  });
  return { pts, games, gf, ga };
}
// Clubs certain of a top-24 finish (→ at least the play-off).
function clinchedR32(matches) {
  const st = lpStateFromMatches(matches);
  return lpResolve(st.pts, st.games, st.gf, st.ga).r32;
}
// Clubs certain of a top-8 finish (→ straight into the Last 16).
function clinchedTop8(matches) {
  const st = lpStateFromMatches(matches);
  return lpResolve(st.pts, st.games, st.gf, st.ga).r16;
}
// No best-third places in the CL — kept so shared callers still work.
function qualifiedThirdPlacers(matches) { return []; }
// CL meaning: certain to finish 25th–36th (needs games played).
function isDefinitelyFourth(code, ptsMap, gfMap, gaMap, gamesMap) {
  return lpResolve(ptsMap, gamesMap || {}, gfMap, gaMap).out.has(code);
}

function deriveStages(matches) {
  const eliminated = {};
  const winners    = {};
  const stageReached = {}; // code → highest stage key reached

  const done = matches.filter(m => isSettled(m.status));

  const markStage = (code, stageKey) => {
    if (!code) return;
    const cur = stageReached[code];
    if (!cur || STAGE_ORDER.indexOf(stageKey) > STAGE_ORDER.indexOf(cur)) {
      stageReached[code] = stageKey;
    }
  };

  done.forEach(m => {
    const stage = (m.stage || "").toUpperCase();
    const fin   = m.status === "FINISHED";
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    const pen = m.score?.penalties;

    let loser = null, winner = null;
    if (hs > as_)      { loser = a; winner = h; }
    else if (as_ > hs) { loser = h; winner = a; }
    else if (pen) {
      if (pen.home > pen.away) { loser = a; winner = h; }
      else { loser = h; winner = a; }
    }

    if (stage === "FINAL") {
      // Crowning the actual champion stays FINISHED-only — everything else
      // below is a real-time projection (see deriveMatchPts, which already
      // does this for the Scores tab's live "+Npts"), but declaring a
      // provisional World Cup winner mid-match is a step further than
      // provisionally advancing a round, so it waits for the final whistle.
      if (winner && fin) { winners[winner] = true; markStage(winner, "WINNER"); }
      if (loser)  { markStage(loser, "FINALIST"); eliminated[loser] = "FINALIST"; }
    } else if (stage.includes("SEMI")) {
      // Both teams confirmed at semi-finals regardless; winner/loser (who's
      // CURRENTLY ahead, live or finished) provisionally advance/are
      // eliminated in real time — consistent with deriveMatchPts and with
      // how group-stage matches already score live via deriveGroupPts/WDL.
      // Recomputed fresh from `matches` every call, so this self-corrects
      // the moment the live score (or final result) changes.
      if (h) markStage(h, "SEMI_FINALS");
      if (a) markStage(a, "SEMI_FINALS");
      if (winner) markStage(winner, "FINALIST");
      if (loser)  eliminated[loser] = "SEMI_FINALS";
    } else if (stage.includes("QUARTER")) {
      if (h) markStage(h, "QUARTER_FINALS");
      if (a) markStage(a, "QUARTER_FINALS");
      if (winner) markStage(winner, "SEMI_FINALS");
      if (loser)  eliminated[loser] = "QUARTER_FINALS";
    } else if (stage.includes("LAST_16") || stage.includes("16")) {
      if (h) markStage(h, "LAST_16");
      if (a) markStage(a, "LAST_16");
      if (winner) markStage(winner, "QUARTER_FINALS");
      if (loser)  eliminated[loser] = "LAST_16";
    } else if (stage.includes("LAST_32") || stage.includes("32")) {
      if (h) markStage(h, "LAST_32");
      if (a) markStage(a, "LAST_32");
      if (winner) markStage(winner, "LAST_16");
      if (loser)  eliminated[loser] = "LAST_32";
    }
  });

  // Definite Last 32 qualifiers: teams that have mathematically clinched a top-2
  // group finish are in the Last 32 regardless of the real fixtures existing yet.
  // markStage only upgrades, so this never downgrades a team already further on.
  clinchedR32(matches).forEach(code => {
    if (!eliminated[code]) markStage(code, "LAST_32");
  });

  // Credit teams appearing in any published-but-unplayed knockout fixture.
  // When the Round of 32 draw is announced, qualified teams get SCHEDULED fixtures
  // before playing them — those teams have definitely qualified even if clinchedR32
  // hasn't detected it (e.g. due to team-code mismatches in GROUP_ASSIGNMENTS).
  matches.filter(m => !isSettled(m.status) && !(m.stage || "").toUpperCase().includes("GROUP")).forEach(m => {
    const s = (m.stage || "").toUpperCase();
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    let sk = null;
    if (s === "FINAL")                                          sk = "FINALIST";
    else if (s.includes("SEMI"))                               sk = "SEMI_FINALS";
    else if (s.includes("QUARTER"))                            sk = "QUARTER_FINALS";
    else if (s.includes("LAST_16") || s.includes("16"))        sk = "LAST_16";
    else if (s.includes("LAST_32") || s.includes("32"))        sk = "LAST_32";
    if (sk) {
      if (h && !eliminated[h]) markStage(h, sk);
      if (a && !eliminated[a]) markStage(a, sk);
    }
  });

  // Best-3rd-place qualifiers: top 8 of the 12 third-placed teams also reach
  // the Last 32. These teams won't have published knockout fixtures until the
  // draw is made, so clinchedR32 and the scheduled-fixture loop above can't
  // detect them. qualifiedThirdPlacers() ranks them "as it stands" (same
  // criteria as the Groups tab 3rd-place table) and marks the top 8.
  qualifiedThirdPlacers(matches).forEach(code => {
    if (!eliminated[code]) markStage(code, "LAST_32");
  });

  // League phase: certain top-8 → Last 16; certain 25th–36th → out.
  const knockoutTeams = new Set(Object.keys(stageReached));
  const _st = lpStateFromMatches(matches);
  const _lp = lpResolve(_st.pts, _st.games, _st.gf, _st.ga);
  _lp.r16.forEach(code => { if (!eliminated[code]) markStage(code, "LAST_16"); });
  _lp.out.forEach(code => {
    if (knockoutTeams.has(code) || eliminated[code]) return;
    eliminated[code] = "GROUP_ELIM";
    stageReached[code] = "GROUP_ELIM";
  });

  // Self-heal missing knockout eliminations from partial feed data. If a LATER
  // knockout round has actually been played (a FINISHED match exists at a stage
  // beyond a team's furthest-reached round), that team's round is definitively
  // over — so any team still shown at the earlier round that didn't advance is
  // out, even when the feed never delivered its own losing fixture. Real case:
  // the QF/SF results arrive but a team's Last-16 loss is missing, leaving a
  // knocked-out team wrongly "still in" (and wrongly counted alive by the win
  // simulation). Confirmed-only: keyed off FINISHED matches.
  const koStageOf = (m) => {
    const s = (m.stage || "").toUpperCase();
    if (s === "FINAL")                                     return "FINALIST";
    if (s.includes("SEMI"))                                return "SEMI_FINALS";
    if (s.includes("QUARTER"))                             return "QUARTER_FINALS";
    if (s.includes("LAST_16") || s.includes("16"))         return "LAST_16";
    if (s.includes("LAST_32") || s.includes("32"))         return "LAST_32";
    return null;
  };
  let maxFinishedIdx = 0;
  matches.filter(m => m.status === "FINISHED").forEach(m => {
    const sk = koStageOf(m);
    if (sk) maxFinishedIdx = Math.max(maxFinishedIdx, STAGE_ORDER.indexOf(sk));
  });
  Object.entries(stageReached).forEach(([code, stage]) => {
    if (eliminated[code] || winners[code]) return;
    const idx = STAGE_ORDER.indexOf(stage);
    if (idx > 0 && idx < maxFinishedIdx) eliminated[code] = stage; // out at the round reached
  });

  return { eliminated, winners, stageReached };
}

// ─────────────────────────────────────────────────────────────────────────────
// W/D/L TALLY  — count match results for every team across all finished games
// ─────────────────────────────────────────────────────────────────────────────
function deriveWDL(matches) {
  const record = {}; // code → { w, d, l }
  const ensure = c => { if (c && !record[c]) record[c] = { w:0, d:0, l:0 }; };

  matches.filter(m => isSettled(m.status)).forEach(m => {
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    ensure(h); ensure(a);
    if (!h || !a) return;
    if (hs > as_)      { record[h].w++; record[a].l++; }
    else if (as_ > hs) { record[a].w++; record[h].l++; }
    else               { record[h].d++; record[a].d++; }
  });
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE PLAYERS
// ─────────────────────────────────────────────────────────────────────────────
function scorePlayers(matches) {
  const { eliminated, winners, stageReached } = deriveStages(matches);
  const wdlByTeam = deriveWDL(matches);
  const history = deriveSparklineHistory(matches);
  const grpPts = deriveGroupPts(matches);

  return PLAYERS.map(p => {
    let total = 0;
    let w = 0, d = 0, l = 0;
    let teams = [];

    if (p.grimReaper) {
      Object.entries(eliminated).forEach(([code, stage]) => {
        if (stage === "GROUP_ELIM") total += reaperBountyForCode(code);
      });
      // Goal drought curse
      matches.filter(m => isSettled(m.status) && (m.stage||"").toUpperCase().includes("GROUP"))
        .forEach(m => { total += goalDroughtPts(m); });
    } else {
      teams = p.codes.map((code, i) => {
        const stage = stageReached[code] || null;
        const p_pts = stage ? pts(code, stage) : 0;
        const gp = grpPts[code] || 0;
        total += p_pts + gp;
        const teamRecord = wdlByTeam[code] || { w:0, d:0, l:0 };
        w += teamRecord.w; d += teamRecord.d; l += teamRecord.l;
        return { name: p.teams[i], code, pot: potOf(code), stage, pts: p_pts + gp,
                 w: teamRecord.w, d: teamRecord.d, l: teamRecord.l,
                 eliminated: !!eliminated[code], won: !!winners[code],
                 lateB: !!(p.lateB?.[i]) };
      });
    }

    const hist = history[p.name] || [0];
    const lastVal = hist[hist.length - 1];
    // Calculate points earned in last game involving this player's teams
    const playerCodes = p.grimReaper ? null : p.codes;
    const lastGamePts = (() => {
      if (p.grimReaper) {
        // Reaper: points from most recent finished match (drought + any elimination that match triggered)
        const sorted = [...matches].filter(m => isSettled(m.status))
          .sort((a,b) => new Date(b.utcDate) - new Date(a.utcDate));
        const last = sorted[0];
        if (!last) return 0;
        let reaperPts = goalDroughtPts(last);
        // Check if any team was eliminated as a result of this match
        const h = last.homeTeam?.tla?.toUpperCase();
        const a = last.awayTeam?.tla?.toUpperCase();
        [h, a].forEach(code => {
          if (!code) return;
          const gamesPlayed = matches.filter(m => isSettled(m.status) &&
            (m.homeTeam?.tla?.toUpperCase() === code || m.awayTeam?.tla?.toUpperCase() === code)).length;
          // Was this their 3rd group game? Check if they got eliminated
          if (gamesPlayed === LP_GAMES) {
            const { eliminated: elim } = deriveStages(matches);
            if (elim[code] === "GROUP_ELIM") {
              reaperPts += reaperBountyForCode(code);
            }
          }
        });
        return reaperPts;
      }
      // Find last finished match involving any of this player's teams
      const last = [...matches].filter(m => isSettled(m.status) && playerCodes.some(c =>
        m.homeTeam?.tla?.toUpperCase() === c || m.awayTeam?.tla?.toUpperCase() === c
      )).sort((a,b) => new Date(b.utcDate) - new Date(a.utcDate))[0];
      if (!last) return 0;
      const h = last.homeTeam?.tla?.toUpperCase();
      const a = last.awayTeam?.tla?.toUpperCase();
      const hs = last.score?.fullTime?.home ?? 0;
      const as_ = last.score?.fullTime?.away ?? 0;
      const hRes = hs > as_ ? "W" : hs < as_ ? "L" : "D";
      const aRes = hs > as_ ? "L" : hs < as_ ? "W" : "D";
      let pts = 0;
      playerCodes.forEach(c => {
        if (c === h) pts += groupGamePts(c, hRes);
        if (c === a) pts += groupGamePts(c, aRes);
      });
      return pts;
    })();
    const prevVal = lastVal - lastGamePts;
    const lastChange = lastGamePts;
    const pctChange = prevVal !== 0 ? ((lastChange / Math.abs(prevVal)) * 100) : null;
    const tiebreak = w * 3 + d - l;
    return { ...p, total, teams, w, d, l, tiebreak, hist, lastChange, pctChange,
             ...(p.grimReaper ? { _eliminated: eliminated, _matches: matches } : {}) };
  }).sort((a, b) => b.total - a.total || (a.grimReaper ? 1 : 0) - (b.grimReaper ? 1 : 0) || b.tiebreak - a.tiebreak);
}

// Ranked standings for EVERY group at once, keyed by GROUPS key — used by the
// admin cross-group search so it can list/rank players outside the group the
// admin currently has active. Temporarily swaps the active-group globals
// (PLAYERS/POT_OVERRIDES/KNOCKOUT_ONLY) per group and restores them
// synchronously before returning, so the caller's own active group is
// unaffected.
function scoreAllGroups(matches) {
  const savedPlayers = PLAYERS, savedOverrides = POT_OVERRIDES, savedKnockoutOnly = KNOCKOUT_ONLY;
  const out = {};
  try {
    Object.keys(GROUPS).forEach(key => {
      PLAYERS = GROUPS[key].players;
      POT_OVERRIDES = GROUPS[key].potOverrides || {};
      KNOCKOUT_ONLY = !!GROUPS[key].knockoutOnly;
      out[key] = scorePlayers(matches);
    });
  } finally {
    PLAYERS = savedPlayers;
    POT_OVERRIDES = savedOverrides;
    KNOCKOUT_ONLY = savedKnockoutOnly;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// compute24hRankChange(matches) — table POSITION movement over a true rolling
// 24-hour window, replacing the old "% change in points" indicator.
//
// WHY: percentage change in points is a poor signal — someone going from
// 2pts to 4pts "doubles" while someone going 80->82 barely registers, even
// though the latter might matter more competitively. Position change (e.g.
// "up 2 places") is intuitive and comparable across all players regardless
// of their current score.
//
// WHY A FIXED ROLLING WINDOW (not "since last change"): a consistent 24h
// timeframe is honest and predictable, even though it means "no change" is
// shown during multi-day gaps between stages (e.g. between group stage and
// Last 32) — that's correct information, not a missing feature. A "since
// last meaningful update" approach would always show *something*, but that
// something could span a very different, unstated amount of real time from
// one player to the next, which is more misleading than an honest "no
// change in the last 24h."
//
// HOW: build a SECOND scored ranking using only matches that kicked off
// more than 24h ago (i.e. "the table as it stood 24h ago"), then diff each
// player's position in that ranking against their position in the CURRENT
// full ranking (passed in as `currentRanked`, so this never re-sorts
// differently from what's actually displayed elsewhere).
//
// Returns a Map from player name -> rankDelta (positive = moved up the
// table, negative = moved down, 0 = no change in position).
// ─────────────────────────────────────────────────────────────────────────────
function compute24hRankChange(matches, currentRanked) {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  // Build both snapshots from the same live-aware matches (isSettled), but
  // exclude matches that kicked off within the last 24h for the baseline.
  // This means the delta reflects real position movement over 24h, with
  // live matches correctly included in the current ranking.
  const matches24hAgo = matches.filter(m => new Date(m.utcDate).getTime() <= cutoffMs);
  const rankedNow = scorePlayers(matches);
  const ranked24hAgo = scorePlayers(matches24hAgo);

  const rankNowByName = {};
  rankedNow.forEach((p, i) => { rankNowByName[p.name] = i; });

  const rank24hAgoByName = {};
  ranked24hAgo.forEach((p, i) => { rank24hAgoByName[p.name] = i; });

  const result = new Map();
  currentRanked.forEach((p) => {
    const nowRank = rankNowByName[p.name];
    const prevRank = rank24hAgoByName[p.name];
    result.set(p.name, (prevRank !== undefined && nowRank !== undefined) ? prevRank - nowRank : 0);
  });
  return result;
}

// compute24hPtsChange(matches, currentRanked) — points gained over the same
// rolling 24h window as compute24hRankChange (a player's total now minus
// their total 24h ago). Kept as a separate function rather than folded into
// compute24hRankChange's return value, since that Map's shape (plain number
// = rank delta) is already relied on by every existing caller (PlayerRow's
// pos-change pill, the Climber/Sliding badges) — changing it to an object
// would mean touching all of those for one new homepage feature.
function compute24hPtsChange(matches, currentRanked) {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const matches24hAgo = matches.filter(m => new Date(m.utcDate).getTime() <= cutoffMs);
  const totalNowByName = {};
  scorePlayers(matches).forEach(p => { totalNowByName[p.name] = p.total; });
  const total24hAgoByName = {};
  scorePlayers(matches24hAgo).forEach(p => { total24hAgoByName[p.name] = p.total; });

  const result = new Map();
  currentRanked.forEach((p) => {
    const now = totalNowByName[p.name];
    const prev = total24hAgoByName[p.name];
    result.set(p.name, (prev !== undefined && now !== undefined) ? now - prev : 0);
  });
  return result;
}

// compute24hFamilyRankChange(matches, families) — family-league equivalent of
// compute24hRankChange: ranks families by average member points (same
// formula FamilyLeagueTab uses) both now and 24h ago, then returns each
// family's rank-position delta (positive = moved up), same sign convention
// and Map<name, number> shape as the player version above.
function compute24hFamilyRankChange(matches, families) {
  if (!families) return new Map();
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const matches24hAgo = matches.filter(m => new Date(m.utcDate).getTime() <= cutoffMs);
  const totalNowByName = {};
  scorePlayers(matches).forEach(p => { totalNowByName[p.name] = p.total; });
  const total24hAgoByName = {};
  scorePlayers(matches24hAgo).forEach(p => { total24hAgoByName[p.name] = p.total; });

  const familyAvg = (totalsByName) => families.map(f => {
    const totals = f.members.map(name => totalsByName[name] ?? 0);
    return { name: f.name, avg: totals.reduce((s, t) => s + t, 0) / totals.length };
  }).sort((a, b) => b.avg - a.avg);

  const rankNowByName = {};
  familyAvg(totalNowByName).forEach((f, i) => { rankNowByName[f.name] = i; });
  const rank24hAgoByName = {};
  familyAvg(total24hAgoByName).forEach((f, i) => { rank24hAgoByName[f.name] = i; });

  const result = new Map();
  families.forEach(f => {
    const nowRank = rankNowByName[f.name];
    const prevRank = rank24hAgoByName[f.name];
    result.set(f.name, (prevRank !== undefined && nowRank !== undefined) ? prevRank - nowRank : 0);
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTE CARLO WIN PROBABILITY SIMULATION
// ─────────────────────────────────────────────────────────────────────────────
function simulateWinProbability(ranked, matches, N = 5000) {
  const { eliminated, winners, stageReached } = deriveStages(matches);

  // Every club not yet out is alive (the whole league phase, not just owned
  // clubs) — the sim plays out qualification as well as the knockouts.
  const alive = Object.keys(POT).filter(code => !eliminated[code]);

  // Pot-based win probability weights for knockout matchups
  const potWeight = (code) => {
    const pot = potOf(code);
    return [4, 3, 2, 1][pot - 1]; // Pot1 strongest
  };

  // Current base points per player
  const basePoints = {};
  ranked.forEach(p => { basePoints[p.name] = p.total; });

  // Grim reaper current total — name isn't always "Josh" (Macklins/Caversham
  // use an unnamed "Grim Reaper" player).
  const reaperBase = ranked.find(p => p.grimReaper)?.total || 0;
  const reaperName = (ranked.find(p => p.grimReaper) || {}).name;

  // Player code lookup — a code can be owned by MORE THAN ONE player (A/B shared
  // teams), so map each code to an array of owners and credit all of them.
  const codeToPlayers = {};
  ranked.filter(p => !p.grimReaper).forEach(p => {
    p.codes.forEach(code => {
      if (!codeToPlayers[code]) codeToPlayers[code] = [];
      if (!codeToPlayers[code].includes(p.name)) codeToPlayers[code].push(p.name);
    });
  });

  const wins = {};
  ranked.forEach(p => { wins[p.name] = 0; });
  const teamWins = {};        // per-team World Cup championships across sims
  alive.forEach(c => { teamWins[c] = 0; });

  // Finishing-position distribution across sims, for "predicted finish (Nth of
  // M) + confidence". Ranked among REAL players only — the Grim Reaper can haunt
  // the table but can't place/win it, so it isn't part of the field.
  const realNames = ranked.filter(p => !p.grimReaper).map(p => p.name);
  const rankCounts = {}; // name -> { rank -> count }
  realNames.forEach(n => { rankCounts[n] = {}; });

  // Knockout ladder: -1 = still in the league phase, 0 = play-off (LAST_32),
  // 1 = Last 16 … 5 = winner. Each round only the clubs AT that rung play; the
  // rest wait (top-8 sit out the play-off).
  const LADDER = ["LAST_32","LAST_16","QUARTER_FINALS","SEMI_FINALS","FINALIST","WINNER"];
  const rungOf = (code) => LADDER.indexOf(stageReached[code]); // -1 if none/GROUP_ELIM

  for (let sim = 0; sim < N; sim++) {
    const simPts = { ...basePoints };
    const simBanked = {};
    alive.forEach(c => { simBanked[c] = teamPts_sim(c, stageReached); });
    const advance = (code, stage) => {
      const np = ptsTotal(code, stage);
      const inc = np - (simBanked[code] || 0);
      if (inc !== 0) {
        (codeToPlayers[code] || []).forEach(o => { simPts[o] = (simPts[o] || 0) + inc; });
        simBanked[code] = np;
      }
    };
    const rung = {};
    alive.forEach(c => { rung[c] = rungOf(c); });
    // League phase still open: pot-weighted rolls fill the remaining top-24 and
    // top-8 places; the rest go out (and take any GROUP_ELIM penalty).
    const pending = alive.filter(c => rung[c] < 0);
    if (pending.length) {
      const inR16 = alive.filter(c => rung[c] >= 1).length;
      const inKO  = alive.filter(c => rung[c] >= 0).length;
      const rolled = pending.map(c => ({ c, r: Math.random() * potWeight(c) })).sort((x, y) => y.r - x.r);
      const slots = Math.max(0, LP_QUAL - inKO), direct = Math.max(0, LP_DIRECT - inR16);
      rolled.forEach((x, i) => {
        if (i < direct)      { rung[x.c] = 1; advance(x.c, "LAST_16"); }
        else if (i < slots)  { rung[x.c] = 0; advance(x.c, "LAST_32"); }
        else                 { rung[x.c] = -2; advance(x.c, "GROUP_ELIM"); }
      });
    }
    let champion = null;
    for (let r = 0; r < LADDER.length - 1; r++) {
      const field = alive.filter(c => rung[c] === r).sort(() => Math.random() - 0.5);
      for (let i = 0; i < field.length; i += 2) {
        const a = field[i], b = field[i + 1];
        if (!b) { rung[a] = r + 1; advance(a, LADDER[r + 1]); continue; } // bye
        const wa = potWeight(a), wb = potWeight(b);
        const w = Math.random() < wa / (wa + wb) ? a : b;
        rung[w] = r + 1; advance(w, LADDER[r + 1]);
        rung[w === a ? b : a] = -3; // out
      }
    }
    champion = alive.find(c => rung[c] === LADDER.length - 1) || Object.keys(winners)[0] || null;
    if (champion) teamWins[champion] = (teamWins[champion] || 0) + 1;

  // Final standings among the real field (the reaper can't place/win), with
    // competition ranking so tied totals share a position. wins[] = finishing
    // first, so the percentages sum to 100% across the field.
    const board = realNames.map(name => ({ name, pts: simPts[name] ?? 0 }))
      .sort((a, b) => b.pts - a.pts);
    let rank = 0, prevPts = null;
    board.forEach((e, i) => {
      if (prevPts === null || e.pts < prevPts) { rank = i + 1; prevPts = e.pts; }
      rankCounts[e.name][rank] = (rankCounts[e.name][rank] || 0) + 1;
    });
    if (board[0]) wins[board[0].name] = (wins[board[0].name] || 0) + 1;
  }

  // Convert to percentages
  const result = {};
  ranked.forEach(p => {
    result[p.name] = Math.round((wins[p.name] || 0) / N * 100);
  });
  const teams = {};
  alive.forEach(code => { teams[code] = Math.round((teamWins[code] || 0) / N * 100); });
  Object.keys(winners).forEach(code => { teams[code] = 100; }); // already crowned

  // Predicted finish per real player: the modal (most-frequent) finishing
  // position across sims, plus the % of sims that landed on it (confidence).
  const field = realNames.length;
  const predicted = {};
  realNames.forEach(name => {
    const counts = rankCounts[name];
    let bestRank = field, bestCount = -1;
    Object.entries(counts).forEach(([r, c]) => { if (c > bestCount) { bestCount = c; bestRank = +r; } });
    predicted[name] = { rank: bestRank, confidence: Math.round((bestCount / N) * 100), field };
  });

  return { players: result, teams, predicted };
}

// Helper — get current stage points for a team (already awarded)
function teamPts_sim(code, stageReached) {
  const stage = stageReached[code];
  return stage ? ptsTotal(code, stage) : 0;
}
// Group stage sourced from Sports Mole / BBC / ITV confirmed schedule
// Knockout stage TBC — defaults to BBC for now, update as announced
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// BADGES
// ─────────────────────────────────────────────────────────────────────────────
// Accolades shown next to a player's name and listed in their pop-over.
// Each badge: { icon, label, desc, tone:"good"|"bad" }.
function computeBadges(ranked, matches, rank24hChange, winPctPlayers) {
  const done = matches.filter(m => isSettled(m.status));
  const started = done.length > 0;
  const badges = {};
  ranked.forEach(p => { badges[p.name] = []; });
  const real = ranked.filter(p => !p.grimReaper);
  const rc = (rank24hChange && rank24hChange.get) ? rank24hChange : new Map();
  const KO = ["LAST_32","LAST_16","QUARTER_FINALS","SEMI_FINALS","FINALIST","WINNER"];
  const add = (name, b) => { if (badges[name]) badges[name].push(b); };

  // 💀 Grim Reaper — the active group's grimReaper:true player's one and only accolade
  const reaper = ranked.find(p => p.grimReaper);
  if (reaper) add(reaper.name, { icon:"💀", label:"Grim Reaper", desc:"Feasts on league-phase upsets and 0-0s — can haunt the table, but can't win it", tone:"bad" });

  // 🤖 Definitely Not Human — MACK-BOT's one and only accolade (Macklins'
  // joke 8th player). Always-on flavour badge, same "always applies"
  // pattern as Grim Reaper above — not performance-based.
  const bot = ranked.find(p => p.isBot);
  if (bot) add(bot.name, { icon:"🤖", label:"Definitely Not Human", desc:"Drafted to fill the 8th seat. Runs on batteries, spreadsheets, and zero capacity for disappointment.", tone:"bad" });

  // 🏆 Top Dog — current leader (once anyone has scored)
  if (real.length && real[0].total > 0) add(real[0].name, { icon:"🏆", label:"Top Dog", desc:"Top of the table", tone:"good" });

  // 🥄 Wooden Spoon — current last place (mirror of Top Dog; excludes the reaper
  // and bot via `real`, same as Top Dog). Only once the tournament is underway
  // and there's more than one player to be last of.
  if (started && real.length > 1) add(real[real.length - 1].name, { icon:"🥄", label:"Wooden Spoon", desc:"Bottom of the table", tone:"bad" });

  // 🔮 The Prophecy — current favourite (highest sweepstake win %)
  if (winPctPlayers) {
    let fav = null;
    real.forEach(p => {
      const w = winPctPlayers[p.name] || 0;
      if (w > 0 && (!fav || w > fav.w)) fav = { name: p.name, w };
    });
    if (fav) add(fav.name, { icon:"🔮", label:"The Prophecy", desc:`Foretold to win the sweep (${fav.w}% chance)`, tone:"good" });
  }

  // 🚀 Climber / 📉 Sliding — biggest 24h table moves
  let up = null, down = null;
  real.forEach(p => {
    const d = rc.get(p.name) || 0;
    if (d > 0 && (!up || d > up.d)) up = { name:p.name, d };
    if (d < 0 && (!down || d < down.d)) down = { name:p.name, d };
  });
  if (up) add(up.name, { icon:"🚀", label:"Climber", desc:`Up ${up.d} place${up.d>1?"s":""} in the last 24h`, tone:"good" });
  if (down) add(down.name, { icon:"📉", label:"Sliding", desc:`Down ${Math.abs(down.d)} place${Math.abs(down.d)>1?"s":""} in the last 24h`, tone:"bad" });

  // ⚡ On Fire — biggest points gain last round
  const onFire = real.filter(p => p.lastChange > 0).sort((a,b) => b.lastChange - a.lastChange)[0];
  if (onFire) add(onFire.name, { icon:"⚡", label:"On Fire", desc:`+${onFire.lastChange}pts last round`, tone:"good" });

  // 🔪 Giant Killer — the single biggest giant-killing in the groups: the win
  // with the largest pot gap (winner's pot number minus loser's), ties broken by
  // earliest kickoff. Only counts wins by an OWNED team; if the biggest upset is
  // an unowned side, the next-biggest owned one takes it.
  let giantKiller = null;
  done.filter(m => (m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    if (!h || !a || hs === as_) return;
    const winner = hs > as_ ? h : a;
    const loser  = hs > as_ ? a : h;
    const gap = potOf(winner) - potOf(loser);
    if (gap <= 0) return; // winner must be the lower-seeded (higher pot number) side
    const t = new Date(m.utcDate).getTime();
    if (!giantKiller || gap > giantKiller.gap || (gap === giantKiller.gap && t < giantKiller.t)) {
      const o = real.find(p => p.codes?.includes(winner));
      if (o) giantKiller = { name: o.name, gap, t, code: winner, loser };
    }
  });
  if (giantKiller) add(giantKiller.name, { icon:"🔪", label:"Giant Killer", desc:`${giantKiller.code} beat a Pot ${potOf(giantKiller.loser)} side`, tone:"good" });

  // 🐶 Underdog — the FIRST Pot 4 team to reach the knockouts (single award).
  // "Made the knockouts" = appears in a knockout fixture; "first" = earliest
  // such fixture by kickoff, scanning for the first Pot 4 team to show up.
  const koByDate = matches
    .filter(m => !(m.stage || "").toUpperCase().includes("GROUP"))
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  let underdogCode = null;
  for (const m of koByDate) {
    for (const tla of [m.homeTeam?.tla?.toUpperCase(), m.awayTeam?.tla?.toUpperCase()]) {
      if (tla && potOf(tla) === 4) { underdogCode = tla; break; }
    }
    if (underdogCode) break;
  }
  if (underdogCode) {
    const o = real.find(p => p.codes?.includes(underdogCode));
    if (o) add(o.name, { icon:"🐶", label:"Underdog", desc:`First Pot 4 team to reach the knockouts (${underdogCode})`, tone:"good" });
  }

  // (Clean Sheet replaced by 🧱 Brick Wall — the single best-defence player, below.)

  // 🥚 Early Bird — first to get on the board
  const firstScorer = real.filter(p => p.total > 0).sort((a,b) => {
    const af = a.hist.findIndex((v,i) => i > 0 && v > a.hist[i-1]);
    const bf = b.hist.findIndex((v,i) => i > 0 && v > b.hist[i-1]);
    return af - bf;
  })[0];
  if (firstScorer) add(firstScorer.name, { icon:"🥚", label:"Early Bird", desc:"First to get on the board", tone:"good" });

  // 🤡 Big Flop is awarded further down as a single winner (it needs the
  // per-team elimination dates computed later for the "first" tiebreak).

  // 🦆 Still Quacking — the last player yet to score, but only once the field is
  // moving: fires only when exactly one player is still on 0 and someone else
  // has scored (otherwise it'd be shared by everyone early on).
  if (started) {
    const quacking = real.filter(p => p.total === 0);
    if (quacking.length === 1 && real.some(p => p.total > 0))
      add(quacking[0].name, { icon:"🦆", label:"Still Quacking", desc:"Last one yet to get on the board", tone:"bad" });
  }

  // 🎸 One Man Band — biggest gap between a player's TOP and SECOND-highest
  // scoring team (works for groups with >2 teams each: one team clearly ahead
  // of their next best, not just ahead of their worst).
  let oneMan = null;
  real.forEach(p => {
    const tp = (p.teams || []).map(t => t.pts).sort((a, b) => b - a);
    if (tp.length >= 2) {
      const gap = tp[0] - tp[1];
      if (gap > 0 && (!oneMan || gap > oneMan.g)) oneMan = { name: p.name, g: gap };
    }
  });
  if (oneMan) add(oneMan.name, { icon:"🎸", label:"One Man Band", desc:`One team carrying — ${oneMan.g}pts clear of their next best`, tone:"good" });

  // 💥 Firepower (most goals scored) / 🚰 Leaky (most goals conceded) by a player's teams
  const goalsFor = {}, goalsAgainst = {};
  done.forEach(m => {
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    if (h) { goalsFor[h] = (goalsFor[h] || 0) + hs;  goalsAgainst[h] = (goalsAgainst[h] || 0) + as_; }
    if (a) { goalsFor[a] = (goalsFor[a] || 0) + as_; goalsAgainst[a] = (goalsAgainst[a] || 0) + hs;  }
  });
  let firepower = null, leaky = null, fortress = null, coldest = null;
  real.forEach(p => {
    const codes = p.codes || [];
    const played = codes.some(c => goalsAgainst[c] !== undefined); // at least one team has played
    const gf = codes.reduce((s, c) => s + (goalsFor[c] || 0), 0);
    const ga = codes.reduce((s, c) => s + (goalsAgainst[c] || 0), 0);
    if (gf > 0 && (!firepower || gf > firepower.g)) firepower = { name: p.name, g: gf };
    if (ga > 0 && (!leaky || ga > leaky.g)) leaky = { name: p.name, g: ga };
    if (played && (!fortress || ga < fortress.g)) fortress = { name: p.name, g: ga }; // fewest conceded
    if (played && (!coldest || gf < coldest.g)) coldest = { name: p.name, g: gf };    // fewest scored
  });
  if (firepower) add(firepower.name, { icon:"💥", label:"Firepower", desc:`Teams have scored the most goals (${firepower.g})`, tone:"good" });
  if (leaky) add(leaky.name, { icon:"🚰", label:"Leaky", desc:`Teams have conceded the most goals (${leaky.g})`, tone:"bad" });
  if (fortress) add(fortress.name, { icon:"🧱", label:"Brick Wall", desc:`Teams have conceded the fewest goals (${fortress.g})`, tone:"good" });
  if (coldest) add(coldest.name, { icon:"💨", label:"Firing Blanks", desc:`Teams have scored the fewest goals (${coldest.g})`, tone:"bad" });

  // Elimination dates — replay finished matches chronologically to find WHEN each
  // team went OUT (used by the First Casualty / Wiped Out badges).
  //   Group, while still in progress: the match after which the team is
  //   mathematically locked into 4th of its group — i.e. ≥3 teams are
  //   guaranteed above it. A rival counts as guaranteed above if either (a)
  //   their CURRENT points already exceed the team's MAX possible
  //   (points-only, no game data needed), or (b) their current points
  //   exactly equal the team's MAX *and* the two have already played each
  //   other in the group with a decisive (non-draw) result — per FIFA's 2026
  //   tiebreak order, head-to-head outranks overall goal difference, and a
  //   played head-to-head result can't change, so this stays gapless (never
  //   false-flags) without needing to bound future goal difference.
  //   4th can't be top-2 or a best-third, so the team is genuinely out.
  //   Group, once complete (all 4 teams have played all 3 games): there's no
  //   more future to bound, so fall back to the same GD/GF-tiebreak-aware
  //   isDefinitelyFourth() the main scoring engine (deriveStages) uses. The
  //   points+h2h check above is a strict subset of this — some 4th places
  //   are only decided by goal difference (no head-to-head, or a drawn one),
  //   which it can never resolve, leaving the team with no elimDate at all
  //   and the Wiped Out badge permanently unable to fire for them even
  //   though they're genuinely, visibly eliminated everywhere else in the
  //   app. This closes that gap without touching the in-progress heuristic.
  //   Knockout: the match they lost.
  const elimDate = {};
  const groupOf = {};
  Object.entries(GROUP_ASSIGNMENTS).forEach(([g, codes]) => codes.forEach(c => { groupOf[c] = g; }));
  const gpts = {}, gplayed = {}, ggf = {}, gga = {}, gplayedFinished = {};
  Object.keys(groupOf).forEach(c => { gpts[c] = 0; gplayed[c] = 0; ggf[c] = 0; gga[c] = 0; gplayedFinished[c] = 0; });
  const pairKey = (x, y) => [x, y].sort().join("-");
  const h2hWinner = {}; // pairKey → winning code, or "DRAW"
  let lastGroupMatchDate = null;
  [...done].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)).forEach(m => {
    const stage = (m.stage || "").toUpperCase();
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    const pen = m.score?.penalties;
    if (stage.includes("GROUP")) {
      lastGroupMatchDate = m.utcDate;
      if (m.status === "FINISHED") {
        if (h) gplayedFinished[h] = (gplayedFinished[h] || 0) + 1;
        if (a) gplayedFinished[a] = (gplayedFinished[a] || 0) + 1;
      }
      if (h) { gplayed[h] = (gplayed[h] || 0) + 1; ggf[h] = (ggf[h] || 0) + hs; gga[h] = (gga[h] || 0) + as_; }
      if (a) { gplayed[a] = (gplayed[a] || 0) + 1; ggf[a] = (ggf[a] || 0) + as_; gga[a] = (gga[a] || 0) + hs; }
      if (hs > as_) gpts[h] = (gpts[h] || 0) + 3;
      else if (as_ > hs) gpts[a] = (gpts[a] || 0) + 3;
      else { gpts[h] = (gpts[h] || 0) + 1; gpts[a] = (gpts[a] || 0) + 1; }
      if (h && a && !h2hWinner[pairKey(h, a)]) {
        h2hWinner[pairKey(h, a)] = hs > as_ ? h : as_ > hs ? a : "DRAW";
      }
      lpResolve(gpts, gplayed, ggf, gga).out.forEach(t => { if (!elimDate[t]) elimDate[t] = m.utcDate; });
    } else {
      let loser = null;
      if (hs > as_) loser = a; else if (as_ > hs) loser = h; else if (pen) loser = pen.home > pen.away ? a : h;
      if (loser && !elimDate[loser]) elimDate[loser] = m.utcDate;
    }
  });
  // Once EVERY group has played all 3 games, the best-8-of-12 third-place
  // cutoff is knowable — a team that finishes 3rd in its own group but
  // doesn't make that cutoff is eliminated too, same as a straight 4th
  // place, but this can only be determined tournament-wide (a 3rd place
  // finish alone doesn't say whether it's good enough). Mirrors
  // deriveStages' own bottom-4-thirds handling; dated to the last
  // group-stage match played anywhere, since that's the moment this becomes
  // knowable. Without this, a "3rd but didn't qualify" team never gets an
  // elimDate at all — First Casualty/Wiped Out can misattribute to a later
  // player, or never fire for someone genuinely (and visibly, everywhere
  // else in the app) knocked out this way.
  // Must match qualifiedThirdPlacers' own FINISHED-only definition of
  // "complete" (it ignores IN_PLAY/PAUSED) — otherwise a group with its last
  // game still live would look "complete" here (isSettled includes live
  // matches) while qualifiedThirdPlacers correctly still calls it
  // incomplete, and a team could get prematurely marked eliminated before
  // the wildcard cutoff is actually final.
  // 🩸 First Casualty — first player to lose a team / ⚰️ Wiped Out — first to lose ALL teams
  let firstOne = null, firstAll = null;
  real.forEach(p => {
    const codes = p.codes || [];
    const dated = codes.map(c => ({ code: c, t: elimDate[c] ? new Date(elimDate[c]).getTime() : null })).filter(x => x.t !== null);
    if (dated.length >= 1) {
      const f = dated.reduce((m, x) => x.t < m.t ? x : m);
      if (!firstOne || f.t < firstOne.d) firstOne = { name: p.name, d: f.t, code: f.code };
    }
    // Wiped Out needs the player's ENTIRE roster gone (every team has an elim
    // date — a team still alive or one that won the tournament has none), so it
    // scales to groups with >2 teams each. Timestamp = when their LAST team went.
    if (codes.length >= 2 && codes.every(c => elimDate[c])) {
      const last = dated.reduce((m, x) => x.t > m.t ? x : m);
      if (!firstAll || last.t < firstAll.d) firstAll = { name: p.name, d: last.t, code: last.code };
    }
  });
  // Readable team name from the live match data (matches the displayed-name
  // convention used elsewhere, e.g. `teamName()` in index.html).
  const teamNameOf = (code) => {
    if (!code) return code;
    const m = matches.find(mm => mm.homeTeam?.tla?.toUpperCase() === code || mm.awayTeam?.tla?.toUpperCase() === code);
    if (!m) return code;
    return (m.homeTeam?.tla?.toUpperCase() === code ? m.homeTeam?.name : m.awayTeam?.name) || code;
  };
  if (firstOne) add(firstOne.name, { icon:"🩸", label:"First Casualty", desc:`First to have a team eliminated (${teamNameOf(firstOne.code)})`, tone:"bad" });
  if (firstAll) add(firstAll.name, { icon:"⚰️", label:"Wiped Out", desc:`First to have all their teams eliminated (last: ${teamNameOf(firstAll.code)})`, tone:"bad" });

  // 🤡 Big Flop — the FIRST Pot 1 favourite eliminated at ANY stage, group or
  // knockout (single winner; earliest elimination by date).
  let bigFlop = null;
  real.forEach(p => {
    (p.teams || []).forEach(t => {
      if (t.pot === 1 && t.eliminated) {
        const d = elimDate[t.code] ? new Date(elimDate[t.code]).getTime() : Infinity;
        if (!bigFlop || d < bigFlop.d) bigFlop = { name: p.name, d, code: t.code };
      }
    });
  });
  if (bigFlop) add(bigFlop.name, { icon:"🤡", label:"Big Flop", desc:`First Pot 1 favourite eliminated (${teamNameOf(bigFlop.code)})`, tone:"bad" });

  // 👠 Cinderella — owns the LAST Pot 4 team still alive in the whole
  // competition. Unlike Big Flop/Underdog above, this is a live, current
  // state (like Top Dog/Wooden Spoon), not a "first to..." achievement — it
  // only exists while exactly one Pot 4 team remains un-eliminated, moves to
  // whoever else is left if that changes, and disappears entirely once the
  // very last Pot 4 team is itself knocked out (no fairy tale ending to award).
  const pot4Teams = [];
  real.forEach(p => (p.teams || []).forEach(t => { if (t.pot === 4) pot4Teams.push({ code: t.code, eliminated: t.eliminated, owner: p.name }); }));
  const alivePot4 = pot4Teams.filter(t => !t.eliminated);
  if (alivePot4.length === 1) {
    add(alivePot4[0].owner, { icon:"👠", label:"Cinderella", desc:`Owns the last Pot 4 team standing (${teamNameOf(alivePot4[0].code)})`, tone:"good" });
  }

  // 🍞 Bread Winner / 🐑 Black Sheep — family-groups only (FAMILIES is null for
  // groups without the family feature). Each family's top/bottom contributor
  // (by SHARE of their family's combined points) is a candidate, but the
  // badges themselves are single-winner across the WHOLE group, same as
  // every other performance badge — the single highest share of all
  // families' top candidates gets Bread Winner, the single lowest share of
  // all families' bottom candidates gets Black Sheep. A family is skipped if
  // its total is exactly 0 (a share of zero points is undefined, not
  // "equal"), or if fewer than 2 REAL members remain to compare.
  //
  // The Grim Reaper's own points DO count toward the family total when he's
  // listed as a family member (e.g. Caversham's Macklin family includes
  // "Josh", who's also that group's Reaper) — leaving his points out shrinks
  // the total and inflates everyone else's share (a 2-real-member family
  // reading as e.g. 90/10 when it should be closer to even once his points
  // are counted). He just isn't himself eligible to WIN either badge, same
  // as every other performance badge in this function.
  if (FAMILIES) {
    let breadWinner = null, blackSheep = null;
    FAMILIES.forEach(f => {
      const members = f.members.map(name => ranked.find(p => p.name === name)).filter(Boolean);
      const familyTotal = members.reduce((s, p) => s + p.total, 0);
      if (familyTotal === 0) return;
      const candidates = members.filter(p => !p.grimReaper).map(p => ({ name: p.name, family: f.name, share: p.total / familyTotal }));
      if (candidates.length < 2) return;
      const top = candidates.reduce((m, x) => x.share > m.share ? x : m);
      const bottom = candidates.reduce((m, x) => x.share < m.share ? x : m);
      if (top.name === bottom.name) return;
      if (!breadWinner || top.share > breadWinner.share) breadWinner = top;
      if (!blackSheep || bottom.share < blackSheep.share) blackSheep = bottom;
    });
    if (breadWinner) add(breadWinner.name, { icon:"🍞", label:"Bread Winner", desc:`Carrying the ${breadWinner.family} family (${Math.round(breadWinner.share * 100)}% of their points)`, tone:"good" });
    if (blackSheep) add(blackSheep.name, { icon:"🐑", label:"Black Sheep", desc:`Contributing the least to the ${blackSheep.family} family (${Math.round(blackSheep.share * 100)}% of their points)`, tone:"bad" });
  }

  // Order each player's badges rarest-first so the row preview (which shows only
  // the first couple) highlights what's UNIQUE to them rather than common
  // accolades (e.g. Underdog) that lots of players share. Stable sort keeps
  // the original push order for ties (headline badges first).
  const freq = {};
  Object.values(badges).forEach(list => list.forEach(b => { freq[b.label] = (freq[b.label] || 0) + 1; }));
  Object.values(badges).forEach(list => list.sort((a, b) => freq[a.label] - freq[b.label]));

  return badges;
}

// computeNewBadges24h(badgesNow, matches) — badges held now that weren't
// held 24h ago, i.e. "assigned in the last 24h". Reuses the already-computed
// current badge set (badgesNow) rather than recomputing it, and only builds
// one extra (cheap) snapshot for the 24h-ago baseline via computeBadges —
// deliberately called there WITHOUT rank24hChange/winPctPlayers, since those
// are themselves windowed/simulated values with no clean "value as of 24h
// ago"; the trend-based badges that depend on them (Climber, Sliding, The
// Prophecy) simply count as "new" the day they first appear, which is the
// behaviour we want anyway. For a single-holder badge (Top Dog, Firepower,
// etc.) computeBadges always assigns it to exactly one current player, so if
// the holder changed within the window, this diff naturally surfaces it for
// whoever holds it *now* — no separate "most recent owner" logic needed.
function computeNewBadges24h(badgesNow, matches) {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const matches24hAgo = matches.filter(m => new Date(m.utcDate).getTime() <= cutoffMs);
  const badges24hAgo = computeBadges(scorePlayers(matches24hAgo), matches24hAgo);

  const hadBefore = new Set();
  Object.entries(badges24hAgo).forEach(([name, list]) => {
    (list || []).forEach(b => hadBefore.add(`${name}|${b.label}`));
  });

  const result = [];
  Object.entries(badgesNow).forEach(([name, list]) => {
    (list || []).forEach(b => {
      if (!hadBefore.has(`${name}|${b.label}`)) result.push({ name, ...b });
    });
  });
  return result;
}

var BROADCAST = {}; // UK: TNT Sports has most CL games (Amazon Prime one Tuesday pick)

var getBroadcast = (homeTla, awayTla) => {
  const key = `${homeTla}-${awayTla}`;
  const alt = `${awayTla}-${homeTla}`;
  return BROADCAST[key] || BROADCAST[alt] || {b:"TNT", url:"https://www.tntsports.co.uk/"};
};
var fmt = (str) => {
  if (!str) return "";
  const d = new Date(str);
  return d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" })
    + " " + d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
};

// Resolves which player owns a team code within a plain PLAYERS-shaped
// roster (name/teams/codes/lateB — no computed score fields needed). Used
// by the service worker against a raw GROUPS[key].players roster, e.g. to
// label a push notification with the right player name.
var ownerOfTeamCode = (tla, players) => {
  const code = tla?.toUpperCase();
  if (!players) return undefined;
  // Prefer non-lateB player when duplicate codes exist
  const matches = players.filter(p => p.codes && p.codes.includes(code));
  if (!matches.length) return undefined;
  const primary = matches.find(p => {
    const idx = p.codes.indexOf(code);
    return !(p.lateB && p.lateB[idx]);
  });
  return (primary || matches[0]).name;
};

var ownerOf = (tla, ranked) => {
  const code = tla?.toUpperCase();
  // Prefer non-lateB player when duplicate codes exist
  const matches = ranked.filter(p => p.codes.includes(code));
  if (!matches.length) return undefined;
  const primary = matches.find(p => {
    const idx = p.codes.indexOf(code);
    return !(PLAYERS.find(pl => pl.name === p.name)?.lateB?.[idx]);
  });
  return (primary || matches[0]).name;
};

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY — replay matches chronologically, compute per-player cumulative points
// ─────────────────────────────────────────────────────────────────────────────
function deriveHistory(matches) {
  const done = matches
    .filter(m => isSettled(m.status))
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const teamPlayer = {}; // code -> array of player names
  PLAYERS.forEach(p => p.codes.forEach((c) => {
    if (!teamPlayer[c]) teamPlayer[c] = [];
    if (!teamPlayer[c].includes(p.name)) teamPlayer[c].push(p.name);
  }));

  const running = {};
  const history = {};
  const teamPts = {};
  PLAYERS.forEach(p => { running[p.name] = 0; history[p.name] = [0]; });
  // Whoever has grimReaper:true in the active group — not always named
  // "Josh" (Macklins/Caversham use an unnamed "Grim Reaper" player).
  const reaperName = (PLAYERS.find(p => p.grimReaper) || {}).name;

  const eliminated = {}, winners = {}, groupGames = {};
  const grpPts = {}, grpGF = {}, grpGA = {};
  const knockoutTeams = new Set();
  const bucketLabels = ["Start"];

  matches.filter(m => !(m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    if (m.homeTeam?.tla) knockoutTeams.add(m.homeTeam.tla.toUpperCase());
    if (m.awayTeam?.tla) knockoutTeams.add(m.awayTeam.tla.toUpperCase());
  });

  const award = (code, stageKey) => {
    const pls = teamPlayer[code] || [];
    const newPts = ptsTotal(code, stageKey);
    pls.forEach(pl => {
      const key = pl + ":" + code;
      const oldPts = teamPts[key] || 0;
      running[pl] += (newPts - oldPts);
      teamPts[key] = newPts;
    });
  };

  const reaperBounty = (code, stageKey) => {
    if (stageKey !== "GROUP_ELIM") return;
    const bounty = reaperBountyForCode(code);
    if (bounty > 0) running[reaperName] += bounty;
  };

  // Determine matchday bucket for each match
  // Group stage: bucket = "MD1", "MD2", "MD3" based on game number per team
  // Knockout: bucket = stage name
  const getBucket = (m) => {
    const stage = (m.stage || "").toUpperCase();
    if (!stage.includes("GROUP")) return stage;
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hGames = (groupGames[h] || 0) + 1;
    const aGames = (groupGames[a] || 0) + 1;
    return `MD${Math.max(hGames, aGames)}`;
  };

  // Process matches grouped into buckets
  let currentBucket = null;

  done.forEach(m => {
    const stage = (m.stage || "").toUpperCase();
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    const pen = m.score?.penalties;

    let loser = null, winner = null;
    if (hs > as_)      { loser = a; winner = h; }
    else if (as_ > hs) { loser = h; winner = a; }
    else if (pen) { if (pen.home > pen.away) { loser = a; winner = h; } else { loser = h; winner = a; } }

    const bucket = getBucket(m);

    // When bucket changes, snapshot current running totals
    if (bucket !== currentBucket && currentBucket !== null) {
      PLAYERS.forEach(p => history[p.name].push(running[p.name]));
      bucketLabels.push(bucket);
    }
    currentBucket = bucket;

    if (stage === "FINAL") {
      if (winner && !winners[winner]) { winners[winner] = true; award(winner, "WINNER"); }
      if (loser && !eliminated[loser]) { eliminated[loser] = "FINALIST"; award(loser, "FINALIST"); }
    } else if (stage.includes("SEMI") && loser && !eliminated[loser]) {
      eliminated[loser] = "SEMI_FINALS"; award(loser, "SEMI_FINALS");
      if (winner) award(winner, "SEMI_FINALS");
    } else if (stage.includes("QUARTER") && loser && !eliminated[loser]) {
      eliminated[loser] = "QUARTER_FINALS"; award(loser, "QUARTER_FINALS");
      if (winner) award(winner, "QUARTER_FINALS");
    } else if ((stage.includes("LAST_16")||stage.includes("16")) && loser && !eliminated[loser]) {
      eliminated[loser] = "LAST_16"; award(loser, "LAST_16");
      if (winner) award(winner, "LAST_16");
    } else if ((stage.includes("LAST_32")||stage.includes("32")) && loser && !eliminated[loser]) {
      eliminated[loser] = "LAST_32"; award(loser, "LAST_32");
      if (winner) award(winner, "LAST_32");
    } else if (stage.includes("GROUP")) {
      let hResult, aResult;
      if (hs > as_)      { hResult = "W"; aResult = "L"; }
      else if (as_ > hs) { hResult = "L"; aResult = "W"; }
      else               { hResult = "D"; aResult = "D"; }

      [[h, hResult], [a, aResult]].forEach(([code, result]) => {
        const pls = teamPlayer[code] || [];
        pls.forEach(pl => {
          if (result !== "L") running[pl] = (running[pl] || 0) + groupGamePts(code, result);
        });
      });

      // Grim Reaper goal drought curse
      const drought = goalDroughtPts(m);
      if (drought > 0) running[reaperName] = (running[reaperName] || 0) + drought;

      // Only count games toward elimination once fully finished — not during live matches
      if (m.status === "FINISHED") {
        if (h && a) {
          if (!grpPts[h]) { grpPts[h]=0; grpGF[h]=0; grpGA[h]=0; }
          if (!grpPts[a]) { grpPts[a]=0; grpGF[a]=0; grpGA[a]=0; }
          grpGF[h] += hs; grpGA[h] += as_;
          grpGF[a] += as_; grpGA[a] += hs;
          if (hs > as_) grpPts[h] += 3;
          else if (as_ > hs) grpPts[a] += 3;
          else { grpPts[h]++; grpPts[a]++; }
        }
        [h, a].forEach(code => { if (code) groupGames[code] = (groupGames[code]||0) + 1; });
        lpResolve(grpPts, groupGames, grpGF, grpGA).out.forEach(code => {
          if (knockoutTeams.has(code) || eliminated[code]) return;
          eliminated[code] = "GROUP_ELIM"; award(code, "GROUP_ELIM"); reaperBounty(code, "GROUP_ELIM");
        });
      }
    }
  });

  // Final snapshot after last bucket
  if (currentBucket !== null) {
    PLAYERS.forEach(p => history[p.name].push(running[p.name]));
    bucketLabels.push(currentBucket);
  }

  // Reconciliation: catch GROUP_ELIM teams missed during replay (e.g. non-qualifying
  // 3rd-placers only detectable once all groups finish). Uses deriveStages as the
  // same authoritative source that scorePlayers uses, so bump chart final positions
  // match the league table.
  const { stageReached: authStages } = deriveStages(matches);
  const reconChanged = new Set();
  Object.entries(authStages).forEach(([code, stage]) => {
    if (stage !== "GROUP_ELIM") return;
    if (eliminated[code]) return;
    eliminated[code] = "GROUP_ELIM";
    const newPts = ptsTotal(code, "GROUP_ELIM");
    (teamPlayer[code] || []).forEach(pl => {
      const key = pl + ":" + code;
      running[pl] += (newPts - (teamPts[key] || 0));
      teamPts[key] = newPts;
      reconChanged.add(pl);
    });
    const bounty = reaperBountyForCode(code);
    if (bounty > 0 && reaperName) { running[reaperName] += bounty; reconChanged.add(reaperName); }
  });
  // CL: clinched play-off / Last 16 places aren't match events either — pin
  // every endpoint to the scored total so the bump chart ends where the table is.
  scorePlayers(matches).forEach(p => {
    if (running[p.name] !== p.total) { running[p.name] = p.total; reconChanged.add(p.name); }
  });
  if (reconChanged.size > 0) {
    PLAYERS.forEach(p => history[p.name].push(running[p.name]));
    bucketLabels.push(""); // empty → shows "Now" at last column
  }

  return { history, bucketLabels };
}

// Per-match history for sparklines (every scoring event = one point)
function deriveSparklineHistory(matches) {
  // Historical replay uses FINISHED only — live match scores are unreliable
  // mid-game (fullTime may be null/stale). Live contribution is appended
  // separately at the end so the sparkline shape is always correct.
  const done = matches
    .filter(m => m.status === "FINISHED")
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const teamPlayer = {}; // code -> array of player names
  PLAYERS.forEach(p => p.codes.forEach((c) => {
    if (!teamPlayer[c]) teamPlayer[c] = [];
    if (!teamPlayer[c].includes(p.name)) teamPlayer[c].push(p.name);
  }));

  const running = {};
  const history = {};
  const teamPts = {};
  PLAYERS.forEach(p => { running[p.name] = 0; history[p.name] = [0]; });
  // Whoever has grimReaper:true in the active group — not always named
  // "Josh" (Macklins/Caversham use an unnamed "Grim Reaper" player).
  const reaperName = (PLAYERS.find(p => p.grimReaper) || {}).name;

  const eliminated = {}, winners = {}, groupGames = {};
  const grpPts = {}, grpGF = {}, grpGA = {};
  const knockoutTeams = new Set();

  // Include ALL non-group matches (scheduled and finished) so teams in published-
  // but-unplayed knockout fixtures aren't falsely eliminated as GROUP_ELIM during
  // the replay — mirrors the same logic deriveStages uses to build knockoutTeams.
  matches.filter(m => !(m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    if (m.homeTeam?.tla) knockoutTeams.add(m.homeTeam.tla.toUpperCase());
    if (m.awayTeam?.tla) knockoutTeams.add(m.awayTeam.tla.toUpperCase());
  });

  // Clinch bonus (Last 32 qualification) isn't a match event, so credit it the
  // instant a team is mathematically guaranteed top-2 — same as the live total.
  // awardSilent updates running totals WITHOUT touching changedPlayers, so it
  // never spawns an extra frame (keeps bar-race overlays frame-aligned); the
  // bonus simply rides on the next pushed frame. teamPts bookkeeping means the
  // real Last 32 fixture later awards a delta of 0 — no double count.
  const clinchAwarded = new Set();
  const awardSilent = (code, stageKey) => {
    const pls = teamPlayer[code] || [];
    const newPts = ptsTotal(code, stageKey);
    pls.forEach(pl => {
      const key = pl + ":" + code;
      running[pl] += (newPts - (teamPts[key] || 0));
      teamPts[key] = newPts;
    });
  };

  const clinch16 = new Set();

  done.forEach(m => {
    const stage = (m.stage || "").toUpperCase();
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    const pen = m.score?.penalties;

    let loser = null, winner = null;
    if (hs > as_)      { loser = a; winner = h; }
    else if (as_ > hs) { loser = h; winner = a; }
    else if (pen) { if (pen.home > pen.away) { loser = a; winner = h; } else { loser = h; winner = a; } }

    const changedPlayers = new Set();
    const award = (code, stageKey) => {
      const pls = teamPlayer[code] || [];
      const newPts = ptsTotal(code, stageKey);
      pls.forEach(pl => {
        const key = pl + ":" + code;
        const oldPts = teamPts[key] || 0;
        running[pl] += (newPts - oldPts);
        teamPts[key] = newPts;
        changedPlayers.add(pl);
      });
    };

    if (stage === "FINAL") {
      if (winner && !winners[winner]) { winners[winner] = true; award(winner, "WINNER"); }
      if (loser && !eliminated[loser]) { eliminated[loser] = "FINALIST"; award(loser, "FINALIST"); }
    // Knockout: loser banks the round they went out in; the WINNER advances and
    // banks the NEXT round (the current round was already banked on qualifying,
    // e.g. via clinch), so every knockout frame carries a real score change (the
    // winner advancing) alongside the loser's elimination — no more frames where
    // a team is eliminated but nothing moves. Same model as deriveStages.
    } else if (stage.includes("SEMI") && loser && !eliminated[loser]) {
      eliminated[loser] = "SEMI_FINALS"; award(loser, "SEMI_FINALS");
      if (winner) award(winner, "FINALIST");
    } else if (stage.includes("QUARTER") && loser && !eliminated[loser]) {
      eliminated[loser] = "QUARTER_FINALS"; award(loser, "QUARTER_FINALS");
      if (winner) award(winner, "SEMI_FINALS");
    } else if ((stage.includes("LAST_16")||stage.includes("16")) && loser && !eliminated[loser]) {
      eliminated[loser] = "LAST_16"; award(loser, "LAST_16");
      if (winner) award(winner, "QUARTER_FINALS");
    } else if ((stage.includes("LAST_32")||stage.includes("32")) && loser && !eliminated[loser]) {
      eliminated[loser] = "LAST_32"; award(loser, "LAST_32");
      if (winner) award(winner, "LAST_16");
    } else if (stage.includes("GROUP")) {
      let hResult, aResult;
      if (hs > as_)      { hResult = "W"; aResult = "L"; }
      else if (as_ > hs) { hResult = "L"; aResult = "W"; }
      else               { hResult = "D"; aResult = "D"; }
      [[h, hResult], [a, aResult]].forEach(([code, result]) => {
        const pls = teamPlayer[code] || [];
        pls.forEach(pl => {
          if (result !== "L") {
            running[pl] = (running[pl] || 0) + groupGamePts(code, result);
            changedPlayers.add(pl);
          }
        });
      });
      // Grim Reaper goal drought curse
      const drought = goalDroughtPts(m);
      if (drought > 0) { running[reaperName] = (running[reaperName] || 0) + drought; changedPlayers.add(reaperName); }
      if (h && a) {
        if (!grpPts[h]) { grpPts[h]=0; grpGF[h]=0; grpGA[h]=0; }
        if (!grpPts[a]) { grpPts[a]=0; grpGF[a]=0; grpGA[a]=0; }
        grpGF[h] += hs; grpGA[h] += as_;
        grpGF[a] += as_; grpGA[a] += hs;
        if (hs > as_) grpPts[h] += 3;
        else if (as_ > hs) grpPts[a] += 3;
        else { grpPts[h]++; grpPts[a]++; }
      }
      if (h) groupGames[h] = (groupGames[h]||0) + 1;
      if (a) groupGames[a] = (groupGames[a]||0) + 1;
      // League phase as of this frame (FINISHED-only replay): certain exits take
      // the GROUP_ELIM penalty (+ reaper bounty) on this frame; certain top-24 /
      // top-8 bank LAST_32 / LAST_16 silently (no extra frame).
      const _lp = lpResolve(grpPts, groupGames, grpGF, grpGA);
      _lp.out.forEach(code => {
        if (eliminated[code] || knockoutTeams.has(code)) return;
        eliminated[code] = "GROUP_ELIM"; award(code, "GROUP_ELIM");
        const bounty = reaperBountyForCode(code);
        if (bounty > 0) { running[reaperName] += bounty; changedPlayers.add(reaperName); }
      });
      _lp.r32.forEach(code => { if (!clinchAwarded.has(code) && !eliminated[code]) { clinchAwarded.add(code); awardSilent(code, "LAST_32"); } });
      _lp.r16.forEach(code => { if (!clinch16.has(code) && !eliminated[code]) { clinch16.add(code); awardSilent(code, "LAST_16"); } });
    }

    if (changedPlayers.size > 0) PLAYERS.forEach(p => history[p.name].push(running[p.name]));
  });

  // Reconciliation pass: catch any GROUP_ELIM teams the replay missed (e.g.
  // non-qualifying 3rd-placers when not all groups are done yet). deriveStages
  // is the same authoritative source scorePlayers uses for `total`, so this
  // makes the final bar-race frame match the league.
  const { stageReached: authStages } = deriveStages(matches);
  const reconChanged = new Set();
  Object.entries(authStages).forEach(([code, stage]) => {
    if (stage !== "GROUP_ELIM") return;
    if (eliminated[code]) return; // already handled during replay
    eliminated[code] = "GROUP_ELIM";
    const newPts = ptsTotal(code, "GROUP_ELIM");
    (teamPlayer[code] || []).forEach(pl => {
      const key = pl + ":" + code;
      running[pl] += (newPts - (teamPts[key] || 0));
      teamPts[key] = newPts;
      reconChanged.add(pl);
    });
    const bounty = reaperBountyForCode(code);
    if (bounty > 0 && reaperName) { running[reaperName] += bounty; reconChanged.add(reaperName); }
  });
  if (reconChanged.size > 0) PLAYERS.forEach(p => history[p.name].push(running[p.name]));

  // NOTE: the sparkline is deliberately CONFIRMED-ONLY — it replays FINISHED
  // matches and does NOT append a live-match point. A live game's points still
  // move the player's displayed total/position in real time (scorePlayers /
  // deriveStages / deriveGroupPts use isSettled), but the sparkline stays flat
  // during the game and only redraws when the match finishes — same as the
  // bracket resolves at the final whistle. This also keeps the frame count in
  // sync with the bar race (deriveRaceEliminations/Stages), which are likewise
  // FINISHED-only.
  return history;
}

// Per-match sweepstake points — how many points each side EARNED (or, for a
// live match, are CURRENTLY PROJECTED to earn) via this specific result.
// Group stage = that game's W/D/L value (groupGamePts). Knockout = the delta
// between the stage just reached and whatever stage the team had already
// banked, so a run of wins isn't double-counted — same model
// deriveSparklineHistory uses for the points-over-time charts, just keyed by
// match id instead of accumulated into a running total. Note both sides of a
// non-final knockout match "reach" that round by playing in it, so winner
// and loser typically earn the same amount (the model rewards reaching a
// round, not winning the individual tie) — only the FINAL splits WINNER vs
// FINALIST. Uses isSettled (FINISHED + IN_PLAY/PAUSED) so live matches show
// a real-time projection, consistent with how scorePlayers/deriveStages
// already treat live matches as scoring in real time — these numbers are
// provisional and will shift if the live score changes, same as the rest of
// the app's live totals.
function deriveMatchPts(matches) {
  const done = matches.filter(m => isSettled(m.status))
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const teamPts = {}; // code -> points already banked for the highest stage reached so far
  const award = (code, stageKey) => {
    const newPts = ptsTotal(code, stageKey);
    const delta = newPts - (teamPts[code] || 0);
    teamPts[code] = newPts;
    return delta;
  };

  const result = {};
  done.forEach(m => {
    const stage = (m.stage || "").toUpperCase();
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    const pen = m.score?.penalties;
    let loser = null, winner = null;
    if (hs > as_)      { loser = a; winner = h; }
    else if (as_ > hs) { loser = h; winner = a; }
    else if (pen)      { if (pen.home > pen.away) { loser = a; winner = h; } else { loser = h; winner = a; } }

    let hPts = 0, aPts = 0;

    if (stage.includes("GROUP")) {
      let hResult, aResult;
      if (hs > as_)      { hResult = "W"; aResult = "L"; }
      else if (as_ > hs) { hResult = "L"; aResult = "W"; }
      else               { hResult = "D"; aResult = "D"; }
      hPts = groupGamePts(h, hResult);
      aPts = groupGamePts(a, aResult);
    } else if (stage === "FINAL") {
      if (winner) { const d = award(winner, "WINNER");   if (winner === h) hPts = d; else aPts = d; }
      if (loser)  { const d = award(loser,  "FINALIST"); if (loser  === h) hPts = d; else aPts = d; }
    } else {
      // stageKey = stage being played; nextStageKey = stage winner advances to
      let stageKey = null, nextStageKey = null;
      if (stage.includes("SEMI"))                                  { stageKey = "SEMI_FINALS";    nextStageKey = "FINALIST"; }
      else if (stage.includes("QUARTER"))                          { stageKey = "QUARTER_FINALS"; nextStageKey = "SEMI_FINALS"; }
      else if (stage.includes("LAST_16") || stage.includes("16")) { stageKey = "LAST_16";         nextStageKey = "QUARTER_FINALS"; }
      else if (stage.includes("LAST_32") || stage.includes("32")) { stageKey = "LAST_32";         nextStageKey = "LAST_16"; }
      if (stageKey) {
        // Loser's stage bonus stays off the match row — it shows at their Q milestone via stageBonusFor
        if (loser) award(loser, stageKey); // bank for tracking; don't add to match display
        // Winner earns the next stage's bonus (advancing beyond the current round)
        if (winner && nextStageKey) { const dw = award(winner, nextStageKey); if (winner === h) hPts = dw; else aPts = dw; }
      }
    }

    result[m.id] = { home: hPts, away: aPts };
  });

  return result;
}

// Per-team cumulative sweepstake-points history for the Teams-table sparklines.
// Forward replay of CONFIRMED events only — the same model as deriveSparklineHistory
// (which drives the player sparklines), keyed by team code. Using confirmed events
// (never provisional "as it stands" states) is what keeps the line honest: a team
// is only credited a Last-32 bonus once it has mathematically clinched (clinchedR32
// is pessimistic/monotonic) or been settled as a best-3rd qualifier at group
// completion — so a team like Scotland that briefly sat in the provisional top-8
// thirds never shows a phantom rise-then-drop. Steps: group W/D points as earned;
// the qualification bonus (+) or group-elim penalty (−) at group stage; each
// knockout round reached (winner advances = banks the next round, matching
// deriveStages). A final reconciliation pins each endpoint to the exact displayed
// swPts. Keyed by team code; all series share one timeline (equal length).
function deriveTeamHistory(matches) {
  const allCodes = Object.values(GROUP_ASSIGNMENTS).flat();
  const done = matches.filter(m => m.status === "FINISHED")
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const running = {}, stageBanked = {}, history = {};
  allCodes.forEach(c => { running[c] = 0; stageBanked[c] = 0; history[c] = [0]; });
  const grpPts = {}, grpGF = {}, grpGA = {}, groupGames = {}, eliminated = {};
  const clinchAwarded = new Set();

  const knockoutTeams = new Set();
  matches.filter(m => !(m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    if (m.homeTeam?.tla) knockoutTeams.add(m.homeTeam.tla.toUpperCase());
    if (m.awayTeam?.tla) knockoutTeams.add(m.awayTeam.tla.toUpperCase());
  });

  const bank = (code, stageKey) => {
    if (!code || !(code in running)) return false;
    const newPts = ptsTotal(code, stageKey);
    const delta = newPts - (stageBanked[code] || 0);
    if (delta === 0) return false;
    stageBanked[code] = newPts; running[code] += delta; return true;
  };
  const pushAll = () => allCodes.forEach(c => history[c].push(running[c]));
  const grpCmp = (x, y) => {
    const pd = (grpPts[y]||0)-(grpPts[x]||0); if (pd) return pd;
    const gd = ((grpGF[y]||0)-(grpGA[y]||0))-((grpGF[x]||0)-(grpGA[x]||0)); if (gd) return gd;
    return (grpGF[y]||0)-(grpGF[x]||0);
  };
  done.forEach(m => {
    const stage = (m.stage || "").toUpperCase();
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    const pen = m.score?.penalties;
    let loser = null, winner = null;
    if (hs > as_)      { loser = a; winner = h; }
    else if (as_ > hs) { loser = h; winner = a; }
    else if (pen)      { if (pen.home > pen.away) { loser = a; winner = h; } else { loser = h; winner = a; } }
    let changed = false;

    if (stage === "FINAL") {
      if (winner && bank(winner, "WINNER")) changed = true;
      if (loser && bank(loser, "FINALIST")) changed = true;
    } else if (stage.includes("GROUP")) {
      let hR, aR;
      if (hs > as_)      { hR = "W"; aR = "L"; }
      else if (as_ > hs) { hR = "L"; aR = "W"; }
      else               { hR = "D"; aR = "D"; }
      [[h, hR], [a, aR]].forEach(([c, r]) => {
        if (c && (c in running) && r !== "L") { const p = groupGamePts(c, r); if (p) { running[c] += p; changed = true; } }
      });
      if (h && a) {
        if (!grpPts[h]) { grpPts[h]=0; grpGF[h]=0; grpGA[h]=0; }
        if (!grpPts[a]) { grpPts[a]=0; grpGF[a]=0; grpGA[a]=0; }
        grpGF[h]+=hs; grpGA[h]+=as_; grpGF[a]+=as_; grpGA[a]+=hs;
        if (hs>as_) grpPts[h]+=3; else if (as_>hs) grpPts[a]+=3; else { grpPts[h]++; grpPts[a]++; }
      }
      if (h) groupGames[h]=(groupGames[h]||0)+1;
      if (a) groupGames[a]=(groupGames[a]||0)+1;
      const _lp = lpResolve(grpPts, groupGames, grpGF, grpGA);
      _lp.out.forEach(c => { if (eliminated[c] || knockoutTeams.has(c)) return; eliminated[c] = "GROUP_ELIM"; if (bank(c, "GROUP_ELIM")) changed = true; });
      _lp.r32.forEach(c => { if (!clinchAwarded.has(c) && !eliminated[c]) { clinchAwarded.add(c); if (bank(c, "LAST_32")) changed = true; } });
      _lp.r16.forEach(c => { if (!eliminated[c] && bank(c, "LAST_16")) changed = true; });
    } else {
      // Knockout: winner advances (banks the next round), loser banks the round played.
      let sk = null, nk = null;
      if (stage.includes("SEMI"))                                 { sk = "SEMI_FINALS";    nk = "FINALIST"; }
      else if (stage.includes("QUARTER"))                         { sk = "QUARTER_FINALS"; nk = "SEMI_FINALS"; }
      else if (stage.includes("LAST_16") || stage.includes("16")) { sk = "LAST_16";        nk = "QUARTER_FINALS"; }
      else if (stage.includes("LAST_32") || stage.includes("32")) { sk = "LAST_32";        nk = "LAST_16"; }
      if (sk) {
        if (loser && bank(loser, sk)) changed = true;
        if (winner && bank(winner, nk)) changed = true;
      }
    }
    if (changed) pushAll();
  });


  // Reconcile each endpoint to the exact CONFIRMED swPts (catches e.g. teams
  // credited via a published knockout fixture the FINISHED-only replay can't
  // see). A "confirmed view" downgrades any live match to SCHEDULED first, so a
  // team's qualification credit is kept but a live match's score does NOT move
  // the sparkline endpoint — the team's displayed total still updates live via
  // scorePlayers, but the line only redraws when the game finishes (same as the
  // bracket). Converges to the live total the instant the match is FINISHED.
  const confirmedView = matches.map(m =>
    (m.status === "IN_PLAY" || m.status === "PAUSED") ? Object.assign({}, m, { status: "SCHEDULED" }) : m);
  const grpPtsAuth = deriveGroupPts(confirmedView);
  const { stageReached, eliminated: elimAuth } = deriveStages(confirmedView);
  let recon = false;
  allCodes.forEach(code => {
    const sR = stageReached[code];
    const swPts = (grpPtsAuth[code] || 0)
      + (sR && sR !== "GROUP_ELIM" ? ptsTotal(code, sR) : 0)
      + (elimAuth[code] === "GROUP_ELIM" ? ptsTotal(code, "GROUP_ELIM") : 0);
    if (running[code] !== swPts) { running[code] = swPts; recon = true; }
  });
  if (recon) pushAll();

  return history;
}

// Per-frame elimination snapshots for the bar race. Mirrors the chronological
// replay + frame-advance gating of deriveSparklineHistory so elimByFrame[i]
// aligns 1:1 with that function's history frames. elimByFrame[i] = array of team
// codes eliminated as of frame i (frame 0 = start, nothing out yet).
// KEEP THE FRAME-ADVANCE CONDITIONS HERE IN SYNC with deriveSparklineHistory.
function deriveRaceEliminations(matches) {
  const done = matches.filter(m => m.status === "FINISHED")
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const teamPlayer = {};
  PLAYERS.forEach(p => p.codes.forEach((c) => {
    if (!teamPlayer[c]) teamPlayer[c] = [];
    if (!teamPlayer[c].includes(p.name)) teamPlayer[c].push(p.name);
  }));
  const owned = (code) => (teamPlayer[code] || []).length > 0;
  const knockoutTeams = new Set();
  matches.filter(m => !(m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    if (m.homeTeam?.tla) knockoutTeams.add(m.homeTeam.tla.toUpperCase());
    if (m.awayTeam?.tla) knockoutTeams.add(m.awayTeam.tla.toUpperCase());
  });
  const eliminated = {}, winners = {}, groupGames = {};
  const grpPts = {}, grpGF = {}, grpGA = {};
  const frames = [[]]; // frame 0 = start, nothing eliminated
  done.forEach(m => {
    const stage = (m.stage || "").toUpperCase();
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    const pen = m.score?.penalties;
    let loser = null, winner = null;
    if (hs > as_)      { loser = a; winner = h; }
    else if (as_ > hs) { loser = h; winner = a; }
    else if (pen) { if (pen.home > pen.away) { loser = a; winner = h; } else { loser = h; winner = a; } }
    let changed = false;
    if (stage === "FINAL") {
      if (winner && !winners[winner]) { winners[winner] = true; if (owned(winner)) changed = true; }
      if (loser && !eliminated[loser]) { eliminated[loser] = "FINALIST"; if (owned(loser)) changed = true; }
    } else if (stage.includes("SEMI") && loser && !eliminated[loser]) {
      eliminated[loser] = "SEMI_FINALS"; if (owned(loser) || owned(winner)) changed = true;
    } else if (stage.includes("QUARTER") && loser && !eliminated[loser]) {
      eliminated[loser] = "QUARTER_FINALS"; if (owned(loser) || owned(winner)) changed = true;
    } else if ((stage.includes("LAST_16")||stage.includes("16")) && loser && !eliminated[loser]) {
      eliminated[loser] = "LAST_16"; if (owned(loser) || owned(winner)) changed = true;
    } else if ((stage.includes("LAST_32")||stage.includes("32")) && loser && !eliminated[loser]) {
      eliminated[loser] = "LAST_32"; if (owned(loser) || owned(winner)) changed = true;
    } else if (stage.includes("GROUP")) {
      let hResult, aResult;
      if (hs > as_)      { hResult = "W"; aResult = "L"; }
      else if (as_ > hs) { hResult = "L"; aResult = "W"; }
      else               { hResult = "D"; aResult = "D"; }
      [[h, hResult], [a, aResult]].forEach(([code, result]) => { if (result !== "L" && owned(code)) changed = true; });
      if (goalDroughtPts(m) > 0) changed = true;
      if (h && a) {
        if (!grpPts[h]) { grpPts[h]=0; grpGF[h]=0; grpGA[h]=0; }
        if (!grpPts[a]) { grpPts[a]=0; grpGF[a]=0; grpGA[a]=0; }
        grpGF[h] += hs; grpGA[h] += as_;
        grpGF[a] += as_; grpGA[a] += hs;
        if (hs > as_) grpPts[h] += 3;
        else if (as_ > hs) grpPts[a] += 3;
        else { grpPts[h]++; grpPts[a]++; }
      }
      [h, a].forEach(code => { if (code) groupGames[code] = (groupGames[code]||0) + 1; });
      lpResolve(grpPts, groupGames, grpGF, grpGA).out.forEach(code => {
        if (eliminated[code] || knockoutTeams.has(code)) return;
        eliminated[code] = "GROUP_ELIM";
        if (owned(code) || reaperBountyForCode(code) > 0) changed = true;
      });
    }
    if (changed) frames.push(Object.keys(eliminated));
  });
  // Reconcile the final frame with the authoritative eliminated set. The
  // chronological FINISHED-only replay can't see a knockout exit whose losing
  // fixture the feed never delivered (e.g. a Last-16 loss missing while the QFs
  // arrived) — deriveStages infers those. Fold any such teams into the LAST
  // frame only (no new frame is pushed), so their ✕ shows once the race reaches
  // the end without breaking frame-alignment with the bars. No live frame is
  // appended — the bars (deriveSparklineHistory) are FINISHED-only too.
  if (frames.length > 0) {
    const authElim = deriveStages(matches).eliminated;
    const finalSet = new Set(frames[frames.length - 1]);
    Object.keys(authElim).forEach(c => finalSet.add(c));
    frames[frames.length - 1] = [...finalSet];
  }
  return frames;
}

// Per-frame tournament-stage label for the bar race — aligned 1:1 with
// deriveSparklineHistory / deriveRaceEliminations frames (same "did this match
// change an owned total" trigger), so stages[frame] names the stage the race
// is currently at. Group games are numbered 1–3 by how many group games the
// teams have played; knockouts use their round name.
function deriveRaceStages(matches) {
  const done = matches.filter(m => m.status === "FINISHED")
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const teamPlayer = {};
  PLAYERS.forEach(p => p.codes.forEach((c) => {
    if (!teamPlayer[c]) teamPlayer[c] = [];
    if (!teamPlayer[c].includes(p.name)) teamPlayer[c].push(p.name);
  }));
  const owned = (code) => (teamPlayer[code] || []).length > 0;
  const knockoutTeams = new Set();
  matches.filter(m => !(m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    if (m.homeTeam?.tla) knockoutTeams.add(m.homeTeam.tla.toUpperCase());
    if (m.awayTeam?.tla) knockoutTeams.add(m.awayTeam.tla.toUpperCase());
  });
  const stageLabel = (stage, gameNo) => {
    if (stage === "FINAL") return "Finals";
    if (stage.includes("SEMI")) return "Semi Finals";
    if (stage.includes("QUARTER")) return "Quarter Finals";
    if (stage.includes("LAST_16") || stage.includes("16")) return "Last 16";
    if (stage.includes("LAST_32") || stage.includes("32")) return "Play-offs";
    if (stage.includes("GROUP")) return "League Phase MD" + (gameNo || 1);
    return "";
  };
  const eliminated = {}, winners = {}, groupGames = {};
  const grpPts = {}, grpGF = {}, grpGA = {};
  const stages = [null]; // frame 0 = start (back-filled below)
  let lastLabel = "";
  done.forEach(m => {
    const stage = (m.stage || "").toUpperCase();
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    const pen = m.score?.penalties;
    let loser = null, winner = null;
    if (hs > as_)      { loser = a; winner = h; }
    else if (as_ > hs) { loser = h; winner = a; }
    else if (pen) { if (pen.home > pen.away) { loser = a; winner = h; } else { loser = h; winner = a; } }
    let changed = false, gameNo = 0;
    if (stage === "FINAL") {
      if (winner && !winners[winner]) { winners[winner] = true; if (owned(winner)) changed = true; }
      if (loser && !eliminated[loser]) { eliminated[loser] = "FINALIST"; if (owned(loser)) changed = true; }
    } else if (stage.includes("SEMI") && loser && !eliminated[loser]) {
      eliminated[loser] = "SEMI_FINALS"; if (owned(loser) || owned(winner)) changed = true;
    } else if (stage.includes("QUARTER") && loser && !eliminated[loser]) {
      eliminated[loser] = "QUARTER_FINALS"; if (owned(loser) || owned(winner)) changed = true;
    } else if ((stage.includes("LAST_16")||stage.includes("16")) && loser && !eliminated[loser]) {
      eliminated[loser] = "LAST_16"; if (owned(loser) || owned(winner)) changed = true;
    } else if ((stage.includes("LAST_32")||stage.includes("32")) && loser && !eliminated[loser]) {
      eliminated[loser] = "LAST_32"; if (owned(loser) || owned(winner)) changed = true;
    } else if (stage.includes("GROUP")) {
      let hResult, aResult;
      if (hs > as_)      { hResult = "W"; aResult = "L"; }
      else if (as_ > hs) { hResult = "L"; aResult = "W"; }
      else               { hResult = "D"; aResult = "D"; }
      [[h, hResult], [a, aResult]].forEach(([code, result]) => { if (result !== "L" && owned(code)) changed = true; });
      if (goalDroughtPts(m) > 0) changed = true;
      if (h && a) {
        if (!grpPts[h]) { grpPts[h]=0; grpGF[h]=0; grpGA[h]=0; }
        if (!grpPts[a]) { grpPts[a]=0; grpGF[a]=0; grpGA[a]=0; }
        grpGF[h] += hs; grpGA[h] += as_;
        grpGF[a] += as_; grpGA[a] += hs;
        if (hs > as_) grpPts[h] += 3;
        else if (as_ > hs) grpPts[a] += 3;
        else { grpPts[h]++; grpPts[a]++; }
      }
      [h, a].forEach(code => { if (code) groupGames[code] = (groupGames[code]||0) + 1; });
      lpResolve(grpPts, groupGames, grpGF, grpGA).out.forEach(code => {
        if (eliminated[code] || knockoutTeams.has(code)) return;
        eliminated[code] = "GROUP_ELIM";
        if (owned(code) || reaperBountyForCode(code) > 0) changed = true;
      });
      gameNo = m.matchday || Math.max(groupGames[h] || 0, groupGames[a] || 0);
    }
    if (changed) { lastLabel = stageLabel(stage, gameNo); stages.push(lastLabel); }
  });
  // No live frame is appended — the race bars (deriveSparklineHistory) are
  // FINISHED-only, so the stage labels stay 1:1 frame-aligned with them.
  stages[0] = stages[1] || "League Phase MD1";
  return stages;
}

// ─────────────────────────────────────────────────────────────────────────────
// INGEST — football-data CL feed → the engine's vocabulary. Stage names map to
// the WC engine's (league phase = GROUP_STAGE, play-off = LAST_32), team codes
// are pinned per club id (the feed's TLAs collide). Idempotent.
// ─────────────────────────────────────────────────────────────────────────────
var CL_STAGE_MAP = {
  LEAGUE_STAGE: "GROUP_STAGE", LEAGUE_PHASE: "GROUP_STAGE",
  PLAYOFFS: "LAST_32", PLAY_OFFS: "LAST_32", PLAYOFF_ROUND: "LAST_32", KNOCKOUT_PLAYOFFS: "LAST_32",
  ROUND_OF_16: "LAST_16", QUARTER_FINAL: "QUARTER_FINALS", SEMI_FINAL: "SEMI_FINALS",
};
function clNormalizeMatches(ms) {
  const fix = (t) => {
    if (!t || t.id == null) return t;
    const c = CL_CODE_BY_ID[t.id];
    if (!c) return t;
    return Object.assign({}, t, { tla: c, name: t.name || CL_CLUBS[c].name, shortName: t.shortName || CL_CLUBS[c].name });
  };
  return (ms || []).map(m => Object.assign({}, m, {
    stage: CL_STAGE_MAP[(m.stage || "").toUpperCase()] || m.stage,
    homeTeam: fix(m.homeTeam), awayTeam: fix(m.awayTeam),
  }));
}

// Goals a leg contributes to the aggregate (regular + extra time, never the
// shoot-out — the feed can fold penalties into fullTime on shoot-out games).
function clLegGoals(m) {
  const s = m.score || {};
  if (s.duration === "PENALTY_SHOOTOUT" && s.regularTime)
    return { home: (s.regularTime.home || 0) + (s.extraTime?.home || 0), away: (s.regularTime.away || 0) + (s.extraTime?.away || 0) };
  return { home: s.fullTime?.home ?? 0, away: s.fullTime?.away ?? 0 };
}

// Scoring view of the feed: two-legged ties collapse onto leg 2. Leg 1 reads as
// SCHEDULED (both clubs are "in" the round, nobody advances on it); leg 2, once
// under way, carries the AGGREGATE (from leg 2's home side) plus a shoot-out
// (or the feed's declared winner) to split a level aggregate. Display code
// keeps the raw legs — only the scoring functions below see this view.
var _clViewCache = new WeakMap();
var CL_TWO_LEG = { LAST_32: 1, LAST_16: 1, QUARTER_FINALS: 1, SEMI_FINALS: 1 };
function clScoringView(ms) {
  if (!Array.isArray(ms) || !ms.length || ms[0]._clv) return ms;
  const hit = _clViewCache.get(ms); if (hit) return hit;
  const ties = {};
  ms.forEach(m => {
    const st = (m.stage || "").toUpperCase();
    const h = m.homeTeam?.tla, a = m.awayTeam?.tla;
    if (!CL_TWO_LEG[st] || !h || !a) return;
    const k = st + ":" + [h, a].sort().join("-");
    (ties[k] = ties[k] || []).push(m);
  });
  const repl = new Map();
  Object.values(ties).forEach(legs => {
    legs.sort((x, y) => new Date(x.utcDate) - new Date(y.utcDate));
    const l1 = legs[0], l2 = legs[1];
    repl.set(l1, Object.assign({}, l1, { status: "SCHEDULED", _leg: 1 }));
    if (!l2 || !isSettled(l2.status)) return;
    const g1 = clLegGoals(l1), g2 = clLegGoals(l2);
    const same = l1.homeTeam.tla === l2.homeTeam.tla;
    const aggH = g2.home + (same ? g1.home : g1.away);
    const aggA = g2.away + (same ? g1.away : g1.home);
    let pens = null;
    const p = l2.score?.penalties;
    if (aggH === aggA) {
      if (p && p.home != null && p.away != null && p.home !== p.away) pens = { home: p.home, away: p.away };
      else if (l2.status === "FINISHED" && l2.score?.winner === "HOME_TEAM") pens = { home: 1, away: 0 };
      else if (l2.status === "FINISHED" && l2.score?.winner === "AWAY_TEAM") pens = { home: 0, away: 1 };
    }
    repl.set(l2, Object.assign({}, l2, {
      score: Object.assign({}, l2.score, { fullTime: { home: aggH, away: aggA }, penalties: pens }),
      _leg: 2, _agg: true,
    }));
  });
  const out = ms.map(m => Object.assign({}, repl.get(m) || m, { _clv: true }));
  Object.defineProperty(out, "_clRaw", { value: ms });
  _clViewCache.set(ms, out);
  return out;
}

// Route every match-taking scoring function through the view. Internal calls go
// through the same global names, and the view is idempotent (_clv), so nothing
// is collapsed twice. W/D/L records use the raw legs (real per-game results).
(function () {
  const g = (typeof globalThis !== "undefined") ? globalThis : this;
  const first = ["deriveStages","deriveGroupPts","scorePlayers","scoreAllGroups","deriveHistory",
    "deriveSparklineHistory","deriveMatchPts","deriveTeamHistory","deriveRaceEliminations","deriveRaceStages",
    "compute24hRankChange","compute24hPtsChange","compute24hFamilyRankChange","clinchedR32","clinchedTop8"];
  const second = ["computeBadges","simulateWinProbability","computeNewBadges24h"];
  first.forEach(n => { const f = g[n]; if (typeof f === "function") g[n] = function (ms, ...rest) { return f.call(this, clScoringView(ms), ...rest); }; });
  second.forEach(n => { const f = g[n]; if (typeof f === "function") g[n] = function (x, ms, ...rest) { return f.call(this, x, clScoringView(ms), ...rest); }; });
  const wdl = g.deriveWDL;
  if (typeof wdl === "function") g.deriveWDL = function (ms) { return wdl.call(this, (ms && ms._clRaw) || ms); };
})();
