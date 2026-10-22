export function createChessMoveAnimator(squares) {
  const active = new Set();
  const squareAt = (row, column) => squares[(row - 1) * 8 + column - 1];

  function cancel() {
    for (const { animation, square } of active) {
      animation.cancel();
      square.classList.remove("is-moving");
    }
    active.clear();
  }

  function play(previous, next) {
    cancel();
    if (
      !previous ||
      previous.round !== next.round ||
      next.moves !== previous.moves + 1 ||
      squares[0].ownerDocument.defaultView.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches
    ) return;

    const move = next.lastMove;
    if (!move?.fromRow || !move.toRow) return;
    const piece = previous.board[move.fromRow - 1][move.fromColumn - 1];
    const destination = next.board[move.toRow - 1][move.toColumn - 1];
    if (!piece || !destination || piece[0] !== destination[0]) return;

    const moves = [move];
    if (move.special === "castle") {
      moves.push({
        fromRow: move.fromRow,
        fromColumn: move.toColumn === 7 ? 8 : 1,
        toRow: move.toRow,
        toColumn: move.toColumn === 7 ? 6 : 4,
      });
    }

    // Measure after rendering so movement also follows a newly flipped view.
    const transitions = moves.map(({ fromRow, fromColumn, toRow, toColumn }) => {
      const square = squareAt(toRow, toColumn);
      const from = squareAt(fromRow, fromColumn).getBoundingClientRect();
      const to = square.getBoundingClientRect();
      return {
        square,
        piece: square.querySelector(".piece"),
        x: from.x + from.width / 2 - to.x - to.width / 2,
        y: from.y + from.height / 2 - to.y - to.height / 2,
      };
    });
    for (const { square, piece, x, y } of transitions) {
      if (!piece?.animate || (!x && !y)) continue;
      const rotation = square.classList.contains("is-upside-down") ? 180 : 0;
      square.classList.add("is-moving");
      const animation = piece.animate(
        [
          { transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)` },
          { transform: `translate(0, 0) rotate(${rotation}deg)` },
        ],
        { duration: 200, easing: "cubic-bezier(0.2, 0.65, 0.3, 1)" },
      );
      const entry = { animation, square };
      active.add(entry);
      const finish = () => {
        if (active.delete(entry)) square.classList.remove("is-moving");
      };
      animation.addEventListener("finish", finish, { once: true });
      animation.addEventListener("cancel", finish, { once: true });
    }
  }

  return { play, cancel };
}
