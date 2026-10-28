import { describe, it, expect } from 'vitest';
import { safeAvatarExtension } from '../src/utils/uploads.js';

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
});
