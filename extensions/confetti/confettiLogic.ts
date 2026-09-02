export interface ConfettiBurstConfig {
  count: number;
  size: number;
  velocity: number;
  fade: boolean;
}

/** Turn the palette's simple 1–5 scale into the library's particle controls. */
export function confettiBurstForIntensity(raw: string | undefined): ConfettiBurstConfig {
  // Blank counts as absent, not as zero. The palette already drops an empty
  // optional field, but `Number("")` is `0` rather than `NaN`, so a caller that
  // passes the raw text through would land on level 1 and read as "the default
  // got quieter" — a bug with no error attached to it.
  const text = (raw ?? "").trim();
  const requested = text === "" ? 3 : Number(text);
  const intensity = Number.isFinite(requested)
    ? Math.min(5, Math.max(1, requested))
    : 3;

  // Velocity is the main cue, while count scales the celebration from subtle to full.
  // Level 3 deliberately reproduces the original 100-count / size-1 / speed-200 burst.
  return {
    // 100 at level 3, halving every two steps down and doubling every two up:
    // 50 / 71 / 100 / 141 / 200.
    count: Math.round(100 * 2 ** ((intensity - 3) / 2)),
    size: 1,
    velocity: 80 + intensity * 40,
    fade: false,
  };
}
