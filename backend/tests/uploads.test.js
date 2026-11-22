import { describe, it, expect } from 'vitest';
import { isSafeUploadPath, safeAvatarExtension } from '../src/utils/uploads.js';

describe('safeAvatarExtension', () => {
  it('maps allowed image MIME types to a safe extension', () => {
    expect(safeAvatarExtension('image/png')).toBe('.png');
    expect(safeAvatarExtension('image/jpeg')).toBe('.jpg');
    expect(safeAvatarExtension('image/webp')).toBe('.webp');
  });

  it('ignores the original filename and rejects dangerous MIME types', () => {
    expect(() => safeAvatarExtension('text/html')).toThrow(/Format d'image/);
    expect(() => safeAvatarExtension('image/svg+xml')).toThrow(/Format d'image/);
    expect(() => safeAvatarExtension('application/javascript')).toThrow(/Format d'image/);
    expect(() => safeAvatarExtension('')).toThrow(/Format d'image/);
  });

  it('never serves legacy .html/.svg uploads', () => {
    expect(isSafeUploadPath('/avatar-1.html')).toBe(false);
    expect(isSafeUploadPath('/avatar-1.svg')).toBe(false);
    expect(isSafeUploadPath('/avatar-1.js')).toBe(false);
    expect(isSafeUploadPath('/avatar-1.png')).toBe(true);
    expect(isSafeUploadPath('/avatar-1.JPG')).toBe(true);
    expect(isSafeUploadPath('/avatar-1.webp')).toBe(true);
  });
});
