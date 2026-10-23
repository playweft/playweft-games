export const SUDOKU_PROGRESS_KEY = "playweft:sudoku:progress:v1";

export function validateSudokuProgress(key, raw) {
  if (key !== SUDOKU_PROGRESS_KEY || raw === null) return;
  try {
    const saved = JSON.parse(raw);
    const grid = (value) =>
      Array.isArray(value) &&
      value.length === 9 &&
      value.every(
        (row) =>
          Array.isArray(row) &&
          row.length === 9 &&
          row.every(
            (digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9,
          ),
      );
    if (
      saved &&
      grid(saved.initial) &&
      grid(saved.solution) &&
      grid(saved.values)
    )
      return;
  } catch {
    /* Report malformed JSON through the same preserved-save dialog. */
  }
  throw Object.assign(
    new Error(
      "The saved Sudoku board is malformed. The original data has been preserved.",
    ),
    {
      code: "INVALID_SUDOKU_SAVE",
    },
  );
}
