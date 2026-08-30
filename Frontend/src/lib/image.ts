/**
 * Preparing a photograph for upload.
 *
 * ── The problem this solves ────────────────────────────────────────────────
 * The server accepts JPEG, PNG and WebP up to 4MB. A photograph taken on any
 * phone made in the last decade is 3-8MB, so "add a photo of the dish" — the
 * single most natural thing an owner does on the menu screen — failed roughly
 * half the time, with a 413 that arrived only after the whole file had been
 * uploaded over a restaurant's wifi.
 *
 * Downscaling in the browser turns that into a non-event. A menu thumbnail is
 * rendered at 64-200px and the largest use is a grid tile, so 1600px on the
 * long edge is already generous; a 7MB phone photo lands around 300KB, and the
 * upload finishes before the 4MB ceiling is anywhere in view.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 * It is not a security control. The server re-checks the type by magic bytes
 * and enforces the size itself, because anything decided here can be bypassed
 * by not using this page. This exists to make the common case work and to fail
 * the uncommon one with a sentence someone can act on.
 *
 * It also does not re-encode an image that is already small enough. Every
 * round through a lossy codec costs quality, and a 200KB JPEG that is already
 * under the cap has nothing to gain from another pass.
 */

/** What the server will store. Keep in sync with Backend/src/middleware/upload.js. */
const ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

/**
 * Accepted `file.type` values, including the aliases different operating
 * systems hand out for the same file. An empty or generic type is not in this
 * list and is not meant to be — see `isAcceptedType`.
 */
const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/x-png',
  'image/webp',
]);

/** Longest edge, in pixels, after downscaling. */
const MAX_EDGE = 1600;

/** Below this, an accepted image is passed through untouched. */
const REENCODE_ABOVE_BYTES = 1_500_000;

/** JPEG quality for the re-encode. Visually lossless at menu-tile sizes. */
const JPEG_QUALITY = 0.85;

/** A refusal the UI can show verbatim. */
export class ImageError extends Error {}

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
};

/**
 * Is this a file we should even try to send?
 *
 * Checked by extension AND type, because either one alone is unreliable: a
 * file dragged out of an archive can arrive with an empty `type`, and a file
 * saved without an extension has no name to read. Agreement from either is
 * enough — the server's magic-byte check is what actually decides.
 */
function isAcceptedType(file: File): boolean {
  const type = file.type.toLowerCase();
  if (ACCEPTED_TYPES.has(type)) return true;

  // No usable type: fall back to the name.
  const looksUndeclared = type === '' || type.endsWith('octet-stream');
  return looksUndeclared && (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));
}

/**
 * PNG survives as PNG; everything else becomes JPEG.
 *
 * Transparency is real on this screen — an owner uploading a logo-shaped item
 * image would get a black background from a JPEG re-encode, which looks like a
 * bug rather than a compression choice. JPEG is the better default everywhere
 * else, since a photograph re-encoded as PNG is several times larger.
 */
function outputTypeFor(file: File): 'image/png' | 'image/jpeg' {
  const isPng = file.type.toLowerCase().includes('png') || extensionOf(file.name) === 'png';
  return isPng ? 'image/png' : 'image/jpeg';
}

/**
 * Decode to something drawable.
 *
 * `createImageBitmap` is the direct route and avoids a DOM round trip, but it
 * is missing on older Safari, so an <img> and an object URL stand in.
 */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through — a decoder that refuses the file is handled below, and
      // the <img> path is a second opinion worth having.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new ImageError('That image could not be read. Try another file.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const dimensionsOf = (source: ImageBitmap | HTMLImageElement) => ({
  width: 'width' in source ? source.width : 0,
  height: 'height' in source ? source.height : 0,
});

/**
 * Validate, and downscale if it is worth doing.
 *
 * @throws {ImageError} with a message written to be shown to the user.
 */
export async function prepareImage(file: File): Promise<File> {
  if (!isAcceptedType(file)) {
    throw new ImageError('Choose a JPG, PNG or WebP image.');
  }

  const source = await decode(file);
  const { width, height } = dimensionsOf(source);

  if (!width || !height) {
    throw new ImageError('That image could not be read. Try another file.');
  }

  const longest = Math.max(width, height);
  // Nothing to gain: already small, and already a format the server stores.
  if (longest <= MAX_EDGE && file.size <= REENCODE_ABOVE_BYTES && ACCEPTED_TYPES.has(file.type)) {
    if ('close' in source) source.close();
    return file;
  }

  // Never upscale — enlarging a small image only makes the upload bigger.
  const scale = Math.min(1, MAX_EDGE / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('That image could not be processed. Try another file.');

  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();

  const type = outputTypeFor(file);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined);
  });

  if (!blob) throw new ImageError('That image could not be processed. Try another file.');

  const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${base}.${type === 'image/png' ? 'png' : 'jpg'}`, { type });
}

/** The `accept` attribute for a file input, derived from the same lists. */
export const IMAGE_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/webp',
  ...ACCEPTED_EXTENSIONS.map((e) => `.${e}`),
].join(',');
