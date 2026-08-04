/**
 * Cloudinary client.
 *
 * Configured at boot; the upload/destroy helpers are consumed by the menu
 * routes in Phase 5. Buffers are streamed straight through — nothing is
 * written to local disk.
 */
import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true, // always return https URLs
});

export const CLOUDINARY_FOLDER = 'verdant-pos/menu';

/**
 * Upload an in-memory image buffer.
 * @param {Buffer} buffer
 * @param {{folder?: string, publicId?: string}} [options]
 * @returns {Promise<{url: string, publicId: string}>}
 */
export function uploadImageBuffer(buffer, { folder = CLOUDINARY_FOLDER, publicId } = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'image',
        // Do not let Cloudinary infer type from a spoofed extension.
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        overwrite: true,
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
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
