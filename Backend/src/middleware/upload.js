/**
 * Menu image uploads.
 *
 * ── Why the file never touches disk ────────────────────────────────────────
 * multer's default is `diskStorage`, which writes uploads to a temp directory
 * before the handler runs. That means untrusted bytes sitting on the server's
 * filesystem, a cleanup obligation on every error path, and — if the storage
 * path is ever served statically — a route to executing what was uploaded.
 * `memoryStorage` keeps the bytes in a Buffer that is streamed straight to
 * Cloudinary and then garbage-collected. The size cap below is what makes that
 * safe; without it, memory storage is a way to exhaust RAM.
 *
 * ── Why the Content-Type header is not trusted ─────────────────────────────
 * `Content-Type` on a multipart part is supplied by the client. Renaming
 * shell.php to shell.jpg and declaring `image/jpeg` costs nothing. So the MIME
 * check below is only a cheap first pass; the real check reads the first bytes
 * of the buffer and confirms they are the signature of a format we accept.
 * A file that claims to be a JPEG but does not begin FF D8 FF is rejected.
 */
import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';

/** Formats we accept, by declared MIME type. */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Magic-byte signatures. The authoritative check.
 *
 * WebP is a RIFF container: bytes 0-3 are 'RIFF', 4-7 are the file size, and
 * 8-11 are 'WEBP' — so it needs an offset match rather than a simple prefix.
 */
const SIGNATURES = [
  { format: 'jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { format: 'png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { format: 'webp', offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // 'RIFF'
];

const matchesAt = (buffer, offset, bytes) =>
  bytes.every((b, i) => buffer[offset + i] === b);

/**
 * Identify a buffer by its content.
 * @param {Buffer} buffer
 * @returns {'jpeg'|'png'|'webp'|null}
 */
export function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  for (const sig of SIGNATURES) {
    if (!matchesAt(buffer, sig.offset, sig.bytes)) continue;

    // RIFF alone is not enough — AVI and WAV are also RIFF containers.
    if (sig.format === 'webp') {
      const isWebp = buffer.toString('ascii', 8, 12) === 'WEBP';
      if (!isWebp) continue;
    }
    return sig.format;
  }
  return null;
}

/**
 * First-pass filter on the declared type. Cheap, and it lets multer abort
 * before buffering a large file we were never going to accept.
 */
function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    logger.warn('Rejected upload with disallowed MIME type', {
      requestId: req.id,
      userId: req.user?.id,
      mimetype: file.mimetype,
    });
    return cb(ApiError.badRequest('Image must be a JPEG, PNG or WebP'));
  }
  return cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: env.UPLOAD_MAX_BYTES,
    files: 1,
    // Caps the non-file parts too. Without these, a multipart body can carry
    // thousands of text fields under the file-size limit.
    fields: 20,
    fieldSize: 100 * 1024,
    parts: 25,
  },
});

/**
 * Accept a single optional `image` field.
 *
 * Wraps multer so its errors become the API's standard envelope instead of
 * multer's own shapes, and so LIMIT_FILE_SIZE reports 413 rather than 500.
 */
export function uploadImage(fieldName = 'image') {
  const handler = upload.single(fieldName);

  return (req, res, next) =>
    handler(req, res, (err) => {
      if (!err) return next();

      if (err instanceof multer.MulterError) {
        logger.warn('Upload rejected by multer', {
          requestId: req.id,
          userId: req.user?.id,
          code: err.code,
          field: err.field,
        });

        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            return next(
              ApiError.payloadTooLarge(
                `Image must be smaller than ${Math.floor(env.UPLOAD_MAX_BYTES / 1024 / 1024)}MB`,
              ),
            );
          case 'LIMIT_FILE_COUNT':
          case 'LIMIT_UNEXPECTED_FILE':
            return next(ApiError.badRequest('Only one image may be uploaded'));
          default:
            return next(ApiError.badRequest('Invalid upload'));
        }
      }
      return next(err);
    });
}

/**
 * Verify the uploaded bytes really are an image of an accepted format.
 *
 * Runs after multer, so `req.file.buffer` is populated. A missing file is
 * fine — the image is optional on both create and update.
 */
export function verifyImageContent(req, _res, next) {
  if (!req.file) return next();

  const format = detectImageFormat(req.file.buffer);

  if (!format) {
    logger.warn('Rejected upload whose content is not an image', {
      requestId: req.id,
      userId: req.user?.id,
      declaredMime: req.file.mimetype,
      size: req.file.size,
      // First bytes only — enough to identify what was actually sent, not
      // enough to reproduce a payload in the logs.
      leadingBytes: req.file.buffer.subarray(0, 8).toString('hex'),
    });
    return next(ApiError.badRequest('File content is not a valid JPEG, PNG or WebP image'));
  }

  // A mismatch means the declared type was wrong — a plain mistake, or an
  // attempt to smuggle one format past a filter that only reads the header.
  const declared = req.file.mimetype.replace('image/', '').replace('jpg', 'jpeg');
  if (declared !== format) {
    logger.warn('Upload MIME type does not match its content', {
      requestId: req.id,
      userId: req.user?.id,
      declared: req.file.mimetype,
      actual: format,
    });
    return next(ApiError.badRequest('Image content does not match its declared type'));
  }

  req.file.detectedFormat = format;
  return next();
}

export default uploadImage;
