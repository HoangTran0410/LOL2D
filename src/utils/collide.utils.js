import PolyDecomp from '../../libs/poly-decomp.js';

const CollideUtils = {
  // using SAT library
  pointPolygon: (x, y, vertices) => {
    let point = new SAT.Vector(x, y);
    let polygon = new SAT.Polygon(
      new SAT.Vector(0, 0),
      vertices.map(_ => new SAT.Vector(_.x, _.y))
    );
    return SAT.pointInPolygon(point, polygon);
  },

  // using SAT library + decomp library
  pointPolygonConcave: (x, y, vertices) => {
    let _vertices = vertices.map(_ => [_.x, _.y]);

    PolyDecomp.makeCCW(_vertices);
    let decompVisibility = PolyDecomp.quickDecomp(_vertices);

    let SATPoint = new SAT.Vector(x, y);
    for (let poly of decompVisibility) {
      let SATpolygon = new SAT.Polygon(
        new SAT.Vector(),
        poly.map(p => new SAT.Vector(p[0], p[1]))
      );
      let overlap = SAT.pointInPolygon(SATPoint, SATpolygon);

      if (overlap) {
        return true;
      }
    }

    return false;
  },
};

export default CollideUtils;
