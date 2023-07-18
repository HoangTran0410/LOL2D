const VectorUtils = {
  getAngle(from, to) {
    return p5.Vector.sub(to, from).heading();
  },
  getVectorWithRange(rootVector, targetVector, range, autoRandomWhenZero = true) {
    let from = rootVector.copy();
    let dir = p5.Vector.sub(targetVector, from);
    let distance = dir.mag();
    // case leesinQ to target, then R => fail because distance = 0, target will not dash to other side
    // so we add a random vector to dir
    if (autoRandomWhenZero && distance === 0) dir.add(random(-1, 1), random(-1, 1));
    let to = p5.Vector.add(from, dir.setMag(range));
    return { from, to, distance };
  },
  getVectorWithMaxRange(rootVector, targetVector, maxRange) {
    let from = rootVector.copy();
    let to = p5.Vector.add(from, p5.Vector.sub(targetVector, from).limit(maxRange));
    return { from, to };
  },
  getVectorWithMinAndMaxRange(rootVector, targetVector, minRange, maxRange) {
    let from = rootVector.copy();
    let to = p5.Vector.add(from, p5.Vector.sub(targetVector, from).limit(maxRange));
    if (from.dist(to) < minRange) {
      to = p5.Vector.add(from, p5.Vector.sub(targetVector, from).setMag(minRange));
    }
    return { from, to };
  },
  getVectorWithAngleAndRange(rootVector, angle, range) {
    let from = rootVector.copy();
    let to = p5.Vector.add(from, p5.Vector.fromAngle(angle).setMag(range));
    return { from, to };
  },
  moveVectorToVector(vector, targetVector, speed) {
    return vector.add(p5.Vector.sub(targetVector, vector).setMag(speed));
  },
  getDirectionVector(from, to) {
    return p5.Vector.sub(to, from).normalize();
  },
};

export default VectorUtils;
