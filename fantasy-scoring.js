// ═════════════════════════════════════════════════════════════════════════════
// fantasy-scoring.js — engine for SWEEPSTAKER FANTASY (fantasy.html): an
// FPL-style game played with CLUBS instead of footballers.
//
// Loaded AFTER league-scoring.js and reuses its data/helpers: LEAGUE_TEAMS,
// LEAGUE_COMPETITIONS, CL_TIER, lgWeeks (gameweeks; international breaks are
// folded in), lgIsSettled, lgResultFor, leagueCrest. Prefixed fp/FP_ — no
// other globals. Pure functions only; the page owns state/storage.
//
// Rules (see FANTASY.md for the player-facing version):
//   - Squad of 15 clubs: exactly 3 from each of the 5 leagues, £100.0m budget.
//   - Starting XI of 11 with at least 2 per league; 4 on the bench, ordered.
//   - Captain scores ×2 (×3 with Triple Captain); vice steps in if the captain
//     has no game. Auto-subs: a starter with no game is replaced by the first
//     bench club that played, keeping ≥2 starters per league.
//   - EQUAL scoring for every club (price does the balancing, not pots):
//       win 3 · draw 1 · +1 per goal · clean sheet +2 · conceded 3+ −1 ·
//       won by 3+ +1 · Champions League win +2 extra.
//   - Transfers: 1 free per gameweek, bank up to 5, each extra −4.
//     Chips (once each per season): Wildcard ×2 (one per half), Free Hit,
//     Bench Boost, Triple Captain.
//   - Prices move with FORM, not transfer demand (too few managers for demand
//     to mean anything): an Elo rating updated by every result; each 25 Elo
//     above/below the club's start = ±£0.1m, moving at most ±£0.2m per GW.
//     Selling price = FPL rule (keep half of any rise, rounded down to £0.1m).
// ═════════════════════════════════════════════════════════════════════════════

var FP_LEAGUES = ["PL", "PD", "SA", "BL1", "FL1"];
var FP_PER_LEAGUE = 3;
var FP_SQUAD = 15, FP_XI = 11, FP_MIN_XI_PER_LEAGUE = 2;
var FP_BUDGET = 1000; // tenths of £m (integers avoid float drift): 1000 = £100.0m
var FP_MAX_FT = 5, FP_HIT = 4;
var FP_CHIPS = { WC1: "Wildcard", WC2: "Wildcard", FH: "Free Hit", BB: "Bench Boost", TC: "Triple Captain" };
var FP_POINTS = { win: 3, draw: 1, goal: 1, cleanSheet: 2, concede3: -1, bigWin: 1, clWin: 2 };
var FP_POT_PRICE = { 1: 85, 2: 70, 3: 55, 4: 45 };   // tenths of £m (calibrated on 2025-26: ≈18 pts per £1m in every band)
var FP_CL_PRICE = { 1: 65, 2: 35, 3: 15, 4: 5 };     // CL clubs play ~10 extra games: premium by CL tier
var FP_ELO_PER_TENTH = 25, FP_MAX_MOVE = 2, FP_MIN_PRICE = 35;

function fpMoney(t) { return "£" + (t / 10).toFixed(1) + "m"; }

// ── Pool: every club playing a league match in the 5 leagues in `matches`
// (so the 2025-26 replay and the live 2026-27 season each get the right
// clubs). Pot from LEAGUE_TEAMS (its p25 override when `season2025`);
// unknown clubs (e.g. sides since relegated) default to pot 4.
function fpPool(matches, season2025) {
  var seen = {}, inCL = {};
  matches.forEach(function (m) {
    if (!m.competition || !m.homeTeam || !m.awayTeam) return;
    var c = m.competition.code;
    if (c === "CL") { inCL[m.homeTeam.id] = 1; inCL[m.awayTeam.id] = 1; return; }
    if (FP_LEAGUES.indexOf(c) === -1 || m.stage !== "REGULAR_SEASON") return;
    [m.homeTeam, m.awayTeam].forEach(function (t) {
      if (!seen[t.id]) seen[t.id] = { id: t.id, league: c, short: t.shortName || t.tla || ("#" + t.id) };
    });
  });
  var pool = {};
  Object.keys(seen).forEach(function (k) {
    var s = seen[k], t = (typeof LEAGUE_TEAMS !== "undefined") ? LEAGUE_TEAMS[s.id] : null;
    var pot = 4;
    if (t) {
      if (season2025 && t.p25 && t.p25.league === s.league) pot = t.p25.pot;
      else if (t.league === s.league) pot = t.pot;
    }
    var tier = (inCL[s.id] && typeof CL_TIER !== "undefined") ? (CL_TIER[s.id] || 3) : 0;
    var base = FP_POT_PRICE[pot] + (tier ? FP_CL_PRICE[tier] : 0);
    pool[s.id] = { id: s.id, name: t ? t.name : s.short, league: s.league, pot: pot, clTier: tier, base: base };
  });
  return pool;
}

// ── Points for one club in one settled match (0 if not involved / unsettled).
function fpMatchPoints(m, id) {
  if (!lgIsSettled(m)) return 0;
  var home = m.homeTeam && m.homeTeam.id === id, away = m.awayTeam && m.awayTeam.id === id;
  if (!home && !away) return 0;
  var ft = (m.score && m.score.fullTime) || {};
  var g = (home ? ft.home : ft.away) || 0, a = (home ? ft.away : ft.home) || 0;
  var P = FP_POINTS, pts = 0;
  if (g > a) pts += P.win; else if (g === a) pts += P.draw;
  pts += g * P.goal;
  if (a === 0) pts += P.cleanSheet;
  if (a >= 3) pts += P.concede3;
  if (g - a >= 3) pts += P.bigWin;
  if (g > a && m.competition && m.competition.code === "CL") pts += P.clWin;
  return pts;
}
// Short breakdown text for one match, e.g. "W 3–0 · +3 win +3 goals +2 CS +1 big".
function fpMatchBreakdown(m, id) {
  var home = m.homeTeam.id === id, ft = (m.score && m.score.fullTime) || {};
  var g = (home ? ft.home : ft.away) || 0, a = (home ? ft.away : ft.home) || 0, P = FP_POINTS, bits = [];
  if (g > a) bits.push("+" + P.win + " win"); else if (g === a) bits.push("+" + P.draw + " draw");
  if (g) bits.push("+" + g * P.goal + " goal" + (g > 1 ? "s" : ""));
  if (a === 0) bits.push("+" + P.cleanSheet + " clean sheet");
  if (a >= 3) bits.push(P.concede3 + " leaky");
  if (g - a >= 3) bits.push("+" + P.bigWin + " big win");
  if (g > a && m.competition && m.competition.code === "CL") bits.push("+" + P.clWin + " CL win");
  return bits.join(" · ");
}

// ── Gameweek context: weeks, per-club per-GW points + matches, price timeline.
// Built once per data load. ctx = { weeks, pool, gwPts[gw][id], gwMatches[gw][id],
// played[gw][id], price[gw][id] (price at GW deadline, i.e. before it), deadline[gw] }.
function fpContext(matches, season2025) {
  var weeks = typeof lgWeeks === "function" ? lgWeeks(matches) : [];
  var pool = fpPool(matches, season2025);
  var ids = Object.keys(pool).map(Number);
  var gwPts = [], gwMatches = [], deadline = [];
  var relevant = matches.filter(function (m) {
    return m.competition && (m.competition.code === "CL" || (FP_LEAGUES.indexOf(m.competition.code) !== -1 && m.stage === "REGULAR_SEASON"));
  });
  weeks.forEach(function (w, gi) {
    var pts = {}, ms = {}, first = null;
    relevant.forEach(function (m) {
      var d = m.utcDate.slice(0, 10);
      if (d < w.start || d >= w.end) return;
      if (first === null || m.utcDate < first) first = m.utcDate;
      [m.homeTeam.id, m.awayTeam.id].forEach(function (id) {
        if (!pool[id]) return;
        (ms[id] = ms[id] || []).push(m);
        pts[id] = (pts[id] || 0) + fpMatchPoints(m, id);
      });
    });
    gwPts[gi] = pts; gwMatches[gi] = ms; deadline[gi] = first || (w.start + "T00:00:00Z");
  });
  // Elo → price timeline. price[gi] = price at GW gi's deadline.
  var eloStart = {}, elo = {};
  ids.forEach(function (id) { eloStart[id] = elo[id] = 1500 + (2.5 - pool[id].pot) * 80; });
  var oppElo = function (id) {
    if (elo[id] != null) return elo[id];
    var tier = (typeof CL_TIER !== "undefined" && CL_TIER[id]) || 3;
    return 1500 + (2.5 - tier) * 80;
  };
  var price = [], cur = {};
  ids.forEach(function (id) { cur[id] = pool[id].base; });
  var settledSorted = relevant.filter(lgIsSettled).slice().sort(function (a, b) { return a.utcDate.localeCompare(b.utcDate); });
  var mi = 0;
  weeks.forEach(function (w, gi) {
    price[gi] = {}; ids.forEach(function (id) { price[gi][id] = cur[id]; });
    // play this GW's results into Elo, then move prices for the next deadline
    while (mi < settledSorted.length && settledSorted[mi].utcDate.slice(0, 10) < w.end) {
      var m = settledSorted[mi++], h = m.homeTeam.id, a = m.awayTeam.id;
      var ft = (m.score && m.score.fullTime) || {}, hs = ft.home || 0, as = ft.away || 0;
      var rh = oppElo(h), ra = oppElo(a);
      var exp = 1 / (1 + Math.pow(10, (ra - rh - 50) / 400));
      var res = hs > as ? 1 : hs === as ? 0.5 : 0;
      var k = 24 * (1 + Math.min(2, Math.abs(hs - as)) * 0.25);
      if (elo[h] != null) elo[h] += k * (res - exp);
      if (elo[a] != null) elo[a] -= k * (res - exp);
    }
    ids.forEach(function (id) {
      var target = pool[id].base + Math.round((elo[id] - eloStart[id]) / FP_ELO_PER_TENTH);
      var step = Math.max(-FP_MAX_MOVE, Math.min(FP_MAX_MOVE, target - cur[id]));
      cur[id] = Math.max(FP_MIN_PRICE, cur[id] + step);
    });
  });
  return { weeks: weeks, pool: pool, gwPts: gwPts, gwMatches: gwMatches, price: price, deadline: deadline };
}

// FPL selling price: keep half of any rise (rounded down), all of any fall.
function fpSellPrice(bought, now) { return now <= bought ? now : bought + Math.floor((now - bought) / 2); }

// ── Validate a set of picks for GW gi. Returns [] or a list of error strings.
// picks = { squad:[ids], xi:[ids], bench:[ids], captain, vice, chip }
function fpValidate(ctx, picks) {
  var e = [], pool = ctx.pool, sq = picks.squad || [];
  if (sq.length !== FP_SQUAD) e.push("Pick " + FP_SQUAD + " clubs (" + sq.length + " so far).");
  var per = {};
  sq.forEach(function (id) { var t = pool[id]; if (!t) e.push("Unknown club " + id); else per[t.league] = (per[t.league] || 0) + 1; });
  FP_LEAGUES.forEach(function (L) {
    if ((per[L] || 0) !== FP_PER_LEAGUE) e.push("Need exactly " + FP_PER_LEAGUE + " from " + (LEAGUE_COMPETITIONS[L] ? LEAGUE_COMPETITIONS[L].label : L) + " (" + (per[L] || 0) + ").");
  });
  if (new Set(sq).size !== sq.length) e.push("A club is in the squad twice.");
  var xi = picks.xi || [], bench = picks.bench || [];
  if (xi.length !== FP_XI) e.push("Starting XI needs " + FP_XI + " clubs.");
  if (bench.length !== FP_SQUAD - FP_XI) e.push("Bench needs " + (FP_SQUAD - FP_XI) + " clubs.");
  var xiPer = {};
  xi.forEach(function (id) { if (pool[id]) xiPer[pool[id].league] = (xiPer[pool[id].league] || 0) + 1; });
  FP_LEAGUES.forEach(function (L) { if ((xiPer[L] || 0) < FP_MIN_XI_PER_LEAGUE) e.push("Start at least " + FP_MIN_XI_PER_LEAGUE + " from " + (LEAGUE_COMPETITIONS[L] ? LEAGUE_COMPETITIONS[L].label : L) + "."); });
  if (xi.indexOf(picks.captain) === -1) e.push("Captain must be in the starting XI.");
  if (xi.indexOf(picks.vice) === -1 || picks.vice === picks.captain) e.push("Vice-captain must be another starter.");
  return e;
}

// ── Auto-subs + captaincy for one GW. Returns { pts, lines:[{id, pts, mult,
// role:'xi'|'bench'|'subIn'|'subOut', played}], subs:[[out,in]], capUsed }.
function fpScoreGw(ctx, gi, picks) {
  var pts = ctx.gwPts[gi] || {}, ms = ctx.gwMatches[gi] || {}, pool = ctx.pool;
  var played = function (id) { return !!(ms[id] && ms[id].some(lgIsSettled)); };
  var xi = picks.xi.slice(), bench = picks.bench.slice(), subs = [];
  var bb = picks.chip === "BB";
  if (!bb) {
    var leagueCount = function (arr, L) { return arr.filter(function (id) { return pool[id] && pool[id].league === L; }).length; };
    xi.slice().forEach(function (out) {
      if (played(out)) return;
      for (var b = 0; b < bench.length; b++) {
        var inn = bench[b];
        if (!played(inn)) continue;
        var trial = xi.map(function (x) { return x === out ? inn : x; });
        var ok = FP_LEAGUES.every(function (L) { return leagueCount(trial, L) >= FP_MIN_XI_PER_LEAGUE; });
        if (!ok) continue;
        xi = trial; bench.splice(b, 1); bench.push(out); subs.push([out, inn]);
        break;
      }
    });
  }
  var cap = played(picks.captain) && xi.indexOf(picks.captain) !== -1 ? picks.captain
    : (played(picks.vice) && xi.indexOf(picks.vice) !== -1 ? picks.vice : null);
  var capMult = picks.chip === "TC" ? 3 : 2;
  var counted = bb ? xi.concat(bench) : xi, total = 0, lines = [];
  counted.forEach(function (id) {
    var mult = id === cap ? capMult : 1, p = (pts[id] || 0) * mult;
    total += p;
    lines.push({ id: id, pts: p, raw: pts[id] || 0, mult: mult, played: played(id),
      role: subs.some(function (s) { return s[1] === id; }) ? "subIn" : (xi.indexOf(id) !== -1 ? "xi" : "bench") });
  });
  if (!bb) bench.forEach(function (id) { lines.push({ id: id, pts: 0, raw: pts[id] || 0, mult: 0, played: played(id), role: subs.some(function (s) { return s[0] === id; }) ? "subOut" : "bench" }); });
  return { pts: total, lines: lines, subs: subs, capUsed: cap };
}

// ── Replay a manager's whole history. entries[gi] = picks for GW gi, or
// null/undefined = carry the last (non-Free-Hit) picks forward unchanged.
// Tracks holdings {id: purchase price}, bank, free transfers, chips. For each
// GW: transfers, hits, bank, points (after auto-subs/captaincy/chips), running
// total, and validation errors (budget, squad rules, chip misuse). Free Hit
// changes the squad for that GW only — holdings, bank and FTs are untouched.
function fpReplay(ctx, entries, upTo) {
  var out = [], bank = FP_BUDGET, ft = 1, holdings = null, last = null, total = 0, chipsUsed = {};
  var half = Math.floor(ctx.weeks.length / 2);
  for (var gi = 0; gi < upTo; gi++) {
    var pk = entries[gi] ? JSON.parse(JSON.stringify(entries[gi])) : (last ? Object.assign(JSON.parse(JSON.stringify(last)), { chip: null }) : null);
    if (!pk) { out.push(null); continue; }
    var price = ctx.price[gi] || {};
    var base = holdings ? Object.keys(holdings).map(Number) : [];
    var outs = base.filter(function (id) { return pk.squad.indexOf(id) === -1; });
    var ins = pk.squad.filter(function (id) { return base.indexOf(id) === -1; });
    var errors = [];
    var b2 = bank;
    outs.forEach(function (id) { b2 += fpSellPrice(holdings[id], price[id]); });
    ins.forEach(function (id) { b2 -= (price[id] || 0); });
    var nT = holdings ? ins.length : 0;
    var isWC = pk.chip === "WC1" || pk.chip === "WC2", isFH = pk.chip === "FH";
    var hits = (!holdings || isWC || isFH) ? 0 : Math.max(0, nT - ft) * FP_HIT;
    if (b2 < 0) errors.push("Over budget by " + fpMoney(-b2) + ".");
    if (pk.chip && chipsUsed[pk.chip] != null) errors.push(FP_CHIPS[pk.chip] + " already used in GW" + (chipsUsed[pk.chip] + 1) + ".");
    if (pk.chip === "WC1" && gi >= half) errors.push("First Wildcard is for the first half of the season.");
    if (pk.chip === "WC2" && gi < half) errors.push("Second Wildcard opens in the second half.");
    if (pk.chip && !FP_CHIPS[pk.chip]) errors.push("Unknown chip.");
    errors = errors.concat(fpValidate(ctx, pk));
    var sc = fpScoreGw(ctx, gi, pk);
    var gwPts = sc.pts - hits;
    total += gwPts;
    out.push({ gi: gi, picks: pk, transfers: nT, ins: ins, outs: outs, ftBefore: holdings ? ft : null, hits: hits,
      bank: isFH ? bank : b2, raw: sc.pts, pts: gwPts, total: total, lines: sc.lines, subs: sc.subs, capUsed: sc.capUsed, errors: errors });
    if (pk.chip) chipsUsed[pk.chip] = gi;
    if (isFH) continue; // Free Hit: nothing carries over
    // commit transfers
    var newH = {};
    pk.squad.forEach(function (id) { newH[id] = (holdings && holdings[id] != null) ? holdings[id] : (price[id] || 0); });
    if (holdings) ft = isWC ? ft : Math.min(FP_MAX_FT, Math.max(0, ft - nT) + 1);
    holdings = newH; bank = b2; last = pk;
  }
  return { gws: out, total: total, bank: bank, ft: ft, chipsUsed: chipsUsed, holdings: holdings || {}, last: last };
}

// Squad value at GW gi (current selling value, as FPL shows).
function fpSquadValue(ctx, gi, squad, holdings) {
  var price = ctx.price[Math.min(gi, ctx.price.length - 1)] || {}, v = 0;
  squad.forEach(function (id) { v += holdings && holdings[id] != null ? fpSellPrice(holdings[id], price[id]) : price[id]; });
  return v;
}

// ── Auto-pick a valid squad under budget for GW gi (for "Auto pick" and tests):
// per league, greedy best value (base price vs. form) while fitting the budget.
function fpAutoPick(ctx, gi, seed) {
  var price = ctx.price[gi] || {}, pool = ctx.pool, rng = (typeof lgMulberry32 === "function") ? lgMulberry32(seed || 7) : Math.random;
  var squad = [];
  // target ~£6.6m average: in each league take one premium, one mid, one budget
  FP_LEAGUES.forEach(function (L) {
    var clubs = Object.keys(pool).map(Number).filter(function (id) { return pool[id].league === L; })
      .sort(function (a, b) { return price[b] - price[a]; });
    var hi = clubs.slice(0, Math.max(1, Math.floor(clubs.length / 4)));
    var mid = clubs.slice(Math.floor(clubs.length / 4), Math.floor(clubs.length * 3 / 4));
    var lo = clubs.slice(Math.floor(clubs.length * 3 / 4));
    [hi, mid, lo].forEach(function (band) { if (band.length) squad.push(band[Math.floor(rng() * band.length)]); });
  });
  // downgrade most expensive picks until within budget
  var cost = function () { return squad.reduce(function (s, id) { return s + price[id]; }, 0); };
  var guard = 0;
  while (cost() > FP_BUDGET && guard++ < 50) {
    var dear = squad.slice().sort(function (a, b) { return price[b] - price[a]; })[0];
    var L = pool[dear].league;
    var cheaper = Object.keys(pool).map(Number).filter(function (id) { return pool[id].league === L && squad.indexOf(id) === -1 && price[id] < price[dear]; })
      .sort(function (a, b) { return price[b] - price[a]; });
    if (!cheaper.length) break;
    squad[squad.indexOf(dear)] = cheaper[0];
  }
  return fpDefaultLineup(ctx, gi, squad);
}
// Default XI/bench/captaincy for a squad: per league start the 2 priciest,
// plus the next-priciest club overall; captain = priciest starter.
function fpDefaultLineup(ctx, gi, squad) {
  var price = ctx.price[gi] || {}, pool = ctx.pool, xi = [], rest = [];
  FP_LEAGUES.forEach(function (L) {
    var mine = squad.filter(function (id) { return pool[id] && pool[id].league === L; }).sort(function (a, b) { return price[b] - price[a]; });
    xi = xi.concat(mine.slice(0, FP_MIN_XI_PER_LEAGUE)); rest = rest.concat(mine.slice(FP_MIN_XI_PER_LEAGUE));
  });
  rest.sort(function (a, b) { return price[b] - price[a]; });
  while (xi.length < FP_XI && rest.length) xi.push(rest.shift());
  var byPrice = xi.slice().sort(function (a, b) { return price[b] - price[a]; });
  return { squad: squad.slice(), xi: xi, bench: rest, captain: byPrice[0], vice: byPrice[1], chip: null };
}
