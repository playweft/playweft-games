# Playweft Games

Ten lightweight multiplayer games and two standalone games for the sibling
[`playweft`](../playweft) platform. They share one Vite build and expose
independent, versioned Playweft game packages.

Each package is described by `/<game>/playweft.json`. Its Manifest contains
the `start_url`, localized catalogue metadata, supported modes, room player
limits, and authoritative Lua entry. Playweft bridge v1 fetches and validates
the Manifest before opening the game iframe.

| Game | Players | Local entry | Production build |
| --- | --- | --- | --- |
| 斗地主 | 3 | `http://localhost:5174/dou-dizhu/` | `dist/dou-dizhu/index.html` |
| 麻将 | 1 + 3 AI | `http://localhost:5174/mahjong/` | `dist/mahjong/index.html` |
| 国际象棋 | 2 | `http://localhost:9139/chess/` | `dist/chess/index.html` |
| 中国象棋 | 2 | `http://localhost:5174/xiangqi/` | `dist/xiangqi/index.html` |
| UNO | 2–4 | `http://localhost:5174/uno/` | `dist/uno/index.html` |
| Werewolf dealer | 6-12 | `http://localhost:5174/werewolf-dealer/` | `dist/werewolf-dealer/index.html` |
| 五子棋 | 1–2 | `http://localhost:9139/gomoku/` | `dist/gomoku/index.html` |
| Sudoku | 1 | `http://localhost:5174/sudoku/` | `dist/sudoku/index.html` |
| Texas Hold'em | 2–6 | `http://localhost:5174/texas-holdem/` | `dist/texas-holdem/index.html` |
| 围棋 | 1–2 | `http://localhost:5174/go/` | `dist/go/index.html` |
| Connect Four | 2 | `http://localhost:5174/connect-four/` | `dist/connect-four/index.html` |
| Pig Dice | 2 | `http://localhost:5174/pig-dice/` | `dist/pig-dice/index.html` |

Gomoku non-room play offers human versus a local JavaScript AI or two humans
taking turns on the same device. In AI games, the human can
choose either color or random colors; rematches swap colors. Its two-ply
search runs in a module Worker, considers up to eight moves and six replies,
and checks a 25 ms deadline between branches, with at most 48 evaluated replies. Immediate wins and
mandatory blocks scan the whole board before the bounded search. Simulated
black moves use the same forbidden-move checks as local play. Worker failures
use a short local fallback; search requests are cancelled when the game closes
or changes rounds. No model download, Wasm, GPU or background pondering is used.

## Run locally

Install dependencies once:

```sh
npm install
```

Start the Playweft Worker and web app from `../playweft`, then start the shared
game development server from this repository:

```sh
npm run dev
```

Open `http://localhost:5174/` to browse the game list. Sudoku, Xiangqi and the
local-AI Dou Dizhu mode open directly as solo games; paste a game's directory URL or
its explicit `playweft.json` URL into Playweft. The multiplayer games
use the platform-owned lobby; Texas Hold'em supports two to six seated players,
斗地主 supports one local player with two computer opponents or exactly three
room players, the Werewolf dealer supports six to twelve, and
UNO supports two to four.
围棋和中国象棋同时支持双人房间与单终端双方轮流行棋的 Solo 模式。麻将在浏览器内运行与房间协议一致的 Lua 规则，提供三名本地 AI，并支持东风场/半庄、连庄、立直、振听、役番符、宝牌、杠与抢杠、多家荣和、途中流局、包牌、延长赛和完整点数支付。麻将牌桌使用 PixiJS/WebGL 渲染，规则状态通过独立适配层驱动画面与交互。

## Verify and build

```sh
npm run check
npm run build
```

The generated `dist` directory is one static deployment with twelve game
packages. Each room package contains its `playweft.json`, client, help page and
`game.lua`; Sudoku contains the same package metadata without a server entry.

`public/_headers` enables CORS only for the featured list and game Manifests,
which the top-level Playweft page fetches in the browser. Lua entries are
fetched server-side by the Playweft Worker and do not need CORS.

国际象棋支持同设备双人轮流行棋和双人房间，提供合法走法提示、翻转棋盘、吃子及行棋记录、王车易位、吃过路兵、四种兵升变、将死、逼和、常见子力不足、重复局面及五十/七十五回合和棋、协议和棋与认输。联机与本地模式共用同一份 Lua 规则，Wasm 随静态包构建。
