export class ViewportTransform {
  readonly rotation: 0 | 90 | 180 | 270;
  readonly scale: number;
  private readonly x: number;
  private readonly y: number;
  private readonly width: number;
  private readonly height: number;

  constructor(view: [number, number, number, number], scale = 1, rotation = 0) {
    const [x1, y1, x2, y2] = view;
    this.x = x1;
    this.y = y1;
    this.width = x2 - x1;
    this.height = y2 - y1;
    this.scale = Math.max(0.1, scale);
    this.rotation = (((rotation % 360) + 360) % 360) as 0 | 90 | 180 | 270;
    if (![0, 90, 180, 270].includes(this.rotation)) throw new RangeError('PDF rotation must be 0, 90, 180, or 270.');
  }

  pdfPoint(x: number, y: number): [number, number] {
    const relativeX = x - this.x;
    const relativeY = y - this.y;
    switch (this.rotation) {
      case 90:
        return [relativeY * this.scale, relativeX * this.scale];
      case 180:
        return [(this.width - relativeX) * this.scale, relativeY * this.scale];
      case 270:
        return [(this.height - relativeY) * this.scale, (this.width - relativeX) * this.scale];
      default:
        return [relativeX * this.scale, (this.height - relativeY) * this.scale];
    }
  }

  pdfRect(x: number, y: number, width: number, height: number): [number, number, number, number] {
    const corners = [
      this.pdfPoint(x, y),
      this.pdfPoint(x + width, y),
      this.pdfPoint(x, y + height),
      this.pdfPoint(x + width, y + height),
    ];
    const xs = corners.map(([pointX]) => pointX);
    const ys = corners.map(([, pointY]) => pointY);
    return [Math.min(...xs), Math.max(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }
}
