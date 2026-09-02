// SPDX-License-Identifier: MIT
/**
 * Picture urls: what gets rewritten, what must not, and the shape the host
 * process parses back.
 * Run: npx tsx sdk/extension/contract/image-urls.assert.ts
 */
import type { ProviderId, ResultSchema } from "./sdk";
import { brokeredImageUrl, rewriteImageUrls, schemaHasImage } from "./imageUrls";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROVIDER = "kavibay.spotify/spotify" as ProviderId;

const playlist: ResultSchema = {
  type: "list",
  of: {
    type: "object",
    fields: {
      name: { type: "string" },
      imageUrl: { type: "string", nullable: true, image: true },
      url: { type: "string" },
      trackCount: { type: "number" },
    },
  },
};

const rewritten = rewriteImageUrls(
  playlist,
  [
    { name: "Mix", imageUrl: "https://i.scdn.co/image/abc", url: "https://open.spotify.com/x", trackCount: 3 },
    { name: "No cover", imageUrl: null, url: "https://open.spotify.com/y", trackCount: 0 },
  ],
  PROVIDER,
) as { imageUrl: string | null; url: string; name: string }[];

assert(
  rewritten[0]?.imageUrl === brokeredImageUrl(PROVIDER, "https://i.scdn.co/image/abc"),
  "a marked field becomes a host-answered url",
);
assert(
  rewritten[0]?.url === "https://open.spotify.com/x",
  "an unmarked url is left alone — marking is what makes this happen, not looking like a link",
);
assert(rewritten[1]?.imageUrl === null, "a null cover stays null rather than becoming a url to nothing");
assert(rewritten[0]?.name === "Mix", "everything else survives the copy");

/**
 * The walker copies. Rewriting in place would rewrite an already-rewritten
 * cache entry on the next read, wrapping one `kavibay-img:` url in another —
 * once per re-render, and invisible until an image stopped loading.
 */
const source = [{ name: "Mix", imageUrl: "https://i.scdn.co/image/abc", url: "u", trackCount: 1 }];
rewriteImageUrls(playlist, source, PROVIDER);
assert(source[0]!.imageUrl === "https://i.scdn.co/image/abc", "the input is not mutated");

const twice = rewriteImageUrls(playlist, rewritten, PROVIDER) as { imageUrl: string }[];
assert(
  twice[0]?.imageUrl === rewritten[0]?.imageUrl,
  "a second pass is a no-op: only an https url is rewritten, and the first pass removed it",
);

// Both halves survive a round trip, including the `/` a provider id contains.
const url = brokeredImageUrl(PROVIDER, "https://i.scdn.co/image/a?b=1&c=2");
const [, , , provider, target] = url.split("/");
assert(decodeURIComponent(provider!) === PROVIDER, "the provider id survives its own slash");
assert(
  decodeURIComponent(target!) === "https://i.scdn.co/image/a?b=1&c=2",
  "a query string survives rather than splitting the path Rust parses",
);

// A schema with no picture in it must not send a result through the copy at all.
assert(schemaHasImage(playlist), "a marked field is found through a list and an object");
assert(
  !schemaHasImage({ type: "object", fields: { a: { type: "string" }, b: { type: "number" } } }),
  "a schema with no picture is left alone",
);

console.log("image-urls.assert: ok");
