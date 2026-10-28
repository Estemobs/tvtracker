import path from 'node:path';

const AVATAR_MIME_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
]);

const SAFE_UPLOAD_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export const ALLOWED_AVATAR_MIME_TYPES = [...AVATAR_MIME_EXTENSIONS.keys()];

export function safeAvatarExtension(mimetype) {
  const extension = AVATAR_MIME_EXTENSIONS.get(String(mimetype || '').toLowerCase());
  if (!extension) {
    throw new Error("Format d'image non supporté.");
  }
  return extension;
}

// Legacy uploads may have kept a client-controlled extension (.html/.svg). Never serve those,
// even if they are still present on disk.
export function isSafeUploadPath(pathname) {
  return SAFE_UPLOAD_EXTENSIONS.has(path.extname(String(pathname || '')).toLowerCase());
}
