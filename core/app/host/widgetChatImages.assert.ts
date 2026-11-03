import { imageProblem, imageSrc, MAX_CHAT_IMAGES, readChatImage } from "./widgetChatImages";

function assert(condition: unknown, message = "assertion failed") {
  if (!condition) throw new Error(message);
}
async function rejectsRead(file: File) {
  let failure = "";
  try { await readChatImage(file); } catch (error) { failure = String(error); }
  assert(failure.includes(`Could not read ${file.name}.`), failure);
}

const png = { type: "image/png", size: 1 };
assert(imageProblem(png, 0) === null);
for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
  assert(imageProblem({ type, size: 4 * 1024 * 1024 }, MAX_CHAT_IMAGES - 1) === null);
}
assert(imageProblem(png, MAX_CHAT_IMAGES)?.includes("At most 6"));
assert(imageProblem({ ...png, size: 4 * 1024 * 1024 + 1 }, 0)?.includes("4 MB"));
assert(imageProblem({ ...png, size: 0 }, 0)?.includes("empty"));
assert(imageProblem({ type: "image/svg+xml", size: 1 }, 0)?.includes("PNG, JPEG, WebP or GIF"));
assert(imageProblem({ type: "", size: 1 }, 0)?.includes("PNG, JPEG, WebP or GIF"));

// FileReader supplies data URLs; the wire must carry only their base64 payload.
const originalReader = globalThis.FileReader;
let result = "data:image/png;base64,QUJD";
let fail = false;
try {
  globalThis.FileReader = class {
    result = result;
    onload?: () => void;
    onerror?: () => void;
    readAsDataURL() {
      if (fail) this.onerror?.();
      else this.onload?.();
    }
  } as unknown as typeof FileReader;
  const file = { name: "sleep.png", type: "image/png" } as File;
  const image = await readChatImage(file);
  assert(image.name === "sleep.png" && image.mediaType === "image/png" && image.data === "QUJD");
  assert(imageSrc(image) === "data:image/png;base64,QUJD");
  result = "invalid";
  await rejectsRead(file);
  fail = true;
  await rejectsRead(file);
} finally {
  globalThis.FileReader = originalReader;
}
