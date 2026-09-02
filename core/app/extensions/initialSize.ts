/**
 * Map extension defaultSize → createInstance width/height opts.
 *
 * `remembered` is the size a widget of this type was last left at; it wins over
 * the manifest, which is only the author's first guess.
 */
export function initialSizeForExtension(
  def: {
    defaultSize?: { w: number; h: number };
    hugHeight?: boolean;
  },
  remembered?: { w: number; h?: number },
): { width?: number; height?: number } {
  const ds = remembered ?? def.defaultSize;
  if (!ds) return {};
  if (def.hugHeight) return { width: ds.w };
  // A remembered width-only entry (dock resized while hugHeight) still needs a
  // height for a type that no longer hugs — fall back to the manifest's.
  const h = ds.h ?? def.defaultSize?.h;
  return { width: ds.w, ...(typeof h === "number" ? { height: h } : {}) };
}
