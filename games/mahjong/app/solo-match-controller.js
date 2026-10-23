import { createLocalLuaGame } from "../workers/local-game-worker-client.js";
import { HUMAN_ID, PLAYERS } from "../rules/constants.js";
import {
  mahjongOpeningDealerSeat,
  mahjongPlayersByOpeningWind,
} from "../rules/seat-order.js";
import { createMahjongSoloSave, writeMahjongSoloSave } from "../replay/solo-save.js";
import { replayMahjongSoloSave } from "../replay/solo-replay.js";

export function createMahjongSoloMatchController({
  elements,
  getGame,
  setGame,
  getGameInitializing,
  setGameInitializing,
  getPlayerName,
  setPlayerName,
  getAutoActions,
  setAutoActions,
  getSoloSave,
  setSoloSave,
  tableController,
  themeController,
  settingsDialog,
  visualRendererReady,
  beginSetupExit,
  selectedMatchRules,
  resetAutoActions,
  syncAutoActionControls,
  scheduleAi,
  showLoadingError,
  showSetup,
  showSetupRecoveryError,
  createGame = createLocalLuaGame,
}) {
  function canonicalSoloPlayers(randomSeed, playerNames) {
    const viewerOrder = PLAYERS.map((player, index) => ({
      ...player,
      name: playerNames[index] ?? player.name,
    }));
    return mahjongPlayersByOpeningWind(
      viewerOrder,
      mahjongOpeningDealerSeat(randomSeed),
    );
  }

  function soloGameOptions({
    randomSeed,
    matchId,
    matchType,
    rules,
    playerNames,
    players = canonicalSoloPlayers(randomSeed, playerNames),
  }) {
    return {
      sourceUrl: "./game.lua",
      players,
      playerId: HUMAN_ID,
      randomSeed,
      matchId,
      viewerRelativeProjection: true,
      settings: {
        matchType,
        rules,
        // players[] is already opening East/South/West/North.
        initialDealerSeat: 1,
        canonicalMatchSeats: true,
      },
    };
  }

  async function initialize(matchType = "east") {
    if (getGame() || getGameInitializing()) return;
    const save = getSoloSave();
    if (save) {
      if (save.matchType === matchType) return resumeSavedMatch();
      return;
    }
    setGameInitializing(true);
    tableController.syncMatchMusic();
    const rules = selectedMatchRules();
    elements.loading.classList.remove("is-active", "is-error");
    elements.loadingMessage.hidden = true;
    elements.loading.hidden = false;
    void elements.loadingSpinner.offsetWidth;
    const setupExit = beginSetupExit();
    const randomSeed = crypto.randomUUID().replaceAll("-", "");
    const matchId = `solo-${crypto.randomUUID()}`;
    try {
      await themeController.ready;
      await themeController.rerollPortraits(randomSeed);
      const defaultNames = themeController.getDefaultNames?.() || {};
      const opponentNames = {
        right: defaultNames.right || PLAYERS[1].name,
        opposite: defaultNames.opposite || PLAYERS[2].name,
        left: defaultNames.left || PLAYERS[3].name,
      };
      const playerNames = [
        getPlayerName(),
        opponentNames.right,
        opponentNames.opposite,
        opponentNames.left,
      ];
      const canonicalPlayers = canonicalSoloPlayers(randomSeed, playerNames);
      const playerPresentations =
        themeController.getPaipuPlayerPresentations?.(
          canonicalPlayers,
          HUMAN_ID,
        ) || {};
      const gamePreparation = createGame(
        soloGameOptions({
          randomSeed,
          matchId,
          matchType,
          rules,
          playerNames,
          players: canonicalPlayers,
        }),
      );
      const [createdGame] = await Promise.all([
        gamePreparation,
        setupExit,
        visualRendererReady,
      ]);
      setGame(createdGame);
      resetAutoActions({ persist: false });
      const save = createMahjongSoloSave({
        randomSeed,
        matchId,
        matchType,
        rules,
        playerName: getPlayerName(),
        autoActions: getAutoActions(),
        opponentPortraits: themeController.getPortraits(),
        opponentNames,
        playerPresentations,
      });
      setSoloSave(save);
      writeMahjongSoloSave(save);
      await tableController.refresh(createdGame.initialProjection, {
        animateDealIn: true,
      });
      elements.app.setAttribute("aria-busy", "false");
      elements.setup.hidden = true;
      elements.loading.hidden = true;
      settingsDialog.setSoloMatchActive(true);
      settingsDialog.setEndMatchLabel("结束本局");
      scheduleAi({ afterDealIn: true });
    } catch (error) {
      console.error(error);
      await setupExit;
      showLoadingError("牌桌准备失败，请刷新页面重试");
    } finally {
      setGameInitializing(false);
    }
  }

  async function resumeSavedMatch() {
    if (getGame() || getGameInitializing()) return;
    const save = getSoloSave();
    if (!save) return;
    setGameInitializing(true);
    elements.loading.classList.remove("is-active", "is-error");
    elements.loadingMessage.hidden = true;
    elements.loading.hidden = false;
    void elements.loadingSpinner.offsetWidth;
    const setupExit = beginSetupExit();
    let restored;
    try {
      const playerNames = PLAYERS.map((player, index) =>
        index === 0
          ? save.playerName || getPlayerName()
          : save.opponentNames[["right", "opposite", "left"][index - 1]] ||
            player.name,
      );
      const canonicalPlayers = canonicalSoloPlayers(save.randomSeed, playerNames);
      restored = await createGame(
        soloGameOptions({
          randomSeed: save.randomSeed,
          matchId: save.matchId,
          matchType: save.matchType,
          rules: save.rules,
          playerNames,
          players: canonicalPlayers,
        }),
      );
      const projection = await replayMahjongSoloSave({
        game: restored,
        save,
        playerId: HUMAN_ID,
      });
      await Promise.all([visualRendererReady, setupExit]);
      setGame(restored);
      await themeController.applyMatchPortraits(
        save.opponentPortraits,
        save.randomSeed,
      );
      // Rebuild the stable player-ID presentation map from the restored
      // canonical seats. This also repairs saves created before the seat
      // mapping was made explicit.
      const playerPresentations =
        themeController.getPaipuPlayerPresentations?.(
          canonicalPlayers,
          HUMAN_ID,
        ) || {};
      if (JSON.stringify(save.playerPresentations || {}) !== JSON.stringify(playerPresentations)) {
        const updatedSave = { ...save, playerPresentations };
        setSoloSave?.(updatedSave);
        writeMahjongSoloSave(updatedSave);
      }
      if (save.playerName) setPlayerName(save.playerName);
      setAutoActions({ ...save.autoActions });
      syncAutoActionControls();
      await tableController.refresh(projection);
      tableController.syncMatchMusic();
      elements.app.setAttribute("aria-busy", "false");
      elements.setup.hidden = true;
      elements.loading.hidden = true;
      settingsDialog.setSoloMatchActive(true);
      settingsDialog.setEndMatchLabel("结束本局");
      scheduleAi();
    } catch (error) {
      console.error(error);
      await setupExit;
      restored?.close();
      if (getGame() === restored) setGame(undefined);
      tableController.reset();
      settingsDialog.setSoloMatchActive(false);
      showSetup();
      elements.loading.hidden = true;
      showSetupRecoveryError(
        error instanceof Error && error.message
          ? error.message
          : "Failed to restore saved game.",
      );
    } finally {
      setGameInitializing(false);
    }
  }

  return { initialize };
}
