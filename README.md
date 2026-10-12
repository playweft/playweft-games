# Playweft Games

A collection of 12 browser games for local play and multiplayer rooms on
[Playweft](https://github.com/playweft/playweft). Play against an AI, share one
device with friends, or join a room through the platform.

The games share one Vite build and deploy as static files. Each game has its
own versioned `playweft.json` package manifest; Playweft provides the lobby,
networking, and authoritative room rules.

[Quick start](#quick-start) · [Games](#games) · [Multiplayer](#multiplayer-with-playweft) · [Contributing](CONTRIBUTING.md) · [License](#license)

## Games

Local entries below become available after starting the development server.
“Same device” means two people taking turns in one browser. Room player counts
refer to seated human players; spectators do not occupy a seat.

| Game | Local play | Room players | Local entry |
| --- | --- | --- | --- |
| Dou Dizhu / 斗地主 | One human + two AI opponents | 3 | [/dou-dizhu/](http://localhost:9139/dou-dizhu/) |
| Mahjong / 麻将 | One human + three AI opponents | 2–4 | [/mahjong/](http://localhost:9139/mahjong/) |
| Chess / 国际象棋 | Two players, same device | 2 | [/chess/](http://localhost:9139/chess/) |
| Xiangqi / 中国象棋 | Two players, same device | 2 | [/xiangqi/](http://localhost:9139/xiangqi/) |
| UNO | — | 2–4 | [/uno/](http://localhost:9139/uno/) |
| Werewolf Dealer / 狼人杀发牌器 | Pass one device to deal roles for 6–15 people | 6–15 | [/werewolf-dealer/](http://localhost:9139/werewolf-dealer/) |
| Gomoku / 五子棋 | Human vs. AI or two players, same device | 2 | [/gomoku/](http://localhost:9139/gomoku/) |
| Sudoku / 数独 | Single-player puzzle | — | [/sudoku/](http://localhost:9139/sudoku/) |
| Texas Hold'em / 德州扑克 | — | 2–6 | [/texas-holdem/](http://localhost:9139/texas-holdem/) |
| Go / 围棋 | Two players, same device | 2 | [/go/](http://localhost:9139/go/) |
| Connect Four / 四子棋 | Human vs. AI | 2 | [/connect-four/](http://localhost:9139/connect-four/) |
| Pig Dice / 贪心骰子 | — | 2 | [/pig-dice/](http://localhost:9139/pig-dice/) |

Each running game includes a rules page at `/<game>/help.html`. Games without
local play need a Playweft room for an interactive match.

## Quick start

Use **Node.js 22.12 or newer** and npm. Vite also supports Node.js 20.19.x;
see the installed Vite package's engine requirement when choosing another version.

```sh
git clone https://github.com/playweft/playweft-games.git
cd playweft-games
npm ci
npm run dev
```

Open [http://localhost:9139/](http://localhost:9139/) to browse the games, or
open a local entry from the table above. Local play works without running
Playweft's web app or Worker.

The configured development port is **9139**. If it is occupied, Vite may choose
the next available port; use the address printed in the terminal. To require
that exact port:

```sh
npm run dev -- --strictPort
```

## Multiplayer with Playweft

Room play requires the separate
[Playweft platform](https://github.com/playweft/playweft). Its web app manages
rooms and invitations; its Worker executes the room's Lua rules.

1. Keep this repository's game server running with `npm run dev`.
2. Clone and install the platform, following its
   [setup instructions](https://github.com/playweft/playweft#run-locally).
3. In separate terminals, from the platform repository, run:

   ```sh
   npm run dev:worker -- --var AUTH_SECRET:local-session-secret
   ```

   ```sh
   npm run dev:web
   ```

4. Open the platform at [http://localhost:9133/](http://localhost:9133/) and
   add a game using its directory URL or explicit manifest URL, for example:

   ```text
   http://localhost:9139/gomoku/
   http://localhost:9139/gomoku/playweft.json
   ```

5. Create a room and share its invitation link with the other players.

The platform Worker defaults to port `8787`; the web app proxies API requests
to it. The development secret above is only for local use. For another device,
use addresses reachable by both the players and the Worker rather than
`localhost`.

For the package contract and bridge protocol, see the
[game integration guide](https://github.com/playweft/playweft/blob/main/docs/game-integration/README.md).

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the shared Vite development server on port 9139. |
| `npm test` | Run the Node.js test suite without rebuilding. |
| `npm run check` | Build all packages, then run the test suite. |
| `npm run build` | Generate the static deployment in `dist/`. |

Use `npm run check` before submitting a change. It already includes the build,
so a second `npm run build` is unnecessary unless you change files afterward.

```text
games/<game>/       Game UI, manifest, rules, and help page
src/                Shared bridge, local runtime, UI components, and caching
build/vite/plugins/ Package emission, URL handling, and build configuration
tests/              Rule, local-mode, protocol, and UI-controller tests
public/             Icons, catalogue, service worker, and hosting headers
docs/               Development notes
vite.config.js      Game entries and development server configuration
```

The client uses JavaScript, HTML, and CSS. Room rules run in Lua; some local
modes reuse Lua through Wasmoon/WebAssembly, while others use JavaScript.
Mahjong's table uses Three.js/WebGL, and Gomoku's local AI runs in a Web Worker.
See [development notes](docs/development.md) for architecture and AI details.

### Optional Mahjong asset configuration

No environment variables are required for the default games.
`MAHJONG_DEFAULT_ASSET_CONFIG_URL` optionally points to a raw JSON configuration
for Mahjong backgrounds, portraits, tile backs, and music. Export it in the
process environment before starting Vite or building; see [.env.example](.env.example)
for the supported asset categories and
[the configuration normalizer](games/mahjong/theme/default-assets.js) for its shape.
An omitted or unusable configuration falls back to the bundled defaults.

## Build and deploy

```sh
npm run build
npm exec vite -- preview --host 127.0.0.1 --port 9140 --strictPort
```

Open [http://127.0.0.1:9140/](http://127.0.0.1:9140/) to inspect the production
build locally. This explicit preview port is separate from the development
server's default port.

Deploy the **entire `dist/` directory** to a static host at the site's root.
It contains the catalogue, shared assets, and each game's directory with
`index.html`, `help.html`, and `playweft.json`. Room packages also contain the
Lua entry named in their manifest; Mahjong's room entry is `game-online.lua`.
Sudoku has no room server entry.

For production room play, serve the package over HTTPS and keep its Lua entry
on the same origin as the manifest. Allow the Playweft page to fetch
`/featured-games.json` and `/<game>/playweft.json` through CORS.
[public/_headers](public/_headers) supplies these rules for hosts that support
that file; configure equivalent headers on other hosts. The Worker fetches
room Lua entries server-side, so those requests do not require CORS.

## Contributing

Bug reports and pull requests are welcome. Include the game, mode, browser,
and steps to reproduce a problem in an
[issue](https://github.com/playweft/playweft-games/issues).
For code changes, see [CONTRIBUTING.md](CONTRIBUTING.md), keep changes focused,
and run `npm run check` before opening a
[pull request](https://github.com/playweft/playweft-games/pulls).

## License

Project code is licensed under the [MIT License](LICENSE).
Third-party assets retain their own licenses:

- Chess piece SVGs by Cburnett use CC BY-SA 3.0. Attribution, source URLs, and
  asset terms are recorded in [the chess asset README](games/chess/assets/README.md).
- Mahjong's Bakudai font subset uses SIL Open Font License 1.1; see
  [the font notice](games/mahjong/assets/fonts/BAKUDAI-FONT-NOTICE.txt) and
  [license text](games/mahjong/assets/fonts/BAKUDAI-OFL.txt).

Dependency licenses are included with their respective packages.
