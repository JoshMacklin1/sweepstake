// Sweepstaker League — draft backend (Cloudflare Worker + Durable Object)
//
// One Durable Object instance per league code holds the authoritative league
// state (lobby -> drafting -> complete) and pushes live updates to every
// connected client over a WebSocket. Deployed as its own Worker, independent
// of the football-proxy match/push Worker, so it can't affect that service.
//
// The Worker knows nothing about football itself: at create time the client
// sends the pool of eligible team ids (derived from LEAGUE_TEAMS filtered by
// the chosen competitions, in league-scoring.js — still the single source of
// truth). The Worker just arbitrates who owns which opaque id, enforces turn
// order, and broadcasts state. Scoring/standings stay entirely client-side.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusable chars
function makeCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}
function makeToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["league","ABC123","join"]
    if (parts[0] !== "league") return json({ error: "not_found" }, 404);

    // POST /league  -> allocate a fresh code + Durable Object, then create.
    if (parts.length === 1 && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
      // Retry a handful of times in the (astronomically unlikely) event of a
      // code collision with an already-initialised league.
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = makeCode();
        const stub = env.LEAGUE.get(env.LEAGUE.idFromName(code));
        const res = await stub.fetch("https://do/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, code }),
        });
        if (res.status !== 409) return res; // 409 = code already taken, retry
      }
      return json({ error: "could_not_allocate_code" }, 500);
    }

    // /league/:code/...  -> route to that league's Durable Object.
    const code = (parts[1] || "").toUpperCase();
    if (!code) return json({ error: "no_code" }, 400);
    const stub = env.LEAGUE.get(env.LEAGUE.idFromName(code));
    return stub.fetch(request);
  },
};

export class League {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this._data = null;
  }

  async load() {
    if (this._data) return this._data;
    this._data = (await this.state.storage.get("data")) || null;
    // Migrate leagues created before host was a tracked role: derive the host
    // player from the old hostToken (fall back to the first player).
    if (this._data && this._data.hostPlayerId === undefined) {
      const hp = this._data.players.find(p => this._data.hostToken && p.token === this._data.hostToken);
      this._data.hostPlayerId = hp ? hp.id : (this._data.players[0] ? this._data.players[0].id : null);
      await this.save();
    }
    return this._data;
  }
  async save() {
    await this.state.storage.put("data", this._data);
  }

  // Public projection — never leaks player tokens or the host token.
  view(d) {
    return {
      code: d.code,
      name: d.name,
      competitions: d.competitions,
      status: d.status,
      players: d.players.map(p => ({ id: p.id, name: p.name, joinedAt: p.joinedAt })),
      order: d.order,
      picks: d.picks,
      turnNo: d.turnNo,
      poolSize: d.pool.length,
      perPlayer: d.perPlayer,
      totalPicks: d.totalPicks,
      hostPlayerId: d.hostPlayerId,
      currentPlayerId: this.currentPlayerId(d),
    };
  }

  currentPlayerId(d) {
    return d.status === "drafting" ? this.playerAtPick(d, d.turnNo) : null;
  }

  // Snake / ABBA ordering across perPlayer rounds: forward, reverse, forward...
  playerAtPick(d, n) {
    const P = d.order.length;
    if (!P) return null;
    const round = Math.floor(n / P);
    const pos = n % P;
    const idx = round % 2 === 0 ? pos : (P - 1 - pos);
    return d.order[idx];
  }

  broadcast() {
    const msg = JSON.stringify({ type: "state", state: this.view(this._data) });
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(msg); } catch { /* dropped socket */ }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const seg = url.pathname.split("/").filter(Boolean);
    const action = seg[seg.length - 1];

    // WebSocket upgrade: GET /league/:code/ws  (live draft + lobby feed)
    if (action === "ws" && request.headers.get("Upgrade") === "websocket") {
      const d = await this.load();
      if (!d) return json({ error: "not_found" }, 404);
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]); // hibernatable — free-tier friendly
      pair[1].send(JSON.stringify({ type: "state", state: this.view(d) }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // POST /create  (called by the top-level Worker with an allocated code)
    if (request.method === "POST" && action === "create") {
      if (await this.load()) return json({ error: "exists" }, 409);
      const body = await request.json().catch(() => ({}));
      const now = Date.now();
      const hostToken = makeToken();
      this._data = {
        code: body.code,
        name: (body.name || "League").trim(),
        competitions: Array.isArray(body.competitions) ? body.competitions : [],
        pool: Array.isArray(body.poolTeamIds) ? body.poolTeamIds.map(Number) : [],
        status: "lobby",
        hostToken,
        players: [],
        order: [],
        picks: [],
        turnNo: 0,
        perPlayer: 0,
        totalPicks: 0,
        hostPlayerId: null,
        createdAt: now,
      };
      // The host is a player too if they named themselves at create time.
      let hostPlayerId = null;
      if (body.hostName && body.hostName.trim()) {
        hostPlayerId = makeToken().slice(0, 12);
        this._data.players.push({ id: hostPlayerId, name: body.hostName.trim(), token: hostToken, joinedAt: now });
        this._data.hostPlayerId = hostPlayerId;
      }
      await this.save();
      return json({ code: this._data.code, hostToken, playerId: hostPlayerId, state: this.view(this._data) });
    }

    const d = await this.load();
    if (!d) return json({ error: "not_found" }, 404);

    // GET /league/:code  or  /league/:code/state  -> current snapshot
    if (request.method === "GET" && (seg.length === 2 || action === "state")) {
      return json({ state: this.view(d) });
    }

    // POST /join { name }  -> add a player (lobby only)
    if (request.method === "POST" && action === "join") {
      if (d.status !== "lobby") return json({ error: "closed" }, 409);
      const body = await request.json().catch(() => ({}));
      const name = (body.name || "").trim();
      if (!name) return json({ error: "name_required" }, 400);
      if (d.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
        return json({ error: "name_taken" }, 409);
      const player = { id: makeToken().slice(0, 12), name, token: makeToken(), joinedAt: Date.now() };
      d.players.push(player);
      await this.save();
      this.broadcast();
      return json({ playerId: player.id, token: player.token, state: this.view(d) });
    }

    // POST /leave { token }  -> a player leaves. In the lobby they're removed
    // from the roster; if they were the host, the role passes to the next
    // player. During a draft, leaving is client-side only (roster/picks/turns
    // must stay intact), so this is a no-op server-side.
    if (request.method === "POST" && action === "leave") {
      const body = await request.json().catch(() => ({}));
      const player = d.players.find(p => p.token === body.token);
      if (!player) return json({ ok: true, state: this.view(d) });
      if (d.status === "lobby") {
        d.players = d.players.filter(p => p.id !== player.id);
        if (d.hostPlayerId === player.id) {
          d.hostPlayerId = d.players.length ? d.players[0].id : null;
        }
        await this.save();
        this.broadcast();
      }
      return json({ ok: true, state: this.view(d) });
    }

    // POST /start { token }  -> randomise order, close the lobby (host only)
    if (request.method === "POST" && action === "start") {
      const body = await request.json().catch(() => ({}));
      // The caller must be the current host player. Accept the player token
      // (new clients) or the legacy hostToken (old cached clients) — for the
      // original host they're the same value.
      const caller = d.players.find(p => p.token === body.token || (body.hostToken && p.token === body.hostToken));
      if (!caller || caller.id !== d.hostPlayerId) return json({ error: "forbidden" }, 403);
      if (d.status !== "lobby") return json({ error: "already_started" }, 409);
      if (d.players.length < 2) return json({ error: "need_players" }, 400);
      const ids = d.players.map(p => p.id);
      for (let i = ids.length - 1; i > 0; i--) { // Fisher–Yates
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      d.order = ids;
      d.perPlayer = Math.floor(d.pool.length / ids.length);
      d.totalPicks = d.perPlayer * ids.length;
      d.turnNo = 0;
      d.status = d.totalPicks > 0 ? "drafting" : "complete";
      await this.save();
      this.broadcast();
      return json({ state: this.view(d) });
    }

    // POST /pick { token, teamId, expectedTurnNo }  -> claim a team on your turn
    if (request.method === "POST" && action === "pick") {
      const body = await request.json().catch(() => ({}));
      if (d.status !== "drafting") return json({ error: "not_drafting" }, 409);
      const player = d.players.find(p => p.token === body.token);
      if (!player) return json({ error: "unknown_player" }, 403);
      if (this.playerAtPick(d, d.turnNo) !== player.id)
        return json({ error: "not_your_turn", state: this.view(d) }, 409);
      if (typeof body.expectedTurnNo === "number" && body.expectedTurnNo !== d.turnNo)
        return json({ error: "stale_turn", state: this.view(d) }, 409);
      const teamId = Number(body.teamId);
      if (!d.pool.includes(teamId)) return json({ error: "not_in_pool" }, 400);
      if (d.picks.some(pk => pk.teamId === teamId)) return json({ error: "taken", state: this.view(d) }, 409);
      d.picks.push({ teamId, playerId: player.id, pickNo: d.turnNo });
      d.turnNo += 1;
      if (d.picks.length >= d.totalPicks) d.status = "complete";
      await this.save();
      this.broadcast();
      return json({ state: this.view(d) });
    }

    return json({ error: "not_found" }, 404);
  }

  // Hibernatable WebSocket handlers. Clients only receive broadcasts; any
  // inbound message is ignored so a chatty client can't mutate state here.
  async webSocketMessage() { /* no-op */ }
  async webSocketClose(ws) { try { ws.close(); } catch { /* already closed */ } }
  async webSocketError(ws) { try { ws.close(); } catch { /* already closed */ } }
}
