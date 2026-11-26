import { goTieBreakLabel } from "./rules.js";

const formatScore = value => Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 1 });

export function goResultSummary(state) {
  const scoring = !state.ended && state.phase === "scoring";
  const winner = Number(state.winnerIndex);
  const winnerColor = winner === Number(state.blackIndex) ? "黑方" : "白方";
  const event = state.lastEvent?.kind;
  const scored = Boolean(state.ended && event === "scored");
  let reason = "正在核对双方的计分结果，请稍候";
  if (state.ended) {
    if (event === "resigned" || event === "player_left") {
      const loser = Number(state.lastEvent.playerIndex) === Number(state.blackIndex) ? "黑方" : "白方";
      reason = `${loser}${event === "resigned" ? "认输" : "离开了对局"}`;
    } else if (scored) {
      const difference = Math.abs(Number(state.scores.black) - Number(state.scores.white));
      reason = difference > 0
        ? `${winnerColor}领先 ${formatScore(difference)} 目`
        : `贴目后平分，按“${goTieBreakLabel(state.settings?.tieBreak)}”判定`;
    } else reason = "本局已结束";
  }
  return {
    title: scoring ? "正在计分…" : winner ? `${winnerColor}获胜` : "和棋",
    reason,
    black: scored ? formatScore(state.scores.black) : "—",
    white: scored ? formatScore(state.scores.white) : "—",
    rules: `${state.settings?.rules === "japanese" ? "日本规则" : "中国规则"} · 白方加 ${formatScore(state.settings?.komi)} 目`,
  };
}

export function createGoResultDialog({ root, dialog, onRematch, onHome, onRetryScore }) {
  const find = selector => root.querySelector(selector);
  const headline = find("#result-headline"), reason = find("#result-reason");
  const black = find("#result-black"), white = find("#result-white"), rules = find("#result-rules");
  const rematch = find("#rematch-button"), home = find("#result-home");
  let shownKey, scoring = false, active = false, canRetry = false;
  rematch.addEventListener("click", () => {
    if (scoring) {
      rematch.disabled = true;
      reason.textContent = "正在核对双方的计分结果，请稍候";
      onRetryScore();
    } else onRematch();
  });
  home.addEventListener("click", onHome);

  function reset() {
    shownKey = undefined;
    active = false;
    dialog.setOpen(false);
  }

  return {
    reset,
    open() { dialog.setOpen(true); },
    showError(message) {
      if (!active) return false;
      reason.textContent = message;
      if (scoring) {
        rematch.textContent = "重新计分";
        rematch.disabled = !canRetry;
      }
      return dialog.isOpen;
    },
    update(state, { key, participant, local, busy }) {
      if (!state || (!state.ended && state.phase !== "scoring")) { reset(); return; }
      active = true;
      canRetry = participant;
      scoring = !state.ended;
      const summary = goResultSummary(state);
      headline.textContent = summary.title;
      reason.textContent = summary.reason;
      black.textContent = summary.black;
      white.textContent = summary.white;
      rules.textContent = summary.rules;
      rematch.hidden = !participant;
      rematch.textContent = "再来一局";
      rematch.disabled = !state.ended || busy;
      home.hidden = !local;
      // Scoring and its final result share one announcement, even if dismissed.
      if (shownKey !== key) {
        shownKey = key;
        dialog.setOpen(true);
      }
    },
  };
}
