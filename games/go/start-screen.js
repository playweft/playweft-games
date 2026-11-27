export function createStartScreen({ root, models, difficulty, onAi, onLocal, onOnline,
  onResume, onBack, onAdvanced, onStart, onDifficulty }) {
  const find = selector => root.querySelector(selector);
  const home = find("#home-menu"), match = find("#match-menu");
  const playAi = find("#play-ai"), local = find("#play-local"), online = find("#play-online");
  const resume = find("#play-resume"), resumeEntry = find("#resume-entry");
  const history = find("#history-button");
  const back = find("#match-menu-back"), advanced = find("#match-advanced"), start = find("#match-start");
  const select = find("#quick-ai-difficulty");
  const status = root.ownerDocument.querySelector("#start-status");
  const title = find("#match-menu-title"), stack = find(".start-menu-stack");
  const labels = { ai: find(".start-ai-label"), local: find(".start-local-label") };
  const movingTitle = root.ownerDocument.createElement("span");
  movingTitle.className = "start-moving-label";
  movingTitle.setAttribute("aria-hidden", "true");
  movingTitle.hidden = true;
  stack.append(movingTitle);
  let page = "home", resumeId, titleMotion, lastOpponent = "ai";

  function setStatus(message) {
    if (message && message !== status.textContent) status.textContent = message;
    status.classList.toggle("is-visible", Boolean(message));
    const view = root.ownerDocument.defaultView;
    if (!message && (view.matchMedia("(prefers-reduced-motion: reduce)").matches || view.getComputedStyle(status).opacity === "0")) {
      status.textContent = "";
    }
  }
  status.addEventListener("transitionend", event => {
    if (event.target === status && event.propertyName === "opacity" && !status.classList.contains("is-visible")) {
      status.textContent = "";
    }
  });

  root.ownerDocument.addEventListener("keydown", event => {
    if (!event.ctrlKey && !event.altKey && !event.metaKey) root.classList.add("is-keyboard-navigation");
  }, { capture: true });
  root.addEventListener("pointerdown", () => {
    root.classList.remove("is-keyboard-navigation");
  }, { capture: true });

  // Layout offsets exclude the menu slide and the pressed button's transform.
  function staticPosition(element) {
    let x = 0, y = 0;
    for (let node = element; node && node !== stack; node = node.offsetParent) {
      x += node.offsetLeft;
      y += node.offsetTop;
    }
    return { x, y };
  }

  function clearTitleMotion() {
    titleMotion?.cancel();
    titleMotion = undefined;
    movingTitle.hidden = true;
    delete root.dataset.movingTitle;
  }

  function focusCurrentPage() {
    const entry = lastOpponent === "local" ? local : playAi;
    const target = page === "home" ? entry : title;
    target.focus({ preventScroll: true });
  }

  for (const panel of [home, match]) {
    panel.addEventListener("transitionend", event => {
      if (event.target === panel && event.propertyName === "opacity" && !panel.inert && !root.hidden &&
        root.ownerDocument.activeElement === root.ownerDocument.body) focusCurrentPage();
    });
  }

  for (const [id, model] of Object.entries(models)) {
    const option = root.ownerDocument.createElement("option");
    option.value = id;
    option.textContent = model.difficulty;
    select.add(option);
  }
  select.value = difficulty;
  playAi.addEventListener("click", onAi);
  local.addEventListener("click", onLocal);
  online.addEventListener("click", onOnline);
  resume.addEventListener("click", () => { if (resumeId) onResume(resumeId); });
  back.addEventListener("click", onBack);
  advanced.addEventListener("click", onAdvanced);
  start.addEventListener("click", onStart);
  select.addEventListener("change", () => onDifficulty(select.value));
  select.parentElement.addEventListener("click", event => {
    if (event.target === select || select.disabled) return;
    select.focus({ preventScroll: true });
    try { select.showPicker(); } catch { select.click(); }
  });

  return {
    get page() { return page; },
    get advancedButton() { return advanced; },
    show(next) {
      const previous = page;
      const opponent = next === "home" ? lastOpponent : next;
      const canAnimate = !root.hidden && previous !== next &&
        (previous === "home" || next === "home") && movingTitle.animate &&
        !root.ownerDocument.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let source;
      if (canAnimate) {
        if (titleMotion && root.dataset.movingTitle === opponent) {
          const current = movingTitle.getBoundingClientRect(), bounds = stack.getBoundingClientRect();
          source = { x: current.left - bounds.left, y: current.top - bounds.top };
        } else source = staticPosition(previous === "home" ? labels[opponent] : title);
      }
      clearTitleMotion();
      page = next;
      history.hidden = page !== "home";
      if (page !== "home") {
        lastOpponent = page;
        title.textContent = page === "ai" ? "人机对战" : "本地双人";
        select.parentElement.hidden = page !== "ai";
      }
      home.setAttribute("aria-hidden", String(page !== "home"));
      match.setAttribute("aria-hidden", String(page === "home"));
      home.inert = page !== "home";
      match.inert = page === "home";
      if (source) {
        const target = staticPosition(page === "home" ? labels[opponent] : title);
        root.dataset.movingTitle = opponent;
        movingTitle.textContent = labels[opponent].textContent;
        movingTitle.hidden = false;
        const animation = movingTitle.animate([
          { transform: `translate(${source.x}px, ${source.y}px)` },
          { transform: `translate(${target.x}px, ${target.y}px)` },
        ], {
          duration: 240,
          easing: page === "home" ? "cubic-bezier(1, 0, 0.8, 1)" : "cubic-bezier(0.2, 0, 0, 1)",
        });
        titleMotion = animation;
        animation.finished.then(() => {
          if (titleMotion === animation) clearTitleMotion();
        }).catch(() => {});
      }
      requestAnimationFrame(() => {
        if (!root.hidden && page === next) focusCurrentPage();
      });
    },
    setDifficulty(id) { select.value = id; },
    setStatus,
    render({ visible, ready, busy, creatingRoom, room, canCreateRoom, standalone,
      resumeId: nextResumeId, resumeLabel, message = "", starting = false }) {
      root.hidden = !visible;
      if (!visible) clearTitleMotion();
      resumeId = nextResumeId;
      const blocked = !ready || busy || room;
      for (const control of [playAi, local, select, advanced, start, back, history]) control.disabled = blocked;
      resume.disabled = blocked || !resumeId;
      online.disabled = blocked || (!standalone && !canCreateRoom);
      find("#play-online-label").textContent = creatingRoom ? "正在创建房间…" : "好友联机";
      find("#match-start-label").textContent = starting ? "正在准备…" : "开始对局";
      resumeEntry.setAttribute("aria-hidden", String(!resumeId));
      find("#resume-caption").textContent = resumeLabel;
      setStatus(visible ? message : "");
    },
  };
}
