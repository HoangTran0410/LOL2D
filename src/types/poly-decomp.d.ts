declare module 'poly-decomp' {
  type Polygon = number[][];

  interface PolyDecomp {
    makeCCW(polygon: Polygon): boolean;
    quickDecomp(polygon: Polygon): Polygon[];
  }

  const polyDecomp: PolyDecomp;
  export default polyDecomp;
}
