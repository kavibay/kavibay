# Third-party notices

Skeleton inventory of third-party material shipped with Kavibay. Grow this file
as dependencies and vendored assets are audited.

## Application dependencies

Runtime and build dependencies are declared in `package.json` and
`src-tauri/Cargo.toml`. A machine-checked allowlist (`cargo deny`, npm
`license-checker`) is planned with CI (hardening P1.1). Current major stacks
(Tauri, Vue, tiptap, rusqlite, windows-rs, reqwest, …) are MIT/Apache-licensed
and GPL-compatible.

- `@hiseb/confetti` 2.1.0: ISC — https://github.com/swetzel/confetti.js

## Moodist extension (attribution)

The Moodist first-party extension is modelled on the Moodist project and ships
CC0 recordings, generated noise and small UI icons. Authoritative per-extension notes live in:

`extensions/moodist/LICENSES.md`

Summary (do not treat this as a substitute for that file):

- Moodist project: MIT — https://github.com/remvze/moodist
- Sound assets: recordings from Freesound released under CC0 1.0, each listed
  with its original in `extensions/moodist/LICENSES.md`; noise computed at
  runtime (`extensions/moodist/noise.ts`), no file. Moodist's own
  recordings, licensed upstream under Pixabay's Content License or CC0 without
  a per-file record, are not redistributed.

## Icons — Lucide

`sdk/extension/icons/` vendors Lucide icons as inline Vue components. Motion
variants are generated from the same upstream geometry and add only CSS, so they
carry no separate licence.

Lucide is ISC-licensed and permits commercial use. Two copyright holders apply,
because Lucide is a fork of Feather and a subset of its icons is still Feather's
— both notices are reproduced rather than resolved per icon:

- Lucide — ISC — https://lucide.dev/license — https://github.com/lucide-icons/lucide

  > Copyright (c) 2026 Lucide Icons and Contributors
  >
  > Permission to use, copy, modify, and/or distribute this software for any
  > purpose with or without fee is hereby granted, provided that the above
  > copyright notice and this permission notice appear in all copies.
  >
  > THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
  > WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
  > MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
  > SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
  > WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
  > OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
  > CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

- Feather (icons inherited by Lucide) — MIT — https://github.com/feathericons/feather

  > Copyright (c) 2013-present Cole Bemis
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to deal
  > in the Software without restriction, including without limitation the rights
  > to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  > copies of the Software, and to permit persons to whom the Software is
  > furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in
  > all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  > IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  > FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  > LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
  > FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
  > IN THE SOFTWARE.

**Brand and logo icons are not covered by the above.** A licence on an SVG grants
no trademark rights, so any icon depicting a company mark (GitHub, Spotify, tado,
…) is governed by that owner's trademark terms, not by ISC. Check before shipping
one — see Lucide's brand logo statement.

## Brand marks — provider logos

`sdk/extension/brand/` ships logos, shown wherever the app names the account a
user connects: the credential cards in Settings, the connect gate a widget shows
before its provider is live, the permission dialog for a widget package, and
the palette's search actions.

Each is the trademark of its owner and is used nominatively — to identify the
service being connected. No affiliation or endorsement is implied, the marks are
not modified beyond scaling (GitHub, Anthropic and OpenAI are drawn in
`currentColor`, as monochrome marks need for light and dark surfaces), and none
of them is used as this app's own identity.

- Anthropic — Anthropic PBC — https://www.anthropic.com
- Claude — Anthropic PBC — https://claude.ai/favicon.svg
- Brave Search — Brave Software, Inc. — https://brave.com/favicon.ico
- Bing — Microsoft Corporation — https://www.bing.com/favicon.ico
- Cloudflare — Cloudflare, Inc. — https://www.cloudflare.com
- DuckDuckGo — Duck Duck Go, Inc. — https://duckduckgo.com/press
- Ecosia — Ecosia GmbH — https://www.ecosia.org/favicon.ico
- GitHub — GitHub, Inc. — https://github.com/logos
- Google — Google LLC — https://about.google/brand-resource-center/
- Linear — Linear Orbit, Inc. — https://linear.app/brand
- n8n — n8n GmbH — https://n8n.io
- Notion — Notion Labs, Inc. — https://www.notion.com/pages/brand
- Spotify — Spotify AB — https://developer.spotify.com/documentation/design
- Fitbit — Google LLC — https://dev.fitbit.com
- OpenAI — OpenAI, Inc. — https://openai.com
- Open-Meteo — https://open-meteo.com
- tado° — tado GmbH — https://www.tado.com/

Trademark guidelines are the binding terms here, not a file licence. **Confirm
each mark against its owner's current guidelines before advertising or
distributing the app more widely**, in the same pass as the Pixabay review above.
A provider we ship no mark for renders no logo at all — that is deliberate
(`sdk/extension/brand/BrandMark.vue`), not a gap waiting to be filled.

## Fonts

The three fonts offered in Appearance settings ship inside the bundle (as
`.woff2`, pulled in by `core/app/styles.css`) rather than being fetched from
Google Fonts at runtime. They arrive through the `@fontsource-variable/*` npm
packages, which repackage the upstream releases without modifying them.

All three are under the SIL Open Font License 1.1, which permits bundling and
redistribution as part of a larger work. The OFL text ships with each package
under `node_modules/@fontsource-variable/<name>/LICENSE`.

- Plus Jakarta Sans — OFL 1.1 — Copyright 2020 The Plus Jakarta Sans Project
  Authors — https://github.com/tokotype/PlusJakartaSans
- Manrope — OFL 1.1 — Copyright 2019 The Manrope Project Authors —
  https://github.com/sharanda/manrope
- JetBrains Mono — OFL 1.1 — Copyright 2020 The JetBrains Mono Project Authors —
  https://github.com/JetBrains/JetBrainsMono

The public site (`../www.kavibay.com/`) is static and has no `node_modules`, so
it carries its own copies of the same three Latin subsets under
`../www.kavibay.com/fonts/`, each next to the matching OFL text
(`../www.kavibay.com/fonts/<name>-LICENSE.txt`).

## Other assets

- Emoji-picker data: source TBD — record here when confirmed.
- Per-extension `icon.svg` files predating the Lucide set: hand-drawn for this
  project unless a per-extension LICENSES.md says otherwise. Several sit on a
  24px grid and may be Lucide-derived; the notices above cover that case either
  way, so this is a tidiness question rather than a licensing one.
