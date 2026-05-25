import type { NormRect } from "../../types/citation";

type ViewportSize = {
  width: number;
  height: number;
};

type ViewportRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const EPSILON = 0.0001;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function clampNormRect(rect: NormRect): NormRect {
  const x0 = clamp01(rect.x);
  const y0 = clamp01(rect.y);
  const x1 = clamp01(rect.x + rect.width);
  const y1 = clamp01(rect.y + rect.height);
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.max(EPSILON, Math.abs(x1 - x0)),
    height: Math.max(EPSILON, Math.abs(y1 - y0))
  };
}

export function isNormRectVisible(rect: NormRect): boolean {
  const x1 = rect.x + rect.width;
  const y1 = rect.y + rect.height;
  return x1 > 0 && y1 > 0 && rect.x < 1 && rect.y < 1;
}

export function normRectToViewportRect(rect: NormRect, viewport: ViewportSize): ViewportRect {
  const clamped = clampNormRect(rect);
  return {
    x: clamped.x * viewport.width,
    y: clamped.y * viewport.height,
    width: Math.max(1, clamped.width * viewport.width),
    height: Math.max(1, clamped.height * viewport.height)
  };
}

export function createCropTransform(
  rect: NormRect,
  viewport: ViewportSize,
  targetWidth: number,
  targetHeight: number
): [number, number, number, number, number, number] {
  const crop = normRectToViewportRect(rect, viewport);
  const scaleX = targetWidth / crop.width;
  const scaleY = targetHeight / crop.height;
  return [scaleX, 0, 0, scaleY, -crop.x * scaleX, -crop.y * scaleY];
}

export function buildSnippetCacheKey(params: {
  docId: string;
  page: number;
  normRect: NormRect;
  scale: number;
  version: string;
}): string {
  const clamped = clampNormRect(params.normRect);
  return [
    params.docId.trim().toLowerCase(),
    `p${params.page}`,
    clamped.x.toFixed(4),
    clamped.y.toFixed(4),
    clamped.width.toFixed(4),
    clamped.height.toFixed(4),
    `s${params.scale.toFixed(2)}`,
    `v${params.version}`
  ].join("|");
}
