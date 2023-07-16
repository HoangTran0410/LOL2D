import SAT from '../../libs/SAT.js';
import PolyDecomp from '../../libs/poly-decomp.js';

const CollideUtils = {
  // using SAT library
  pointPolygon: (x, y, vertices) => {
    return SAT.pointInPolygon(
      new SAT.Vector(x, y),
      new SAT.Polygon(
        new SAT.Vector(0, 0),
        vertices.map(_ => new SAT.Vector(_.x, _.y))
      )
    );
  },

  // using SAT library + decomp library
  pointPolygonConcave: (x, y, vertices) => {
    let _vertices = vertices.map(_ => [_.x, _.y]);

    PolyDecomp.makeCCW(_vertices);
    let decompVisibility = PolyDecomp.quickDecomp(_vertices);

    for (let poly of decompVisibility) {
      let _poly = poly.map(_ => ({ x: _[0], y: _[1] }));
      let overlap = CollideUtils.pointPolygon(x, y, _poly);
      if (overlap) {
        return true;
      }
    }
    return false;
  },

  // check collision between circle and arc
  circleArc: (
    circle_x,
    circle_y,
    circle_r,
    arx_x,
    arc_y,
    arc_r,
    arc_angle_start,
    arc_angle_end
  ) => {
    // check if circle is outside of arc's bounding box
    let distance = Math.sqrt(Math.pow(circle_x - arx_x, 2) + Math.pow(circle_y - arc_y, 2));
    if (distance > circle_r + arc_r) return false;

    // check if circle is between arc's angle
    let angle = atan2(circle_y - arc_y, circle_x - arx_x);
    if (angle < arc_angle_start || angle > arc_angle_end) return false;

    return true;
  },

  circleRect(cx, cy, radius, rx, ry, rw, rh) {
    // temporary variables to set edges for testing
    let testX = cx;
    let testY = cy;

    // which edge is closest?
    if (cx < rx) testX = rx; // test left edge
    else if (cx > rx + rw) testX = rx + rw; // right edge
    if (cy < ry) testY = ry; // top edge
    else if (cy > ry + rh) testY = ry + rh; // bottom edge

    // get distance from closest edges
    let distX = cx - testX;
    let distY = cy - testY;
    let distance = sqrt(distX * distX + distY * distY);

    // if the distance is less than the radius, collision!
    if (distance <= radius) {
      return true;
    }
    return false;
  },
};

export default CollideUtils;
