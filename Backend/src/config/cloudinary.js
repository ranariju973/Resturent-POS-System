/**
 * Cloudinary client.
 *
 * Configured at boot; the upload/destroy helpers are consumed by the menu
 * routes in Phase 5. Buffers are streamed straight through — nothing is
 * written to local disk.
 */
import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';
import { ApiError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true, // always return https URLs
});

export const CLOUDINARY_FOLDER = 'verdant-pos/menu';

/**
 * Turn a Cloudinary rejection into an error the client can act on.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `upload_stream` rejects with Cloudinary's own error shape, which is not an
 * ApiError. Nothing downstream recognised it, so errorHandler's last resort
 * caught it and every failure — a bad API secret, an exhausted quota, a
 * dropped connection — reached the admin as a bare 500 "Something went wrong"
 * and was logged as a fault in THIS codebase.
 *
 * It is almost never our bug. Uploading is a call to a third party, so the
 * honest status is 502: we asked, and the image service did not deliver. The
 * distinction matters operationally — a 500 sends someone reading this code,
 * a 502 sends them to look at credentials, quota and the Cloudinary status
 * page, which is where the problem actually is.
 *
 * The original error is kept as `cause` so the full detail still reaches the
 * logs exactly once, via errorHandler.
 */
function asUploadError(err) {
  // Cloudinary reports HTTP status on the error itself; 401/403 mean the
  // credentials are wrong, which is a deployment problem worth naming.
  const status = err?.http_code ?? err?.error?.http_code;
  const message = err?.message ?? err?.error?.message ?? '';

  if (status === 401 || status === 403) {
    return new ApiError(502, 'The image service rejected our credentials. Check the Cloudinary configuration.', {
      code: 'IMAGE_SERVICE_UNAUTHORISED',
      cause: err,
    });
  }

  // 420/429 is Cloudinary's rate/quota signal.
  if (status === 420 || status === 429) {
    return new ApiError(502, 'The image service is over its quota. Try again shortly.', {
      code: 'IMAGE_SERVICE_QUOTA',
      cause: err,
    });
  }

  return new ApiError(502, `Could not upload the image${message ? ` — ${message}` : ''}.`, {
    code: 'IMAGE_UPLOAD_FAILED',
    cause: err,
  });
}

/**
 * Upload an in-memory image buffer.
 *
 * Rejects with an ApiError (502), never with Cloudinary's raw error — see
 * asUploadError above for why the status is 502 rather than 500.
 *
 * @param {Buffer} buffer
 * @param {{folder?: string, publicId?: string}} [options]
 * @returns {Promise<{url: string, publicId: string}>}
 */
export function uploadImageBuffer(
  buffer,
  { folder = CLOUDINARY_FOLDER, publicId, sourceFormat } = {},
) {
  /*
   * A HEIC upload is STORED as JPEG.
   *
   * Only Safari renders image/heic. Keeping the original would mean a menu
   * photographed on an iPhone — the overwhelmingly common case — delivered a
   * .heic URL that is simply blank in Chrome and on Android, which looks like
   * a broken image rather than an unsupported format. Cloudinary transcodes on
   * ingest, so the conversion costs nothing here and the stored asset is
   * viewable everywhere.
   *
   * JPEG rather than WebP because this is also what gets embedded in printed
   * invoices and PDFs, where WebP support is still patchy.
   *
   * ── Why the conversion rides on fetch_format, not `format` ───────────────
   * The obvious spelling is the top-level `format: 'jpg'` upload option. It is
   * silently ignored whenever `allowed_formats` is also set — no error, no
   * warning, the asset is simply stored in its original format. Verified
   * against the live API: `format: 'jpg'` alone yields a .jpg, and the same
   * call with `allowed_formats` present yields the source format back.
   *
   * Dropping `allowed_formats` to make `format` work would trade a real
   * server-side restriction for a cosmetic one, so the conversion is expressed
   * as an incoming transformation instead, which `allowed_formats` does not
   * override. Non-HEIC uploads keep `fetch_format: 'auto'` and are untouched
   * by this.
   */
  const isHeic = sourceFormat === 'heic';

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'image',
        // Do not let Cloudinary infer type from a spoofed extension.
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
        overwrite: true,
        transformation: [{ quality: 'auto', fetch_format: isHeic ? 'jpg' : 'auto' }],
      },
      (error, result) => {
        if (error) {
          logger.error('Cloudinary upload failed', {
            httpCode: error.http_code ?? error.error?.http_code,
            message: error.message ?? error.error?.message,
          });
          return reject(asUploadError(error));
        }
        /*
         * A callback with neither an error nor a usable result. Undocumented
         * but observed, and without this the destructure below would throw a
         * TypeError from inside a promise executor — which surfaces as the
         * same opaque 500 this function exists to eliminate.
         */
        if (!result?.secure_url) {
          return reject(asUploadError(new Error('the image service returned no URL')));
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );

    // A stream-level failure (socket reset, DNS) never reaches the callback.
    stream.on('error', (err) => reject(asUploadError(err)));

    stream.end(buffer);
  });
}

/** Delete an asset by public_id. Safe to call with a null/undefined id. */
export async function deleteImage(publicId) {
  if (!publicId) return null;
  return cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
}

export { cloudinary };
export default cloudinary;
