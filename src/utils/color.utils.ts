const ColorUtils = {
  applyColorAlpha(colorCode: any, alpha: number) {
    const c = color(colorCode);
    c.setAlpha(alpha);
    return c;
  },
  createLinearGradient(canvas: any, x: number, y: number, w: number, colorStops: { stop: number; color: string }[]) {
    const g = canvas.drawingContext.createLinearGradient(x, y, x + w, y);
    for (const cs of colorStops) {
      g.addColorStop(cs.stop, cs.color);
    }
    canvas.drawingContext.fillStyle = g;
  },
  createRadialGradient(canvas: any, x: number, y: number, r1: number, r2: number, colorStops: { stop: number; color: string }[]) {
    const g = canvas.drawingContext.createRadialGradient(x, y, r1, x, y, r2);
    for (const cs of colorStops) {
      g.addColorStop(cs.stop, cs.color);
    }
    canvas.drawingContext.fillStyle = g;
  },
};
export default ColorUtils;
