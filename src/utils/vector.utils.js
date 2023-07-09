const VectorUtils = {
  getVectorWithRange(rootVector, targetVector, range) {
    let from = rootVector.copy();
    let to = p5.Vector.add(from, p5.Vector.sub(targetVector, from).setMag(range));
    return { from, to };
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
