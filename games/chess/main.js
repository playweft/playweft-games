import {
  ArrowUpRight,
  CircleHelp,
  ChevronRight,
  List,
  RotateCcw,
  Settings,
  X,
  createIcons,
} from "lucide";
import { createPlayweftClient } from "../../src/playweft-client.js";
import { createSoloChessGame } from "./solo.js";
import { pieceSvg, PIECE_NAMES } from "./pieces.js";
import { createOverlayDialog } from "../../src/components/overlay-dialog.js";
import { CHESS_PERSPECTIVES, resolveChessView } from "./view.js";
import "./styles.css";

const $ = (id) => document.getElementById(id);
const squares = [];
let state, selected, promotionMove, localGame, playerId, pending, resignIndex;
let mode = window.parent === window ? "solo" : "room";
let flipped = false,
  historyKey = "",
  closed = false;
const PERSPECTIVE_KEY = "playweft.chess.perspective";
let perspective = "white";
try {
  const saved = localStorage.getItem(PERSPECTIVE_KEY);
  if (CHESS_PERSPECTIVES.includes(saved)) perspective = saved;
} catch {
  // The setting still works when storage is unavailable in an embedded game.
}
const END_REASONS = {
  checkmate: "将死，对方已无合法应将。",
  stalemate: "无合法走法且未被将军，双方和棋。",
  insufficient_material: "剩余子力无法将死，双方和棋。",
  threefold: "三次重复局面，申请和棋成功。",
  fivefold: "五次重复局面，自动和棋。",
  fifty_moves: "连续五十回合未动兵、未吃子，申请和棋成功。",
  seventy_five_moves: "连续七十五回合未动兵、未吃子，自动和棋。",
  agreement: "双方同意和棋。",
  resigned: "对方认输，本局结束。",
  player_left: "对方离开了对局。",
};
const ERRORS = {
  NOT_YOUR_TURN: "现在轮到对方行棋。",
  ILLEGAL_MOVE: "这一步不合法，请重新选择。",
  NOT_YOUR_PIECE: "请选择己方棋子。",
  NOT_A_PLAYER: "观战者不能行棋。",
  GAME_OVER: "本局已结束。",
  PROMOTION_REQUIRED: "请选择升变棋子。",
  NO_DRAW_OFFER: "当前没有可接受的和棋提议。",
  DRAW_NOT_AVAILABLE: "当前不满足申请和棋的条件。",
  DRAW_ALREADY_OFFERED: "请等待对方回应和棋提议。",
};
const sideFor = (index) => (index === state?.whiteIndex ? "w" : "b");
const label = (side) => (side === "w" ? "白方" : "黑方");
const coordinate = (r, c) => `${String.fromCharCode(96 + c)}${9 - r}`;
const ended = () => Boolean(state?.winner || state?.draw);
const ownIndex = () => state?.players?.indexOf(playerId) + 1 || 0;
const canAct = () =>
  Boolean(state) &&
  !pending &&
  !ended() &&
  (mode === "solo" || ownIndex() === state.current);
const participant = () => Boolean(state) && (mode === "solo" || ownIndex() > 0);
const fromMoves = (r, c) =>
  (state?.legalMoves ?? []).filter(
    (m) => m.fromRow === r && m.fromColumn === c,
  );
const targetMoves = (r, c) =>
  selected
    ? fromMoves(selected.row, selected.column).filter(
        (m) => m.toRow === r && m.toColumn === c,
      )
    : [];

for (let r = 1; r <= 8; r++) {
  for (let c = 1; c <= 8; c++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `square${(r + c) % 2 ? " dark" : ""}`;
    button.dataset.square = coordinate(r, c);
    button.disabled = true;
    button.addEventListener("click", () => choose(r, c));
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        selected = undefined;
        render();
        return;
      }
      const direction = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
      }[event.key];
      if (!direction) return;
      event.preventDefault();
      const rr = r + direction[0] * (flipped ? -1 : 1);
      const cc = c + direction[1] * (flipped ? -1 : 1);
      if (rr >= 1 && rr <= 8 && cc >= 1 && cc <= 8)
        squares[(rr - 1) * 8 + cc - 1].focus();
    });
    squares.push(button);
    $("board").append(button);
  }
}
createIcons({
  icons: {
    ArrowUpRight,
    CircleHelp,
    ChevronRight,
    List,
    RotateCcw,
    Settings,
    X,
  },
});

const perspectiveSelect = $("perspective-setting");
const settingsDialog = createOverlayDialog({
  root: $("settings-dialog"),
  surface: $("settings-surface"),
  closeButtons: [$("settings-close")],
  initialFocus: $("settings-surface"),
  returnFocus: $("settings-button"),
});
function renderPerspectiveSetting() {
  perspectiveSelect.value = perspective;
  $("perspective-value").textContent = perspectiveSelect.selectedOptions[0].textContent;
}
renderPerspectiveSetting();
$("settings-button").addEventListener("click", () => settingsDialog.setOpen(true));
perspectiveSelect.addEventListener("change", () => {
  perspective = perspectiveSelect.value;
  try {
    localStorage.setItem(PERSPECTIVE_KEY, perspective);
  } catch {
    // Keep the selection for this session even if persistence is unavailable.
  }
  renderPerspectiveSetting();
  render();
});
perspectiveSelect.closest(".setting-field").addEventListener("click", (event) => {
  if (event.target === perspectiveSelect) return;
  perspectiveSelect.focus({ preventScroll: true });
  if (typeof perspectiveSelect.showPicker === "function") {
    try {
      perspectiveSelect.showPicker();
      return;
    } catch {
      // Cross-origin frames may only allow direct select activation.
    }
  }
  perspectiveSelect.click();
});

// Keep one live status and one ledger while changing the presentation.
const compactLayout = window.matchMedia(
  "(max-width: 900px) and (min-height: 481px), (max-width: 559px)",
);
const landscapeLayout = window.matchMedia(
  "(min-width: 560px) and (max-height: 480px)",
);
function syncLayout() {
  $("details-dialog").close();
  if (landscapeLayout.matches) {
    $("players-strip").append($("top-player"), $("bottom-player"));
  } else {
    document.querySelector(".board-stack").prepend($("top-player"));
    document.querySelector(".board-stack").append($("bottom-player"));
  }
  if (compactLayout.matches) {
    $("board-status").append($("match-status"));
    $("details-content").append($("match-panel"));
  } else {
    $("match-panel").prepend($("match-status"));
    document.querySelector(".chess-layout").append($("match-panel"));
  }
}
compactLayout.addEventListener("change", syncLayout);
landscapeLayout.addEventListener("change", syncLayout);
syncLayout();
$("details-button").addEventListener("click", () =>
  $("details-dialog").showModal(),
);
$("details-close").addEventListener("click", () => $("details-dialog").close());

const client =
  window.parent === window
    ? undefined
    : createPlayweftClient({
        onReady(message) {
          mode = message.mode ?? "room";
          playerId = message.playerId;
          if (mode === "solo") void startLocal();
        },
        onState(message) {
          playerId = message.playerId;
          receiveState(message.state);
        },
        onActionResult(result) {
          if (pending === result.requestId) {
            pending = undefined;
            render();
          }
        },
        onError(error, code, requestId) {
          if (!requestId || requestId === pending) pending = undefined;
          notice(ERRORS[code] ?? `操作未完成：${error}`);
          render();
        },
      });

async function startLocal() {
  try {
    localGame = await createSoloChessGame();
    if (closed) {
      localGame.close();
      return;
    }
    receiveState(localGame.state());
  } catch (error) {
    notice(`加载失败，请刷新重试。${error.message}`);
  }
}
function receiveState(nextState) {
  state = nextState;
  pending = selected = promotionMove = undefined;
  $("promotion-dialog").close();
  $("resign-dialog").close();
  if (ended()) $("details-dialog").close();
  notice("");
  render();
}
function notice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}

function choose(r, c) {
  if (!canAct()) return;
  const piece = state.board[r - 1][c - 1];
  if (piece[0] === sideFor(state.current)) {
    selected =
      selected?.row === r && selected?.column === c
        ? undefined
        : { row: r, column: c };
    if (selected && !fromMoves(r, c).length) {
      selected = undefined;
      notice("这枚棋子暂时没有合法走法。");
    } else notice("");
    render();
    return;
  }
  const move = targetMoves(r, c)[0];
  if (!move) return;
  if (move.promotion) {
    promotionMove = {
      type: "move",
      fromRow: move.fromRow,
      fromColumn: move.fromColumn,
      toRow: r,
      toColumn: c,
    };
    $("promotion-options").replaceChildren();
    for (const kind of ["Q", "R", "B", "N"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `${pieceSvg(sideFor(state.current) + kind)}${PIECE_NAMES[kind]}`;
      button.setAttribute("aria-label", `升变为${PIECE_NAMES[kind]}`);
      button.addEventListener("click", () => {
        const action = { ...promotionMove, promotion: kind };
        $("promotion-dialog").close();
        promotionMove = undefined;
        send(action);
      });
      $("promotion-options").append(button);
    }
    $("promotion-dialog").showModal();
    return;
  }
  send({
    type: "move",
    fromRow: move.fromRow,
    fromColumn: move.fromColumn,
    toRow: r,
    toColumn: c,
  });
}
function send(action, actorIndex = state?.current) {
  if (!state || pending) return;
  notice("");
  if (mode === "solo") {
    try {
      const result = localGame.action(action, actorIndex);
      if (result.accepted) receiveState(localGame.state());
      else {
        notice(ERRORS[result.error?.code] ?? "操作未完成，请重试。");
        render();
      }
    } catch (error) {
      notice(`操作未完成：${error.message}`);
    }
  } else {
    pending = client?.sendAction(action);
    if (!pending) notice("尚未连接平台，请等待连接后重试。");
    render();
  }
}
$("cancel-button").addEventListener("click", () => {
  selected = undefined;
  render();
});
$("rematch-button").addEventListener("click", () => send({ type: "rematch" }));
$("claim-button").addEventListener("click", () => send({ type: "claim_draw" }));
$("draw-button").addEventListener("click", () => send({ type: "offer_draw" }));
$("accept-draw").addEventListener("click", () =>
  send({ type: "accept_draw" }, 3 - state.drawOffer),
);
$("decline-draw").addEventListener("click", () =>
  send({ type: "decline_draw" }, 3 - state.drawOffer),
);
$("promotion-cancel").addEventListener("click", () => {
  promotionMove = undefined;
  $("promotion-dialog").close();
});
$("promotion-dialog").addEventListener("cancel", () => {
  promotionMove = undefined;
});
$("resign-button").addEventListener("click", () => {
  resignIndex = mode === "solo" ? state.current : ownIndex();
  $("resign-title").textContent = `${label(sideFor(resignIndex))}确认认输？`;
  $("resign-dialog").showModal();
});
$("resign-cancel").addEventListener("click", () => $("resign-dialog").close());
$("resign-confirm").addEventListener("click", () => {
  $("resign-dialog").close();
  send({ type: "resign" }, resignIndex);
});
window.addEventListener("pagehide", (event) => {
  // Preserve the local engine when browser Back restores this page from BFCache.
  if (event.persisted) return;
  closed = true;
  client?.destroy();
  localGame?.close();
});

function render() {
  if (!state) return;
  const view = resolveChessView(perspective, state);
  flipped = view.flipped;
  const active = canAct();
  $("move-count").textContent = `${state.moves} 步`;
  const order = flipped ? [...squares].reverse() : squares;
  for (let i = 0; i < 64; i++) {
    const square = order[i];
    const index = squares.indexOf(square),
      r = Math.floor(index / 8) + 1,
      c = (index % 8) + 1;
    const piece = state.board[r - 1][c - 1],
      target = active && targetMoves(r, c).length > 0;
    square.innerHTML =
      (piece ? pieceSvg(piece) : "") +
      (i % 8 === 0 ? `<span class="coord coord-rank">${9 - r}</span>` : "") +
      (i >= 56
        ? `<span class="coord coord-file">${String.fromCharCode(96 + c)}</span>`
        : "");
    square.classList.toggle(
      "is-selected",
      selected?.row === r && selected?.column === c,
    );
    square.classList.toggle("is-target", target);
    square.classList.toggle("is-capture", target && Boolean(piece));
    square.classList.toggle("is-upside-down", Boolean(piece) && piece[0] === view.upsideDownSide);
    square.classList.toggle(
      "is-check",
      state.inCheck && piece === `${sideFor(state.current)}K`,
    );
    square.classList.toggle(
      "is-last",
      (state.lastMove.fromRow === r && state.lastMove.fromColumn === c) ||
        (state.lastMove.toRow === r && state.lastMove.toColumn === c),
    );
    square.disabled = !active;
    square.setAttribute(
      "aria-pressed",
      String(selected?.row === r && selected?.column === c),
    );
    square.setAttribute(
      "aria-label",
      `${coordinate(r, c)}，${piece ? label(piece[0]) + PIECE_NAMES[piece[1]] : "空格"}${target ? "，可到达" : ""}`,
    );
    if ($("board").children[i] !== square)
      $("board").insertBefore(square, $("board").children[i]);
  }
  renderPlayer($("top-player"), view.topSide);
  renderPlayer($("bottom-player"), view.bottomSide);
  const colorLabel = label(sideFor(state.current));
  $("status-kicker").textContent = ended()
    ? "本局结束"
    : `${colorLabel}行棋 · 第 ${Math.floor(state.moves / 2) + 1} 回合`;
  $("status-title").textContent = ended()
    ? state.draw
      ? "和棋"
      : `${label(sideFor(state.winnerIndex))}获胜`
    : pending
      ? "正在落子…"
      : state.inCheck
        ? `${colorLabel}被将军`
        : `${colorLabel}，轮到你了`;
  $("status-detail").textContent = ended()
    ? (END_REASONS[state.endReason] ?? "本局结束。")
    : mode === "room" && !ownIndex()
      ? "你正在观战，可在设置中调整棋盘视角。"
      : mode === "room" && ownIndex() !== state.current
        ? "对方正在思考，请稍候。"
        : state.inCheck
          ? "这一步必须解除将军。"
          : selected
            ? `已选择 ${coordinate(selected.row, selected.column)}，点击提示格行棋。`
            : "选择一枚棋子，开启你的下一步。";
  const blocked = !participant() || pending || ended();
  $("cancel-button").hidden = !selected || ended();
  $("cancel-button").disabled = Boolean(pending);
  $("rematch-button").hidden = !ended() || !participant();
  $("rematch-button").disabled = Boolean(pending);
  $("claim-button").hidden = !state.canClaimDraw || !active;
  $("draw-button").disabled = Boolean(blocked || state.drawOffer);
  $("resign-button").disabled = Boolean(blocked);
  $("draw-response").hidden =
    ended() ||
    !state.drawOffer ||
    !participant() ||
    (mode !== "solo" && state.drawOffer === ownIndex());
  $("accept-draw").disabled = $("decline-draw").disabled = Boolean(pending);
  $("details-button").querySelector(".attention-dot").hidden =
    $("draw-response").hidden;
  if (state.drawOffer && !ended())
    $("status-detail").textContent =
      `${label(sideFor(state.drawOffer))}提议和棋，等待对方回应。`;
  renderHistory();
}
function renderPlayer(card, side) {
  const index = side === "w" ? state.whiteIndex : 3 - state.whiteIndex;
  const name = state.playerNames?.[index - 1];
  card.querySelector(".player-avatar").innerHTML = pieceSvg(side + "K");
  card.querySelector("strong").textContent =
    `${label(side)}${mode === "room" && ownIndex() === index ? " · 你" : ""}${name ? ` · ${name}` : ""}`;
  card.querySelector(".player-detail").textContent =
    `${side === "w" ? "先手" : "后手"} · ${mode === "solo" ? "本地玩家" : "房间玩家"}`;
  card.querySelector(".captured").innerHTML = (
    Array.isArray(state.captured[side]) ? state.captured[side] : []
  )
    .map(pieceSvg)
    .join("");
  card.classList.toggle("is-current", !ended() && state.current === index);
}
function renderHistory() {
  const key = `${state.round}:${state.moves}`;
  if (key === historyKey) return;
  historyKey = key;
  const history = Array.isArray(state.history) ? state.history : [];
  $("history").replaceChildren();
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "每一步，都是新的开始。";
    $("history").append(empty);
  } else {
    const offset = state.moves - history.length;
    for (let i = 0; i < history.length; ) {
      const row = document.createElement("div");
      row.className = "history-row";
      const number = document.createElement("span"),
        white = document.createElement("span"),
        black = document.createElement("span");
      number.textContent = `${Math.floor((offset + i) / 2) + 1}.`;
      if (history[i].color === "w") white.textContent = history[i++].notation;
      if (history[i]?.color === "b") black.textContent = history[i++].notation;
      row.append(number, white, black);
      $("history").append(row);
    }
    $("history").scrollTop = $("history").scrollHeight;
  }
}
if (mode === "solo") void startLocal();
