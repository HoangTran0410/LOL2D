export function hasFlag(target: number, flag: number): boolean {
  return (target & flag) === flag;
}

export const statusFlagsToString = (status: number, statusFlags: Record<string, number>): string[] => {
  const result: string[] = [];
  for (const key in statusFlags) {
    if (status & (statusFlags as Record<string, number>)[key]) {
      result.push(key);
    }
  }
  return result;
};

export const shuffleArray = <T>(array: T[]): T[] => {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export const removeAccents = (str: string): string => {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

export const uuidv4 = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    let r = (Math.random() * 16) | 0;
    let v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const rectToVertices = (
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  angle = 0,
  anchor?: { x: number; y: number }
): { x: number; y: number }[] => {
  const vertices: { x: number; y: number }[] = [];
  vertices.push({ x: rx, y: ry });
  vertices.push({ x: rx + rw, y: ry });
  vertices.push({ x: rx + rw, y: ry + rh });
  vertices.push({ x: rx, y: ry + rh });
  if (angle !== 0) {
    if (!anchor) anchor = { x: rx, y: ry };
    return rotateVerticesWithAnchor(vertices, angle, anchor);
  }
  return vertices;
};

export const rotateVerticesWithAnchor = (
  vertices: { x: number; y: number }[],
  angle: number,
  anchor: { x: number; y: number }
): { x: number; y: number }[] => {
  const result: { x: number; y: number }[] = [];
  for (const vertex of vertices) {
    const x = vertex.x - anchor.x;
    const y = vertex.y - anchor.y;
    const rotatedX = x * Math.cos(angle) - y * Math.sin(angle);
    const rotatedY = x * Math.sin(angle) + y * Math.cos(angle);
    result.push({ x: rotatedX + anchor.x, y: rotatedY + anchor.y });
  }
  return result;
};
