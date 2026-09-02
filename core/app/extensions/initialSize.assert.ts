/**
 * Run: npx tsx core/app/extensions/initialSize.assert.ts
 */
import { initialSizeForExtension } from "./initialSize";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const s = initialSizeForExtension({
    defaultSize: { w: 280, h: 200 },
    hugHeight: false,
  });
  assert(s.width === 280 && s.height === 200, "normal size");
}

{
  const s = initialSizeForExtension({
    defaultSize: { w: 222, h: 120 },
    hugHeight: true,
  });
  assert(s.width === 222 && s.height === undefined, "hugHeight skips h");
}

{
  const s = initialSizeForExtension({ hugHeight: false });
  assert(s.width === undefined && s.height === undefined, "runtime omit");
}

// --- remembered size beats the manifest ---
{
  const s = initialSizeForExtension(
    { defaultSize: { w: 280, h: 200 }, hugHeight: false },
    { w: 420, h: 340 },
  );
  assert(s.width === 420 && s.height === 340, "remembered wins over manifest");
}

{
  const s = initialSizeForExtension(
    { defaultSize: { w: 222, h: 120 }, hugHeight: true },
    { w: 500 },
  );
  assert(s.width === 500 && s.height === undefined, "dock remembers width only");
}

{
  // A width-only entry from when the type still hugged its height.
  const s = initialSizeForExtension(
    { defaultSize: { w: 280, h: 200 }, hugHeight: false },
    { w: 500 },
  );
  assert(s.width === 500 && s.height === 200, "missing h falls back to manifest");
}

{
  const s = initialSizeForExtension({ hugHeight: false }, { w: 300, h: 300 });
  assert(s.width === 300 && s.height === 300, "remembered works without a manifest size");
}

console.log("initialSize.assert.ts: ok");
