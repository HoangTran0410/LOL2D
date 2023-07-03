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
  getVectorWithAngleAndRange(rootVector, angle, range) {
    let from = rootVector.copy();
    let to = p5.Vector.add(from, p5.Vector.fromAngle(angle).setMag(range));
    return { from, to };
  },
  moveVectorToVector(vector, targetVector, speed) {
    return vector.add(p5.Vector.sub(targetVector, vector).setMag(speed));
  },
};

export default VectorUtils;
