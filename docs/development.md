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

## Documentation maintenance

Use the manifests as the source for supported modes, seated player limits,
and room Lua entry names. Use `vite.config.js` and `package.json` as the source
for ports and commands. Cross-repository links should use complete URLs under
`https://github.com/playweft/`; relative links are for files in this repository.
