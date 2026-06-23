// ═════════════════════════════════════════════════════════════════════════════
// scoring.js — SHARED scoring/data logic for the Sweepstakes app
//
// This file is the single source of truth for:
//   - player/team assignments (PLAYERS, POT)
//   - the points matrices (PTS_INC, GROUP_WIN_PTS, GROUP_DRAW_PTS)
//   - all pure derive*/score* functions (deriveStages, deriveWDL, scorePlayers,
//     deriveGroupPts, deriveHistory, deriveSparklineHistory, computeBadges,
//     simulateWinProbability, goalDroughtPts, etc.)
//
// It is used by BOTH:
//   1. index.html — loaded as a plain <script src="scoring.js"></script> before
//      the Babel-compiled app script. Everything below attaches to the global
//      scope exactly as it always has, so the app code is unchanged.
//   2. The email Worker (worker-email.js) — loaded via `import` as an ES module,
//      so the daily digest email uses the EXACT SAME scoring logic as the app.
//      No duplicated logic, no risk of the email and the app disagreeing on
//      anyone's points.
//
// If you change scoring rules, pot values, player assignments, or add a new
// badge — change it here ONCE and both the app and the email pick it up.
//
// DO NOT edit index.html's old inline copy of this logic — it has been removed
// from index.html, which now loads this file instead. If you're looking for
// PLAYERS, POT, PTS_INC, scorePlayers, etc. — they live here now.
// ═════════════════════════════════════════════════════════════════════════════

var WORKER_URL = "https://football-proxy.joshmacklin7.workers.dev";
var WC_CODE = "WC";
var SEASON = 2026;

// DEV_MODE is now controlled via UI toggle — default off
var DEV_MODE_DEFAULT = false;

var MOCK_MATCHES = [
  // ═══════════════════════════════════════════════════════════════
  // GROUP STAGE — all 12 groups complete (3 games each)
  // Scenario: mid Last 16
  // ═══════════════════════════════════════════════════════════════

  // GROUP A: Mexico(1st), South Korea(2nd), South Africa(3rd/best3rd), Czech Republic(out)
  { id:1,  status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-11T19:00:00Z", homeTeam:{name:"Mexico",tla:"MEX"}, awayTeam:{name:"South Africa",tla:"RSA"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:2,  status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-11T22:00:00Z", homeTeam:{name:"South Korea",tla:"KOR"}, awayTeam:{name:"Czech Republic",tla:"CZE"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:3,  status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-17T19:00:00Z", homeTeam:{name:"Mexico",tla:"MEX"}, awayTeam:{name:"Czech Republic",tla:"CZE"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:4,  status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-17T22:00:00Z", homeTeam:{name:"South Africa",tla:"RSA"}, awayTeam:{name:"South Korea",tla:"KOR"}, score:{fullTime:{home:0,away:2}, penalties:null} },
  { id:5,  status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-23T19:00:00Z", homeTeam:{name:"Mexico",tla:"MEX"}, awayTeam:{name:"South Korea",tla:"KOR"}, score:{fullTime:{home:1,away:1}, penalties:null} },
  { id:6,  status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-23T19:00:00Z", homeTeam:{name:"Czech Republic",tla:"CZE"}, awayTeam:{name:"South Africa",tla:"RSA"}, score:{fullTime:{home:1,away:2}, penalties:null} },

  // GROUP B: Canada(1st), Switzerland(2nd), Qatar(out), Bosnia(out)
  { id:7,  status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-12T00:00:00Z", homeTeam:{name:"Canada",tla:"CAN"}, awayTeam:{name:"Bosnia-Herzegovina",tla:"BIH"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:8,  status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-12T03:00:00Z", homeTeam:{name:"Qatar",tla:"QAT"}, awayTeam:{name:"Switzerland",tla:"SUI"}, score:{fullTime:{home:0,away:3}, penalties:null} },
  { id:9,  status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-18T00:00:00Z", homeTeam:{name:"Canada",tla:"CAN"}, awayTeam:{name:"Qatar",tla:"QAT"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:10, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-18T03:00:00Z", homeTeam:{name:"Switzerland",tla:"SUI"}, awayTeam:{name:"Bosnia-Herzegovina",tla:"BIH"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:11, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-24T00:00:00Z", homeTeam:{name:"Canada",tla:"CAN"}, awayTeam:{name:"Switzerland",tla:"SUI"}, score:{fullTime:{home:1,away:1}, penalties:null} },
  { id:12, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-24T00:00:00Z", homeTeam:{name:"Qatar",tla:"QAT"}, awayTeam:{name:"Bosnia-Herzegovina",tla:"BIH"}, score:{fullTime:{home:0,away:0}, penalties:null} },

  // GROUP C: Brazil(1st), Morocco(2nd), Scotland(3rd/best3rd), Haiti(out)
  { id:13, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-13T22:00:00Z", homeTeam:{name:"Brazil",tla:"BRA"}, awayTeam:{name:"Morocco",tla:"MAR"}, score:{fullTime:{home:1,away:1}, penalties:null} },
  { id:14, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-14T01:00:00Z", homeTeam:{name:"Haiti",tla:"HAI"}, awayTeam:{name:"Scotland",tla:"SCO"}, score:{fullTime:{home:0,away:1}, penalties:null} },
  { id:15, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-20T22:00:00Z", homeTeam:{name:"Brazil",tla:"BRA"}, awayTeam:{name:"Haiti",tla:"HAI"}, score:{fullTime:{home:4,away:0}, penalties:null} },
  { id:16, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-21T01:00:00Z", homeTeam:{name:"Morocco",tla:"MAR"}, awayTeam:{name:"Scotland",tla:"SCO"}, score:{fullTime:{home:1,away:2}, penalties:null} },
  { id:17, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-26T22:00:00Z", homeTeam:{name:"Brazil",tla:"BRA"}, awayTeam:{name:"Scotland",tla:"SCO"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:18, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-26T22:00:00Z", homeTeam:{name:"Morocco",tla:"MAR"}, awayTeam:{name:"Haiti",tla:"HAI"}, score:{fullTime:{home:3,away:0}, penalties:null} },

  // GROUP D: USA(1st), Australia(2nd), Turkey(out), Paraguay(out)
  { id:19, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-12T00:00:00Z", homeTeam:{name:"USA",tla:"USA"}, awayTeam:{name:"Paraguay",tla:"PAR"}, score:{fullTime:{home:4,away:1}, penalties:null} },
  { id:20, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-14T04:00:00Z", homeTeam:{name:"Australia",tla:"AUS"}, awayTeam:{name:"Turkey",tla:"TUR"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:21, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-18T22:00:00Z", homeTeam:{name:"USA",tla:"USA"}, awayTeam:{name:"Australia",tla:"AUS"}, score:{fullTime:{home:1,away:1}, penalties:null} },
  { id:22, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-19T01:00:00Z", homeTeam:{name:"Paraguay",tla:"PAR"}, awayTeam:{name:"Turkey",tla:"TUR"}, score:{fullTime:{home:0,away:1}, penalties:null} },
  { id:23, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-25T22:00:00Z", homeTeam:{name:"USA",tla:"USA"}, awayTeam:{name:"Turkey",tla:"TUR"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:24, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-25T22:00:00Z", homeTeam:{name:"Australia",tla:"AUS"}, awayTeam:{name:"Paraguay",tla:"PAR"}, score:{fullTime:{home:2,away:0}, penalties:null} },

  // GROUP E: Germany(1st), Ecuador(2nd), Ivory Coast(out), Curacao(out)
  { id:25, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-14T19:00:00Z", homeTeam:{name:"Germany",tla:"GER"}, awayTeam:{name:"Curaçao",tla:"CUW"}, score:{fullTime:{home:4,away:1}, penalties:null} },
  { id:26, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-15T01:00:00Z", homeTeam:{name:"Ivory Coast",tla:"CIV"}, awayTeam:{name:"Ecuador",tla:"ECU"}, score:{fullTime:{home:0,away:2}, penalties:null} },
  { id:27, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-21T01:00:00Z", homeTeam:{name:"Germany",tla:"GER"}, awayTeam:{name:"Ivory Coast",tla:"CIV"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:28, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-21T04:00:00Z", homeTeam:{name:"Ecuador",tla:"ECU"}, awayTeam:{name:"Curaçao",tla:"CUW"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:29, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-27T01:00:00Z", homeTeam:{name:"Germany",tla:"GER"}, awayTeam:{name:"Ecuador",tla:"ECU"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:30, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-27T01:00:00Z", homeTeam:{name:"Curaçao",tla:"CUW"}, awayTeam:{name:"Ivory Coast",tla:"CIV"}, score:{fullTime:{home:0,away:1}, penalties:null} },

  // GROUP F: Netherlands(1st), Sweden(2nd), Japan(out), Tunisia(out)
  { id:31, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-14T22:00:00Z", homeTeam:{name:"Netherlands",tla:"NED"}, awayTeam:{name:"Japan",tla:"JPN"}, score:{fullTime:{home:3,away:1}, penalties:null} },
  { id:32, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-15T01:00:00Z", homeTeam:{name:"Tunisia",tla:"TUN"}, awayTeam:{name:"Sweden",tla:"SWE"}, score:{fullTime:{home:0,away:2}, penalties:null} },
  { id:33, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-21T19:00:00Z", homeTeam:{name:"Netherlands",tla:"NED"}, awayTeam:{name:"Tunisia",tla:"TUN"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:34, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-21T22:00:00Z", homeTeam:{name:"Sweden",tla:"SWE"}, awayTeam:{name:"Japan",tla:"JPN"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:35, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-27T19:00:00Z", homeTeam:{name:"Netherlands",tla:"NED"}, awayTeam:{name:"Sweden",tla:"SWE"}, score:{fullTime:{home:2,away:2}, penalties:null} },
  { id:36, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-27T19:00:00Z", homeTeam:{name:"Japan",tla:"JPN"}, awayTeam:{name:"Tunisia",tla:"TUN"}, score:{fullTime:{home:1,away:0}, penalties:null} },

  // GROUP G: Belgium(1st), Iran(2nd), Egypt(out), New Zealand(out)
  { id:37, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-15T19:00:00Z", homeTeam:{name:"Belgium",tla:"BEL"}, awayTeam:{name:"Egypt",tla:"EGY"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:38, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-15T22:00:00Z", homeTeam:{name:"Iran",tla:"IRN"}, awayTeam:{name:"New Zealand",tla:"NZL"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:39, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-21T19:00:00Z", homeTeam:{name:"Belgium",tla:"BEL"}, awayTeam:{name:"Iran",tla:"IRN"}, score:{fullTime:{home:1,away:1}, penalties:null} },
  { id:40, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-21T22:00:00Z", homeTeam:{name:"Egypt",tla:"EGY"}, awayTeam:{name:"New Zealand",tla:"NZL"}, score:{fullTime:{home:1,away:0}, penalties:null} },
  { id:41, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-27T19:00:00Z", homeTeam:{name:"Belgium",tla:"BEL"}, awayTeam:{name:"New Zealand",tla:"NZL"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:42, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-27T19:00:00Z", homeTeam:{name:"Iran",tla:"IRN"}, awayTeam:{name:"Egypt",tla:"EGY"}, score:{fullTime:{home:2,away:0}, penalties:null} },

  // GROUP H: Spain(1st), Uruguay(2nd), Cape Verde(out), Saudi Arabia(out)
  { id:43, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-15T19:00:00Z", homeTeam:{name:"Spain",tla:"ESP"}, awayTeam:{name:"Cape Verde",tla:"CPV"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:44, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-15T22:00:00Z", homeTeam:{name:"Saudi Arabia",tla:"KSA"}, awayTeam:{name:"Uruguay",tla:"URU"}, score:{fullTime:{home:0,away:2}, penalties:null} },
  { id:45, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-21T22:00:00Z", homeTeam:{name:"Spain",tla:"ESP"}, awayTeam:{name:"Saudi Arabia",tla:"KSA"}, score:{fullTime:{home:4,away:0}, penalties:null} },
  { id:46, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-22T01:00:00Z", homeTeam:{name:"Uruguay",tla:"URU"}, awayTeam:{name:"Cape Verde",tla:"CPV"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:47, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-27T22:00:00Z", homeTeam:{name:"Spain",tla:"ESP"}, awayTeam:{name:"Uruguay",tla:"URU"}, score:{fullTime:{home:1,away:1}, penalties:null} },
  { id:48, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-27T22:00:00Z", homeTeam:{name:"Cape Verde",tla:"CPV"}, awayTeam:{name:"Saudi Arabia",tla:"KSA"}, score:{fullTime:{home:0,away:0}, penalties:null} },

  // GROUP I: France(1st), Norway(2nd), Senegal(out), Iraq(out)
  { id:49, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-16T19:00:00Z", homeTeam:{name:"France",tla:"FRA"}, awayTeam:{name:"Senegal",tla:"SEN"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:50, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-16T22:00:00Z", homeTeam:{name:"Norway",tla:"NOR"}, awayTeam:{name:"Iraq",tla:"IRQ"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:51, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-22T19:00:00Z", homeTeam:{name:"France",tla:"FRA"}, awayTeam:{name:"Iraq",tla:"IRQ"}, score:{fullTime:{home:4,away:0}, penalties:null} },
  { id:52, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-22T22:00:00Z", homeTeam:{name:"Norway",tla:"NOR"}, awayTeam:{name:"Senegal",tla:"SEN"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:53, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-28T19:00:00Z", homeTeam:{name:"France",tla:"FRA"}, awayTeam:{name:"Norway",tla:"NOR"}, score:{fullTime:{home:1,away:1}, penalties:null} },
  { id:54, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-28T19:00:00Z", homeTeam:{name:"Senegal",tla:"SEN"}, awayTeam:{name:"Iraq",tla:"IRQ"}, score:{fullTime:{home:2,away:0}, penalties:null} },

  // GROUP J: Argentina(1st), Austria(2nd), Algeria(out), Jordan(out)
  { id:55, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-16T19:00:00Z", homeTeam:{name:"Argentina",tla:"ARG"}, awayTeam:{name:"Algeria",tla:"ALG"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:56, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-16T22:00:00Z", homeTeam:{name:"Austria",tla:"AUT"}, awayTeam:{name:"Jordan",tla:"JOR"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:57, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-22T19:00:00Z", homeTeam:{name:"Argentina",tla:"ARG"}, awayTeam:{name:"Jordan",tla:"JOR"}, score:{fullTime:{home:4,away:0}, penalties:null} },
  { id:58, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-22T22:00:00Z", homeTeam:{name:"Austria",tla:"AUT"}, awayTeam:{name:"Algeria",tla:"ALG"}, score:{fullTime:{home:1,away:1}, penalties:null} },
  { id:59, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-28T19:00:00Z", homeTeam:{name:"Argentina",tla:"ARG"}, awayTeam:{name:"Austria",tla:"AUT"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:60, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-28T19:00:00Z", homeTeam:{name:"Algeria",tla:"ALG"}, awayTeam:{name:"Jordan",tla:"JOR"}, score:{fullTime:{home:1,away:0}, penalties:null} },

  // GROUP K: Portugal(1st), Colombia(2nd), Uzbekistan(out), Congo DR(out)
  { id:61, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-17T19:00:00Z", homeTeam:{name:"Portugal",tla:"POR"}, awayTeam:{name:"Uzbekistan",tla:"UZB"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:62, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-17T22:00:00Z", homeTeam:{name:"Colombia",tla:"COL"}, awayTeam:{name:"DR Congo",tla:"DRC"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:63, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-23T19:00:00Z", homeTeam:{name:"Portugal",tla:"POR"}, awayTeam:{name:"DR Congo",tla:"DRC"}, score:{fullTime:{home:4,away:0}, penalties:null} },
  { id:64, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-23T22:00:00Z", homeTeam:{name:"Colombia",tla:"COL"}, awayTeam:{name:"Uzbekistan",tla:"UZB"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:65, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-29T19:00:00Z", homeTeam:{name:"Portugal",tla:"POR"}, awayTeam:{name:"Colombia",tla:"COL"}, score:{fullTime:{home:1,away:1}, penalties:null} },
  { id:66, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-29T19:00:00Z", homeTeam:{name:"Uzbekistan",tla:"UZB"}, awayTeam:{name:"DR Congo",tla:"DRC"}, score:{fullTime:{home:1,away:0}, penalties:null} },

  // GROUP L: England(1st), Croatia(2nd), Ghana(out), Panama(out)
  { id:67, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-17T19:00:00Z", homeTeam:{name:"England",tla:"ENG"}, awayTeam:{name:"Croatia",tla:"CRO"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:68, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-17T22:00:00Z", homeTeam:{name:"Ghana",tla:"GHA"}, awayTeam:{name:"Panama",tla:"PAN"}, score:{fullTime:{home:1,away:1}, penalties:null} },
  { id:69, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-23T19:00:00Z", homeTeam:{name:"England",tla:"ENG"}, awayTeam:{name:"Ghana",tla:"GHA"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:70, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-23T22:00:00Z", homeTeam:{name:"Croatia",tla:"CRO"}, awayTeam:{name:"Panama",tla:"PAN"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:71, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-29T19:00:00Z", homeTeam:{name:"England",tla:"ENG"}, awayTeam:{name:"Panama",tla:"PAN"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:72, status:"FINISHED", stage:"GROUP_STAGE", utcDate:"2026-06-29T19:00:00Z", homeTeam:{name:"Croatia",tla:"CRO"}, awayTeam:{name:"Ghana",tla:"GHA"}, score:{fullTime:{home:2,away:0}, penalties:null} },

  // ═══════════════════════════════════════════════════════════════
  // LAST 32 — all 16 games finished, everyone who qualifies advances
  // ═══════════════════════════════════════════════════════════════
  // Results chosen to advance key sweepstake teams to Last 16
  // Each of the 32 R32 teams appears exactly once. Consecutive pairs (1&2, 3&4...)
  // feed the correspondingly-numbered Last 16 match below, so the bracket tree
  // is structurally valid (no team ever appears twice in the same round).
  { id:200, status:"FINISHED", stage:"LAST_32", utcDate:"2026-06-30T19:00:00Z", homeTeam:{name:"Germany",tla:"GER"}, awayTeam:{name:"Austria",tla:"AUT"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:201, status:"FINISHED", stage:"LAST_32", utcDate:"2026-06-30T22:00:00Z", homeTeam:{name:"Mexico",tla:"MEX"}, awayTeam:{name:"Ivory Coast",tla:"CIV"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:202, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-01T19:00:00Z", homeTeam:{name:"Argentina",tla:"ARG"}, awayTeam:{name:"Croatia",tla:"CRO"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:203, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-01T22:00:00Z", homeTeam:{name:"Belgium",tla:"BEL"}, awayTeam:{name:"Ecuador",tla:"ECU"}, score:{fullTime:{home:1,away:0}, penalties:null} },
  { id:204, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-02T19:00:00Z", homeTeam:{name:"France",tla:"FRA"}, awayTeam:{name:"Egypt",tla:"EGY"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:205, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-02T22:00:00Z", homeTeam:{name:"Morocco",tla:"MAR"}, awayTeam:{name:"Ghana",tla:"GHA"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:206, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-03T19:00:00Z", homeTeam:{name:"England",tla:"ENG"}, awayTeam:{name:"Iran",tla:"IRN"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:207, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-03T22:00:00Z", homeTeam:{name:"Spain",tla:"ESP"}, awayTeam:{name:"Japan",tla:"JPN"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:208, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-04T19:00:00Z", homeTeam:{name:"Portugal",tla:"POR"}, awayTeam:{name:"South Korea",tla:"KOR"}, score:{fullTime:{home:3,away:1}, penalties:null} },
  { id:209, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-04T22:00:00Z", homeTeam:{name:"Colombia",tla:"COL"}, awayTeam:{name:"Norway",tla:"NOR"}, score:{fullTime:{home:1,away:0}, penalties:null} },
  { id:210, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-05T19:00:00Z", homeTeam:{name:"Brazil",tla:"BRA"}, awayTeam:{name:"Paraguay",tla:"PAR"}, score:{fullTime:{home:3,away:0}, penalties:null} },
  { id:211, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-05T22:00:00Z", homeTeam:{name:"Netherlands",tla:"NED"}, awayTeam:{name:"South Africa",tla:"RSA"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:212, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-06T19:00:00Z", homeTeam:{name:"USA",tla:"USA"}, awayTeam:{name:"Scotland",tla:"SCO"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:213, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-06T22:00:00Z", homeTeam:{name:"Canada",tla:"CAN"}, awayTeam:{name:"Switzerland",tla:"SUI"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:214, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-07T19:00:00Z", homeTeam:{name:"Australia",tla:"AUS"}, awayTeam:{name:"Uruguay",tla:"URU"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:215, status:"FINISHED", stage:"LAST_32", utcDate:"2026-07-07T22:00:00Z", homeTeam:{name:"Sweden",tla:"SWE"}, awayTeam:{name:"Uzbekistan",tla:"UZB"}, score:{fullTime:{home:1,away:0}, penalties:null} },

  // ═══════════════════════════════════════════════════════════════
  // LAST 16 — 4 done, 1 live, 3 scheduled
  // 16 teams, each appearing exactly once, each one a genuine R32 winner above.
  // ═══════════════════════════════════════════════════════════════
  // GER through, MEX out — George loses Mexico
  { id:300, status:"FINISHED", stage:"LAST_16", utcDate:"2026-07-08T19:00:00Z", homeTeam:{name:"Germany",tla:"GER"}, awayTeam:{name:"Mexico",tla:"MEX"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  // ARG through, BEL out — Toby's Argentina through, Paul loses Belgium
  { id:301, status:"FINISHED", stage:"LAST_16", utcDate:"2026-07-08T22:00:00Z", homeTeam:{name:"Argentina",tla:"ARG"}, awayTeam:{name:"Belgium",tla:"BEL"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  // FRA through, MAR out — Christoph's France through, Auz loses Morocco
  { id:302, status:"FINISHED", stage:"LAST_16", utcDate:"2026-07-09T19:00:00Z", homeTeam:{name:"France",tla:"FRA"}, awayTeam:{name:"Morocco",tla:"MAR"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  // ENG through, ESP out — Elliott's England through, Paul loses Spain
  { id:303, status:"FINISHED", stage:"LAST_16", utcDate:"2026-07-09T22:00:00Z", homeTeam:{name:"England",tla:"ENG"}, awayTeam:{name:"Spain",tla:"ESP"}, score:{fullTime:{home:2,away:1}, penalties:null} },

  // Portugal through, Colombia out — Auz's Portugal advances, Dollie's Colombia knocked out
  { id:399, status:"FINISHED", stage:"LAST_16", utcDate:"2026-07-10T19:00:00Z",
    homeTeam:{name:"Portugal",tla:"POR"}, awayTeam:{name:"Colombia",tla:"COL"}, score:{fullTime:{home:2,away:1}, penalties:null} },

  { id:400, status:"FINISHED", stage:"LAST_16", utcDate:"2026-07-10T22:00:00Z", homeTeam:{name:"Brazil",tla:"BRA"}, awayTeam:{name:"Netherlands",tla:"NED"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:401, status:"FINISHED", stage:"LAST_16", utcDate:"2026-07-11T19:00:00Z", homeTeam:{name:"USA",tla:"USA"}, awayTeam:{name:"Canada",tla:"CAN"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:402, status:"FINISHED", stage:"LAST_16", utcDate:"2026-07-11T22:00:00Z", homeTeam:{name:"Australia",tla:"AUS"}, awayTeam:{name:"Sweden",tla:"SWE"}, score:{fullTime:{home:1,away:0}, penalties:null} },

  // ═══════════════════════════════════════════════════════════════
  // QUARTER FINALS — England's run to the title starts here
  // QF1: GER beats ARG | QF2: ENG beats FRA | QF3: POR beats BRA | QF4: USA beats AUS
  // ═══════════════════════════════════════════════════════════════
  { id:500, status:"FINISHED", stage:"QUARTER_FINALS", utcDate:"2026-07-12T19:00:00Z", homeTeam:{name:"Germany",tla:"GER"}, awayTeam:{name:"Argentina",tla:"ARG"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:501, status:"FINISHED", stage:"QUARTER_FINALS", utcDate:"2026-07-12T22:00:00Z", homeTeam:{name:"England",tla:"ENG"}, awayTeam:{name:"France",tla:"FRA"}, score:{fullTime:{home:2,away:1}, penalties:null} },
  { id:502, status:"FINISHED", stage:"QUARTER_FINALS", utcDate:"2026-07-13T19:00:00Z", homeTeam:{name:"Portugal",tla:"POR"}, awayTeam:{name:"Brazil",tla:"BRA"}, score:{fullTime:{home:2,away:0}, penalties:null} },
  { id:503, status:"FINISHED", stage:"QUARTER_FINALS", utcDate:"2026-07-13T22:00:00Z", homeTeam:{name:"USA",tla:"USA"}, awayTeam:{name:"Australia",tla:"AUS"}, score:{fullTime:{home:1,away:0}, penalties:null} },

  // ═══════════════════════════════════════════════════════════════
  // SEMI FINALS — SF1: GER vs ENG (ENG wins) | SF2: POR vs USA (POR wins)
  // ═══════════════════════════════════════════════════════════════
  { id:600, status:"FINISHED", stage:"SEMI_FINALS", utcDate:"2026-07-15T19:00:00Z", homeTeam:{name:"Germany",tla:"GER"}, awayTeam:{name:"England",tla:"ENG"}, score:{fullTime:{home:1,away:2}, penalties:null} },
  { id:601, status:"FINISHED", stage:"SEMI_FINALS", utcDate:"2026-07-15T22:00:00Z", homeTeam:{name:"Portugal",tla:"POR"}, awayTeam:{name:"USA",tla:"USA"}, score:{fullTime:{home:2,away:1}, penalties:null} },

  // ═══════════════════════════════════════════════════════════════
  // FINAL — England beat Portugal to win the World Cup 🏆
  // ═══════════════════════════════════════════════════════════════
  { id:700, status:"FINISHED", stage:"FINAL", utcDate:"2026-07-19T16:00:00Z", homeTeam:{name:"England",tla:"ENG"}, awayTeam:{name:"Portugal",tla:"POR"}, score:{fullTime:{home:2,away:1}, penalties:null} },
];



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
var GROUPS = {
  SILVERSTREAM: {
    code: "SILVERSTREAM",
    label: "Silverstream",
    players: [
      { name: "Alex B",   teams: ["Belgium","Paraguay A"],           codes: ["BEL","PAR"],  lateB: [false,false] },
      { name: "Ben",      teams: ["Brazil","Sweden A"],              codes: ["BRA","SWE"],  lateB: [false,false] },
      { name: "Charlotte",teams: ["Mexico","DR Congo"],              codes: ["MEX","DRC"],  lateB: [false,false] },
      { name: "Craig",    teams: ["Australia","Scotland"],           codes: ["AUS","SCO"],  lateB: [false,false] },
      { name: "Ahmet",    teams: ["Croatia","Egypt"],                codes: ["CRO","EGY"],  lateB: [false,false] },
      { name: "Dharma",   teams: ["England","Uzbekistan"],           codes: ["ENG","UZB"],  lateB: [false,false] },
      { name: "Gary",     teams: ["Spain","Saudi Arabia"],           codes: ["ESP","KSA"],  lateB: [false,false] },
      { name: "Henry",    teams: ["Netherlands","Norway"],           codes: ["NED","NOR"],  lateB: [false,false] },
      { name: "Katrina",  teams: ["Switzerland","Bosnia"],           codes: ["SUI","BIH"],  lateB: [false,false] },
      { name: "Luke DF",  teams: ["Ecuador","New Zealand"],          codes: ["ECU","NZL"],  lateB: [false,false] },
      { name: "Marco",    teams: ["Japan","Ghana A"],                codes: ["JPN","GHA"],  lateB: [false,false] },
      { name: "Michelle", teams: ["Argentina","Ivory Coast"],        codes: ["ARG","CIV"],  lateB: [false,false] },
      { name: "Natalie",  teams: ["Senegal","Turkey"],               codes: ["SEN","TUR"],  lateB: [false,false] },
      { name: "Nick S",   teams: ["Morocco","Cape Verde"],           codes: ["MAR","CPV"],  lateB: [false,false] },
      { name: "Ollie P",  teams: ["Uruguay","Qatar"],                codes: ["URU","QAT"],  lateB: [false,false] },
      { name: "Paul H",   teams: ["South Korea","Iraq"],             codes: ["KOR","IRQ"],  lateB: [false,false] },
      { name: "Peter W",  teams: ["Austria","Czech Republic"],       codes: ["AUT","CZE"],  lateB: [false,false] },
      { name: "Ramon",    teams: ["Portugal","Algeria"],             codes: ["POR","ALG"],  lateB: [false,false] },
      { name: "Sam",      teams: ["Canada","Curaçao"],               codes: ["CAN","CUW"],  lateB: [false,false] },
      { name: "Stephen",  teams: ["Colombia","Panama"],              codes: ["COL","PAN"],  lateB: [false,false] },
      { name: "Stuart",   teams: ["Iran","Jordan"],                  codes: ["IRN","JOR"],  lateB: [false,false] },
      { name: "Wes",      teams: ["France","Haiti"],                 codes: ["FRA","HAI"],  lateB: [false,false] },
      { name: "Will A",   teams: ["Germany A","South Africa"],       codes: ["GER","RSA"],  lateB: [false,false] },
      { name: "Will B",   teams: ["United States","Tunisia"],        codes: ["USA","TUN"],  lateB: [false,false] },
      { name: "Peter H",  teams: ["Sweden B","Paraguay B"],          codes: ["SWE","PAR"],  lateB: [true,true] },
      { name: "Alex DL",  teams: ["Germany B","Ghana B"],            codes: ["GER","GHA"],  lateB: [true,true] },
      { name: "Josh",     teams: [], codes: [], grimReaper: true },
    ],
  },
  RODENTS: {
    code: "RODENTS",
    label: "Rodents",
    // 8 real players, 6 teams each — covers all 48 World Cup teams between
    // them. Josh plays the Grim Reaper here, not a real player. Team
    // assignments were predetermined by the group's own draw (not
    // randomised by us, unlike the other new groups below).
    players: [
      { name: "George",    teams: ["Mexico","Canada","Germany","Japan","Panama","Iraq"],                       codes: ["MEX","CAN","GER","JPN","PAN","IRQ"], lateB: [false,false,false,false,false,false] },
      { name: "Christoph", teams: ["France","Switzerland","Norway","Uzbekistan","South Africa","New Zealand"], codes: ["FRA","SUI","NOR","UZB","RSA","NZL"], lateB: [false,false,false,false,false,false] },
      { name: "Sam",       teams: ["Netherlands","United States","Senegal","Austria","Paraguay","Bosnia"],     codes: ["NED","USA","SEN","AUT","PAR","BIH"], lateB: [false,false,false,false,false,false] },
      { name: "Toby",      teams: ["Argentina","Uruguay","Egypt","Tunisia","Curaçao","Sweden"],                codes: ["ARG","URU","EGY","TUN","CUW","SWE"], lateB: [false,false,false,false,false,false] },
      { name: "Dollie",    teams: ["Brazil","Colombia","Australia","Ivory Coast","Saudi Arabia","DR Congo"],   codes: ["BRA","COL","AUS","CIV","KSA","DRC"], lateB: [false,false,false,false,false,false] },
      { name: "Elliott",   teams: ["England","Iran","South Korea","Ecuador","Qatar","Ghana"],                  codes: ["ENG","IRN","KOR","ECU","QAT","GHA"], lateB: [false,false,false,false,false,false] },
      { name: "Paul",      teams: ["Spain","Belgium","Croatia","Algeria","Haiti","Czech Republic"],            codes: ["ESP","BEL","CRO","ALG","HAI","CZE"], lateB: [false,false,false,false,false,false] },
      { name: "Auz",       teams: ["Portugal","Morocco","Scotland","Jordan","Cape Verde","Turkey"],            codes: ["POR","MAR","SCO","JOR","CPV","TUR"], lateB: [false,false,false,false,false,false] },
      { name: "Josh",      teams: [], codes: [], grimReaper: true },
    ],
  },
  CORNWALL: {
    code: "CORNWALL",
    label: "Cornwall",
    // 16 real players, 3 teams each (covers all 48 World Cup teams between
    // them) — randomly assigned, balanced so every player gets exactly 3
    // of the 4 pots represented once (misses exactly 1 pot). Josh plays
    // the Grim Reaper here, like Rodents.
    players: [
      { name: "Paul",      teams: ["Iran","South Africa","Belgium"],            codes: ["IRN","RSA","BEL"], lateB: [false,false,false] },
      { name: "Auz",       teams: ["Ghana","Austria","Algeria"],                codes: ["GHA","AUT","ALG"], lateB: [false,false,false] },
      { name: "Candice",   teams: ["Iraq","Qatar","Argentina"],                 codes: ["IRQ","QAT","ARG"], lateB: [false,false,false] },
      { name: "Charlotte", teams: ["New Zealand","Saudi Arabia","England"],     codes: ["NZL","KSA","ENG"], lateB: [false,false,false] },
      { name: "Elliott",   teams: ["Haiti","Australia","Canada"],               codes: ["HAI","AUS","CAN"], lateB: [false,false,false] },
      { name: "Emily",     teams: ["Turkey","Scotland","Brazil"],               codes: ["TUR","SCO","BRA"], lateB: [false,false,false] },
      { name: "Iain",      teams: ["Tunisia","Norway","France"],                codes: ["TUN","NOR","FRA"], lateB: [false,false,false] },
      { name: "Izzy",      teams: ["Curaçao","Morocco","Uzbekistan"],           codes: ["CUW","MAR","UZB"], lateB: [false,false,false] },
      { name: "Kate",      teams: ["Jordan","Ecuador","Netherlands"],           codes: ["JOR","ECU","NED"], lateB: [false,false,false] },
      { name: "Katie",     teams: ["Czech Republic","South Korea","Ivory Coast"], codes: ["CZE","KOR","CIV"], lateB: [false,false,false] },
      { name: "Lucy",      teams: ["DR Congo","Colombia","United States"],      codes: ["DRC","COL","USA"], lateB: [false,false,false] },
      { name: "Naomi",     teams: ["Senegal","Egypt","Mexico"],                 codes: ["SEN","EGY","MEX"], lateB: [false,false,false] },
      { name: "Rory",      teams: ["Croatia","Sweden","Spain"],                 codes: ["CRO","SWE","ESP"], lateB: [false,false,false] },
      { name: "Sam",       teams: ["Bosnia","Japan","Paraguay"],                codes: ["BIH","JPN","PAR"], lateB: [false,false,false] },
      { name: "Tom",       teams: ["Uruguay","Panama","Portugal"],              codes: ["URU","PAN","POR"], lateB: [false,false,false] },
      { name: "Tori",      teams: ["Cape Verde","Switzerland","Germany"],       codes: ["CPV","SUI","GER"], lateB: [false,false,false] },
      { name: "Josh",      teams: [], codes: [], grimReaper: true },
    ],
  },
  MACKLINS: {
    code: "MACKLINS",
    label: "Macklins",
    // 8 real players, 6 teams each (covers all 48 World Cup teams between
    // them) — randomly assigned, balanced so every player gets a roughly
    // even (1 or 2 per pot) spread across the 4 pots. "MACK-BOT" is a joke
    // 8th slot added to even out the player count — plays exactly like a
    // normal player (scores normally, could technically win); `isBot: true`
    // only drives the flavour badge in computeBadges, not any scoring
    // difference. Josh is a real player here, not the Grim Reaper — the
    // Grim Reaper is a separate, unnamed/anonymous entry.
    players: [
      { name: "Maggie",  teams: ["Canada","Panama","Qatar","Japan","Uruguay","Iraq"],                  codes: ["CAN","PAN","QAT","JPN","URU","IRQ"], lateB: [false,false,false,false,false,false] },
      { name: "Julian",  teams: ["Brazil","Norway","Paraguay","Ecuador","Jordan","Czech Republic"],    codes: ["BRA","NOR","PAR","ECU","JOR","CZE"], lateB: [false,false,false,false,false,false] },
      { name: "Molly",   teams: ["France","Germany","Algeria","Iran","New Zealand","DR Congo"],        codes: ["FRA","GER","ALG","IRN","NZL","DRC"], lateB: [false,false,false,false,false,false] },
      { name: "Josh",    teams: ["Mexico","United States","Uzbekistan","Austria","Haiti","Curaçao"],   codes: ["MEX","USA","UZB","AUT","HAI","CUW"], lateB: [false,false,false,false,false,false] },
      { name: "Candice", teams: ["Netherlands","Spain","Sweden","South Korea","Morocco","Cape Verde"], codes: ["NED","ESP","SWE","KOR","MAR","CPV"], lateB: [false,false,false,false,false,false] },
      { name: "Jasper",  teams: ["England","Scotland","Saudi Arabia","Australia","Turkey","Ghana"],    codes: ["ENG","SCO","KSA","AUS","TUR","GHA"], lateB: [false,false,false,false,false,false] },
      { name: "Taco",    teams: ["Argentina","Belgium","Egypt","Switzerland","Senegal","Bosnia"],      codes: ["ARG","BEL","EGY","SUI","SEN","BIH"], lateB: [false,false,false,false,false,false] },
      { name: "MACK-BOT", teams: ["Portugal","Ivory Coast","South Africa","Croatia","Colombia","Tunisia"], codes: ["POR","CIV","RSA","CRO","COL","TUN"], lateB: [false,false,false,false,false,false], isBot: true },
      { name: "Grim Reaper", teams: [], codes: [], grimReaper: true },
    ],
  },
  CAVERSHAM: {
    code: "CAVERSHAM",
    label: "Caversham",
    // 8 real players, 6 teams each (covers all 48 World Cup teams between
    // them) — randomly assigned, balanced the same way as Macklins. Josh
    // is a real player here too, not the Grim Reaper — the Grim Reaper is
    // a separate, unnamed/anonymous entry.
    players: [
      { name: "Josh",   teams: ["Japan","Argentina","Spain","Panama","Algeria","Tunisia"],          codes: ["JPN","ARG","ESP","PAN","ALG","TUN"], lateB: [false,false,false,false,false,false] },
      { name: "Aaron",  teams: ["Iran","Uruguay","Canada","Qatar","South Africa","DR Congo"],       codes: ["IRN","URU","CAN","QAT","RSA","DRC"], lateB: [false,false,false,false,false,false] },
      { name: "Candice",teams: ["Ecuador","United States","England","Uzbekistan","Norway","Ghana"], codes: ["ECU","USA","ENG","UZB","NOR","GHA"], lateB: [false,false,false,false,false,false] },
      { name: "Katie",  teams: ["Colombia","Mexico","Brazil","Egypt","Bosnia","Jordan"],            codes: ["COL","MEX","BRA","EGY","BIH","JOR"], lateB: [false,false,false,false,false,false] },
      { name: "Jon",    teams: ["South Korea","Germany","Belgium","Scotland","Cape Verde","Haiti"], codes: ["KOR","GER","BEL","SCO","CPV","HAI"], lateB: [false,false,false,false,false,false] },
      { name: "India",  teams: ["Croatia","Senegal","France","Saudi Arabia","Curaçao","Turkey"],    codes: ["CRO","SEN","FRA","KSA","CUW","TUR"], lateB: [false,false,false,false,false,false] },
      { name: "Yan",    teams: ["Australia","Switzerland","Portugal","Sweden","Czech Republic","New Zealand"], codes: ["AUS","SUI","POR","SWE","CZE","NZL"], lateB: [false,false,false,false,false,false] },
      { name: "Freya",  teams: ["Morocco","Austria","Netherlands","Paraguay","Ivory Coast","Iraq"], codes: ["MAR","AUT","NED","PAR","CIV","IRQ"], lateB: [false,false,false,false,false,false] },
      { name: "Grim Reaper", teams: [], codes: [], grimReaper: true },
    ],
  },
  // future groups added here by hand, each with a unique `code`
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER → TEAM ASSIGNMENTS — the active group's roster (see GROUPS above)
// ─────────────────────────────────────────────────────────────────────────────
var PLAYERS = GROUPS.SILVERSTREAM.players;

// Grim Reaper — earns the absolute value of negative points when Pot1/2 teams go out in groups
var reaperBountyForCode = (code) => {
  const stage = "GROUP_ELIM";
  const penalty = (PTS_INC.GROUP_ELIM || [0,0,0,0])[(POT[code]||4)-1];
  return penalty < 0 ? Math.abs(penalty) : 0; // only feasts on misfortune
};

// ─────────────────────────────────────────────────────────────────────────────
// POT SEEDINGS  (1 = favourite, 4 = underdog)
// ─────────────────────────────────────────────────────────────────────────────
var POT = {
  POR:1,MEX:1,ARG:1,NED:1,ESP:1,ENG:1,FRA:1,BRA:1,CAN:1,GER:1,USA:1,BEL:1,
  MAR:2,JPN:2,URU:2,SEN:2,CRO:2,IRN:2,SUI:2,COL:2,AUT:2,ECU:2,KOR:2,AUS:2,
  SCO:3,EGY:3,PAR:3,ALG:3,QAT:3,NOR:3,CIV:3,KSA:3,PAN:3,SWE:3,UZB:3,RSA:3,
  JOR:4,CUW:4,BIH:4,HAI:4,GHA:4,NZL:4,CPV:4,IRQ:4,TUN:4,CZE:4,TUR:4,DRC:4,COD:4,
  // ^ COD is an alias for DRC (DR Congo) — confirmed the real football-data.org
  // API uses FIFA's official "COD" code (ISO 3166-1 alpha-3, "Congo-Kinshasa")
  // for the 2026 World Cup, not "DRC" as our own data originally assumed.
  // Both keys point to the same pot/flag so lookups work regardless of
  // which code a given match object happens to use.
};

// Group assignments (A–L) — shared World Cup data. Used for mathematical
// group-stage elimination timing in computeBadges.
var GROUP_ASSIGNMENTS = {
  A: ["MEX","RSA","KOR","CZE"],
  B: ["CAN","BIH","QAT","SUI"],
  C: ["BRA","MAR","HAI","SCO"],
  D: ["USA","PAR","AUS","TUR"],
  E: ["GER","CUW","CIV","ECU"],
  F: ["NED","JPN","SWE","TUN"],
  G: ["BEL","EGY","IRN","NZL"],
  H: ["ESP","CPV","KSA","URU"],
  I: ["FRA","SEN","IRQ","NOR"],
  J: ["ARG","ALG","AUT","JOR"],
  K: ["POR","DRC","UZB","COL"],
  L: ["ENG","CRO","GHA","PAN"],
};

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
var GROUP_WIN_PTS  = [2,  4,  8,  12];
var GROUP_DRAW_PTS = [1,  2,  3,   5];

function groupGamePts(code, result) {
  const pot = (POT[code] || 4) - 1;
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
  if (stageKey === "GROUP_ELIM") return (PTS_INC.GROUP_ELIM || [0,0,0,0])[(POT[code]||4)-1];
  const pot = (POT[code]||4) - 1;
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
  LAST_32:        "Last 32",
  GROUP_ELIM:     "Group Stage",
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
var FLAG_ISO = {
  POR:"pt",MEX:"mx",ARG:"ar",NED:"nl",ESP:"es",ENG:"gb-eng",FRA:"fr",BRA:"br",
  CAN:"ca",GER:"de",USA:"us",BEL:"be",MAR:"ma",JPN:"jp",URU:"uy",SEN:"sn",
  CRO:"hr",IRN:"ir",SUI:"ch",COL:"co",AUT:"at",ECU:"ec",KOR:"kr",AUS:"au",
  SCO:"gb-sct",EGY:"eg",PAR:"py",ALG:"dz",QAT:"qa",NOR:"no",CIV:"ci",KSA:"sa",
  PAN:"pa",TUN:"tn",UZB:"uz",RSA:"za",JOR:"jo",CUW:"cw",BIH:"ba",HAI:"ht",
  GHA:"gh",NZL:"nz",CPV:"cv",IRQ:"iq",SWE:"se",CZE:"cz",TUR:"tr",DRC:"cd",COD:"cd",
};

var flag = (code) => FLAG_ISO[code] ? `https://flagcdn.com/h40/${FLAG_ISO[code]}.png` : null;
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
      if (winner) { winners[winner] = true; markStage(winner, "WINNER"); }
      if (loser)  { eliminated[loser] = "FINALIST"; markStage(loser, "FINALIST"); }
    } else if (stage.includes("SEMI")) {
      markStage(winner, "SEMI_FINALS"); markStage(loser, "SEMI_FINALS");
      if (loser) eliminated[loser] = "SEMI_FINALS";
    } else if (stage.includes("QUARTER")) {
      markStage(winner, "QUARTER_FINALS"); markStage(loser, "QUARTER_FINALS");
      if (loser) eliminated[loser] = "QUARTER_FINALS";
    } else if (stage.includes("LAST_16") || stage.includes("16")) {
      markStage(winner, "LAST_16"); markStage(loser, "LAST_16");
      if (loser) eliminated[loser] = "LAST_16";
    } else if (stage.includes("LAST_32") || stage.includes("32")) {
      markStage(winner, "LAST_32"); markStage(loser, "LAST_32");
      if (loser) eliminated[loser] = "LAST_32";
    }
  });

  // Group stage eliminations
  const knockoutTeams = new Set(Object.keys(stageReached));
  const groupGames = {};
  done.filter(m => (m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    if (h) groupGames[h] = (groupGames[h]||0) + 1;
    if (a) groupGames[a] = (groupGames[a]||0) + 1;
  });
  Object.entries(groupGames).forEach(([code, n]) => {
    if (n >= 3 && !knockoutTeams.has(code) && !eliminated[code]) {
      eliminated[code] = "GROUP_ELIM";
      stageReached[code] = "GROUP_ELIM";
    }
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
        return { name: p.teams[i], code, pot: POT[code]||4, stage, pts: p_pts + gp,
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
          if (gamesPlayed === 3) {
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

// ─────────────────────────────────────────────────────────────────────────────
// MONTE CARLO WIN PROBABILITY SIMULATION
// ─────────────────────────────────────────────────────────────────────────────
function simulateWinProbability(ranked, matches, N = 5000) {
  const { eliminated, winners, stageReached } = deriveStages(matches);

  // Teams still alive in knockouts (not eliminated, not group stage)
  const knockoutStages = ["LAST_32","LAST_16","QUARTER_FINALS","SEMI_FINALS","FINALIST","WINNER"];
  const aliveInKnockouts = Object.entries(stageReached)
    .filter(([code, stage]) => knockoutStages.includes(stage) && !eliminated[code])
    .map(([code]) => code);

  // Teams qualified but haven't played a knockout game yet
  const groupWinners = Object.values(PLAYERS)
    .filter(p => !p.grimReaper)
    .flatMap(p => p.codes)
    .filter(code => !eliminated[code] && !stageReached[code]);

  const alive = [...new Set([...aliveInKnockouts, ...groupWinners])];

  // Pot-based win probability weights for knockout matchups
  const potWeight = (code) => {
    const pot = POT[code] || 4;
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

  const remainingStages = ["LAST_32","LAST_16","QUARTER_FINALS","SEMI_FINALS","FINALIST","WINNER"];
  // Work out current highest stage reached by any alive team
  const currentStageIdx = (() => {
    let maxIdx = 0;
    alive.forEach(code => {
      const s = stageReached[code];
      const idx = remainingStages.indexOf(s);
      if (idx > maxIdx) maxIdx = idx;
    });
    return maxIdx;
  })();

  for (let sim = 0; sim < N; sim++) {
    // Clone alive teams for this simulation
    let pool = [...alive];
    const simPts = { ...basePoints };
    let reaperPts = reaperBase;

    // Simulate each remaining knockout stage
    for (let si = currentStageIdx; si < remainingStages.length - 1; si++) {
      const stage = remainingStages[si + 1];
      const nextPool = [];

      // Shuffle pool for random matchups
      const shuffled = [...pool].sort(() => Math.random() - 0.5);

      for (let i = 0; i < shuffled.length - 1; i += 2) {
        const a = shuffled[i];
        const b = shuffled[i + 1];
        if (!b) { nextPool.push(a); continue; }

        // Weight by pot strength
        const wa = potWeight(a);
        const wb = potWeight(b);
        const winner = Math.random() < wa / (wa + wb) ? a : b;
        const loser = winner === a ? b : a;

        nextPool.push(winner);

        // Award points to loser's owner(s) for reaching this stage
        {
          const inc = Math.max(0, ptsTotal(loser, stage) - teamPts_sim(loser, stageReached));
          (codeToPlayers[loser] || []).forEach(o => { simPts[o] = (simPts[o] || 0) + inc; });
        }

        // Award points to winner's owner(s) for reaching the next stage too
        {
          const inc = Math.max(0, ptsTotal(winner, stage) - teamPts_sim(winner, stageReached));
          (codeToPlayers[winner] || []).forEach(o => { simPts[o] = (simPts[o] || 0) + inc; });
        }
      }

      pool = nextPool;
    }

    // Award winner bonus
    if (pool.length > 0) {
      const champion = pool[0];
      teamWins[champion] = (teamWins[champion] || 0) + 1;
      {
        const inc = Math.max(0, ptsTotal(champion, "WINNER") - teamPts_sim(champion, stageReached));
        (codeToPlayers[champion] || []).forEach(o => { simPts[o] = (simPts[o] || 0) + inc; });
      }
    }

    // Find winner of this simulation
    const scores = Object.entries(simPts).map(([name, pts]) => ({ name, pts }));
    scores.push({ name: reaperName, pts: reaperPts }); // Reaper stays fixed (group stage over)
    scores.sort((a, b) => b.pts - a.pts);
    if (scores[0]) wins[scores[0].name] = (wins[scores[0].name] || 0) + 1;
  }

  // Convert to percentages
  const result = {};
  ranked.forEach(p => {
    result[p.name] = Math.round((wins[p.name] || 0) / N * 100);
  });
  const teams = {};
  alive.forEach(code => { teams[code] = Math.round((teamWins[code] || 0) / N * 100); });
  Object.keys(winners).forEach(code => { teams[code] = 100; }); // already crowned
  return { players: result, teams };
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
  if (reaper) add(reaper.name, { icon:"💀", label:"Grim Reaper", desc:"Feasts on group-stage upsets and 0-0s — can haunt the table, but can't win it", tone:"bad" });

  // 🤖 Definitely Not Human — MACK-BOT's one and only accolade (Macklins'
  // joke 8th player). Always-on flavour badge, same "always applies"
  // pattern as Grim Reaper above — not performance-based.
  const bot = ranked.find(p => p.isBot);
  if (bot) add(bot.name, { icon:"🤖", label:"Definitely Not Human", desc:"Drafted to fill the 8th seat. Runs on batteries, spreadsheets, and zero capacity for disappointment.", tone:"bad" });

  // 🏆 Top Dog — current leader (once anyone has scored)
  if (real.length && real[0].total > 0) add(real[0].name, { icon:"🏆", label:"Top Dog", desc:"Top of the table", tone:"good" });

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

  // 🔪 Giant Killer — a team beat a higher-pot team in the groups
  done.filter(m => (m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    if (!h || !a) return;
    if (hs > as_ && (POT[h]||4) > (POT[a]||4)) {
      const o = real.find(p => p.codes?.includes(h));
      if (o && !badges[o.name].some(b => b.icon === "🔪")) add(o.name, { icon:"🔪", label:"Giant Killer", desc:`${h} beat a higher-pot team`, tone:"good" });
    }
    if (as_ > hs && (POT[a]||4) > (POT[h]||4)) {
      const o = real.find(p => p.codes?.includes(a));
      if (o && !badges[o.name].some(b => b.icon === "🔪")) add(o.name, { icon:"🔪", label:"Giant Killer", desc:`${a} beat a higher-pot team`, tone:"good" });
    }
  });

  // 💎 Underdog — owns a Pot 3/4 team that reached the knockouts
  real.forEach(p => {
    if (p.teams?.some(t => t.pot >= 3 && t.stage && KO.includes(t.stage)))
      add(p.name, { icon:"💎", label:"Underdog", desc:"A Pot 3/4 team made the knockouts", tone:"good" });
  });

  // (Clean Sheet replaced by 🧱 Brick Wall — the single best-defence player, below.)

  // 🥚 Early Bird — first to get on the board
  const firstScorer = real.filter(p => p.total > 0).sort((a,b) => {
    const af = a.hist.findIndex((v,i) => i > 0 && v > a.hist[i-1]);
    const bf = b.hist.findIndex((v,i) => i > 0 && v > b.hist[i-1]);
    return af - bf;
  })[0];
  if (firstScorer) add(firstScorer.name, { icon:"🥚", label:"Early Bird", desc:"First to get on the board", tone:"good" });

  // 🤡 Big Flop — a Pot 1 favourite crashed out in the groups
  real.forEach(p => {
    if (p.teams?.some(t => t.pot === 1 && t.stage === "GROUP_ELIM"))
      add(p.name, { icon:"🤡", label:"Big Flop", desc:"A Pot 1 favourite went out in the groups", tone:"bad" });
  });

  // 🦆 Still Quacking — yet to score (once underway)
  if (started) real.forEach(p => {
    if (p.total === 0) add(p.name, { icon:"🦆", label:"Still Quacking", desc:"Yet to score a point", tone:"bad" });
  });

  // 🎸 One Man Band — biggest points gap between a player's two teams (one carrying)
  let oneMan = null;
  real.forEach(p => {
    const tp = (p.teams || []).map(t => t.pts);
    if (tp.length >= 2) {
      const gap = Math.max(...tp) - Math.min(...tp);
      if (gap > 0 && (!oneMan || gap > oneMan.g)) oneMan = { name: p.name, g: gap };
    }
  });
  if (oneMan) add(oneMan.name, { icon:"🎸", label:"One Man Band", desc:`One team carrying — ${oneMan.g}pt gap between their teams`, tone:"good" });

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
  //   Group: the match after which the team is mathematically locked into 4th of
  //   its group — i.e. ≥3 teams are guaranteed above it. A rival counts as
  //   guaranteed above if either (a) their CURRENT points already exceed the
  //   team's MAX possible (points-only, no game data needed), or (b) their
  //   current points exactly equal the team's MAX *and* the two have already
  //   played each other in the group with a decisive (non-draw) result — per
  //   FIFA's 2026 tiebreak order, head-to-head outranks overall goal difference,
  //   and a played head-to-head result can't change, so this stays gapless
  //   (never false-flags) without needing to bound future goal difference.
  //   4th can't be top-2 or a best-third, so the team is genuinely out.
  //   Knockout: the match they lost.
  const elimDate = {};
  const groupOf = {};
  Object.entries(GROUP_ASSIGNMENTS).forEach(([g, codes]) => codes.forEach(c => { groupOf[c] = g; }));
  const gpts = {}, gplayed = {};
  Object.keys(groupOf).forEach(c => { gpts[c] = 0; gplayed[c] = 0; });
  const pairKey = (x, y) => [x, y].sort().join("-");
  const h2hWinner = {}; // pairKey → winning code, or "DRAW"
  [...done].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)).forEach(m => {
    const stage = (m.stage || "").toUpperCase();
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    const pen = m.score?.penalties;
    if (stage.includes("GROUP")) {
      if (h) gplayed[h] = (gplayed[h] || 0) + 1;
      if (a) gplayed[a] = (gplayed[a] || 0) + 1;
      if (hs > as_) gpts[h] = (gpts[h] || 0) + 3;
      else if (as_ > hs) gpts[a] = (gpts[a] || 0) + 3;
      else { gpts[h] = (gpts[h] || 0) + 1; gpts[a] = (gpts[a] || 0) + 1; }
      if (h && a && !h2hWinner[pairKey(h, a)]) {
        h2hWinner[pairKey(h, a)] = hs > as_ ? h : as_ > hs ? a : "DRAW";
      }
      const g = groupOf[h] || groupOf[a];
      if (g) GROUP_ASSIGNMENTS[g].forEach(t => {
        if (elimDate[t]) return;
        const tMax = (gpts[t] || 0) + 3 * (3 - (gplayed[t] || 0));
        const guaranteedAbove = GROUP_ASSIGNMENTS[g].filter(x => {
          if (x === t) return false;
          const xPts = gpts[x] || 0;
          if (xPts > tMax) return true;
          if (xPts === tMax) {
            const winner = h2hWinner[pairKey(t, x)];
            if (winner && winner === x) return true; // decisive h2h already favours x
          }
          return false;
        }).length;
        if (guaranteedAbove >= 3) elimDate[t] = m.utcDate; // locked into 4th → out
      });
    } else {
      let loser = null;
      if (hs > as_) loser = a; else if (as_ > hs) loser = h; else if (pen) loser = pen.home > pen.away ? a : h;
      if (loser && !elimDate[loser]) elimDate[loser] = m.utcDate;
    }
  });
  // 🩸 First Casualty — first player to lose a team / ⚰️ Wiped Out — first to lose both
  let firstOne = null, firstBoth = null;
  real.forEach(p => {
    const codes = p.codes || [];
    const dated = codes.map(c => ({ code: c, t: elimDate[c] ? new Date(elimDate[c]).getTime() : null })).filter(x => x.t !== null);
    if (dated.length >= 1) {
      const f = dated.reduce((m, x) => x.t < m.t ? x : m);
      if (!firstOne || f.t < firstOne.d) firstOne = { name: p.name, d: f.t, code: f.code };
    }
    if (dated.length >= 2 && codes.every(c => elimDate[c])) {
      const b = dated.reduce((m, x) => x.t > m.t ? x : m);
      if (!firstBoth || b.t < firstBoth.d) firstBoth = { name: p.name, d: b.t, code: b.code };
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
  if (firstBoth) add(firstBoth.name, { icon:"⚰️", label:"Wiped Out", desc:"First to lose both teams", tone:"bad" });

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

var BROADCAST = {
  // Group stage
  "MEX-RSA": {b:"ITV", url:"https://www.itv.com/"},
  "KOR-CZE": {b:"ITV", url:"https://www.itv.com/"},
  "CAN-BIH": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "USA-PAR": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "QAT-SUI": {b:"ITV", url:"https://www.itv.com/"},
  "BRA-MAR": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "HAI-SCO": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "AUS-TUR": {b:"ITV", url:"https://www.itv.com/"},
  "GER-CUW": {b:"ITV", url:"https://www.itv.com/"},
  "NED-JPN": {b:"ITV", url:"https://www.itv.com/"},
  "CIV-ECU": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "SWE-TUN": {b:"ITV", url:"https://www.itv.com/"},
  "ESP-CPV": {b:"ITV", url:"https://www.itv.com/"},
  "BEL-EGY": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "KSA-URU": {b:"ITV", url:"https://www.itv.com/"},
  "IRN-NZL": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "FRA-SEN": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "IRQ-NOR": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "ARG-ALG": {b:"ITV", url:"https://www.itv.com/"},
  "AUT-JOR": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "POR-DRC": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "ENG-CRO": {b:"ITV", url:"https://www.itv.com/"},
  "GHA-PAN": {b:"ITV", url:"https://www.itv.com/"},
  "UZB-COL": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "CZE-RSA": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "SUI-BIH": {b:"ITV", url:"https://www.itv.com/"},
  "CAN-QAT": {b:"ITV", url:"https://www.itv.com/"},
  "MEX-KOR": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "USA-AUS": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "SCO-MAR": {b:"ITV", url:"https://www.itv.com/"},
  "BRA-HAI": {b:"ITV", url:"https://www.itv.com/"},
  "TUR-PAR": {b:"ITV", url:"https://www.itv.com/"},
  "NED-SWE": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "GER-CIV": {b:"ITV", url:"https://www.itv.com/"},
  "ECU-CUW": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "TUN-JPN": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "ESP-KSA": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "BEL-IRN": {b:"ITV", url:"https://www.itv.com/"},
  "URU-CPV": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "NZL-EGY": {b:"ITV", url:"https://www.itv.com/"},
  "ARG-AUT": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "FRA-IRQ": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "NOR-SEN": {b:"ITV", url:"https://www.itv.com/"},
  "JOR-ALG": {b:"ITV", url:"https://www.itv.com/"},
  "POR-UZB": {b:"ITV", url:"https://www.itv.com/"},
  "ENG-GHA": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "PAN-CRO": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "COL-DRC": {b:"ITV", url:"https://www.itv.com/"},
  "BIH-QAT": {b:"ITV", url:"https://www.itv.com/"},
  "SUI-CAN": {b:"ITV", url:"https://www.itv.com/"},
  "MAR-HAI": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  "SCO-BRA": {b:"BBC", url:"https://www.bbc.co.uk/iplayer"},
  // Knockout stage TBC — will default to BBC
};

var getBroadcast = (homeTla, awayTla) => {
  const key = `${homeTla}-${awayTla}`;
  const alt = `${awayTla}-${homeTla}`;
  return BROADCAST[key] || BROADCAST[alt] || {b:"BBC", url:"https://www.bbc.co.uk/iplayer"};
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
  const knockoutTeams = new Set();
  const bucketLabels = ["Start"];

  matches.filter(m => !(m.stage||"").toUpperCase().includes("GROUP") && isSettled(m.status)).forEach(m => {
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

      [h, a].forEach(code => {
        if (code) groupGames[code] = (groupGames[code]||0) + 1;
        if (code && groupGames[code] >= 3 && !knockoutTeams.has(code) && !eliminated[code]) {
          eliminated[code] = "GROUP_ELIM"; award(code, "GROUP_ELIM"); reaperBounty(code, "GROUP_ELIM");
        }
      });
    }
  });

  // Final snapshot after last bucket
  if (currentBucket !== null) {
    PLAYERS.forEach(p => history[p.name].push(running[p.name]));
    bucketLabels.push(currentBucket);
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
  const knockoutTeams = new Set();

  matches.filter(m => !(m.stage||"").toUpperCase().includes("GROUP") && isSettled(m.status)).forEach(m => {
    if (m.homeTeam?.tla) knockoutTeams.add(m.homeTeam.tla.toUpperCase());
    if (m.awayTeam?.tla) knockoutTeams.add(m.awayTeam.tla.toUpperCase());
  });

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
          if (result !== "L") {
            running[pl] = (running[pl] || 0) + groupGamePts(code, result);
            changedPlayers.add(pl);
          }
        });
      });
      // Grim Reaper goal drought curse
      const drought = goalDroughtPts(m);
      if (drought > 0) { running[reaperName] = (running[reaperName] || 0) + drought; changedPlayers.add(reaperName); }
      [h, a].forEach(code => {
        if (code) groupGames[code] = (groupGames[code]||0) + 1;
        if (code && groupGames[code] >= 3 && !knockoutTeams.has(code) && !eliminated[code]) {
          eliminated[code] = "GROUP_ELIM"; award(code, "GROUP_ELIM");
          const bounty = reaperBountyForCode(code);
          if (bounty > 0) { running[reaperName] += bounty; changedPlayers.add(reaperName); }
        }
      });
    }

    if (changedPlayers.size > 0) PLAYERS.forEach(p => history[p.name].push(running[p.name]));
  });

  // Append live match contribution as the final sparkline point
  const liveMatches = matches.filter(m => m.status === "IN_PLAY" || m.status === "PAUSED");
  if (liveMatches.length > 0) {
    const liveChanged = new Set();
    liveMatches.forEach(m => {
      const stage = (m.stage || "").toUpperCase();
      if (!stage.includes("GROUP")) return; // only group stage scores mid-game
      const h = m.homeTeam?.tla?.toUpperCase();
      const a = m.awayTeam?.tla?.toUpperCase();
      const hs = m.score?.fullTime?.home ?? 0;
      const as_ = m.score?.fullTime?.away ?? 0;
      let hResult, aResult;
      if (hs > as_)      { hResult = "W"; aResult = "L"; }
      else if (as_ > hs) { hResult = "L"; aResult = "W"; }
      else               { hResult = "D"; aResult = "D"; }
      [[h, hResult], [a, aResult]].forEach(([code, result]) => {
        if (!code || result === "L") return;
        const pls = teamPlayer[code] || [];
        pls.forEach(pl => {
          running[pl] = (running[pl] || 0) + groupGamePts(code, result);
          liveChanged.add(pl);
        });
      });
      // Grim Reaper drought curse on live 0-0
      const drought = goalDroughtPts(m);
      if (drought > 0) { running[reaperName] = (running[reaperName] || 0) + drought; liveChanged.add(reaperName); }
    });
    if (liveChanged.size > 0) PLAYERS.forEach(p => history[p.name].push(running[p.name]));
  }

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
      let stageKey = null;
      if (stage.includes("SEMI"))                                  stageKey = "SEMI_FINALS";
      else if (stage.includes("QUARTER"))                          stageKey = "QUARTER_FINALS";
      else if (stage.includes("LAST_16") || stage.includes("16"))  stageKey = "LAST_16";
      else if (stage.includes("LAST_32") || stage.includes("32"))  stageKey = "LAST_32";
      if (stageKey && loser) {
        const dl = award(loser, stageKey);  if (loser  === h) hPts = dl; else aPts = dl;
        if (winner) { const dw = award(winner, stageKey); if (winner === h) hPts = dw; else aPts = dw; }
      }
    }

    result[m.id] = { home: hPts, away: aPts };
  });

  return result;
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
  matches.filter(m => !(m.stage||"").toUpperCase().includes("GROUP") && isSettled(m.status)).forEach(m => {
    if (m.homeTeam?.tla) knockoutTeams.add(m.homeTeam.tla.toUpperCase());
    if (m.awayTeam?.tla) knockoutTeams.add(m.awayTeam.tla.toUpperCase());
  });
  const eliminated = {}, winners = {}, groupGames = {};
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
      [h, a].forEach(code => {
        if (code) groupGames[code] = (groupGames[code]||0) + 1;
        if (code && groupGames[code] >= 3 && !knockoutTeams.has(code) && !eliminated[code]) {
          eliminated[code] = "GROUP_ELIM";
          if (owned(code) || reaperBountyForCode(code) > 0) changed = true;
        }
      });
    }
    if (changed) frames.push(Object.keys(eliminated));
  });
  const liveMatches = matches.filter(m => m.status === "IN_PLAY" || m.status === "PAUSED");
  if (liveMatches.length > 0) {
    let liveChanged = false;
    liveMatches.forEach(m => {
      const stage = (m.stage || "").toUpperCase();
      if (!stage.includes("GROUP")) return;
      const h = m.homeTeam?.tla?.toUpperCase();
      const a = m.awayTeam?.tla?.toUpperCase();
      const hs = m.score?.fullTime?.home ?? 0;
      const as_ = m.score?.fullTime?.away ?? 0;
      let hResult, aResult;
      if (hs > as_)      { hResult = "W"; aResult = "L"; }
      else if (as_ > hs) { hResult = "L"; aResult = "W"; }
      else               { hResult = "D"; aResult = "D"; }
      [[h, hResult], [a, aResult]].forEach(([code, result]) => { if (result !== "L" && owned(code)) liveChanged = true; });
      if (goalDroughtPts(m) > 0) liveChanged = true;
    });
    if (liveChanged) frames.push(Object.keys(eliminated));
  }
  return frames;
}
