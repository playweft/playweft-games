export const ROWS = 6;
export const COLUMNS = 7;
export const COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export const WINNING_WINDOWS = [];
export const CELL_WINDOWS = Array.from({ length: ROWS * COLUMNS }, () => []);
for (let row = 0; row < ROWS; row += 1) {
  for (let column = 0; column < COLUMNS; column += 1) {
    for (const [dr, dc] of DIRECTIONS) {
      const endRow = row + dr * 3;
      const endColumn = column + dc * 3;
      if (!inside(endRow, endColumn)) continue;
      const cells = Array.from({ length: 4 }, (_, n) => (row + dr * n) * COLUMNS + column + dc * n);
      const index = WINNING_WINDOWS.length;
      WINNING_WINDOWS.push(cells);
      for (const cell of cells) CELL_WINDOWS[cell].push(index);
    }
  }
}

export function winningCells(board, row, column, piece) {
  for (const [dr, dc] of DIRECTIONS) {
    let r = row;
    let c = column;
    while (inside(r - dr, c - dc) && board[r - dr][c - dc] === piece) {
      r -= dr;
      c -= dc;
    }
    const line = [];
    while (inside(r, c) && board[r][c] === piece) {
      line.push({ row: r + 1, column: c + 1 });
      r += dr;
      c += dc;
    }
    if (line.length >= 4) return line;
  }
  return [];
}

function inside(row, column) {
  return row >= 0 && row < ROWS && column >= 0 && column < COLUMNS;
}
