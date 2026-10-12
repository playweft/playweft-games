import { createIcons, ArrowDown, RotateCcw } from "lucide";
import { createPlayweftClient } from "../../src/playweft-client.js";
import {
  createSoloConnectFourState,
  applySoloConnectFourAction,
} from "./solo.js";
import { createConnectFourAiController } from "./ai-controller.js";
import { ROWS, COLUMNS } from "./rules.js";
import "./styles.css";

const elements = {
  heading: document.querySelector("#turn-heading"),
  kicker: document.querySelector("#turn-kicker"),
  message: document.querySelector("#board-message"),
  board: document.querySelector("#board"),
  guides: document.querySelector("#column-guides"),
  rematch: document.querySelector("#rematch-button"),
  players: [
    document.querySelector("#player-one"),
    document.querySelector("#player-two"),
  ],
};

let playerId;
let state;
let pendingActionId;
let playMode = window.parent === window ? "solo" : "room";
const columns = [];
const cells = [];

buildBoard();
createIcons({ icons: { ArrowDown, RotateCcw } });

const preview = {
  players: ["preview-one", "preview-two"],
  board: Array.from({ length: ROWS }, () => Array(COLUMNS).fill(0)),
  current: 1,
  moves: 0,
  winner: "",
  winnerIndex: 0,
  draw: false,
  lastMove: { row: 0, column: 0 },
  winningCells: [],
};

const ai = createConnectFourAiController({
  onMove: (action) => {
    if (playMode === "solo" && state?.current === 2) sendAction(action, 2);
  },
  onError: (error) => {
    elements.message.textContent = error;
  },
});

const client =
  window.parent === window
    ? undefined
    : createPlayweftClient({
        onReady(message) {
          playMode = message.mode ?? "room";
          if (playMode === "solo") {
            startLocal();
            return;
          }
          ai.dispose();
          playerId = message.playerId;
          elements.kicker.textContent = "等待房主开始";
          elements.heading.textContent = "两位玩家就位后开局";
        },
        onState(message) {
          if (playMode === "solo") return;
          playerId = message.playerId;
          state = message.state;
          render(state);
        },
        onActionResult(result) {
          if (result.requestId !== pendingActionId) return;
          pendingActionId = undefined;
          render(state ?? preview);
        },
        onError(error, _code, requestId) {
          if (requestId === pendingActionId) pendingActionId = undefined;
          render(state ?? preview);
          elements.message.textContent = error;
        },
      });

window.addEventListener("pagehide", () => {
  ai.dispose();
  client?.destroy();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && state) render(state);
});
document.addEventListener("visibilitychange", () => {
  if (state) render(state);
});
elements.rematch.addEventListener("click", () =>
  sendAction({ type: "rematch" }),
);
if (playMode === "solo") startLocal();
else render(preview);

function startLocal() {
  ai.dispose();
  pendingActionId = undefined;
  state = createSoloConnectFourState();
  playerId = state.players[0];
  render(state);
}

function buildBoard() {
  for (let column = 1; column <= COLUMNS; column += 1) {
    const guide = document.createElement("span");
    guide.innerHTML = '<i data-lucide="arrow-down"></i>';
    elements.guides.append(guide);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "board-column";
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", `在第 ${column} 列落子`);
    button.disabled = true;
    button.addEventListener("click", () => drop(column));
    const columnCells = [];
    for (let row = 1; row <= ROWS; row += 1) {
      const cell = document.createElement("span");
      cell.className = "board-cell";
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      button.append(cell);
      columnCells.push(cell);
    }
    elements.board.append(button);
    columns.push(button);
    cells.push(columnCells);
  }
}

function drop(column) {
  if (
    !state ||
    state.winner ||
    state.draw ||
    state.players[state.current - 1] !== playerId
  )
    return;
  sendAction({ type: "drop", column });
}

function sendAction(action, actorIndex = 1) {
  if (pendingActionId || !state) return;
  if (playMode === "solo") {
    const result = applySoloConnectFourAction(state, action, { actorIndex });
    if (!result.accepted) return;
    state = result.state;
    render(state);
    return;
  }
  const requestId = client?.sendAction(action);
  if (!requestId) {
    elements.message.textContent = "尚未连接 Playweft 平台";
  } else {
    pendingActionId = requestId;
  }
  render(state);
}

function render(nextState) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const currentIndex = Number(nextState.current) - 1;
  const ended = Boolean(nextState.winner || nextState.draw);
  const winning = new Set(
    Array.isArray(nextState.winningCells)
      ? nextState.winningCells.map((cell) => `${cell.row}:${cell.column}`)
      : [],
  );

  elements.rematch.hidden = !state || !ended || ownIndex < 0;
  elements.rematch.disabled = Boolean(pendingActionId);

  players.slice(0, 2).forEach((id, index) => {
    const panel = elements.players[index];
    panel.querySelector("[data-player-name]").textContent =
      playMode === "solo"
        ? index === 0
          ? "你 · 红方"
          : "电脑 · 黄方"
        : index === ownIndex
          ? `玩家 ${index + 1} · 你`
          : `玩家 ${index + 1}`;
    panel.classList.toggle("is-current", !ended && index === currentIndex);
    panel.classList.toggle(
      "is-winner",
      Number(nextState.winnerIndex) === index + 1,
    );
  });

  for (let column = 0; column < COLUMNS; column += 1) {
    let targetRow = -1;
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      if (Number(nextState.board?.[row]?.[column]) === 0) {
        targetRow = row;
        break;
      }
    }
    const canDrop =
      Boolean(state) &&
      ownIndex === currentIndex &&
      !ended &&
      !pendingActionId &&
      targetRow >= 0;
    columns[column].disabled = !canDrop;
    columns[column].dataset.piece = String(currentIndex + 1);

    for (let row = 0; row < ROWS; row += 1) {
      const value = Number(nextState.board?.[row]?.[column]) || 0;
      const cell = cells[column][row];
      cell.dataset.piece = String(value);
      cell.classList.toggle(
        "is-last",
        Number(nextState.lastMove?.row) === row + 1 &&
          Number(nextState.lastMove?.column) === column + 1,
      );
      cell.classList.toggle(
        "is-winning",
        winning.has(`${row + 1}:${column + 1}`),
      );
      cell.classList.toggle("is-target", canDrop && row === targetRow);
    }
  }

  ai.update(
    nextState,
    `${nextState.round}:${nextState.moves}:${nextState.current}`,
    Boolean(state) &&
      playMode === "solo" &&
      document.visibilityState !== "hidden",
  );

  if (!state) return;
  if (nextState.draw) {
    elements.kicker.textContent = "棋盘已满";
    elements.heading.textContent = "本局平手";
    elements.message.textContent = "双方都守住了自己的连线";
    return;
  }
  if (nextState.winner) {
    const won = Number(nextState.winnerIndex) - 1 === ownIndex;
    elements.kicker.textContent = "四子连线";
    elements.heading.textContent = won
      ? "你赢了"
      : playMode === "solo"
        ? "电脑获胜"
        : "对手获胜";
    elements.message.textContent =
      playMode === "solo"
        ? `${won ? "你" : "电脑"}完成了四连，再来一局交换先后手`
        : `玩家 ${nextState.winnerIndex} 完成了四连`;
    return;
  }
  if (ownIndex < 0) {
    elements.kicker.textContent = "观战中";
    elements.heading.textContent = `玩家 ${currentIndex + 1} 正在思考`;
    elements.message.textContent = `已落 ${nextState.moves} 子`;
  } else if (ownIndex === currentIndex) {
    elements.kicker.textContent = "轮到你了";
    elements.heading.textContent = "选择一列落子";
    elements.message.textContent = `你是${ownIndex === 0 ? "红方" : "黄方"}`;
  } else {
    elements.kicker.textContent = playMode === "solo" ? "电脑回合" : "对手回合";
    elements.heading.textContent =
      playMode === "solo" ? "电脑正在思考" : "等待对手落子";
    elements.message.textContent = `已落 ${nextState.moves} 子`;
  }
}
