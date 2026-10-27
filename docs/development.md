# Development notes

See the [README](../README.md) for setup, commands, and deployment, and
[CONTRIBUTING.md](../CONTRIBUTING.md) for the contribution workflow.

## Game packages and room play

Each game is described by `games/<game>/playweft.json`. Its manifest declares
versioned identity, the client entry, localized catalogue metadata, supported
modes, room player limits, and the authoritative Lua entry where applicable.
Build plugins emit these files under `dist/<game>/` while preserving public
URLs such as `/gomoku/` in development and production.

The [Playweft platform](https://github.com/playweft/playweft) loads and validates
the manifest before opening the client in a sandboxed iframe. A transferred
`MessagePort` carries bridge v1 JSON-RPC messages. The platform owns identity,
the lobby, room networking, and authoritative Lua execution; games submit
player actions and render the returned state.

Shared bridge code is in `src/playweft-client.js` and `src/playweft-rpc.js`.
The full contract is in the platform's
[integration guide](https://github.com/playweft/playweft/blob/main/docs/game-integration/README.md).

## Local play

The manifest's `solo` mode describes execution without a room; it can mean a
single-player puzzle, AI opponents, two people sharing a device, or passing
one device to deal roles. Check the README table and each game's help page
rather than treating every Solo entry as human-versus-AI play.

Some local games execute Lua through Wasmoon/WebAssembly. Chess, for example,
uses the same Lua rules in room and local play. Go, Xiangqi, and Gomoku have
JavaScript local implementations alongside their room Lua rules. Relevant
rule and local-mode tests live in `tests/`.

Mahjong uses Three.js/WebGL for its table and a worker-based local Lua runtime.
Its rendering, rule adapters, and match controllers are separated under
`games/mahjong/`.

## Shared button styles

Games can use `src/components/round-icon-button.css` for circular icon buttons.
Import it at the top of the game's own stylesheet:

```css
@import "../../src/components/round-icon-button.css";
```

Add `round-icon-button` alongside the button's game-specific class. The shared
rules provide a transparent, borderless 44 px circle, a centered 20 px SVG,
and hover/active backgrounds on devices with a fine pointer and hover support.
Keyboard focus uses the existing `src/base.css` styles; reduced-motion settings
disable the background transition. Disabled buttons do not receive hover or
active backgrounds.

Keep positioning and foreground colors in the game's class. Override
`--round-button-size`, `--round-button-icon-size`,
`--round-button-hover-background`, `--round-button-active-background`, or
`--round-button-transition-duration` there when needed.

Use the CSS `@import` rather than a JavaScript import for this component: Vite
inlines it into each consuming game's stylesheet, keeping the source shared
without adding a shared button stylesheet dependency to the built games.

## Gomoku AI

The local AI uses JavaScript without a model download, Wasm, or GPU. Its search
lives in `games/gomoku/ai.js`; `ai-worker.js` and `ai-controller.js` manage
background execution and the lifecycle of requests.

- Immediate wins and mandatory blocks scan the full board before candidate pruning.
- The bounded two-ply search considers up to eight moves and six replies, with
  at most 48 evaluated replies.
- The default search checks a 25 ms deadline between branches. This is a search
  budget, not a hard limit on total execution time: tactical scans and an
  individual branch can take longer.
- Simulated black moves use the same forbidden-move checks as local play.
- Worker failures use a short local fallback with a 5 ms search budget.
- Requests are cancelled when the game closes, switches mode, or changes rounds.
  The AI does not ponder in the background.

Regression tests cover tactical moves, forbidden moves, stale requests, and
local two-player mode. Keep those cases working when changing candidate
selection or the worker lifecycle.

## Connect Four AI

Local play pits the human's red pieces against the computer's yellow pieces;
rematches alternate the starting player. The local JavaScript rules mirror
room Lua gravity, win detection, draws, and rematch behavior.

`games/connect-four/ai.js` checks immediate wins and mandatory blocks first,
rejects moves that allow an immediate reply win when safe alternatives exist,
and detects double winning threats. It then uses center-first negamax with
alpha-beta pruning and iterative deepening. Typed arrays hold the board,
column heights, and counts for the 69 possible four-cell lines; playing or
undoing a move updates only the affected lines and evaluation.

The default extra search budget is 1 ms and 768 nodes, with up to four ordinary
plies. Forced blocks can extend a leaf, still subject to the node and time
limits. Time is checked periodically; initialization, tactical checks, and
Worker startup are outside a strict wall-clock bound. An incomplete iteration
is discarded in favor of the last completed result or a safe tactical fallback.
This is a shallow heuristic AI, not a perfect solver.

A module Worker runs only on the computer's local turn and is reused while
idle. Hiding or leaving the page cancels pending work; room mode never starts
AI work. Worker failures use the tactical fallback without additional search.
No model, Wasm, GPU, or background pondering is used.

## Documentation maintenance

Use the manifests as the source for supported modes, seated player limits,
and room Lua entry names. Use `vite.config.js` and `package.json` as the source
for ports and commands. Cross-repository links should use complete URLs under
`https://github.com/playweft/`; relative links are for files in this repository.

## Persistent game progress

Mahjong's local match and browser preferences, and Sudoku's current puzzle,
use the asynchronous `localStorage.*` capabilities on the existing Playweft
bridge. The platform stores strings in its top-level IndexedDB, isolated by
validated game origin. Standalone pages use their own first-party IndexedDB.
These are local browser saves, not account or cloud synchronization.

`src/game-storage.js` chooses the backend and imports each game's explicitly
listed legacy localStorage keys once. Existing destination values win; source
keys are removed only after all imports and the migration marker commit.
Migration can resume after a failed write. An unreadable legacy store or a
failed destination read is an error, never evidence of a new game.

`src/game-storage-cache.js` hydrates the complete game snapshot before the UI
starts. Existing synchronous settings read that snapshot; writes are serialized
and coalesced per key. Only acknowledged commits leave the pending queue.
Read failures and invalid saves block startup with a diagnostic retry dialog.
Write failures retain the newest in-memory snapshot for explicit retry. They
never fall back to iframe localStorage. Add new keys to the game's allowlist
before using them.

Mahjong's separate replay archive and imported asset-pack databases are outside
this localStorage migration. Other games retain their existing storage paths.


## Mahjong career progress

The lobby has a `立志戦` submenu with three independent save slots and a
`修練戦` submenu for the existing East and South free matches. Menu contents
fade out/in while the scene and timber frame stay fixed. Empty slots display
only their number and “新游戏”; format details live in a collapsed rules guide.

Career slots use `playweft.mahjong.career.slot-{1,2,3}.v1` in the same acknowledged
platform/standalone storage as local match saves. Each slot contains its current
match, placement results, current league period, recent period summaries, and
analysis counters together. Free practice keeps `playweft.mahjong.solo-save.v1`.
Completed replay archives remain independent and may be evicted without losing
career results. No account synchronization is implied by platform-owned storage.

After the third placement match's final-hand result, the ordinary match summary
is replaced by a paper-and-bamboo `定段結果` page. It shows the initial grade,
all three matches' ranks, final scores and points, and their total; it does not
display decision evaluation. “开始联赛” starts the first league match in the
same slot, while “返回大厅” returns to the three career slots. The slot's
`placementResultSeen` flag is acknowledged and flushed only on either action.
An unacknowledged grade is shown when the slot is reopened after a reload.
Older slots can show it once if league play has not already begun.

Version 1 progression is deliberately game-specific, not the official league
rulebook: three hanchan placement matches, then eight hanchan per period across
E1, D3, D2, D1, C3, C2, C1, B2, B1, A2, A1. Match points are
`(final score - 25000) / 1000 + [30, 10, -10, -30][rank - 1]`; raw canonical
opening-seat order breaks tied scores consistently with replay export. Period
scores of at least +80 promote one tier, at most -80 relegate one, and otherwise
retain the tier. E1 and A1 are boundaries. Progression constants and placement
thresholds are in `games/mahjong/career/career.js`; opponents currently use the
existing local AI policy at every tier.

Initial placement grants C2 when three-match points total at least +120,
regardless of decision metrics, or when the total is at least +90 and at least
30 reviewed manual discards have mean quality strictly >80 and a major-deviation
rate <=10%. Quality and mistakes are pooled across all reviewed decisions.
Otherwise the three-match total determines the tier: >=+90 C3, >=+30 D1,
>=-30 D2, >=-90 D3, below -90 E1. There is no subsequent one-tier adjustment,
no exact-agreement fallback and no hidden point bonus. Saved, completed placements
are not recalculated. Placement is bounded to E1–C2. These are provisional
game-balance thresholds, not calibrated human-rank estimates.

The match worker optionally reviews a manual career discard before applying it.
Lua compares the same candidate set under one push/fold mode and returns score,
shanten, acceptance, value and risk differences. JS uses
`100 * (1 - clamp((scoreLoss - 14) / scale, 0, 1))`, rounded to an integer, with
scales 300/400/1050 for push/mixed/fold; a normalized loss >=0.4 is a major deviation.
The 14-point tolerance prevents near-equivalent choices from counting as errors.
Agreement compares tile kind and red status, not interchangeable physical copies.
Forced post-riichi discards, automatic actions and non-discard decisions are not
rated. Missing analysis is recorded separately rather than as a failed decision.
These scores are heuristic policy comparisons, not expected-point loss or Elo.

Final settlement and the resumable match are written together, deduplicated by
match ID. Starting the next match allocates a fresh seed and ID. Restoring a
finished but unsettled checkpoint repairs its settlement; restoring an already
settled result never counts the match twice. Settings offers “保存并返回” during
career play. Invalid slot records block startup and preserve the original data.


### Brush font coverage

Mahjong uses the Bakudai subset for lobby mode signs, match/round/wind labels,
action buttons/callouts, result continuation/waiting labels, traditional yaku
names, draw reasons, and career result titles/buttons/grades. Ordinary settings text, career save summaries, player
names, and score-sheet numbers use their existing UI/Kalam fonts.

`node build/fonts/mahjong-brush-text.js --check` verifies the generated glyph list
against the current lobby labels and known dynamic brush labels. Rebuild using
`bash games/mahjong/assets/fonts/build-bakudai-subset.sh /path/to/Bakudai-Regular.woff2`.
The script regenerates the text list, checks source coverage, builds WOFF2 and
verifies its output cmap. Missing simplified 继/续/厅/联/赛/开 codepoints use
the corresponding 繼/續/廳/聯/賽/開 glyphs while preserving UI/accessibility text.

The home `友人戦` sign is the existing capability-gated `room.create` entry;
progress is flushed before creation. Legacy API-created rooms return to the
originating game after they end; the platform owns this navigation.
