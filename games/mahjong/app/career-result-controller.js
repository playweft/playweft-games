import { hasPendingPlacementResult } from "../career/career.js";

const pointsText = (points) => `${points > 0 ? "+" : ""}${points.toFixed(1)}`;

/** A grade reveal backed by the settled slot; no game action or evaluation is rendered here. */
export function createMahjongCareerResult({ document, careerStore, flush, onStartLeague, onReturnToLobby, showError }) {
  const panel = document.querySelector("#career-result");
  const grade = panel.querySelector("#career-result-grade");
  const rows = panel.querySelector("#career-result-rows");
  const total = panel.querySelector("#career-result-total");
  const start = panel.querySelector("#career-result-start");
  const back = panel.querySelector("#career-result-back");
  let busy = false;
  let slot = null;
  let previousFocus;

  function show(career) {
    if (!hasPendingPlacementResult(career)) return false;
    slot = careerStore.activeSlot;
    previousFocus = document.activeElement;
    grade.textContent = career.tier;
    rows.replaceChildren(...career.placement.map((result, index) => {
      const row = document.createElement("tr");
      for (const value of [`第${["一", "二", "三"][index]}场`, `${result.rank}位`, String(result.score), pointsText(result.points)]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    total.textContent = `${pointsText(Math.round(career.placement.reduce((sum, result) => sum + result.points, 0) * 10) / 10)} pt`;
    panel.hidden = false;
    start.focus({ preventScroll: true });
    return true;
  }

  function hide() {
    panel.hidden = true;
    if (previousFocus?.isConnected && !previousFocus.closest("[hidden]")) previousFocus.focus({ preventScroll: true });
  }

  async function finish(callback) {
    if (busy || panel.hidden || !slot) return;
    busy = true;
    start.disabled = back.disabled = true;
    try {
      // Keep the reveal recoverable until a deliberate exit, even across a reload.
      careerStore.acknowledgePlacementResult();
      await flush();
      await callback(slot);
      hide();
    } catch (error) {
      showError(error?.message || "定段结果保存失败，请重试");
    } finally {
      busy = false;
      start.disabled = back.disabled = false;
    }
  }
  const startClick = () => void finish(onStartLeague);
  const backClick = () => void finish(onReturnToLobby);
  start.addEventListener("click", startClick);
  back.addEventListener("click", backClick);
  return { show, hide, destroy() {
    start.removeEventListener("click", startClick);
    back.removeEventListener("click", backClick);
    hide();
  } };
}
