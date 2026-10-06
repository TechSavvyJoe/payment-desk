import { MAX_LOGO_DATA_URL_LENGTH } from "./brandSettings.js";

export const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
export const MAX_LOGO_FILE_BYTES = 10 * 1024 * 1024;
export const LOGO_MAX_WIDTH = 600;
export const LOGO_MAX_HEIGHT = 200;

const EXTENSION_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

/** A logo problem whose message can be shown to the person choosing the file. */
export class LogoError extends Error {}
const fail = (message) => { throw new LogoError(message); };

export function logoTypeFor(file) {
  if (file?.type) return ACCEPTED_LOGO_TYPES.includes(file.type) ? file.type : null;
  const extension = String(file?.name ?? "").split(".").pop().toLowerCase();
  return EXTENSION_TYPES[extension] ?? null;
}

export function fitWithin(width, height, maxWidth = LOGO_MAX_WIDTH, maxHeight = LOGO_MAX_HEIGHT) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function decode(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("decode failed"));
    image.src = url;
  });
}

/** Resizes an uploaded logo on this device and returns it as a PNG data URL. */
export async function prepareLogo(file) {
  if (!file) fail("Choose a logo file.");
  const type = logoTypeFor(file);
  if (!type) fail("Use a PNG, JPG, WebP, GIF, or SVG image for the logo.");
  if (file.size > MAX_LOGO_FILE_BYTES) fail("That logo file is larger than 10 MB. Use a smaller image.");
  // A file with no MIME type (common for SVG on some systems) decodes from a typed copy.
  const url = URL.createObjectURL(file.type ? file : new Blob([file], { type }));
  try {
    let image;
    try {
      image = await decode(url);
    } catch {
      fail("That file couldn't be read as an image. Try saving the logo as a PNG.");
    }
    if (!image.naturalWidth || !image.naturalHeight) fail("That image has no size information. Export the logo as a PNG and try again.");
    const size = fitWithin(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) fail("This browser couldn't process the logo. Try a different browser.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, size.width, size.height);
    let dataUrl;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      fail("The browser blocked reading this logo. Save it as a PNG and try again.");
    }
    if (!dataUrl.startsWith("data:image/png;base64,")) fail("This browser couldn't process the logo. Try a different browser.");
    if (dataUrl.length > MAX_LOGO_DATA_URL_LENGTH) fail("That logo is too detailed to save. Use a simpler PNG.");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}
