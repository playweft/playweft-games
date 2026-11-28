export const STONE_DIAMETER_RATIO = .95;

export function stoneRadius(size) {
  return STONE_DIAMETER_RATIO / (2 * size);
}
