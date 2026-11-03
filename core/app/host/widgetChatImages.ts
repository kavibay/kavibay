import type { LlmImage } from "@sdk/contract/sdk";

export interface ChatAttachment extends LlmImage {
  name: string;
}

// Keep these limits aligned with llm/provider.rs.
export const CHAT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MAX_CHAT_IMAGES = 6;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function imageProblem(file: { type: string; size: number }, attached: number): string | null {
  if (attached >= MAX_CHAT_IMAGES) return `At most ${MAX_CHAT_IMAGES} images per message.`;
  if (!CHAT_IMAGE_TYPES.includes(file.type)) return "Choose a PNG, JPEG, WebP or GIF image.";
  if (file.size === 0) return "That image is empty.";
  if (file.size > MAX_IMAGE_BYTES) return "That image is larger than 4 MB.";
  return null;
}

export function readChatImage(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const start = dataUrl.indexOf("base64,");
      if (start < 0) { reject(new Error(`Could not read ${file.name}.`)); return; }
      resolve({ name: file.name, mediaType: file.type, data: dataUrl.slice(start + 7) });
    };
    reader.onerror = reader.onabort = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function imageSrc(image: LlmImage): string {
  return `data:${image.mediaType};base64,${image.data}`;
}
