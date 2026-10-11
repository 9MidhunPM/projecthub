export const MAX_SCREENSHOTS = 8;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type UploadFile = Pick<File, 'name' | 'size' | 'type'>;

/** Validate the whole selection before starting any uploads. */
export function validateScreenshots(files: readonly UploadFile[], existingCount: number): string | null {
  if (files.length + existingCount > MAX_SCREENSHOTS) {
    const remaining = Math.max(0, MAX_SCREENSHOTS - existingCount);
    return `You can add ${remaining} more ${remaining === 1 ? 'screenshot' : 'screenshots'} (8 total). Choose fewer files.`;
  }
  for (const file of files) {
    if (!SCREENSHOT_TYPES.has(file.type)) return `${file.name}: choose a PNG, JPEG, or WebP image.`;
    if (file.size === 0) return `${file.name} is empty. Choose a different image.`;
    if (file.size > MAX_SCREENSHOT_BYTES) return `${file.name} is larger than 5 MB. Choose a smaller image.`;
  }
  return null;
}

export function moveScreenshot(images: readonly string[], from: number, to: number): string[] {
  const next = [...images];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [image] = next.splice(from, 1);
  next.splice(to, 0, image);
  return next;
}
