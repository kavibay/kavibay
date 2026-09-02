// SPDX-License-Identifier: MIT
/**
 * Provider brand marks — the logo shown wherever the app names an account a
 * user connects.
 *
 * Sits beside `../icons` and not in `core/` because both sides of the license
 * boundary need it: the host draws the connect gate and the credential cards,
 * and the Widget Wizard (an extension) lists the same providers when you pick
 * which accounts a widget reads from.
 *
 * The MIT header covers this code. It does **not** cover the marks it draws:
 * a licence on an SVG grants no trademark rights, and each logo stays governed
 * by its owner's guidelines. See THIRD-PARTY-NOTICES.md before adding one.
 */
export { default as BrandMark } from "./BrandMark.vue";
export { default as McpClientMark } from "./McpClientMark.vue";
export { brandMarkFor, type BrandId } from "./brandMarks";
