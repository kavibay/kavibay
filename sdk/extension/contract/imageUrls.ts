// SPDX-License-Identifier: MIT
import type { ProviderId, ResultSchema } from "./sdk";

/**
 * Turns picture urls in a provider result into urls the host process answers.
 *
 * WHY THIS EXISTS. A widget package is served into an iframe whose CSP is
 * `default-src 'none'; img-src 'self' data: blob:; connect-src 'none'`. That is
 * the isolation, not an oversight: the code in there is generated, nobody
 * reviewed it, and an `<img src>` pointing anywhere is a GET to a host of the
 * widget's choosing with a path of its choosing — a working exfiltration
 * channel for everything the widget just read.
 *
 * Widening `img-src` to `https:` would buy covers and sell that. So the picture
 * takes the same route every other byte already takes: the host fetches it. The
 * widget receives a `kavibay-img:` url, which no network answers — only Rust
 * does, and only for a host the provider declared in `imageHosts`.
 *
 * THE URL IS DATA, NOT CODE. It arrives inside a vendor response, so nothing
 * about it is reviewed. The rewrite here does not vet it; it only re-labels it.
 * The check belongs to the host process, which owns address vetting, pinning
 * and the allowlist, and re-does all three on the real url. Checking here as
 * well would be the second statement of one fact this repo keeps paying for.
 */

/** Scheme prefix. Windows/Android present it as `http://kavibay-img.localhost`. */
export const IMAGE_SCHEME = "kavibay-img";

/**
 * `kavibay-img://p/<provider>/<url>`, both segments percent-encoded.
 *
 * The provider travels in the url because the check is per provider: Spotify
 * declaring `i.scdn.co` must not let some other provider's widget reach it.
 * A fixed `p` authority keeps one shape across both url forms — a provider id
 * contains a `/` and cannot be a host name.
 */
export function brokeredImageUrl(provider: ProviderId, url: string): string {
  return `${IMAGE_SCHEME}://p/${encodeURIComponent(provider)}/${encodeURIComponent(url)}`;
}

/** Whether a value is worth rewriting: an absolute https url and nothing else. */
function isFetchableImage(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("https://");
}

/**
 * A copy of `value` with every `image: true` string replaced.
 *
 * Copies rather than mutates: the value is about to be handed to a query cache
 * that several widgets read, and a walker that edited in place would rewrite an
 * already-rewritten entry on the second pass — turning a url into a
 * `kavibay-img:` url wrapping a `kavibay-img:` url, once per re-render.
 *
 * The same shape as `resultSchemaProblems`, deliberately. Two walkers over one
 * schema that disagree about the schema is exactly the failure this file's
 * neighbours document; keeping them line for line comparable is what makes a
 * divergence visible in review.
 */
export function rewriteImageUrls(
  schema: ResultSchema,
  value: unknown,
  provider: ProviderId,
): unknown {
  switch (schema.type) {
    case "string":
      return schema.image && isFetchableImage(value) ? brokeredImageUrl(provider, value) : value;
    case "number":
    case "boolean":
      return value;
    case "list":
      return Array.isArray(value)
        ? value.map((entry) => rewriteImageUrls(schema.of, entry, provider))
        : value;
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
      const record = value as Record<string, unknown>;
      const out: Record<string, unknown> = { ...record };
      for (const [key, field] of Object.entries(schema.fields)) {
        if (key in record) out[key] = rewriteImageUrls(field, record[key], provider);
      }
      return out;
    }
  }
}

/** Whether a schema marks any picture at all, so an untouched result is not copied. */
export function schemaHasImage(schema: ResultSchema): boolean {
  switch (schema.type) {
    case "string":
      return schema.image === true;
    case "number":
    case "boolean":
      return false;
    case "list":
      return schemaHasImage(schema.of);
    case "object":
      return Object.values(schema.fields).some(schemaHasImage);
  }
}
