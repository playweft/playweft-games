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
