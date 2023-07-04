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
};

export default CollideUtils;
