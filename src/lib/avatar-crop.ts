// The maths behind the profile picture cropper, kept apart from the screen so
// it can be tested. The picture always covers the round frame: you can drag
// and zoom, but never leave an empty edge.

export interface Size { w: number; h: number }
export interface Offset { x: number; y: number }

/** How far the photo is scaled so its short side just fills the frame. */
export function coverScale(img: Size, frame: number): number {
  return Math.max(frame / img.w, frame / img.h);
}

/** The photo's on-screen size at a given zoom (1 = just covering). */
export function shownSize(img: Size, frame: number, zoom: number): Size {
  const s = coverScale(img, frame) * zoom;
  return { w: img.w * s, h: img.h * s };
}

/** Keeps a drag inside the photo, so the frame never shows an empty edge. */
export function clampOffset(off: Offset, img: Size, frame: number, zoom: number): Offset {
  const shown = shownSize(img, frame, zoom);
  const maxX = (shown.w - frame) / 2, maxY = (shown.h - frame) / 2;
  return { x: Math.min(maxX, Math.max(-maxX, off.x)), y: Math.min(maxY, Math.max(-maxY, off.y)) };
}

/** The part of the original photo that sits inside the frame, in photo pixels. */
export function sourceRect(img: Size, frame: number, zoom: number, off: Offset): { x: number; y: number; side: number } {
  const s = coverScale(img, frame) * zoom;
  const side = frame / s;
  const x = img.w / 2 - off.x / s - side / 2;
  const y = img.h / 2 - off.y / s - side / 2;
  return { x, y, side };
}
