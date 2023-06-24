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
  // get point position relative to rect
  let dx = px - rx;
  let dy = py - ry;

  // pre-compute rotation matrix entries
  let cos = Math.cos(angle);
  let sin = Math.sin(angle);

  // get position in rotated rect space
  let rotatedX = cos * dx + sin * dy;
  let rotatedY = -sin * dx + cos * dy;

  // check collisions
  if (rotatedX > 0 && rotatedX < rw && rotatedY > 0 && rotatedY < rh) {
    return true;
  }
  return false;
};
