import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { activeSeat, seatWind } from "../rules/game-format.js";
import { PLAYFIELD_CENTRE_Z, TILE_SIZE } from "./three-layout.js";

const LOGICAL_WIDTH = 640;
const LOGICAL_HEIGHT = Math.round((LOGICAL_WIDTH * 5) / 5.8);
const TEXTURE_SCALE = 2;
const PANEL_BORDER_INSET = 16;
const SCORE_WIND_ANCHOR = "888888";
// Long enough to scan all four seats and glance back at your own score, short
// enough that the real scores come back before the mode reads as a toggle.
// Every tap restarts this window, so a longer look only costs another tap.
export const SCORE_DISPLAY_DURATION_MS = 1800;

export const TABLE_CONSOLE_SCORE_LAYOUT = Object.freeze({
  panelBorderInset: PANEL_BORDER_INSET,
  edgeInset: 99,
  scoreFontSize: 64,
  windFontSize: 80,
  windScoreGap: 14,
  windEdgeAngle: Math.PI / 36,
  stickEdgeInset: 44.5,
  stickWidth: 177,
  stickHeight: 177 / 7,
  stickDotRadius: 8.85,
});

export const TABLE_CONSOLE_CORE_LAYOUT = Object.freeze({
  roundFontSize: 80,
  wallFontSize: 46,
});

export function prepareTableConsoleContext(context, canvas) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);
}

export const TABLE_CONSOLE_LAYOUT = Object.freeze({
  width: TILE_SIZE.width * 5.8,
  depth: TILE_SIZE.width * 5,
  height: 0.18,
  centreZ: PLAYFIELD_CENTRE_Z,
  cornerRadius: 0.14,
});

export class ThreeTableConsole {
  constructor({ anisotropy = 1 } = {}) {
    this.group = new Group();
    this.group.name = "table-console";
    this.geometries = [];
    this.materials = [];

    this.canvas = document.createElement("canvas");
    this.canvas.width = LOGICAL_WIDTH * TEXTURE_SCALE;
    this.canvas.height = LOGICAL_HEIGHT * TEXTURE_SCALE;
    this.context = this.canvas.getContext("2d");
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = anisotropy;

    const baseMaterial = this.trackMaterial(
      new MeshPhysicalMaterial({
        color: new Color("#061b1a"),
        roughness: 0.36,
        metalness: 0.12,
        clearcoat: 0.42,
        clearcoatRoughness: 0.34,
      }),
    );
    const faceMaterial = this.trackMaterial(
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        alphaTest: 0.01,
        depthWrite: true,
        toneMapped: false,
      }),
    );

    const { width, depth, height, centreZ, cornerRadius } =
      TABLE_CONSOLE_LAYOUT;
    const baseGeometry = this.trackGeometry(
      new RoundedBoxGeometry(width, height, depth, 5, cornerRadius),
    );
    const base = new Mesh(baseGeometry, baseMaterial);
    base.name = "table-console-base";
    base.position.set(0, height / 2 + 0.018, centreZ);
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    const faceGeometry = this.trackGeometry(new PlaneGeometry(width, depth));
    this.mesh = new Mesh(faceGeometry, faceMaterial);
    this.mesh.name = "table-console-face";
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(0, height + 0.024, centreZ);
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
  }

  update(state, ui) {
    const context = this.context;
    prepareTableConsoleContext(context, this.canvas);
    drawPanel(context);
    drawCore(context, state, ui);
    drawScores(context, state, ui);
    this.texture.needsUpdate = true;
  }

  restore(state, ui) {
    if (state && ui) this.update(state, ui);
    else this.texture.needsUpdate = true;
  }

  destroy() {
    this.group.remove(...this.group.children);
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.texture.dispose();
  }

  trackGeometry(geometry) {
    this.geometries.push(geometry);
    return geometry;
  }

  trackMaterial(material) {
    this.materials.push(material);
    return material;
  }
}

function drawPanel(context) {
  context.save();
  roundedRect(context, 16, 16, LOGICAL_WIDTH - 32, LOGICAL_HEIGHT - 32, 42);
  const panelGradient = context.createLinearGradient(
    0,
    16,
    0,
    LOGICAL_HEIGHT - 16,
  );
  panelGradient.addColorStop(0, "rgba(16, 51, 46, .985)");
  panelGradient.addColorStop(0.48, "rgba(3, 26, 25, .99)");
  panelGradient.addColorStop(1, "rgba(1, 15, 16, .995)");
  context.fillStyle = panelGradient;
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = "rgba(235, 205, 128, .76)";
  context.stroke();
  roundedRect(context, 28, 28, LOGICAL_WIDTH - 56, LOGICAL_HEIGHT - 56, 32);
  context.lineWidth = 2;
  context.strokeStyle = "rgba(255, 244, 211, .12)";
  context.stroke();
  context.restore();
}

function drawCore(context, state, ui) {
  const { roundFontSize, wallFontSize } = TABLE_CONSOLE_CORE_LAYOUT;
  const centreY = LOGICAL_HEIGHT / 2;
  const coreTop = centreY - 84;
  roundedRect(context, 164, coreTop, 312, 168, 27);
  const coreGradient = context.createLinearGradient(
    0,
    coreTop,
    0,
    coreTop + 168,
  );
  coreGradient.addColorStop(0, "rgba(0, 12, 12, .52)");
  coreGradient.addColorStop(1, "rgba(0, 8, 9, .28)");
  context.fillStyle = coreGradient;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "rgba(232, 203, 132, .18)";
  context.stroke();

  drawText(context, ui.roundLabel, 320, centreY - 34, {
    color: "#f2d17d",
    font: `400 ${roundFontSize}px "Mahjong Brush", "FZKai-Z03", STKaiti, KaiTi, serif`,
  });
  drawText(context, `余牌 ${Number(state.wallCount) || 0}`, 320, centreY + 42, {
    color: "#fff1c9",
    font: `850 ${wallFontSize}px "PingFang SC", sans-serif`,
  });
}

function drawScores(context, state, ui = {}) {
  const viewerSeat = Number(ui.viewerSeat) || 1;
  const active = (activeSeat(state) - viewerSeat + 4) % 4;
  const centreY = LOGICAL_HEIGHT / 2;
  const {
    edgeInset,
    scoreFontSize,
    stickEdgeInset,
    windFontSize,
    windScoreGap,
    windEdgeAngle,
  } = TABLE_CONSOLE_SCORE_LAYOUT;
  const showScoreDifference = ui.scoreDisplayMode === "difference";
  const placements = [
    {
      x: LOGICAL_WIDTH / 2,
      y: LOGICAL_HEIGHT - edgeInset,
      stickX: LOGICAL_WIDTH / 2,
      stickY: LOGICAL_HEIGHT - stickEdgeInset,
      rotation: 0,
      textRotation: 0,
      windSide: -1,
    },
    {
      x: LOGICAL_WIDTH - edgeInset,
      y: centreY,
      stickX: LOGICAL_WIDTH - stickEdgeInset,
      stickY: centreY,
      rotation: Math.PI / 2,
      textRotation: (Math.PI * 3) / 2,
      windSide: -1,
    },
    {
      x: LOGICAL_WIDTH / 2,
      y: edgeInset,
      stickX: LOGICAL_WIDTH / 2,
      stickY: stickEdgeInset,
      rotation: 0,
      textRotation: 0,
      windSide: 1,
    },
    {
      x: edgeInset,
      y: centreY,
      stickX: stickEdgeInset,
      stickY: centreY,
      rotation: -Math.PI / 2,
      textRotation: Math.PI / 2,
      windSide: -1,
    },
  ];
  placements.forEach((placement, index) => {
    const canonicalSeat = ((viewerSeat + index - 1) % 4) + 1;
    const playerId = state.players?.[canonicalSeat - 1];
    if (playerId && state.riichi?.[playerId] === true) {
      drawRiichiStick(
        context,
        placement.stickX,
        placement.stickY,
        placement.rotation,
      );
    }
    const isViewerSeat = canonicalSeat === viewerSeat;
    const displayDifference = showScoreDifference && !isViewerSeat;
    const scoreValue = displayDifference
      ? scoreDifference(state, canonicalSeat, viewerSeat)
      : Number(state.scores?.[canonicalSeat - 1] ?? 0);
    const score = formatScoreDisplay(scoreValue, displayDifference);
    const scoreFont = `${index === active ? 900 : 760} ${scoreFontSize}px "Roboto Slab", ui-monospace, monospace`;
    const wind = seatWind(state, canonicalSeat);
    const windFont = `400 ${windFontSize}px "Mahjong Brush", "FZKai-Z03", STKaiti, KaiTi, serif`;
    context.save();
    context.font = scoreFont;
    const scoreAnchorWidth = context.measureText(SCORE_WIND_ANCHOR).width;
    context.font = windFont;
    const windWidth = context.measureText(wind).width;
    context.restore();
    drawText(context, score, placement.x, placement.y, {
      color: displayDifference
        ? scoreDifferenceColor(scoreValue)
        : index === active
          ? "#ffdc78"
          : "rgba(249, 237, 204, .9)",
      font: scoreFont,
      rotation: placement.textRotation,
      shadow: index === active,
    });
    const windPosition = scoreWindPosition(
      placement.x,
      placement.y,
      scoreAnchorWidth,
      windWidth,
      windScoreGap,
      placement.textRotation,
      placement.windSide,
      -windEdgeAngle,
    );
    drawText(context, wind, windPosition.x, windPosition.y, {
      color: seatWindColor(state, canonicalSeat),
      font: windFont,
      rotation: placement.textRotation,
      shadow: index === active,
    });
  });
}

/**
 * Difference shown at another player's seat, expressed from the viewer's own
 * perspective: a positive value means the viewer leads that seat, a negative
 * one means the viewer trails it.  The console paints positive values green
 * and negative values red, so the reader always gets "green = I lead, red =
 * I trail" instead of the rival's surplus.
 */
export function scoreDifference(state, seat, viewerSeat = 1) {
  const index = Number(seat) - 1;
  const current = Number(state?.scores?.[index]) || 0;
  const viewerIndex = Number(viewerSeat) - 1;
  const ownScore = Number(state?.scores?.[viewerIndex]) || 0;
  return ownScore - current;
}

export function formatScoreDisplay(value, difference = false) {
  const number = Number(value) || 0;
  return difference && number > 0 ? `+${number}` : String(number);
}

export function scoreDifferenceColor(value) {
  const number = Number(value) || 0;
  if (number > 0) return "#72d99a";
  if (number < 0) return "#ef8d82";
  return "#f2d17d";
}

export function scoreWindPosition(
  scoreX,
  scoreY,
  scoreAnchorWidth,
  windWidth,
  gap,
  rotation = 0,
  side = -1,
  edgeRotation = 0,
) {
  const distance =
    Number(scoreAnchorWidth) / 2 + Number(gap) + Number(windWidth) / 2;
  const localOffset = Number(side) < 0 ? -distance : distance;
  const offsetRotation = (Number(rotation) || 0) + Number(edgeRotation);
  return {
    x: Number(scoreX) + localOffset * Math.cos(offsetRotation),
    y: Number(scoreY) + localOffset * Math.sin(offsetRotation),
  };
}

export function seatWindColor(state, seat) {
  return seatWind(state, seat) === "東" ? "#e9833f" : "#f2d17d";
}

function drawRiichiStick(context, x, y, rotation) {
  const { stickWidth, stickHeight, stickDotRadius } =
    TABLE_CONSOLE_SCORE_LAYOUT;
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.shadowColor = "rgba(0, 0, 0, .58)";
  context.shadowBlur = 7;
  context.shadowOffsetY = 3;
  roundedRect(
    context,
    -stickWidth / 2,
    -stickHeight / 2,
    stickWidth,
    stickHeight,
    stickHeight / 2,
  );
  const body = context.createLinearGradient(
    0,
    -stickHeight / 2,
    0,
    stickHeight / 2,
  );
  body.addColorStop(0, "#fffdf2");
  body.addColorStop(0.52, "#e9e5d6");
  body.addColorStop(1, "#b7b2a4");
  context.fillStyle = body;
  context.fill();
  context.shadowColor = "transparent";
  context.lineWidth = 1.5;
  context.strokeStyle = "rgba(68, 65, 57, .68)";
  context.stroke();
  context.beginPath();
  context.arc(0, 0, stickDotRadius, 0, Math.PI * 2);
  context.fillStyle = "#c63a32";
  context.fill();
  context.lineWidth = 1;
  context.strokeStyle = "rgba(94, 13, 13, .72)";
  context.stroke();
  context.restore();
}

function drawText(context, value, x, y, options) {
  context.save();
  context.translate(x, y);
  context.rotate(options.rotation || 0);
  context.fillStyle = options.color;
  context.font = options.font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (options.shadow) {
    context.shadowColor = "rgba(255, 201, 67, .55)";
    context.shadowBlur = 14;
  }
  context.fillText(String(value), 0, 0);
  context.restore();
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}
