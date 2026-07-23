# TRMission (台鐵任務) — Development Plan

## Context

We are building **TRMission (台鐵任務)**, a multiplayer web board game: a **clean-room reimplementation of the game *mechanics* of *Ticket to Ride: Europe* (2015)**, re-themed onto **Taiwan's railways**. The rulebook (`te_rules_2015_en.pdf`) is the mechanical reference only — **no artwork, names, layout, or verbatim rules text are copied**. The map, the city graph, all SVG art, the colour palette, and the rules wording are **original**; only the underlying mechanics and the real Taiwanese place-names are reused.

Why this shape: the game is *entirely about hidden information* (each player's hand and secret destination tickets), so it demands a **fully server-authoritative** design with strict fog-of-war, plus a **deterministic, replayable engine** for crash recovery, audit, and anti-cheat. The product must ship in **Traditional Chinese (primary) + English**, with realtime play over **protobuf-over-WebSocket**, a documented **REST control plane** (dynamic OpenAPI rendered with **Scalar**), and **MongoDB** persistence.

**Confirmed by the user:**
- Backend: **Node.js + TypeScript, NestJS** (HTTP controllers + WebSocket gateway).
- Realtime: **protobuf over WebSocket**; REST API documented via **dynamically-generated OpenAPI + Scalar**.
- Persistence: **MongoDB**.
- Frontend: **React + TypeScript + Vite + Yarn workspaces**, **Lucide** for UI chrome, **self-developed SVG** for all game art.
- i18n: **zh-Hant primary + en**.
- Map: **original Taiwan-geography map**, using real TRA/THSR/branch-line stations as inspiration (per the user's explicit instruction).
- Ruleset: **full** (routes, locomotives, double-routes, ferries, tunnels, stations, long+short tickets, longest-path bonus, full scoring + tiebreakers).
- Accounts: **guests via room codes + optional registered accounts** (stat-preserving upgrade).
- Players: **2–5** per game.

This plan was produced from a parallel design pass across 9 domains plus a principal-engineer critique. The critique caught several cross-domain contradictions (codec, DB driver, PRNG, idempotency, etc.); **§3 resolves each one as a binding decision** before any code is written.

---

## 1. Game summary (mechanics to implement — rephrased, never copied)

Turn-based, server-authoritative. On a turn a player does **exactly one** of:
1. **Draw train cards** — take 2 (from the 5 face-up market or blind deck). Taking a face-up **Locomotive** (wild) consumes the whole draw (only 1). If **3 of the 5** face-up are Locomotives, discard all 5 and redraw.
2. **Claim a route** — play a set matching the route's colour & length. **Gray** routes accept any one colour; Locomotives are wild. Place trains, score immediately. **Double-routes**: a player can't own both of a pair; in **2–3p only one** of each pair is usable (claiming locks the other).
3. **Draw destination tickets** — draw 3, keep ≥1; rest to the bottom.
4. **Build a station** — 1st costs 1 card, 2nd costs 2 of one colour, 3rd costs 3 of one colour (Locos wild). Max 3 per player.

Signature mechanics: **Ferries** (gray routes needing N Locomotives for N symbols), **Tunnels** (lay cards → reveal top 3 → pay 1 extra per colour match or abort), **Stations** (borrow one opponent route into a city for ticket connectivity; +4 each if unused).

Scoring table (length→pts): **1→1, 2→2, 3→4, 4→7, 6→15, 8→21** (no length 5/7). Endgame triggers when a player's car stock hits **≤2** at end of turn → one final round → score. Final = route pts + completed-ticket values − failed-ticket values + 4×unused stations + **10** longest-continuous-path bonus (ties share). Tiebreak: total → most completed tickets → fewest stations used → holds longest-path bonus.

---

## 2. Architecture overview

**Monorepo (Yarn 4 + Turborepo), scope `@trm/*`, ESM everywhere, Node 20 LTS.** Internal packages export TS source (no per-lib build) except `proto` (codegen). Two communication planes:

- **REST control plane** (identity, lobby write-path, history, content, health, WS handoff ticket) — documented OpenAPI + Scalar.
- **Realtime plane** (all in-game actions + live state) — protobuf binary frames over WebSocket.

```
trmission/
├─ packages/
│  ├─ proto/       # .proto source of truth + protobuf-es generated code (gitignored gen/)
│  ├─ shared/      # TrainColor enum, SCORING_TABLE, counter-PRNG, error-code map, ids, zod DTOs
│  ├─ map-data/    # CANONICAL authored Taiwan content (cities/routes/tickets) + validate() + contentHash
│  ├─ engine/      # PURE deterministic reducer (reduce/validate/apply, scoring, longest-trail, connectivity)
│  └─ ui-kit/      # (optional) shared React/SVG primitives
└─ apps/
   ├─ server/      # NestJS: WS gateway + REST + Mongo repositories + auth + OpenAPI/Scalar
   └─ web/         # React + Vite client (zustand+immer, protobuf-es, react-i18next, custom SVG)
```

Build/typecheck order: `proto → shared → map-data → engine → (ui-kit) → server, web`.

**The engine is the heart.** It is a pure function `reduce(state, action) → { state, events }` with **zero I/O** and all randomness from a seed inside the state. The server feeds it actions and ships its events as protobuf; the client imports it for **selectors only** (legal-move hints, optimistic preview) but the **server is the sole authority** and the client never trusts its own result.

---

## 3. Resolved cross-cutting decisions (ADRs) — settle these before coding

The domain designs disagreed on several load-bearing choices. These are the binding resolutions (one short ADR committed per item in Phase 0). Each is a sensible best-practice default within the approved architecture — flag any you'd override.

| # | Decision | Choice | Why |
|--|--|--|--|
| A1 | **Proto codec (ONE)** | **protobuf-es (`@bufbuild/protobuf`) via buf** | Isomorphic browser+node; same generated types consumed identically by server and web over raw binary WS frames. (Overrides ts-proto in server/proto drafts.) |
| A2 | **DB driver (ONE)** | **native `mongodb` driver** behind typed repositories + collection `$jsonSchema` validators | Engine owns the state object; hot path needs explicit atomic operators/write-concern; avoids Mongoose schema duplication. |
| A3 | **Validation/OpenAPI source (ONE)** | **zod** as single source via **`nestjs-zod`** (+ `@anatine/zod-openapi`), rendered by **Scalar** at `/docs` | Documented schema and enforced validation cannot diverge; same zod also feeds Mongo `$jsonSchema`. (Overrides class-validator drafts.) |
| A4 | **PRNG (ONE)** | integer-only **counter PRNG** (`splitmix32` seeded by `cyrb53→uint32`), state `{seed,counter}:uint32` in `GameState.rng`; **checked-in cross-platform conformance vector** | Replay must be byte-identical in node + browser V8; uint32 keeps state thin and serialization clean. |
| A5 | **Event-log semantics (ONE)** | **intent (Action) log** + embedded snapshot each action + durable `gameSnapshots` checkpoints carrying a **stateDigest** | Compact, fully replayable through the deterministic engine; digest enables divergence detection on recovery. |
| A6 | **Version pinning** | stamp **`engineVersion` + `contentHash` + `schemaVersion`** on `games`/`matchHistory`; replay refuses cross-version unless a transcoder exists | Intent-replay correctness depends on frozen engine logic + content. |
| A7 | **Idempotency key (ONE)** | durable unique index **`(gameId, clientMsgId:uuid)`**, checked **before** apply; reconnection reconciles on **per-game `stateVersion`** only | In-memory LRU is not crash-safe; collapsing the 3-counter confusion removes resync corruption. |
| A8 | **REST→WS handoff (ONE)** | short-lived (~45s) REST-minted **ws-game ticket** (`aud:'ws-game'`, `{gameId,playerId,seat,color}`) sent as first protobuf frame **`ClientHello`**; gateway verifies + binds socket | One coherent seam; minted by `POST /rooms/:code/start` and `POST /games/:gameId/ticket` (reconnect). |
| A9 | **Guest identity (ONE)** | guests are **real `users` docs** (`isGuest:true` + TTL `guestExpiresAt`); upgrade keeps same `_id`, unset expiry | Stat-preserving guest→registered upgrade requires a DB account. |
| A10 | **JWT (ONE)** | **HS256** access (~15m, carries `tokenVersion`) + opaque 256-bit refresh (argon2id-hashed, rotated, family reuse-detection) in httpOnly/Secure/SameSite=Strict cookie; ws-ticket signed by same issuer | Single-issuer cluster; simpler MVP ops. RS256+JWKS is the documented scale-out upgrade. |
| A11 | **Seat colours** | wire carries **abstract seat index 0–4**; CVD-safe seat palette (teal/magenta/amber/slate/lime) applied **client-side** | Seat colours must be visually distinct from the 8 card colours for colourblind safety. |
| A12 | **6th colour name** | **PURPLE** everywhere (proto/shared/art/map) | Removes the PINK↔PURPLE drift. |
| A13 | **Map source of truth (ONE)** | canonical authored tables in **`@trm/map-data`** → generation step emits engine board data + client catalog (ids only) + `contentHash`; Mongo `mapDefinitions` is **seeded** from it (versioned, immutable-when-published) | One author surface; everything else is a generated/derived artifact. |
| A14 | **Per-game serialization** | explicit **per-game async command queue (mutex)** so decode→validate→apply→persist→ack is atomic per game; + unique `(gameId, seq)` append guard + idempotent room-start CAS | Prevents double-apply via reconnect resend / intra-node interleaving. |
| A15 | **Termination rule** | a **full round where every player can only PASS forces final scoring**; dangling `TUNNEL_PENDING`→auto-abort, `TICKET_SELECTION`→auto-keep-min, injected as **logged** actions | Guarantees the game always terminates (starved-deck stall) and disconnects can't hang the table. |
| A16 | **Turn timer / auto-turn** | configurable turn timer; on expiry the server injects a **deterministic logged auto-action** (auto-keep-min / auto-abort-tunnel / else auto-draw-blind / else PASS). Wall-clock only triggers injection; the action itself is replayable | Default: on for public rooms, configurable/off for private. |
| A17 | **Scale scope** | **MVP = single vertically-scaled instance**; the per-game lease provides **failover/recovery only**. In-memory throttler + in-memory lobby push (no Redis dependency for MVP) | Multi-node (Redis pub/sub + sticky WS routing by `gameId` hash + spectator fan-out) is a deferred scale phase. |
| A18 | **Error taxonomy** | a **single 1:1 mapping table** in `@trm/shared`: engine `RuleViolation` → proto `RejectionCode` → REST `error.code` → i18n `messageKey` | Keeps localized rejection messages from drifting across four enums. |
| A19 | **Canonical naming** | **author the `.proto` first**; all packages align to its exact names (`PublicPlayerState`, `train_card_count`, `StateDelta`, `ClientHello`, `GameEvent` oneof, …) | Removes schema-name drift across docs. |

---

## 4. Engine specification (the critical package: `@trm/engine`)

Pure reducer; no I/O, no `Date.now`/`Math.random` (ESLint-banned in this package). `initGame(config) + Action[]` **replays byte-identically** (verified by `stateDigest` = key-sorted SHA-256).

**State model (key shapes):** hands & discard as **colour-count multisets** (fungible, conservation-friendly); deck & 5-card market as **ordered arrays** (blind draws + tunnel reveals expose specific cards); `ownership[routeId] = null | {owner} | {locked:true}`; `stations[]`; per-player `keptTickets` (ids only; secret); `turn` FSM phase ∈ `SETUP_TICKETS | AWAIT_ACTION | DRAWING_CARDS | TICKET_SELECTION | TUNNEL_PENDING | GAME_OVER`; `pendingTunnel`, `pendingTicketDraw`, `endgame{triggered, finalTurnsRemaining}`, `rng`, `actionSeq`.

**Hard flows (each gets named unit + golden tests):**
- **Tunnel (two-phase):** Phase A validates the base payment but **keeps base cards in hand** (abort is free), reveals top `min(3,deck)` (reshuffle discard if <3 — base cards stay in hand so can't be revealed against themselves), computes `extraRequired = revealed matching playedColor or LOCO`, → `TUNNEL_PENDING`. Phase B `RESOLVE_TUNNEL`: commit (spend base+extra, assign, lock sibling, score, end turn) or abort (discard reveal only, end turn).
- **Ferry:** gray route, `payment.locomotives ≥ ferryLocos`, `colorCount+locomotives===length`, colored portion one chosen colour.
- **Double-route:** group by `parallelGroupId`; variant `SINGLE_ONLY` (≤3p) locks sibling on claim; no player may own both in any count.
- **Ticket completion + station borrow:** union-find connectivity over owned edges, augmented by an **exhaustive deterministic assignment search** over each station's ≤1 borrowed opponent edge (≤ ~7³ assignments), maximizing `(netPoints, completed, fewest borrows)`. Borrowed edges affect connectivity only.
- **Longest continuous path = max-weight trail** (edges distinct, vertices may repeat): **contract degree-2 chains → branch-and-bound DFS with reachable-weight pruning → bitmask-over-edges DP fallback** gated by a **deterministic instruction-count budget** (never wall-clock). Bounded by `E ≤ 45` (train cap), typically ≤ ~18. **Must prove/clamp a guaranteed-terminating exact bound** and cross-check B&B vs DP in property tests.
- **Endgame:** trigger at trains ≤2 end-of-turn → `finalTurnsRemaining = numPlayers`, decrement per turn, no re-extension → `GAME_OVER` computes `FinalScoreboard` + ranking groups (co-winners possible).

**Invariants (asserted in dev, fast-check'd):** global & per-colour card conservation (110 total; 12/14 per colour), train conservation (`remaining + Σ owned-length === 45`), score monotonicity, ownership exclusivity (+ double-route mutual exclusion), station ≤3 & ≤1/turn, RNG counter monotonic, **replay identity** (`stateDigest(replay)===stateDigest(live)`).

**Selectors (outside the reducer):** `legalActions(state, playerId)`, `enumerateClaimPayments(state, routeId)`, `previewScore`, and `redactFor(state, viewerId)` — the **single projection choke point** that strips other hands, deck order, and secret tickets. Raw `GameState` must be **non-serializable to the wire by construction**.

---

## 5. Realtime protocol, REST, data, frontend, art (condensed)

**Protocol (`@trm/proto`):** two envelopes — `ClientEnvelope{client_seq, oneof command}` / `ServerEnvelope{server_seq, ack_client_seq, oneof event}`. First frame is **`ClientHello`** (ws-game ticket; A8). **Hidden info structurally impossible:** `PublicPlayerState` carries only counts (`train_card_count`, `destination_ticket_count`) — no field can hold a colour/city; secrets live in disjoint owner-only types embedded **only** in frames addressed to the owner. Blind draws broadcast count-only + a private `PrivateHandUpdate`. Deltas batched & versioned (`StateDelta from_version→to_version`); reconnect falls back to a **fresh projected `GameSnapshot`** keyed on `stateVersion` (delta-replay deferred). Commands: draw (one pick per command: `face_up_slot|from_deck`), claim, tunnel decision (continue/abort), draw/select tickets (handles INITIAL_DEAL too), build station, lobby ready/start, chat. Rejections carry an i18n `messageKey`.

**REST (`apps/server`, Express platform):** `/api/v1` URI-versioned. Resources: `auth` (guest mint, register, login, refresh-rotate+reuse-detection, logout), `users/profile`+stats, `rooms` (create/join-by-code/list/ready/seat/settings/kick/transfer/**start**), `games/:id/ticket` (reconnect handoff), `matchHistory` (list+detail/replay), `content` (map definition + ticket catalog — **never** which tickets a live player holds), `health`/`version`. OpenAPI from zod (A3) at `/api/openapi.json` → Scalar at `/docs` (gated off in prod). Global zod `ValidationPipe`, `ThrottlerGuard` (in-memory MVP), Helmet, explicit CORS allowlist (`credentials:true` for refresh cookie), consistent error envelope `{error:{code,message,messageKey,status,timestamp,path,requestId,details[]}}`.

**Data (MongoDB, native driver, A2/A5/A6/A7):** collections — `users` (guest/registered, argon2id creds, locale, stats, TTL on guests), `authSessions` (refresh families), `rooms`, `games` (`seed`, `config`, `engineVersion`, `contentHash`, append-only `gameEvents` + embedded snapshot each action + `seq`), `gameSnapshots` (durable checkpoints + `stateDigest`, every 16 actions / turn boundary / pre-final-round / shutdown), `matchHistory` (archived finished games), `mapDefinitions` (versioned, immutable-when-published, seeded from `@trm/map-data`). Optimistic concurrency via `games.seq` filter + unique `(gameId, seq)`; single-writer lease (`ownerNode`/`leaseExpiresAt`); `writeConcern: majority` for events/snapshots/completion; multi-doc transactions only for completion/upgrade/token-rotation; sliding-TTL on guests/sessions/abandoned lobbies/idle games. **Recovery:** rehydrate from latest snapshot + replay tail, **verify digest**.

**Frontend (`apps/web`):** zustand+immer split stores — `gameStore` (authoritative mirror), `optimistic` (pending-action queue via `produceWithPatches` forward+inverse), `interactionStore` (client-only selection FSM, kept out of the mirror for perf), session/room/connection/settings. Mirror = **snapshot-then-deltas**; seq gap → Resync. **Optimistic only** for the local seat's claim/draw (reconcile on Ack, roll back via inverse patches on reject); tunnels & ticket-keeps are **server-driven** (server randomness). `GameSocket` singleton (protobuf-es, heartbeat, backoff reconnect, survives `/room`↔`/game` nav); REST via TanStack Query. react-i18next zh-Hant primary + en, **lazy namespaces**; city/ticket names resolved from content-catalog ids via `t('cities:'+id)` (`useCityName`/`useTicketLabel`). Board = one fluid SVG (viewBox + pan/zoom via `@use-gesture`). A11y: roving-tabindex graph nav, aria-live event log, Radix dialogs; **colourblind-safe** (hue + pattern + glyph; `patternMode` setting). **Lucide = chrome only**; all game pieces are custom parameterized SVG.

**Art system (self-developed, no TtR assets):** brand = "railway timetable on warm paper", EMU-blue primary `#0F5FA6` + express-ember `#EE6B1F` (original hex, only the *spirit* of TRA/THSR referenced). 8 train colours each get original hex **+ mandatory pattern + glyph** (colourblind-safe via shape, not hue); luminance spread for monochrome separation; wild Locomotive = brushed-metal + streamlined-nose icon (reads in greyscale). `@trm/shared/trainColors.ts` mirrors the proto `TrainColor` enum and emits CSS tokens (server scoring ↔ client art in sync). Map = one portrait SVG generated from `board.json`; rail = N skewed parallelogram "car slots"; tunnels = dashed + portal symbol; ferries = wave tiles + N loco pips; double-routes = offset parallel tracks. ~7 hand-authored `<symbol>` primitives → one SVGO sprite, recoloured via `currentColor`. Fonts: Noto Serif/Sans TC + Fraunces/Inter + IBM Plex Mono (all SIL OFL, self-hosted, CJK-subset). Design tokens as `--tr-*` CSS custom properties + type-safe mirror + dark theme.

---

## 6. Authored Taiwan map content (canonical seed → `@trm/map-data`)

Original topology inspired by real TRA/THSR/branch lines; graph, colourings, lengths, and ticket set are newly authored. Coordinates `x=0(west)…100(east)`, `y=0(north)…100(south)` for direct SVG placement. **Verified by script: connected graph, no unreachable node, 90 segments, total track length 188.** This is the concrete deliverable for the content package and the Mongo seed.

**Card colours (8 + wild):** RED 紅 · ORANGE 橙 · YELLOW 黃 · GREEN 綠 · BLUE 藍 · PURPLE 紫 · BLACK 黑 · WHITE 白 + LOCOMOTIVE 機車頭 (wild). GRAY 灰 is a route attribute only.

### 6.1 Cities (46 nodes)

| # | 中文 | English | x | y | region | island |
|--|--|--|--|--|--|--|
|1|基隆|Keelung|63|5|North|no| |2|瑞芳|Ruifang|66|8|North|no| |3|臺北|Taipei|58|9|North|no| |4|淡水|Tamsui|53|6|North|no|
|5|板橋|Banqiao|56|11|North|no| |6|桃園|Taoyuan|51|14|North|no| |7|中壢|Zhongli|48|17|North|no| |8|新竹|Hsinchu|43|22|NW|no|
|9|竹南|Zhunan|42|25|NW|no| |10|苗栗|Miaoli|41|29|NW|no| |11|大甲|Dajia|38|31|C-West 海線|no| |12|沙鹿|Shalu|37|35|C-West 海線|no|
|13|豐原|Fengyuan|43|34|C-West 山線|no| |14|臺中|Taichung|41|38|C-West|no| |15|彰化|Changhua|39|41|C-West|no| |16|鹿港|Lukang|35|42|C-West coast|no|
|17|員林|Yuanlin|40|44|C-West|no| |18|南投|Nantou|47|43|Interior|no| |19|日月潭|Sun Moon Lake|51|46|Interior|no| |20|二水|Ershui|40|46|C-West|no|
|21|斗六|Douliu|40|49|Yun-Chia-Nan|no| |22|嘉義|Chiayi|38|53|Yun-Chia-Nan|no| |23|阿里山|Alishan|48|55|Interior|no| |24|新營|Xinying|37|57|Yun-Chia-Nan|no|
|25|臺南|Tainan|36|61|Yun-Chia-Nan|no| |26|高雄|Kaohsiung|38|66|South|no| |27|屏東|Pingtung|44|66|South|no| |28|潮州|Chaozhou|45|70|South|no|
|29|枋寮|Fangliao|45|75|South|no| |30|恆春|Hengchun|48|86|South cape|no| |31|大武|Dawu|53|80|South-link|no| |32|臺東|Taitung|58|76|South-link|no|
|33|知本|Zhiben|56|78|South-link|no| |34|池上|Chishang|61|67|East-Rift|no| |35|玉里|Yuli|64|61|East-Rift|no| |36|花蓮|Hualien|68|49|East-Rift|no|
|37|蘇澳|Su'ao|65|34|Northeast|no| |38|羅東|Luodong|63|31|Northeast|no| |39|宜蘭|Yilan|62|28|Northeast|no| |40|頭城|Toucheng|63|24|Northeast|no|
|41|澎湖|Penghu|20|56|Islands|yes| |42|金門|Kinmen|5|48|Islands|yes| |43|馬祖|Matsu|22|10|Islands|yes| |44|小琉球|Liuqiu|31|69|Islands|yes|
|45|綠島|Green Island|70|78|Islands|yes| |46|蘭嶼|Orchid Island|73|88|Islands|yes| | | | | | | |

### 6.2 Routes (90 segments; flags: **D-x** double-pair, **Ferry(n)**, **Tunnel**)

| ID | A | B | Color | Len | Flag | | ID | A | B | Color | Len | Flag |
|--|--|--|--|--|--|--|--|--|--|--|--|--|
|R1|基隆|瑞芳|Yellow|1| | |R46|臺中|日月潭|Blue|4|Tunnel|
|R2|基隆|臺北|Black|2| | |R47|南投|阿里山|White|3|Tunnel|
|R3|瑞芳|臺北|Orange|1| | |R48|嘉義|阿里山|Blue|3|Tunnel 林鐵|
|R4|臺北|淡水|Blue|1| | |R49|阿里山|日月潭|Orange|4|Tunnel|
|R5|淡水|桃園|White|3| | |R50|日月潭|花蓮|Gray|8|Tunnel (central, marquee)|
|R6|臺北|板橋|White|1|D-A| |R51|嘉義|新營|Purple|1| |
|R7|臺北|板橋|Red|1|D-A| |R52|斗六|新營|Red|2| |
|R8|板橋|桃園|Green|2|D-B| |R53|新營|臺南|Black|2|D-H|
|R9|板橋|桃園|Orange|2|D-B| |R54|新營|臺南|Yellow|2|D-H|
|R10|桃園|中壢|Yellow|1|D-C| |R55|嘉義|臺南|Green|3|THSR bypass|
|R11|桃園|中壢|Purple|1|D-C| |R56|臺南|高雄|Red|2|D-I|
|R12|中壢|新竹|Blue|2|D-D| |R57|臺南|高雄|White|2|D-I|
|R13|中壢|新竹|Red|2|D-D| |R58|高雄|屏東|Yellow|2|D-J|
|R14|桃園|新竹|Black|3|THSR bypass| |R59|高雄|屏東|Blue|2|D-J|
|R15|中壢|苗栗|Orange|3| | |R60|臺南|屏東|Purple|3| |
|R16|新竹|竹南|Gray|1| | |R61|屏東|潮州|Blue|1| |
|R17|新竹|苗栗|Green|2| | |R62|高雄|潮州|Green|2| |
|R18|臺北|宜蘭|Gray|4|Tunnel 雪隧| |R63|潮州|枋寮|Orange|2| |
|R19|竹南|苗栗|Red|1| | |R64|屏東|枋寮|White|3| |
|R20|苗栗|豐原|Blue|2|Tunnel 山線| |R65|枋寮|大武|Black|4|Tunnel 南迴|
|R21|豐原|臺中|Black|1| | |R66|大武|知本|Green|2|Tunnel 南迴|
|R22|苗栗|臺中|White|3|山線 alt| |R67|知本|臺東|Red|1| |
|R23|臺中|彰化|Orange|1|D-E| |R68|枋寮|恆春|Gray|3|Tunnel|
|R24|臺中|彰化|Green|1|D-E| |R69|恆春|大武|Yellow|3|Tunnel|
|R25|竹南|大甲|White|2|海線| |R70|恆春|臺東|Gray|6|scenic coast|
|R26|大甲|沙鹿|Yellow|1|海線| |R71|臺東|池上|White|2| |
|R27|大甲|苗栗|Green|2| | |R72|池上|玉里|Orange|1| |
|R28|沙鹿|彰化|Purple|2|海線| |R73|臺東|玉里|Black|3| |
|R29|沙鹿|臺中|Red|1| | |R74|玉里|花蓮|Purple|3| |
|R30|沙鹿|員林|Blue|3| | |R75|花蓮|蘇澳|Blue|4|Tunnel 北迴/蘇花|
|R31|彰化|鹿港|Red|1| | |R76|蘇澳|羅東|Black|1| |
|R32|鹿港|員林|Orange|2| | |R77|蘇澳|宜蘭|Purple|1| |
|R33|彰化|員林|Blue|1|D-F| |R78|羅東|宜蘭|Green|1| |
|R34|彰化|員林|Black|1|D-F| |R79|宜蘭|頭城|Yellow|1| |
|R35|臺中|員林|Yellow|2| | |R80|頭城|瑞芳|Red|3|Tunnel 草嶺|
|R36|員林|二水|Yellow|1| | |R81|基隆|馬祖|Gray|6|Ferry(2)|
|R37|二水|斗六|Orange|1| | |R82|嘉義|澎湖|Gray|3|Ferry(1) 布袋|
|R38|彰化|斗六|Purple|3| | |R83|高雄|澎湖|Gray|4|Ferry(2)|
|R39|斗六|嘉義|Green|2|D-G| |R84|澎湖|金門|Gray|4|Ferry(2)|
|R40|斗六|嘉義|White|2|D-G| |R85|高雄|金門|Gray|6|Ferry(3)|
|R41|臺中|南投|White|2| | |R86|枋寮|小琉球|Gray|2|Ferry(1) 東港|
|R42|員林|南投|Purple|2| | |R87|高雄|小琉球|Gray|3|Ferry(1)|
|R43|南投|二水|Gray|1| | |R88|臺東|綠島|Gray|2|Ferry(1)|
|R44|南投|日月潭|Red|2|Tunnel| |R89|臺東|蘭嶼|Gray|3|Ferry(2)|
|R45|二水|日月潭|Green|3|Tunnel 集集| |R90|綠島|蘭嶼|Gray|2|Ferry(1)|

**Stats:** 10 double-pairs (A–J, western corridor); 15 tunnels; 10 ferries reaching all 6 islands. Colour balance: Red/Green/Blue/White 10 each, Orange/Yellow 9, Purple/Black 8, Gray 16 (6 land + 10 ferry). **Core balance feature — three east-coast crossings:** north 北迴 R75 (len-4 tunnel), south 南迴 R65 (len-4 tunnel), centre R50 (len-8 gray tunnel marquee = 21pts). Owning/blocking one forces a long detour → east-coast & cross-island tickets are high-value and contested.

### 6.3 Destination tickets (6 long + 40 short; value = shortest-path track length + small risk bump)

**LONG:** L1 基隆–高雄 22 · L2 臺北–臺東 16 · L3 淡水–恆春 21 · L4 馬祖–蘭嶼 25 · L5 花蓮–臺南 17 · L6 金門–宜蘭 24.

**SHORT (40):** S1 基隆–新竹 8 · S2 板橋–新竹 5 · S3 臺北–蘇澳 6 · S4 瑞芳–宜蘭 5 · S5 桃園–苗栗 4 · S6 臺北–臺中 9 · S7 淡水–新竹 6 · S8 新竹–彰化 6 · S9 臺中–嘉義 6 · S10 苗栗–員林 5 · S11 臺中–日月潭 5 · S12 彰化–阿里山 7 · S13 大甲–斗六 6 · S14 鹿港–南投 5 · S15 竹南–彰化 5 · S16 嘉義–高雄 5 · S17 臺南–屏東 4 · S18 斗六–臺南 4 · S19 高雄–枋寮 5 · S20 彰化–臺南 7 · S21 南投–臺南 6 · S22 屏東–臺東 11 · S23 高雄–恆春 8 · S24 枋寮–知本 7 · S25 臺東–花蓮 6 · S26 大武–池上 6 · S27 花蓮–宜蘭 6 · S28 玉里–蘇澳 8 · S29 臺東–玉里 4 · S30 花蓮–羅東 6 · S31 臺中–花蓮 13 · S32 南投–玉里 13 · S33 新竹–臺南 12 · S34 臺中–高雄 9 · S35 高雄–澎湖 5 · S36 臺南–澎湖 7 · S37 嘉義–金門 8 · S38 臺東–綠島 3 · S39 枋寮–小琉球 3 · S40 臺東–蘭嶼 4.

Ship as `longTicketDeck`(6) + `shortTicketDeck`(40).

### 6.4 Component tuning + seed config

45 trains/player (vs 188 total track → ~80% claimable at 5p so endgame triggers naturally); 8×12=96 + 14 Locomotives = 110-card deck (all length-6/8 routes are **Gray**, claimable with one's strongest single colour, so 12/colour suffices); 3 stations/player (+4 each if unused); 5 seat colours distinct from card colours; market 5, redraw on 3 locos; longest-path +10. Seed `gameConfig`: `{trainsPerPlayer:45, stationsPerPlayer:3, deck:{perColor:12, locomotives:14}, market:{size:5, redrawOnLocos:3}, longestPathBonus:10, endgameTrainThreshold:2, scoreTable:{1:1,2:2,3:4,4:7,6:15,8:21}}`.

**To validate in playtesting (defaults faithful to TtR:Europe):** initial deal = 1 long + 3 short, keep ≥2; mid-game draw = 3 short, keep ≥1; R50 len-8 marquee (drop to 6 if rarely claimed); long-ticket variance (cap near ~21 if too swingy); 14 vs 16 locomotives if ferries stall; 45 vs a 42 two-player variant.

---

## 7. Top correctness risks & mitigations

1. **Hidden-information leak** (hands/tickets/deck order/tunnel reveals) — *game-breaking.* Disjoint wire types (`PublicPlayerState` can only carry counts), single `redactFor` choke point that **all** egress uses (snapshots, deltas, reconnect, tunnel reveals, errors, logs/audit), a CI **wire-level frame-sniffer leak test** over every frame type, a property test that projection never populates non-viewer secrets, and a `security_leak_detected` metric alerting on >0.
2. **Determinism / replay divergence** (breaks recovery, resync, audit). One integer-only counter PRNG with a **checked-in conformance vector run in node + browser**; freeze `CARD_COLORS` order; ESLint-ban `Date`/`Math.random`/Set-Map-iteration in `@trm/engine`; canonical key-sorted SHA-256 **golden-replay CI gate**; `engineVersion`+`contentHash` pins; store `stateDigest` with each snapshot.
3. **Double-apply of a mutating action** (reconnect resend / intra-node interleave / lease overlap). Per-game serialized command queue (A14), durable idempotency `(gameId,clientMsgId)` checked **before** apply (A7), unique `(gameId,seq)` append guard, idempotent room-start CAS, conservation invariants asserted on every apply.
4. **Longest-path & ticket station-borrow scoring** (NP-hard / non-terminating / wrong). Proven-terminating exact bound after contraction, **deterministic instruction-count budget** (never wall-clock), B&B↔DP cross-check on random graphs, confirm the borrow objective matches intended rules, golden fixtures with hand-verified scores (figure-eight trails, Euler-even components, borrow-only completion, longest-path ties).
5. **Endgame/termination & dangling pending-state.** Explicit all-PASS-forces-scoring rule (A15), deterministic auto-resolution of dangling tunnel/ticket-selection injected as logged actions, defined timeout/auto-turn action (A16), tests proving `finalTurnsRemaining` always reaches 0.

---

## 8. Phased delivery roadmap

Ordering: resolve contradictions → build & exhaustively test the pure engine → authoritative server + persistence → REST/auth/lobby → client → hardening/scale/launch.

**Phase 0 — Decisions & repo skeleton.** Commit one ADR per item in §3; author the canonical `.proto` (PURPLE; abstract seat indices); scaffold Yarn+Turbo, tsconfig solution refs, ESLint purity/boundary rules, buf gen+lint+breaking, CI skeleton (install/lint/typecheck/codegen-drift), dev docker-compose with single-node Mongo **replica set** (needed for transactions/change-streams); wire the `@trm/map-data` generation step (engine data + client catalog + `contentHash`).
*DoD:* monorepo builds; the one `.proto` compiles to protobuf-es and is imported by a server stub + web stub; CI green incl. codegen-drift + buf-breaking gates; one ADR per contested decision.

**Phase 1 — Pure deterministic engine (full ruleset).** All state/action/event types; counter PRNG + conformance vector; setup + initial ticket deal; all reducers (draw incl. face-up-loco-ends-draw + 3-loco recycle + reshuffle; claim incl. gray/ferry/double-route lock; two-phase tunnel; tickets; station ladder); endgame + termination rule; final scoring + tiebreakers; longest-trail with proven-terminating bound; ticket connectivity with station-borrow; `legalActions`/`previewScore`/`redactFor`; `serialize` + `stateDigest`.
*DoD:* full ruleset; fast-check property tests pass all §4 invariants after every legal action + illegal-action fuzz asserts zero mutation; golden-replay fixtures for 2/3/5p (tunnel-abort, ferry-heavy, full-station, endgame, longest-path tie) hash-stable; PRNG vector identical node+browser; B&B↔DP cross-check; engine imports zero node/dom globals (lint-enforced); mutation score ≥85% on scoring/claim/tunnel/longest-path.

**Phase 2 — Authoritative server core loop + persistence (single instance).** WS gateway (ws adapter, binary frames); per-game serialized command queue; 4-layer validation (decode→zod→authz→engine); project/redact per recipient + private-frame fan-out; event-sourced persistence (append `(gameId,seq)` majority + embedded snapshot + durable checkpoints + `stateDigest`); durable idempotency index; crash-recovery rehydrate (digest-verified); reconnect = fresh projected snapshot on `stateVersion`; deterministic auto-resolution of dangling pending-state.
*DoD:* a full game plays end-to-end via scripted ws clients deterministically; reconnect restores exact pre-drop projected view with no double side-effects; kill-and-restart recovers to identical `stateDigest`; **hidden-info leak test over all frame types passes**; integration tests cover every action type + tunnel pay/abort + ticket keep + endgame; idempotency proven against resends.

**Phase 3 — REST control plane, auth, lobby, handoff.** Guest + registered auth (HS256 access + rotating refresh + reuse-detection); rooms lifecycle (create/join/ready/seat/settings/kick/transfer/start with idempotent CAS); REST→WS ticket handoff; OpenAPI from zod + Scalar (prod-gated); throttling + helmet + CORS allowlist; match-history archival on game-over; content endpoints with ETag; `/health`+`/version`.
*DoD:* create→join→ready→start→WS handoff→play→game-over→matchHistory works for guests and registered users; refresh rotation + family-revoke tested; OpenAPI contract-fuzz green against booted server (`mongodb-memory-server`); `openapi-typescript` drift gate green; auth/room endpoints rate-limited; docs gated off in prod.

**Phase 4 — Frontend client.** `GameSocket` (protobuf-es, heartbeat, backoff reconnect, ClientHello+Resync); socketBridge; snapshot/delta/optimistic/interaction stores; SVG board (pan/zoom, route slots, tunnels/ferries/double-routes, stations); art system (parametric pieces, 8 colours with pattern+glyph, holographic loco, tokens, dark theme); panels + modals (market, hand, tickets, tunnel reveal, keep-tickets, station, scoreboard); optimistic claim/draw with inverse-patch rollback (using engine `previewScore`, not a reimplementation); i18n zh-Hant primary + en (Suspense-gated cities/tickets); colourblind `patternMode` + a11y (roving-tabindex board, aria-live, Radix dialogs).
*DoD:* a human plays a full 2–5p game in-browser; reconnect-on-refresh resyncs cleanly; optimistic actions reconcile with zero flicker and roll back on reject; tunnel/ticket flows server-driven & correct; **Playwright multi-context E2E plays a full game to a scoreboard equal to the engine golden score for that seed**; offline-then-online E2E resumes; axe a11y pass on lobby + board.

**Phase 5 — Hardening, observability, scale & launch.** pino + correlation IDs (redaction obeys hidden-info rules); prom-client metrics (`action_latency`, validation/anticheat rejections, `security_leak_detected`); OTel spans around `handleMessage` + `engine.reduce`; append-only audit log (feeds new golden fixtures); k6 + ws-harness load + soak; evil-client anti-cheat suite; **scale decision** (stay single-instance vertical, or add Redis pub/sub + sticky `gameId`-hash routing + spectator fan-out); rolling-deploy drain + lease-handoff runbook; security review.
*DoD:* SLOs met (action round-trip p95 < 150ms server-side, ~0 errors, flat memory in soak); reconnection-storm recovers within budget; dashboards + alerts live (leak metric alarms on >0); evil-client suite all-rejected with zero state mutation + audit events; security checklist passed; prod deploy + rollback validated on staging.

**Explicitly deferred (post-launch):** bots/self-play (engine `legalActions` already supports it — add after the engine freezes); ranked matchmaking/skill rating; spectator mode + cross-node fan-out; seasonal leaderboards; email verify/password reset; multi-map + admin map-authoring tool; reconnect delta-replay optimization; audio/SFX; native/mobile; rich replay-scrubbing UI.

---

## 9. Verification

End-to-end the build is proven by, in increasing scope:
- **Engine (Phase 1):** `yarn workspace @trm/engine test` — fast-check property suite (conservation invariants every step), golden-replay fixtures (`{seed, actionLog, expectedDigest}`) for 2/3/5p edge cases, PRNG conformance vector executed in **both** node and a headless browser, longest-path B&B↔bitmask-DP equivalence on random graphs, and `@trm/map-data` `validate()` (graph connectivity, ferry/loco/length invariants, ticket endpoints exist, no length-5/7).
- **Server (Phase 2):** Testcontainers-Mongo integration — scripted ws clients drive a full deterministic game; reconnect/resync and kill-restart recovery assert identical `stateDigest`; the **wire-level hidden-info leak test** decodes every frame addressed to non-owners and asserts no colours/cities/secret-tickets appear; idempotency resend test.
- **REST (Phase 3):** OpenAPI contract-fuzz (schemathesis) against the booted server; `openapi-typescript`/codegen **drift gate** (`git diff --exit-code`); buf-breaking gate; full auth + room lifecycle integration.
- **Client + full system (Phase 4):** **Playwright multi-browser-context E2E** runs a complete 2–5p game from lobby to scoreboard and asserts the final score **equals the engine golden score for that seed**; offline→online reconnect E2E; axe a11y + colourblind-sim snapshot gates.
- **Manual smoke (any phase ≥4):** `docker compose up` (Mongo replica set + server + web) → open two browser profiles → guest-join the same room code → play a 2-player game start to finish; confirm Scalar API docs render at `/docs` and the OpenAPI JSON at `/api/openapi.json`.
- **Scale/launch (Phase 5):** k6 + bespoke ws-harness (reusing engine `legalActions` for protocol-accurate games) hit the SLOs; nightly soak watches for memory leaks; evil-client suite confirms every illegal action is rejected with zero state mutation + an audit event.

**CI hard merge blockers:** codegen drift, buf breaking, hidden-info leak test, engine coverage ≥90%/85%, golden replay, zero high/critical vulns. **Nightly:** Stryker mutation (engine ≥85%), full load+soak, extended fast-check.
