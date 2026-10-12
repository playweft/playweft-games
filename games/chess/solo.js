import { LuaFactory } from "wasmoon";
import wasmUrl from "wasmoon/dist/glue.wasm?url";
import source from "./game.lua?raw";

// Run exactly the room rules locally; bundle the Wasm asset for offline play.
export async function createSoloChessGame() {
  const lua = await new LuaFactory(wasmUrl).createEngine({
    enableProxy: false,
  });
  try {
    await lua.doString(source);
    const setup = lua.global.get("setup");
    const action = lua.global.get("on_action");
    let state = setup({ players: [{ id: "local-1" }, { id: "local-2" }] });
    return {
      state: () => structuredClone(state),
      action(nextAction, actorIndex = state.current) {
        const result = action(structuredClone(state), nextAction, {
          actor: { id: state.players[actorIndex - 1] },
        });
        if (result.accepted) state = result.state;
        return result;
      },
      close: () => lua.global.close(),
    };
  } catch (error) {
    lua.global.close();
    throw error;
  }
}
