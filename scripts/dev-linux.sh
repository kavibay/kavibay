#!/usr/bin/env bash
#
# `npm run tauri dev` for Linux VMs (VirtualBox, VMware, QEMU without GPU passthrough).
#
# Tauri renders through WebKitGTK on Linux. In a VM there is no real GPU, so Mesa
# falls back to `zink` (GL on top of Vulkan), finds no Vulkan device
# ("ZINK: failed to choose pdev") and then fails every DRI path. Pointing Mesa at
# llvmpipe directly skips that whole probe-and-fail dance and its log spam.
#
# Do NOT enable VirtualBox 3D acceleration instead — its passthrough is broken with
# current Mesa and takes the host terminal down with it.
#
# Two WebKit knobs are deliberately NOT set here, both measured on Ubuntu 24.04 in
# VirtualBox against this app's transparent fullscreen window:
#   WEBKIT_DISABLE_DMABUF_RENDERER=1  — smears the window. Moving surfaces leave a
#     copy at every intermediate position and static panels ghost, because the
#     fallback path stops clearing the transparent buffer between frames.
#   WEBKIT_DISABLE_COMPOSITING_MODE=1 — no measured benefit, so it only adds risk.
# Both are widely recommended for Tauri-in-a-VM. They did not hold up here.
#
# This script does not make the app fast — a fullscreen transparent overlay is the
# worst case for software compositing. See README "Running on Linux" for the levers
# that actually move the needle (resolution, opaque desktop fill, --release).
#
# Usage: npm run dev:linux            (or: npm run dev:linux -- --release)
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "dev-linux.sh is only meant for Linux — use 'npm run tauri dev' instead." >&2
  exit 1
fi

# `:=` keeps anything the caller already exported, so you can still override one knob.
: "${LIBGL_ALWAYS_SOFTWARE:=1}"  # never look for a hardware driver
: "${GALLIUM_DRIVER:=llvmpipe}"  # llvmpipe instead of the failing zink
export LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER

exec npm run tauri dev -- "$@"
