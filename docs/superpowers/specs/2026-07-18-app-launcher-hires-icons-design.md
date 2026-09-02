# App launcher — high-res icons without shortcut overlay

## Goal
Dock / picker icons should be sharp (256×256) and must not show the Windows `.lnk` shortcut arrow. Existing path-based dock icons re-extract once after upgrade.

## Extract (`extract_app_icon`)
1. **`.lnk`**: resolve icon location / target via `IShellLink` (or `SHGFI_ICONLOCATION`), then `SHDefExtractIconW` at 256 — no overlay.
2. **Else** (files, folders, `shell:AppsFolder\…`): `IShellItemImageFactory::GetImage` at 256 with `SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK`.
3. **Fallback**: existing `SHGetFileInfo` + `DrawIconEx` at 256.

## Refresh (frontend)
- On mount, re-extract for `exe` / `lnk` / `folder` when `iconExtractGen !== 2` and not `iconCustom` / GIF.
- Persist `iconExtractGen: 2` after success.
- Uploads set `iconCustom: true` so they are never overwritten.

## Out of scope
URL favicons, key glyphs, changing dock button CSS size (still 48px; sharper source).
