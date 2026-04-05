const VectorUtils = {
  getAngle(from: p5.Vector, to: p5.Vector): number {
    return p5.Vector.sub(to, from).heading();
  },
  getVectorWithRange(
    rootVector: p5.Vector,
    targetVector: p5.Vector,
    range: number,
    autoRandomWhenZero = true
  ) {
    const from = rootVector.copy();
    let dir = p5.Vector.sub(targetVector, from);
    const distance = dir.mag();
    if (autoRandomWhenZero && distance === 0) dir.add(random(-1, 1), random(-1, 1));
    const to = p5.Vector.add(from, dir.setMag(range));
    return { from, to, distance };
  },
  getVectorWithMaxRange(rootVector: p5.Vector, targetVector: p5.Vector, maxRange: number) {
    const from = rootVector.copy();
    const to = p5.Vector.add(from, p5.Vector.sub(targetVector, from).limit(maxRange));
    return { from, to };
  },
  getVectorWithMinAndMaxRange(
    rootVector: p5.Vector,
    targetVector: p5.Vector,
    minRange: number,
    maxRange: number
  ) {
    const from = rootVector.copy();
    let to = p5.Vector.add(from, p5.Vector.sub(targetVector, from).limit(maxRange));
    if (from.dist(to) < minRange) {
      to = p5.Vector.add(from, p5.Vector.sub(targetVector, from).setMag(minRange));
    }
    return { from, to };
  },
  getVectorWithAngleAndRange(rootVector: p5.Vector, angle: number, range: number) {
    const from = rootVector.copy();
    const to = p5.Vector.add(from, p5.Vector.fromAngle(angle).setMag(range));
    return { from, to };
  },
  moveVectorToVector(vector: p5.Vector, targetVector: p5.Vector, speed: number) {
    return vector.add(p5.Vector.sub(targetVector, vector).setMag(speed));
  },
  getDirectionVector(from: p5.Vector, to: p5.Vector): p5.Vector {
    return p5.Vector.sub(to, from).normalize();
  },
};

export default VectorUtils;
