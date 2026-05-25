type CanvasLike = OffscreenCanvas | HTMLCanvasElement;

function createCanvas(width: number, height: number): CanvasLike | null {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

export class CanvasPool {
  private readonly maxSize: number;
  private readonly pool: CanvasLike[] = [];

  constructor(maxSize = 8) {
    this.maxSize = maxSize;
  }

  acquire(width: number, height: number): CanvasLike | null {
    const next = this.pool.pop();
    if (!next) {
      return createCanvas(width, height);
    }
    if ("width" in next) {
      next.width = width;
    }
    if ("height" in next) {
      next.height = height;
    }
    return next;
  }

  release(canvas: CanvasLike) {
    if (this.pool.length >= this.maxSize) {
      return;
    }
    this.pool.push(canvas);
  }

  size() {
    return this.pool.length;
  }
}
