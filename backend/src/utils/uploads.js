const AVATAR_MIME_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
]);

export const ALLOWED_AVATAR_MIME_TYPES = [...AVATAR_MIME_EXTENSIONS.keys()];

export function safeAvatarExtension(mimetype) {
  const extension = AVATAR_MIME_EXTENSIONS.get(String(mimetype || '').toLowerCase());
  if (!extension) {
    throw new Error("Format d'image non supporté.");
  }
  return extension;
}
