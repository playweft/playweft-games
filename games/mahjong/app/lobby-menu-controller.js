import { careerSummary } from "../career/career.js";

// The lightweight lobby owns navigation before and after the match runtime loads.
export function createMahjongLobbyMenu({ document, window, careerStore, startCareer, showError }) {
  const setup = document.querySelector("#setup-panel");
  const paper = setup.querySelector(".setup-menu-paper");
  const pages = [...setup.querySelectorAll("[data-lobby-page]")];
  const slots = document.querySelector("#career-slots");
  const rootButtons = setup.querySelectorAll("[data-lobby-target]");
  let page = "home", transitioning = false, pending = false, destroyed = false;
  const removers = [];
  const listen = (node, type, callback) => {
    node.addEventListener(type, callback);
    removers.push(() => node.removeEventListener(type, callback));
  };
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const pause = (duration) => new Promise((resolve) => window.setTimeout(resolve, reduced() ? 0 : duration));
  async function navigate(next, { animate = true, focus = true } = {}) {
    if (transitioning || destroyed) return;
    transitioning = true;
    try {
      paper.inert = true;
      paper.classList.add("is-menu-fading");
      if (animate) await pause(160);
      if (destroyed) return;
      page = next;
      for (const element of pages) element.hidden = element.dataset.lobbyPage !== next;
      setup.dataset.lobbyView = next;
      refresh();
      // A separate frame ensures opacity transitions even when no layout changes.
      void paper.offsetWidth;
      paper.classList.remove("is-menu-fading");
      if (animate) await pause(160);
      if (focus) pages.find((element) => !element.hidden)?.querySelector("button")?.focus({ preventScroll: true });
    } finally {
      paper.classList.remove("is-menu-fading");
      paper.inert = false;
      transitioning = false;
    }
  }
  function refresh() {
    if (destroyed) return;
    slots.replaceChildren();
    for (const slot of [1, 2, 3]) {
      const career = careerStore.read(slot);
      const summary = careerSummary(career);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `career-slot${career ? "" : " is-empty"}`;
      button.dataset.careerSlot = String(slot);
      button.disabled = pending;
      button.setAttribute("aria-label", `存档 ${slot}，${career ? summary.action : "新游戏"}`);
      const number = document.createElement("span");
      number.className = "career-slot-number";
      number.textContent = String(slot);
      number.setAttribute("aria-hidden", "true");
      const info = document.createElement("span");
      info.className = "career-slot-info";
      const title = document.createElement("strong");
      title.textContent = career ? summary.heading : "新游戏";
      info.append(title);
      if (career) {
        const progress = document.createElement("span");
        progress.className = "career-slot-progress";
        progress.textContent = summary.progress;
        if (summary.action === "继续对局") progress.textContent += " · 继续对局";
        info.append(progress);
        const last = career.lastSettlement;
        const verdict = last && { placed: `定段 ${last.nextTier}`, promoted: `升级至 ${last.nextTier}`, relegated: `降级至 ${last.nextTier}`, retained: `${last.nextTier} 保级` }[last.outcome];
        if (verdict) {
          const detail = document.createElement("span");
          detail.className = "career-slot-detail";
          detail.textContent = verdict;
          info.append(detail);
        }
      }
      const arrow = document.createElement("span");
      arrow.className = "career-slot-arrow";
      arrow.textContent = "›";
      arrow.setAttribute("aria-hidden", "true");
      button.append(number, info, arrow);
      slots.append(button);
    }
    const room = setup.dataset.room === "true";
    for (const button of rootButtons) {
      if (button.dataset.lobbyTarget === "career") button.hidden = room;
    }
    const rules = setup.querySelector(".rule-options");
    if (rules) rules.hidden = page !== "training";
  }
  for (const button of rootButtons) listen(button, "click", () => void navigate(button.dataset.lobbyTarget));
  listen(slots, "click", async (event) => {
    const button = event.target.closest("[data-career-slot]");
    if (!button || pending || transitioning) return;
    pending = true;
    refresh();
    try { await startCareer(Number(button.dataset.careerSlot)); }
    catch (error) { showError(error.message || "生涯对局准备失败，请重试"); }
    finally { pending = false; refresh(); }
  });
  listen(setup, "keydown", (event) => {
    if (event.key === "Escape" && page !== "home" && !pending) {
      event.preventDefault();
      void navigate("home");
    }
  });
  const observer = new window.MutationObserver(() => {
    if (!setup.hidden) refresh();
  });
  observer.observe(setup, { attributes: true, attributeFilter: ["hidden", "data-room"] });
  refresh();
  return {
    refresh,
    showCareer: () => navigate("career", { animate: false, focus: false }),
    destroy() { destroyed = true; observer.disconnect(); removers.forEach((remove) => remove()); },
  };
}
