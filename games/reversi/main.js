import { CircleHelp, RotateCcw, Settings, ChevronRight, X, createIcons } from "lucide";
import { createPlayweftClient } from "../../src/playweft-client.js";
import { SIZE, createReversiState, applyReversiAction } from "./rules.js";
import { createBoardCanvas } from "./board-canvas.js";
import { createOverlayDialog } from "../../src/components/overlay-dialog.js";
import { createReversiAiController } from "./ai-controller.js";
import "./styles.css";

const $ = id => document.getElementById(id);
const cells = [];
const preview = createReversiState();
let mode = window.parent === window ? "solo" : "room";
let state, playerId, pending;
let opponent = "ai";
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
createIcons({ icons: { CircleHelp, RotateCcw, Settings, ChevronRight, X } });
const boardCanvas = createBoardCanvas($("board-view"), $("board-static"), $("board-animation"), cells);
const ai = createReversiAiController({ onMove: action => send(action, 2) });
const setupDialog = createOverlayDialog({
  root: $("setup-dialog"), surface: $("setup-form"), closeButtons: [$("setup-close")],
  initialFocus: $("setup-form"), returnFocus: $("settings-button"),
});
function syncSettings() {
  for (const key of ["opponent", "side"]) {
    const select = $(`${key}-setting`);
    $(`${key}-value`).textContent = select.selectedOptions[0].textContent;
  }
  $("side-field").hidden = $("side-divider").hidden = $("opponent-setting").value !== "ai";
}
for (const select of [$("opponent-setting"), $("side-setting")]) {
  select.addEventListener("change", syncSettings);
  select.closest(".setting-field").addEventListener("click", event => {
    if (event.target === select) return;
    select.focus({ preventScroll: true });
    try { if (select.showPicker) { select.showPicker(); return; } } catch { /* Native select remains directly usable in restricted frames. */ }
    select.click();
  });
}
function openSettings() {
  if (mode !== "solo") return;
  $("start-button").textContent = state ? "开始新对局" : "开始对局";
  syncSettings();
  setupDialog.setOpen(true);
  render();
}
$("settings-button").addEventListener("click", openSettings);
$("setup-dialog").addEventListener("close", render);
$("setup-form").addEventListener("submit", event => {
  event.preventDefault();
  if (mode !== "solo") return;
  opponent = $("opponent-setting").value;
  startLocal();
  setupDialog.setOpen(false);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) ai.cancel();
  else render();
});

function startLocal() {
  ai.cancel();
  state = createReversiState({ blackIndex: opponent === "ai" && $("side-setting").value === "2" ? 2 : 1 });
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
    if (mode === "solo") openSettings();
    else { setupDialog.setOpen(false); render(); }
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

function send(action, actorIndex = mode === "solo" && opponent === "ai" ? 1 : action.type === "rematch" ? 1 : state?.current) {
  if (!state || pending || (mode === "room" && !state.players.includes(playerId))) return;
  if (mode === "solo" && $("setup-dialog").open) return;
  if (action.type === "play" && (state.ended || (mode === "room" && state.players[state.current - 1] !== playerId))) return;
  if (mode === "solo") {
    const result = applyReversiAction(state, action, { actorIndex });
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
  const soloAi = mode === "solo" && opponent === "ai";
  const active = Boolean(state) && !next.ended && !pending && !$("setup-dialog").open
    && (mode === "solo" ? !soloAi || next.current === 1 : ownIndex === next.current);
  $("settings-button").hidden = mode !== "solo";
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
    $(`${key}-name`).textContent = soloAi ? index === 1 ? "你" : "电脑" : mode === "solo" ? `玩家 ${index}` : index === ownIndex ? "你" : `玩家 ${index}`;
  }
  $("rematch-button").hidden = !state || !next.ended || (mode === "room" && !ownIndex);
  $("rematch-button").disabled = Boolean(pending);
  $("game-actions").hidden = $("rematch-button").hidden;
  if (state) {
    const who = index => soloAi ? index === 1 ? "你" : "电脑" : `玩家 ${index}`;
    $("announcement").textContent = next.ended
      ? `${next.draw ? "平局" : `${who(next.winnerIndex)}获胜`}，黑棋 ${next.counts.black}，白棋 ${next.counts.white}`
      : `${next.lastMove.row ? `最新落子 ${coordinate(next.lastMove.row, next.lastMove.column)}。` : ""}${next.passedIndex ? `${who(next.passedIndex)}无合法落点，自动让行。` : ""}轮到${who(next.current)}行棋`;
  }
  ai.update(state, soloAi && !$("setup-dialog").open && !document.hidden);
}
$("rematch-button").addEventListener("click", () => send({ type: "rematch" }));
window.addEventListener("pagehide", event => {
  if (!event.persisted) { window.clearTimeout(helpFallback); ai.cancel(); client?.destroy(); boardCanvas.destroy(); }
});
if (mode === "solo") openSettings();
else render();
