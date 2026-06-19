// ═════════════════════════════════════════════════════════════════════════════
// scoring.js — SHARED scoring/data logic for the Silverstream Sweepstakes
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
// PLAYER → TEAM ASSIGNMENTS
// ─────────────────────────────────────────────────────────────────────────────
var PLAYERS = [
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
];

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
  SCO:3,EGY:3,PAR:3,ALG:3,QAT:3,NOR:3,CIV:3,KSA:3,PAN:3,TUN:3,UZB:3,RSA:3,
  JOR:4,CUW:4,BIH:4,HAI:4,GHA:4,NZL:4,CPV:4,IRQ:4,SWE:4,CZE:4,TUR:4,DRC:4,COD:4,
  // ^ COD is an alias for DRC (DR Congo) — confirmed the real football-data.org
  // API uses FIFA's official "COD" code (ISO 3166-1 alpha-3, "Congo-Kinshasa")
  // for the 2026 World Cup, not "DRC" as our own data originally assumed.
  // Both keys point to the same pot/flag so lookups work regardless of
  // which code a given match object happens to use.
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

// Total points for a team at a given stage (sum of all incremental stages reached)
var ptsTotal = (code, stageKey) => {
  if (stageKey === "GROUP_ELIM") return (PTS_INC.GROUP_ELIM || [0,0,0,0])[(POT[code]||4)-1];
  const pot = (POT[code]||4) - 1;
  const idx = STAGE_ORDER.indexOf(stageKey);
  if (idx < 0) return 0;
  let total = 0;
  STAGE_ORDER.slice(1, idx + 1).forEach(s => { total += (PTS_INC[s]||[0,0,0,0])[pot]; });
  return total;
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

  // Grim reaper current total
  const reaperBase = ranked.find(p => p.grimReaper)?.total || 0;

  // Player code lookup
  const codeToPlayer = {};
  ranked.filter(p => !p.grimReaper).forEach(p => {
    p.codes.forEach(code => { codeToPlayer[code] = p.name; });
  });

  const wins = {};
  ranked.forEach(p => { wins[p.name] = 0; });

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

        // Award points to loser's owner for reaching this stage
        const loserOwner = codeToPlayer[loser];
        if (loserOwner) {
          const newPts = ptsTotal(loser, stage);
          const oldPts = teamPts_sim(loser, stageReached);
          simPts[loserOwner] = (simPts[loserOwner] || 0) + Math.max(0, newPts - oldPts);
        }

        // Award points to winner for reaching next stage too
        const winnerOwner = codeToPlayer[winner];
        if (winnerOwner) {
          const newPts = ptsTotal(winner, stage);
          const oldPts = teamPts_sim(winner, stageReached);
          simPts[winnerOwner] = (simPts[winnerOwner] || 0) + Math.max(0, newPts - oldPts);
        }
      }

      pool = nextPool;
    }

    // Award winner bonus
    if (pool.length > 0) {
      const champion = pool[0];
      const championOwner = codeToPlayer[champion];
      if (championOwner) {
        const newPts = ptsTotal(champion, "WINNER");
        const oldPts = teamPts_sim(champion, stageReached);
        simPts[championOwner] = (simPts[championOwner] || 0) + Math.max(0, newPts - oldPts);
      }
    }

    // Find winner of this simulation
    const scores = Object.entries(simPts).map(([name, pts]) => ({ name, pts }));
    scores.push({ name: "Josh", pts: reaperPts }); // Reaper stays fixed (group stage over)
    scores.sort((a, b) => b.pts - a.pts);
    if (scores[0]) wins[scores[0].name] = (wins[scores[0].name] || 0) + 1;
  }

  // Convert to percentages
  const result = {};
  ranked.forEach(p => {
    result[p.name] = Math.round((wins[p.name] || 0) / N * 100);
  });
  return result;
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
function computeBadges(ranked, matches) {
  const done = matches.filter(m => isSettled(m.status));
  const badges = {};
  ranked.forEach(p => { badges[p.name] = []; });

  // Early Bird — first player to score any pts
  const firstScorer = ranked.filter(p => !p.grimReaper && p.total > 0)
    .sort((a,b) => {
      const aFirst = a.hist.findIndex((v,i) => i > 0 && v > a.hist[i-1]);
      const bFirst = b.hist.findIndex((v,i) => i > 0 && v > b.hist[i-1]);
      return aFirst - bFirst;
    })[0];
  if (firstScorer) badges[firstScorer.name].push({ icon:"🥚", label:"Early Bird", desc:"First to score points" });

  // Giant Killer — owns team that beat a higher-pot team in groups
  done.filter(m => (m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    if (!h || !a) return;
    const hPot = POT[h] || 4;
    const aPot = POT[a] || 4;
    if (hs > as_ && hPot > aPot) {
      const owner = ranked.find(p => p.codes?.includes(h));
      if (owner && !badges[owner.name].find(b => b.icon === "🔪"))
        badges[owner.name].push({ icon:"🔪", label:"Giant Killer", desc:`${h} beat a higher-pot team` });
    }
    if (as_ > hs && aPot > hPot) {
      const owner = ranked.find(p => p.codes?.includes(a));
      if (owner && !badges[owner.name].find(b => b.icon === "🔪"))
        badges[owner.name].push({ icon:"🔪", label:"Giant Killer", desc:`${a} beat a higher-pot team` });
    }
  });

  // On Fire — biggest points gain last round
  const onFire = ranked.filter(p => p.lastChange > 0)
    .sort((a,b) => b.lastChange - a.lastChange)[0];
  if (onFire) badges[onFire.name].push({ icon:"⚡", label:"On Fire", desc:`+${onFire.lastChange}pts last round` });

  // Rough Night — owns most eliminated teams
  const mostElim = ranked.filter(p => !p.grimReaper)
    .sort((a,b) => (b.teams?.filter(t => t.eliminated && !t.won).length||0) - (a.teams?.filter(t => t.eliminated && !t.won).length||0))[0];
  if (mostElim && mostElim.teams?.filter(t => t.eliminated && !t.won).length > 0)
    badges[mostElim.name].push({ icon:"💀", label:"Rough Night", desc:"Most teams eliminated" });

  // Clean Sheet — owns a team that kept a clean sheet in groups
  const cleanSheetOwners = new Set();
  done.filter(m => (m.stage||"").toUpperCase().includes("GROUP")).forEach(m => {
    const h = m.homeTeam?.tla?.toUpperCase();
    const a = m.awayTeam?.tla?.toUpperCase();
    const hs = m.score?.fullTime?.home ?? 0;
    const as_ = m.score?.fullTime?.away ?? 0;
    if (as_ === 0 && hs > 0) { const owner = ranked.find(p => p.codes?.includes(h)); if (owner) cleanSheetOwners.add(owner.name); }
    if (hs === 0 && as_ > 0) { const owner = ranked.find(p => p.codes?.includes(a)); if (owner) cleanSheetOwners.add(owner.name); }
  });
  cleanSheetOwners.forEach(name => {
    if (badges[name]) badges[name].push({ icon:"🧤", label:"Clean Sheet", desc:"A team kept a clean sheet" });
  });

  return badges;
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
    if (bounty > 0) running["Josh"] += bounty;
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
      if (drought > 0) running["Josh"] = (running["Josh"] || 0) + drought;

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
      if (drought > 0) { running["Josh"] = (running["Josh"] || 0) + drought; changedPlayers.add("Josh"); }
      [h, a].forEach(code => {
        if (code) groupGames[code] = (groupGames[code]||0) + 1;
        if (code && groupGames[code] >= 3 && !knockoutTeams.has(code) && !eliminated[code]) {
          eliminated[code] = "GROUP_ELIM"; award(code, "GROUP_ELIM");
          const bounty = reaperBountyForCode(code);
          if (bounty > 0) { running["Josh"] += bounty; changedPlayers.add("Josh"); }
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
      if (drought > 0) { running["Josh"] = (running["Josh"] || 0) + drought; liveChanged.add("Josh"); }
    });
    if (liveChanged.size > 0) PLAYERS.forEach(p => history[p.name].push(running[p.name]));
  }

  return history;
}
