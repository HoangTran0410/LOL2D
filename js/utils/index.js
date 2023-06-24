export function hasFlag(target, flag) {
  return (target & flag) === flag;
}

export const statusFlagsToString = (status, statusFlags) => {
  let result = [];
  for (let key in statusFlags) {
    if (status & statusFlags[key]) {
      result.push(key);
    }
  }
  return result;
};

export const collideRotatedRectVsPoint = (rx, ry, rw, rh, angle, px, py) => {
  let poly = new SAT.Box(new SAT.Vector(rx, ry), rw, rh).toPolygon();
  poly.setAngle(angle);
  let point = new SAT.Vector(px, py);
  return SAT.pointInPolygon(point, poly);
};
