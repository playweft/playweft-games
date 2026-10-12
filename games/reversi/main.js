import { CircleHelp, RotateCcw, createIcons } from "lucide";
import { createPlayweftClient } from "../../src/playweft-client.js";
import { SIZE, createReversiState, applyReversiAction } from "./rules.js";
import { createBoardCanvas } from "./board-canvas.js";
import "./styles.css";

const $ = id => document.getElementById(id);
const cells = [];
const preview = createReversiState();
let mode = window.parent === window ? "solo" : "room";
let state, playerId, pending;
const colorName = color => color === 1 ? "黑方" : "白方";
const coordinate = (row, column) => `${String.fromCharCode(64 + column)}${row}`;
const mouseHover = window.matchMedia("(hover: hover) and (pointer: fine)");
let platformReady = false;
const helpFallback = window.parent === window ? undefined : window.setTimeout(() => {
  if (!platformReady) $("help-button").hidden = false;
}, 2000);
if (window.parent === window) $("help-button").hidden = false;

function focusCell(index) {
  cells.forEach((cell, i) => cell.tabIndex = i === index ? 0 : -1);
  cells[index].focus();
}

for (let row = 1; row <= SIZE; row++) {
  const boardRow = document.createElement("div");
  boardRow.className = "board-row";
  boardRow.setAttribute("role", "row");
  $("board").append(boardRow);
  for (let column = 1; column <= SIZE; column++) {
    const cell = document.createElement("button");
    const index = cells.length;
    cell.className = "reversi-cell";
    cell.type = "button";
    cell.setAttribute("role", "gridcell");
    cell.dataset.row = row;
    cell.dataset.column = column;
    cell.addEventListener("click", () => send({ type: "play", row, column }));
    cell.addEventListener("focus", () => {
      cells.forEach((button, i) => button.tabIndex = i === index ? 0 : -1);
      boardCanvas.focus(cell.matches(":focus-visible") ? index : -1);
    });
    cell.addEventListener("blur", () => boardCanvas.focus(-1));
    cell.addEventListener("pointerenter", () => { if (mouseHover.matches) boardCanvas.hover(index); });
    cell.addEventListener("pointerleave", () => boardCanvas.hover(-1));
    cell.addEventListener("keydown", event => {
      const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
      if (!step) return;
      event.preventDefault();
      const r = row + step[0], c = column + step[1];
      if (r >= 1 && r <= SIZE && c >= 1 && c <= SIZE) focusCell((r - 1) * SIZE + c - 1);
    });
    cells.push(cell);
    boardRow.append(cell);
  }
}
createIcons({ icons: { CircleHelp, RotateCcw } });
const boardCanvas = createBoardCanvas($("board-view"), $("board-static"), $("board-animation"), cells);

function startLocal() {
  state = createReversiState();
  pending = undefined;
  render();
}
const client = window.parent === window ? undefined : createPlayweftClient({
  onReady(message) {
    platformReady = true;
    window.clearTimeout(helpFallback);
    $("help-button").hidden = true;
    mode = message.mode ?? "room";
    playerId = message.playerId;
    if (mode === "solo") startLocal();
    else render();
  },
  onState(message) {
    if (mode === "solo") return;
    playerId = message.playerId;
    state = message.state;
    pending = undefined;
    render();
  },
  onActionResult(result) {
    if (result.requestId !== pending) return;
    pending = undefined;
    render();
  },
  onError(_message, _code, requestId) {
    if (!platformReady) {
      window.clearTimeout(helpFallback);
      $("help-button").hidden = false;
    }
    if (!requestId || requestId === pending) pending = undefined;
    render();
  },
});

function send(action) {
  if (!state || pending || (mode === "room" && !state.players.includes(playerId))) return;
  if (action.type === "play" && (state.ended || (mode === "room" && state.players[state.current - 1] !== playerId))) return;
  if (mode === "solo") {
    const result = applyReversiAction(state, action, { actorIndex: action.type === "rematch" ? 1 : state.current });
    if (!result.accepted) return;
    state = result.state;
  } else {
    pending = client?.sendAction(action);
  }
  render();
}

function render() {
  const next = state ?? preview;
  const ownIndex = next.players.indexOf(playerId) + 1;
  const active = Boolean(state) && !next.ended && !pending && (mode === "solo" || ownIndex === next.current);
  const moves = new Map((Array.isArray(next.legalMoves) ? next.legalMoves : []).map(move => [`${move.row}:${move.column}`, move.flips]));
  const focused = cells.indexOf(document.activeElement);
  const firstMove = Array.isArray(next.legalMoves) ? next.legalMoves[0] : undefined;
  const tabIndex = focused >= 0 ? focused : firstMove ? (firstMove.row - 1) * SIZE + firstMove.column - 1 : 0;
  for (let index = 0; index < cells.length; index++) {
    const row = Math.floor(index / SIZE) + 1, column = index % SIZE + 1;
    const cell = cells[index], piece = next.board[row - 1][column - 1];
    const key = `${row}:${column}`, count = moves.get(key);
    cell.dataset.piece = piece;
    cell.classList.toggle("is-legal", active && Boolean(count));
    cell.disabled = !active;
    cell.tabIndex = active && index === tabIndex ? 0 : -1;
    cell.setAttribute("aria-label", `${coordinate(row, column)}，${piece ? colorName(piece) + "棋子" : "空位"}${active && count ? `，可落子，翻转 ${count} 子` : ""}`);
  }
  boardCanvas.update(next, active);
  for (const [color, key] of [[1, "black"], [2, "white"]]) {
    const index = color === 1 ? next.blackIndex : 3 - next.blackIndex;
    $(`${key}-count`).textContent = next.counts[key];
    $(`${key}-player`).classList.toggle("is-current", Boolean(state) && !next.ended && index === next.current);
    $(`${key}-name`).textContent = mode === "solo" ? `玩家 ${index}` : index === ownIndex ? "你" : `玩家 ${index}`;
  }
  $("rematch-button").hidden = !state || !next.ended || (mode === "room" && !ownIndex);
  $("rematch-button").disabled = Boolean(pending);
  $("game-actions").hidden = $("rematch-button").hidden;
}
$("rematch-button").addEventListener("click", () => send({ type: "rematch" }));
window.addEventListener("pagehide", event => {
  if (!event.persisted) { window.clearTimeout(helpFallback); client?.destroy(); boardCanvas.destroy(); }
});
if (mode === "solo") startLocal();
else render();
