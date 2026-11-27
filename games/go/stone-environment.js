import { DataTexture, EquirectangularReflectionMapping, LinearSRGBColorSpace,
  PMREMGenerator, RGBAFormat, UnsignedByteType } from "three";

// A continuous courtyard sky: cool overhead daylight, a broad bright opening
// on the sun's side, and muted warm ground. Values are linear, not display RGB.
export function stoneSkyRadiance(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  x /= length; y /= length; z /= length;
  const t = Math.max(0, Math.min(1, (y + .2) / .4));
  const sky = t * t * (3 - 2 * t);
  const opening = Math.max(0, -.4 * x + .825 * y - .4 * z) ** 4 * .17;
  return [0, 1, 2].map(channel => {
    const ground = [.17, .15, .12][channel] + .05 * (y + 1);
    const daylight = [.48, .52, .56][channel] + [.25, .28, .30][channel] * Math.max(0, y) + opening;
    return ground + (daylight - ground) * sky;
  });
}

export function createStoneEnvironment(renderer) {
  // Keep the existing finish on devices without filterable render targets.
  if (!renderer.extensions.has("EXT_color_buffer_float")) return;
  const width = 128, height = 64, pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const longitude = ((column + .5) / width - .5) * Math.PI * 2;
    const latitude = ((row + .5) / height - .5) * Math.PI;
    const light = stoneSkyRadiance(Math.cos(latitude) * Math.cos(longitude),
      Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude));
    const index = (row * width + column) * 4;
    light.forEach((value, channel) => { pixels[index + channel] = Math.round(value * 255); });
    pixels[index + 3] = 255;
  }
  const source = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  source.mapping = EquirectangularReflectionMapping;
  source.colorSpace = LinearSRGBColorSpace;
  const generator = new PMREMGenerator(renderer);
  let target;
  function refresh() {
    source.needsUpdate = true;
    // Refill the same texture after context restoration so all material clones
    // keep a valid shared reference. No update is needed for moves or resizing.
    target = generator.fromEquirectangular(source, target);
  }
  refresh();
  return {
    texture: target.texture,
    refresh,
    dispose() { target.dispose(); generator.dispose(); source.dispose(); },
  };
}
