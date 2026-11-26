import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Window } from "happy-dom";
import { createStartScreen } from "../games/go/start-screen.js";

test("Go start menus preserve their DOM, focus and independent callbacks when navigating", async () => {
  const browser = new Window();
  const previous = { requestAnimationFrame: globalThis.requestAnimationFrame };
  globalThis.requestAnimationFrame = callback => callback();
  try {
    const html = await readFile(new URL("../games/go/index.html", import.meta.url), "utf8");
    browser.document.write(html.replace(/<script[^>]*>.*?<\/script>/gs, ""));
    const root = browser.document.querySelector("#start-screen");
    const calls = [];
    const screen = createStartScreen({
      root, models: { b6: { difficulty: "普通" }, b18: { difficulty: "困难" } }, difficulty: "b6",
      onAi: () => { calls.push("ai"); screen.show("ai"); },
      onLocal: () => { calls.push("local"); screen.show("local"); }, onOnline: () => calls.push("online"),
      onResume: id => calls.push(id), onBack: () => screen.show("home"),
      onAdvanced: () => calls.push("advanced"), onStart: () => calls.push("start"),
      onDifficulty: id => calls.push(id),
    });
    const props = { visible: true, ready: true, busy: false, standalone: true, resumeLabel: "" };
    screen.render(props);
    root.querySelector("#play-ai").click();
    assert.equal(screen.page, "ai");
    assert.equal(root.querySelector("#home-menu").inert, true);
    assert.equal(root.querySelector("#match-menu").getAttribute("aria-hidden"), "false");
    const select = root.querySelector("#quick-ai-difficulty");
    const title = root.querySelector("#match-menu-title");
    assert.equal(title.tabIndex, -1);
    assert.equal(browser.document.activeElement, title);
    browser.document.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    assert.equal(root.classList.contains("is-keyboard-navigation"), false);
    browser.document.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Tab" }));
    assert.equal(root.classList.contains("is-keyboard-navigation"), true);
    select.focus();
    select.dispatchEvent(new browser.PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
    assert.equal(root.classList.contains("is-keyboard-navigation"), false);
    assert.equal(browser.document.activeElement, select, "touch hides the highlight without removing focus");
    select.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(root.classList.contains("is-keyboard-navigation"), true);
    select.dispatchEvent(new browser.PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true }));
    assert.equal(root.classList.contains("is-keyboard-navigation"), false);
    assert.equal(browser.document.activeElement, select);
    select.value = "b18";
    select.dispatchEvent(new browser.Event("change"));
    root.querySelector("#match-advanced").click();
    root.querySelector("#match-start").click();
    assert.deepEqual(calls, ["ai", "b18", "advanced", "start"]);

    screen.render({ ...props, busy: true, starting: true });
    assert.equal(select.disabled, true);
    root.querySelector("#match-start").click();
    root.querySelector("#match-menu-back").click();
    assert.equal(calls.length, 4);
    assert.equal(screen.page, "ai");
    screen.render(props);
    root.querySelector("#match-menu-back").click();
    assert.equal(screen.page, "home");
    assert.equal(browser.document.activeElement, root.querySelector("#play-ai"));
    assert.equal(root.querySelector("#quick-ai-difficulty"), select);
    assert.equal(select.value, "b18");

    root.querySelector("#play-local").click();
    assert.equal(screen.page, "local");
    assert.equal(root.querySelector("#match-menu-title").textContent, "本地双人");
    assert.equal(select.parentElement.hidden, true);
    assert.equal(browser.document.activeElement, title);
    assert.equal(root.querySelector("#home-menu").inert, true);
    root.querySelector("#match-advanced").click();
    root.querySelector("#match-start").click();
    assert.deepEqual(calls.slice(-3), ["local", "advanced", "start"]);
    root.querySelector("#match-menu-back").click();
    assert.equal(browser.document.activeElement, root.querySelector("#play-local"));
    root.querySelector("#play-ai").click();
    assert.equal(root.querySelector("#match-menu-title").textContent, "人机对战");
    assert.equal(select.parentElement.hidden, false);
    root.querySelector("#match-menu-back").click();

    screen.render({ ...props, resumeId: "latest-game", resumeLabel: "困难人机" });
    root.querySelector("#play-resume").click();
    assert.equal(calls.at(-1), "latest-game");
    screen.render(props);
    assert.equal(root.querySelector("#resume-entry").getAttribute("aria-hidden"), "true");
    assert.equal(root.querySelector("#play-resume").disabled, true);

    const status = browser.document.querySelector("#start-status");
    assert.equal(root.contains(status), false, "toast must survive the start screen being hidden");
    screen.setStatus("正在准备 AI…");
    assert.equal(status.classList.contains("is-visible"), true);
    screen.render({ ...props, visible: false });
    assert.equal(root.hidden, true);
    assert.equal(status.classList.contains("is-visible"), false);
    assert.equal(status.textContent, "正在准备 AI…", "retain the message during fade-out");
    const fadeEnd = new browser.Event("transitionend");
    Object.defineProperty(fadeEnd, "propertyName", { value: "opacity" });
    screen.setStatus("加载失败，请重试");
    status.dispatchEvent(fadeEnd);
    assert.equal(status.textContent, "加载失败，请重试", "an old fade-out must not clear a new message");
    screen.setStatus("");
    status.dispatchEvent(fadeEnd);
    assert.equal(status.textContent, "");
  } finally {
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    await browser.happyDOM.abort();
  }
});

test("Go mode titles travel between static positions in both directions and reverse without jumping", async () => {
  const browser = new Window();
  const previousRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => callback();
  try {
    const html = await readFile(new URL("../games/go/index.html", import.meta.url), "utf8");
    browser.document.write(html.replace(/<script[^>]*>.*?<\/script>/gs, ""));
    const root = browser.document.querySelector("#start-screen");
    const stack = root.querySelector(".start-menu-stack");
    const screen = createStartScreen({ root, models: {}, onDifficulty() {} });
    const title = root.querySelector("#match-menu-title");
    const labels = { ai: root.querySelector(".start-ai-label"), local: root.querySelector(".start-local-label") };
    const moving = root.querySelector(".start-moving-label");
    const positions = [[title, 52, 11], [labels.ai, 74, 21], [labels.local, 74, 101]];
    for (const [element, x, y] of positions) {
      Object.defineProperties(element, {
        offsetLeft: { get: () => x }, offsetTop: { get: () => y }, offsetParent: { get: () => stack },
      });
    }
    const animations = [];
    moving.animate = (frames, options) => {
      let finish;
      const animation = { finished: new Promise(resolve => { finish = resolve; }), cancel() {} };
      animations.push({ frames, options, finish, animation });
      return animation;
    };
    const finishLast = async () => { animations.at(-1).finish(); await Promise.resolve(); };
    const transform = (x, y) => `translate(${x}px, ${y}px)`;
    for (const mode of ["ai", "local"]) {
      screen.show(mode);
      const entry = animations.at(-1);
      const homeY = mode === "ai" ? 21 : 101;
      assert.deepEqual(entry.frames, [{ transform: transform(74, homeY) }, { transform: transform(52, 11) }]);
      assert.equal(moving.getAttribute("aria-hidden"), "true");
      assert.equal(root.dataset.movingTitle, mode);
      await finishLast();
      assert.equal(moving.hidden, true);
      assert.equal(root.hasAttribute("data-moving-title"), false);
      screen.show("home");
      const exit = animations.at(-1);
      assert.deepEqual(exit.frames, [...entry.frames].reverse());
      assert.equal(exit.options.duration, entry.options.duration);
      assert.equal(entry.options.easing, "cubic-bezier(0.2, 0, 0, 1)");
      assert.equal(exit.options.easing, "cubic-bezier(1, 0, 0.8, 1)");
      await finishLast();
    }

    screen.show("local");
    const interrupted = animations.at(-1);
    stack.getBoundingClientRect = () => ({ left: 100, top: 200 });
    moving.getBoundingClientRect = () => ({ left: 160, top: 250 });
    screen.show("home");
    assert.deepEqual(animations.at(-1).frames, [{ transform: transform(60, 50) }, { transform: transform(74, 101) }]);
    interrupted.finish();
    await Promise.resolve();
    assert.equal(moving.hidden, false, "finishing an old animation must not clear the current one");
    await finishLast();
    assert.equal(moving.hidden, true);

    browser.matchMedia = () => ({ matches: true });
    const count = animations.length;
    screen.show("ai");
    screen.show("home");
    assert.equal(animations.length, count, "reduced motion switches titles without travel");
    assert.equal(root.hasAttribute("data-moving-title"), false);
  } finally {
    globalThis.requestAnimationFrame = previousRaf;
    await browser.happyDOM.abort();
  }
});
