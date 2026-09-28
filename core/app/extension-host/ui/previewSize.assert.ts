import { fitPreviewSize, PREVIEW_PRESETS, validPreviewDimension } from "./previewSize";

function check(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}
function close(actual: number, expected: number): void {
  check(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);
}

const landscape = fitPreviewSize(PREVIEW_PRESETS.landscape, { width: 532, height: 358 });
close(landscape.width, 532);
close(landscape.width / landscape.height, 16 / 9);
const portrait = fitPreviewSize(PREVIEW_PRESETS.portrait, { width: 532, height: 358 });
close(portrait.height, 358);
close(portrait.width / portrait.height, 9 / 16);

// A smaller dialog fits either orientation without clipping or changing its ratio.
const square = fitPreviewSize({ width: 1000, height: 1000 }, { width: 440, height: 100 });
close(square.width, 100);
close(square.height, 100);
const small = fitPreviewSize({ width: 200, height: 100 }, { width: 532, height: 358 });
close(small.width, 200);
close(small.height, 100);
const hidden = fitPreviewSize(PREVIEW_PRESETS.landscape, { width: 0, height: 0 });
close(hidden.width, 0);
close(hidden.height, 0);

for (const value of [64, 720, 1280, 4096]) check(validPreviewDimension(value), `Rejected valid dimension ${value}`);
for (const value of [0, -1, 63, 4097, 100.5, NaN, Infinity]) check(!validPreviewDimension(value), `Accepted invalid dimension ${value}`);
