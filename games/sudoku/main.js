import "../../src/game-storage.css";
import { initializeGameStorage } from "../../src/game-storage-ui.js";
import { SUDOKU_PROGRESS_KEY, validateSudokuProgress } from "./storage.js";
import {
  DIGITS,
  PUZZLE_DIFFICULTIES,
  SIZE,
  candidatesFor,
  cloneGrid,
  conflictsFor,
  generatePuzzleForDifficulty,
} from "./sudoku.js";
import {
  Eraser,
  HelpCircle,
  Lightbulb,
  ListPlus,
  ListX,
  Pencil,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Undo2,
  createIcons,
} from "lucide";
import { createPlayweftSoloClient } from "../../src/playweft-solo-client.js";
import "../../src/base.css";
import "./styles.css";

const PROGRESS_KEY = SUDOKU_PROGRESS_KEY;
const SAVE_INTERVAL_SECONDS = 5;
const DEFAULT_DIFFICULTY = "very-hard";

const elements = {
  layout: document.querySelector(".sudoku-layout"),
  board: document.querySelector("#sudoku-board"),
  digitPad: document.querySelector("#digit-pad"),
  timer: document.querySelector("#timer"),
  autoNotes: document.querySelector("#auto-notes-button"),
  noteToggle: document.querySelector("#note-toggle"),
  undo: document.querySelector("#undo-button"),
  erase: document.querySelector("#erase-button"),
  hint: document.querySelector("#hint-button"),
  clearNotes: document.querySelector("#clear-notes-button"),
  reset: document.querySelector("#reset-button"),
  newGame: document.querySelector("#new-game-button"),
  complete: document.querySelector("#completion"),
  nextGame: document.querySelector("#next-game-button"),
  pause: document.querySelector("#pause-button"),
  generatingOverlay: document.querySelector("#generating-overlay"),
  pausedOverlay: document.querySelector("#paused-overlay"),
  resume: document.querySelector("#resume-button"),
  difficultyOverlay: document.querySelector("#difficulty-overlay"),
  difficultyOptions: document.querySelector("#difficulty-options"),
  difficultyCancel: document.querySelector("#difficulty-cancel-button"),
};

let initial;
let solution;
let values;
let notes;
let selected;
let highlightedDigit;
let history = [];
let noteMode = false;
let complete = false;
let elapsedMilliseconds = 0;
let timerStartedAt;
let isGenerating = false;
let paused = false;
let choosingDifficulty = false;
let currentDifficulty = DEFAULT_DIFFICULTY;
let lastSavedSecond = -1;
let generatorWorker;
let nextGenerationRequestId = 0;
const cells = [];
const pendingGenerations = new Map();
const platform = createPlayweftSoloClient();
let storage;

async function initialize() {
  elements.pause.disabled = true;
  elements.layout.inert = true;
  storage = await initializeGameStorage(platform, {
    gameId: "sudoku",
    keys: [PROGRESS_KEY],
    validate: validateSudokuProgress,
  });
  createIcons({
    icons: {
      Eraser,
      HelpCircle,
      Lightbulb,
      ListPlus,
      ListX,
      Pause,
      Pencil,
      Play,
      RotateCcw,
      Sparkles,
      Undo2,
    },
  });
  buildBoard();
  buildDigitPad();
  bindEvents();
  if (restoreProgress()) {
    startTimer();
    render();
  } else {
    openDifficultyPicker();
  }
  window.requestAnimationFrame(() => {
    document.body.classList.remove("is-initializing");
  });
}
void initialize();
window.setInterval(updateTimer, 1_000);
window.addEventListener("pagehide", (event) => {
  stopTimer();
  saveProgress();
  generatorWorker?.terminate();
  if (!event.persisted) {
    void storage?.flush().catch(() => {}).finally(() => platform.destroy());
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    startTimer();
  } else {
    stopTimer();
  }
  updateTimer();
  saveProgress();
});

function buildBoard() {
  for (let row = 0; row < SIZE; row += 1) {
    const rowCells = [];
    for (let column = 0; column < SIZE; column += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "sudoku-cell";
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.setAttribute("role", "gridcell");
      cell.addEventListener("click", () => {
        if (!values || isGenerating) return;
        if (highlightedDigit && !isGiven(row, column) && !values[row][column]) {
          writeDigit(row, column, highlightedDigit);
          selected = undefined;
          render();
          return;
        }
        if (selected?.row === row && selected?.column === column) {
          selected = undefined;
        } else {
          selected = { row, column };
          highlightedDigit = undefined;
        }
        render();
      });
      elements.board.append(cell);
      rowCells.push(cell);
    }
    cells.push(rowCells);
  }
}

function buildDigitPad() {
  for (const digit of DIGITS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.digit = String(digit);
    button.textContent = String(digit);
    button.setAttribute("aria-label", `填入数字 ${digit}`);
    elements.digitPad.append(button);
  }
}

function bindEvents() {
  elements.digitPad.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-digit]");
    if (button) applyDigit(Number(button.dataset.digit));
  });
  elements.noteToggle.addEventListener("click", () => {
    if (!values || isGenerating || paused) return;
    noteMode = !noteMode;
    render();
  });
  elements.autoNotes.addEventListener("click", addAutoNotes);
  elements.undo.addEventListener("click", undo);
  elements.erase.addEventListener("click", eraseSelected);
  elements.hint.addEventListener("click", revealHint);
  elements.clearNotes.addEventListener("click", clearAllNotes);
  elements.reset.addEventListener("click", resetPuzzle);
  elements.newGame.addEventListener("click", openDifficultyPicker);
  elements.nextGame.addEventListener("click", () =>
    startNewGame(currentDifficulty),
  );
  elements.pause.addEventListener("click", pauseGame);
  elements.resume.addEventListener("click", resumeGame);
  elements.difficultyOptions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-difficulty]");
    if (button) startNewGame(button.dataset.difficulty);
  });
  elements.difficultyCancel.addEventListener("click", closeDifficultyPicker);
  window.addEventListener("keydown", (event) => {
    if (!values || isGenerating || paused) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      applyDigit(Number(event.key));
      return;
    }
    if (
      event.key === "Backspace" ||
      event.key === "Delete" ||
      event.key === "0"
    ) {
      event.preventDefault();
      eraseSelected();
      return;
    }
    if (event.key.toLowerCase() === "n") {
      noteMode = !noteMode;
      render();
      return;
    }
    const moves = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const origin = selected ?? firstBlank(values) ?? { row: 0, column: 0 };
      selected = {
        row: Math.max(0, Math.min(SIZE - 1, origin.row + moves[event.key][0])),
        column: Math.max(
          0,
          Math.min(SIZE - 1, origin.column + moves[event.key][1]),
        ),
      };
      highlightedDigit = undefined;
      render();
    }
  });
}

function openDifficultyPicker() {
  if (isGenerating) return;
  stopTimer();
  choosingDifficulty = true;
  render();
  window.requestAnimationFrame(() => {
    elements.difficultyOptions
      .querySelector("button[data-difficulty]")
      ?.focus();
  });
}

function closeDifficultyPicker() {
  if (!values) return;
  choosingDifficulty = false;
  render();
  window.requestAnimationFrame(() => elements.newGame.focus());
}

async function startNewGame(difficulty = currentDifficulty) {
  if (isGenerating) return;
  if (!PUZZLE_DIFFICULTIES.includes(difficulty)) return;
  currentDifficulty = difficulty;
  choosingDifficulty = false;
  isGenerating = true;
  stopTimer();
  paused = false;
  elements.newGame.disabled = true;
  render();
  let generatedNewPuzzle = false;
  try {
    const generated = await generatePuzzle(currentDifficulty).catch(() =>
      generatePuzzleForDifficulty(currentDifficulty),
    );
    initial = generated.puzzle;
    solution = generated.solution;
    values = cloneGrid(initial);
    notes = emptyNotes();
    selected = undefined;
    highlightedDigit = undefined;
    history = [];
    noteMode = false;
    complete = false;
    elapsedMilliseconds = 0;
    lastSavedSecond = -1;
    generatedNewPuzzle = true;
  } finally {
    isGenerating = false;
    elements.newGame.disabled = false;
    if (generatedNewPuzzle) startTimer();
    render();
  }
}

function applyDigit(digit) {
  if (!values || isGenerating || paused || complete || isDigitComplete(digit))
    return;
  if (!selected || highlightedDigit) {
    highlightedDigit = highlightedDigit === digit ? undefined : digit;
    render();
    return;
  }
  if (isGiven(selected.row, selected.column)) return;
  writeDigit(selected.row, selected.column, digit);
  render();
}

function writeDigit(row, column, digit) {
  if (isDigitComplete(digit)) return;
  if (noteMode) {
    if (values[row][column]) return;
    notes[row][column].has(digit)
      ? notes[row][column].delete(digit)
      : notes[row][column].add(digit);
    return;
  }
  if (values[row][column] === digit) return;
  saveHistory(row, column);
  values[row][column] = digit;
  notes[row][column].clear();
  selected = undefined;
  if (highlightedDigit === digit && isDigitComplete(digit)) {
    highlightedDigit = undefined;
  }
  finishIfComplete();
}

function isDigitComplete(digit) {
  if (!values || !solution) return false;
  let correctCount = 0;
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      if (values[row][column] === digit && solution[row][column] === digit) {
        correctCount += 1;
      }
    }
  }
  return correctCount === SIZE;
}

function eraseSelected() {
  if (
    !values ||
    isGenerating ||
    paused ||
    !selected ||
    complete ||
    isGiven(selected.row, selected.column)
  )
    return;
  const { row, column } = selected;
  if (!values[row][column] && notes[row][column].size === 0) return;
  saveHistory(row, column);
  values[row][column] = 0;
  notes[row][column].clear();
  render();
}

function addAutoNotes() {
  if (!values || isGenerating || complete) return;
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      if (values[row][column]) {
        notes[row][column].clear();
      } else {
        notes[row][column] = new Set(candidatesFor(values, row, column));
      }
    }
  }
  paused = false;
  startTimer();
  render();
}

function clearAllNotes() {
  if (!values || isGenerating || complete) return;
  notes = emptyNotes();
  paused = false;
  startTimer();
  render();
}

function revealHint() {
  if (!values || isGenerating || paused || complete) return;
  const target =
    !selected || values[selected.row][selected.column]
      ? firstBlank(values)
      : selected;
  if (!target) return;
  saveHistory(target.row, target.column);
  values[target.row][target.column] = solution[target.row][target.column];
  notes[target.row][target.column].clear();
  selected = target;
  highlightedDigit = undefined;
  finishIfComplete();
  render();
}

function undo() {
  if (!values || isGenerating || paused || complete) return;
  const previous = history.pop();
  if (!previous) return;
  values[previous.row][previous.column] = previous.value;
  notes[previous.row][previous.column] = new Set(previous.notes);
  selected = undefined;
  highlightedDigit = undefined;
  render();
  flashUndoneCell(previous.row, previous.column);
}

function flashUndoneCell(row, column) {
  const cell = cells[row][column];
  cell.classList.remove("is-undo-flash");
  void cell.offsetWidth;
  cell.classList.add("is-undo-flash");
  cell.addEventListener(
    "animationend",
    () => cell.classList.remove("is-undo-flash"),
    { once: true },
  );
}

function resetPuzzle() {
  if (!values || isGenerating) return;
  stopTimer();
  values = cloneGrid(initial);
  notes = emptyNotes();
  selected = undefined;
  highlightedDigit = undefined;
  history = [];
  complete = false;
  paused = false;
  elapsedMilliseconds = 0;
  lastSavedSecond = -1;
  startTimer();
  render();
}

function saveHistory(row, column) {
  history.push({
    row,
    column,
    value: values[row][column],
    notes: [...notes[row][column]],
  });
  if (history.length > 120) history.shift();
}

function finishIfComplete() {
  if (values.some((row) => row.includes(0))) return;
  if (
    values.some((row, rowIndex) =>
      row.some((value, column) => value !== solution[rowIndex][column]),
    )
  ) {
    return;
  }
  complete = true;
  stopTimer();
}

function render() {
  elements.generatingOverlay.classList.toggle("is-visible", isGenerating);
  elements.generatingOverlay.setAttribute("aria-hidden", String(!isGenerating));
  const showPauseMenu = paused;
  const pauseMenuInteractive = showPauseMenu && !choosingDifficulty;
  elements.pausedOverlay.classList.toggle("is-visible", showPauseMenu);
  elements.pausedOverlay.setAttribute(
    "aria-hidden",
    String(!pauseMenuInteractive),
  );
  elements.pausedOverlay.inert = !pauseMenuInteractive;
  elements.difficultyOverlay.classList.toggle(
    "is-visible",
    choosingDifficulty,
  );
  elements.difficultyOverlay.setAttribute(
    "aria-hidden",
    String(!choosingDifficulty),
  );
  elements.difficultyOverlay.inert = !choosingDifficulty;
  elements.difficultyCancel.hidden = !values;
  elements.layout.inert = paused || choosingDifficulty || isGenerating;
  elements.pause.disabled =
    !values || complete || isGenerating || paused || choosingDifficulty;
  if (!values) {
    updateTimer();
    return;
  }
  const selectedValue = selected
    ? values[selected.row][selected.column]
    : highlightedDigit;
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      const cell = cells[row][column];
      const value = values[row][column];
      const isPeer =
        Boolean(selected) &&
        (row === selected.row ||
          column === selected.column ||
          (Math.floor(row / 3) === Math.floor(selected.row / 3) &&
            Math.floor(column / 3) === Math.floor(selected.column / 3)));
      cell.classList.toggle("is-given", isGiven(row, column));
      cell.classList.toggle(
        "is-selected",
        Boolean(selected && row === selected.row && column === selected.column),
      );
      cell.classList.toggle("is-peer", isPeer);
      cell.classList.toggle(
        "is-matching",
        Boolean(selectedValue && value === selectedValue),
      );
      cell.classList.toggle("is-conflict", conflictsFor(values, row, column));
      cell.disabled = complete || isGenerating || paused;
      cell.setAttribute(
        "aria-label",
        `第 ${row + 1} 行第 ${column + 1} 列${value ? `，数字 ${value}` : "，空白"}`,
      );
      renderCell(cell, value, notes[row][column]);
    }
  }
  elements.noteToggle.classList.toggle("is-active", noteMode);
  elements.noteToggle.setAttribute("aria-pressed", String(noteMode));
  elements.noteToggle.title = noteMode ? "候选数字已开启" : "候选数字";
  elements.noteToggle.disabled = complete || isGenerating || paused;
  elements.undo.disabled =
    history.length === 0 || complete || isGenerating || paused;
  elements.erase.disabled =
    !selected ||
    isGiven(selected.row, selected.column) ||
    complete ||
    isGenerating ||
    paused;
  elements.hint.disabled = complete || isGenerating || paused;
  elements.autoNotes.disabled = complete || isGenerating;
  elements.reset.disabled = complete || isGenerating;
  elements.newGame.disabled = isGenerating;
  for (const button of elements.digitPad.querySelectorAll("button")) {
    button.classList.toggle(
      "is-highlighted",
      Number(button.dataset.digit) === highlightedDigit,
    );
    button.disabled =
      complete ||
      isGenerating ||
      paused ||
      isDigitComplete(Number(button.dataset.digit));
  }
  const showCompletion = complete && !isGenerating;
  elements.complete.classList.toggle("is-visible", showCompletion);
  elements.complete.setAttribute("aria-hidden", String(!showCompletion));
  elements.nextGame.disabled = !showCompletion;
  updateTimer();
  saveProgress();
}

function renderCell(cell, value, cellNotes) {
  if (value) {
    const valueLabel = document.createElement("span");
    valueLabel.className = "cell-value";
    valueLabel.textContent = String(value);
    cell.replaceChildren(valueLabel);
    return;
  }
  const noteLabel = document.createElement("span");
  noteLabel.className = "cell-notes";
  noteLabel.textContent = [...cellNotes].join("");
  cell.replaceChildren(noteLabel);
}

function updateTimer() {
  syncTimer();
  const seconds = elapsedSeconds();
  elements.timer.textContent = formatTime(seconds);
  if (values && seconds - lastSavedSecond >= SAVE_INTERVAL_SECONDS) {
    saveProgress();
  }
}

function firstBlank(grid) {
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      if (!grid[row][column]) return { row, column };
    }
  }
  return undefined;
}

function emptyNotes() {
  return Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => new Set()),
  );
}

function isGiven(row, column) {
  return Boolean(initial?.[row]?.[column]);
}

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function generatePuzzle(difficulty) {
  if (typeof Worker === "undefined") {
    return Promise.resolve().then(() =>
      generatePuzzleForDifficulty(difficulty),
    );
  }
  if (!generatorWorker) {
    generatorWorker = new Worker(
      new URL("./generator-worker.js", import.meta.url),
      { type: "module" },
    );
    generatorWorker.addEventListener("message", ({ data }) => {
      const pending = pendingGenerations.get(data?.requestId);
      if (!pending) return;
      pendingGenerations.delete(data.requestId);
      if (data.type === "generated") pending.resolve(data.generated);
      else
        pending.reject(new Error(data?.error ?? "Unable to generate Sudoku"));
    });
    generatorWorker.addEventListener("error", () => {
      for (const pending of pendingGenerations.values()) {
        pending.reject(new Error("Unable to generate Sudoku"));
      }
      pendingGenerations.clear();
      generatorWorker?.terminate();
      generatorWorker = undefined;
    });
  }
  return new Promise((resolve, reject) => {
    const requestId = ++nextGenerationRequestId;
    pendingGenerations.set(requestId, { resolve, reject });
    generatorWorker.postMessage({ type: "generate", requestId, difficulty });
  });
}

function startTimer() {
  if (
    values &&
    !complete &&
    !paused &&
    !isGenerating &&
    document.visibilityState === "visible" &&
    !timerStartedAt
  ) {
    timerStartedAt = Date.now();
  }
}

function stopTimer() {
  syncTimer();
  timerStartedAt = undefined;
}

function syncTimer() {
  if (!timerStartedAt) return;
  const now = Date.now();
  elapsedMilliseconds += now - timerStartedAt;
  timerStartedAt = now;
}

function elapsedSeconds() {
  return Math.floor(elapsedMilliseconds / 1_000);
}

function saveProgress() {
  if (!values) return;
  try {
    storage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        initial,
        solution,
        values,
        notes: notes.map((row) => row.map((cell) => [...cell])),
        selected,
        highlightedDigit,
        history,
        noteMode,
        complete,
        paused,
        difficulty: currentDifficulty,
        elapsedMilliseconds,
      }),
    );
    lastSavedSecond = elapsedSeconds();
  } catch (error) {
    console.error("Sudoku snapshot could not be queued", error);
  }
}

function restoreProgress() {
  try {
    const saved = JSON.parse(storage.getItem(PROGRESS_KEY) ?? "null");
    if (
      !saved ||
      !isGrid(saved.initial) ||
      !isGrid(saved.solution) ||
      !isGrid(saved.values)
    ) {
      return false;
    }
    initial = saved.initial;
    solution = saved.solution;
    values = saved.values;
    notes = restoreNotes(saved.notes);
    selected = isCell(saved.selected) ? saved.selected : undefined;
    highlightedDigit = DIGITS.includes(saved.highlightedDigit)
      ? saved.highlightedDigit
      : undefined;
    history = restoreHistory(saved.history);
    noteMode = saved.noteMode === true;
    complete = saved.complete === true;
    paused = saved.paused === true && !complete;
    currentDifficulty = PUZZLE_DIFFICULTIES.includes(saved.difficulty)
      ? saved.difficulty
      : DEFAULT_DIFFICULTY;
    elapsedMilliseconds = Number.isFinite(saved.elapsedMilliseconds)
      ? Math.max(0, saved.elapsedMilliseconds)
      : 0;
    lastSavedSecond = elapsedSeconds();
    return true;
  } catch {
    return false;
  }
}

function pauseGame() {
  if (!values || isGenerating || complete || paused) return;
  paused = true;
  stopTimer();
  render();
}

function resumeGame() {
  if (!paused) return;
  paused = false;
  startTimer();
  render();
}

function isGrid(grid) {
  return (
    Array.isArray(grid) &&
    grid.length === SIZE &&
    grid.every(
      (row) =>
        Array.isArray(row) &&
        row.length === SIZE &&
        row.every(
          (value) => Number.isInteger(value) && value >= 0 && value <= SIZE,
        ),
    )
  );
}

function restoreNotes(savedNotes) {
  if (!Array.isArray(savedNotes) || savedNotes.length !== SIZE) {
    return emptyNotes();
  }
  return savedNotes.map((row) =>
    Array.from(
      { length: SIZE },
      (_, column) =>
        new Set(
          Array.isArray(row?.[column])
            ? row[column].filter((value) => DIGITS.includes(value))
            : [],
        ),
    ),
  );
}

function restoreHistory(savedHistory) {
  if (!Array.isArray(savedHistory)) return [];
  return savedHistory
    .filter(
      (entry) =>
        isCell(entry) &&
        Number.isInteger(entry.value) &&
        entry.value >= 0 &&
        entry.value <= SIZE &&
        Array.isArray(entry.notes),
    )
    .slice(-120)
    .map((entry) => ({
      row: entry.row,
      column: entry.column,
      value: entry.value,
      notes: entry.notes.filter((value) => DIGITS.includes(value)),
    }));
}

function isCell(value) {
  return (
    value &&
    Number.isInteger(value.row) &&
    Number.isInteger(value.column) &&
    value.row >= 0 &&
    value.row < SIZE &&
    value.column >= 0 &&
    value.column < SIZE
  );
}
