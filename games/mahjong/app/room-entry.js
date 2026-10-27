export const ROOM_ENTRY_LABELS = Object.freeze({ idle: "友人戦", busy: "创建中" });

/** The platform owns lobby navigation; the running solo match stays unchanged. */
export function createMahjongRoomEntry({ button, getClient, beforeCreate = () => {}, showError }) {
  const label = button.querySelector?.("[data-room-entry-label]") ?? button;
  let available = false;
  let busy = false;
  let destroyed = false;

  function render() {
    button.hidden = !available;
    button.disabled = busy;
    label.textContent = busy ? ROOM_ENTRY_LABELS.busy : ROOM_ENTRY_LABELS.idle;
    button.setAttribute("aria-busy", String(busy));
  }

  async function createRoom() {
    if (!available || busy || destroyed) return;
    busy = true;
    render();
    try {
      await beforeCreate();
      if (destroyed || !available) return;
      await getClient().createRoom();
    } catch (error) {
      if (!destroyed) showError(`创建房间失败：${error.message || "请稍后重试"}`);
    } finally {
      busy = false;
      if (!destroyed) render();
    }
  }

  button.addEventListener("click", createRoom);
  render();
  return {
    setContext(context) {
      available = context?.mode === "solo" &&
        context.capabilities?.includes("room.create") === true;
      render();
    },
    destroy() {
      destroyed = true;
      button.removeEventListener("click", createRoom);
    },
  };
}
