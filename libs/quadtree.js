// https://github.com/timohausmann/quadtree-ts

import CollideUtils from '../src/utils/collide.utils.js';

class Quadtree {
  constructor({ x = 0, y = 0, w, h, maxObjects = 10, maxLevels = 4 } = {}, level = 0) {
    this.bounds = { x, y, w, h };
    this.maxObjects = typeof maxObjects === 'number' ? maxObjects : 10;
    this.maxLevels = typeof maxLevels === 'number' ? maxLevels : 4;
    this.level = level;
    this.objects = [];
    this.nodes = [];
  }

  getIndex(areaObj) {
    return areaObj.qtIndex(this.bounds);
  }

  split() {
    const level = this.level + 1,
      w = this.bounds.w / 2,
      h = this.bounds.h / 2,
      x = this.bounds.x,
      y = this.bounds.y;
    const coords = [
      { x: x + w, y: y },
      { x: x, y: y },
      { x: x, y: y + h },
      { x: x + w, y: y + h },
    ];
    for (let i = 0; i < 4; i++) {
      this.nodes[i] = new Quadtree(
        {
          x: coords[i].x,
          y: coords[i].y,
          w: w,
          h: h,
          maxObjects: this.maxObjects,
          maxLevels: this.maxLevels,
        },
        level
      );
    }
  }

  insert(areaObj) {
    //if we have subnodes, call insert on matching subnodes
    if (this.nodes.length) {
      const indexes = this.getIndex(areaObj);
      for (let i = 0; i < indexes.length; i++) {
        this.nodes[indexes[i]].insert(areaObj);
      }
      return;
    }
    //otherwise, store object here
    this.objects.push(areaObj);
    //maxObjects reached
    if (this.objects.length > this.maxObjects && this.level < this.maxLevels) {
      //split if we don't already have subnodes
      if (!this.nodes.length) {
        this.split();
      }
      //add all objects to their corresponding subnode
      for (let i = 0; i < this.objects.length; i++) {
        const indexes = this.getIndex(this.objects[i]);
        for (let k = 0; k < indexes.length; k++) {
          this.nodes[indexes[k]].insert(this.objects[i]);
        }
      }
      //clean up this node
      this.objects = [];
    }
  }

  retrieve(areaObj, cleanUp = true) {
    const indexes = this.getIndex(areaObj);
    let returnObjects = this.objects;
    // if we have subnodes, retrieve their objects
    if (this.nodes.length) {
      for (let i = 0; i < indexes.length; i++) {
        returnObjects = returnObjects.concat(this.nodes[indexes[i]].retrieve(areaObj, false));
      }
    }

    // only clean up at the root of recursive calls
    if (cleanUp) {
      //remove duplicates
      returnObjects = returnObjects.filter((item, index) => returnObjects.indexOf(item) >= index);
      //get only objects that really intersect with areaObj
      returnObjects = returnObjects.filter(item => areaObj.intersect(item));
    }
    return returnObjects;
  }

  clear() {
    this.objects = [];
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes.length) {
        this.nodes[i].clear();
      }
    }
    this.nodes = [];
  }
}

// ======== AREA OBJECTS ========
class Rectangle {
  constructor({ x, y, w, h, data }) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.data = data;
    this.bounds = { minX: x, minY: y, maxX: x + w, maxY: y + h }; // for BVH
  }

  qtIndex({ x, y, w, h }) {
    const indexes = [],
      boundsCenterX = x + w / 2,
      boundsCenterY = y + h / 2;
    const startIsNorth = this.y < boundsCenterY,
      startIsWest = this.x < boundsCenterX,
      endIsEast = this.x + this.w > boundsCenterX,
      endIsSouth = this.y + this.h > boundsCenterY;
    //top-right quad
    if (startIsNorth && endIsEast) {
      indexes.push(0);
    }
    //top-left quad
    if (startIsWest && startIsNorth) {
      indexes.push(1);
    }
    //bottom-left quad
    if (startIsWest && endIsSouth) {
      indexes.push(2);
    }
    //bottom-right quad
    if (endIsEast && endIsSouth) {
      indexes.push(3);
    }
    return indexes;
  }

  // prettier-ignore
  intersect(other) {
    if (other instanceof Rectangle) {
      return CollideUtils.rectRect(this.x, this.y, this.w, this.h, other.x, other.y, other.w, other.h);
    }
    if (other instanceof Circle) {
      return CollideUtils.circleRect(other.x, other.y, other.r, this.x, this.y, this.w, this.h);
    }
    if (other instanceof Line) {
      return CollideUtils.lineRect(other.x1, other.y1, other.x2, other.y2, this.x, this.y, this.w, this.h);
    }
  }
}

class Circle {
  constructor({ x, y, r, data }) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.data = data;
    this.bounds = { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r }; // for BVH
  }

  qtIndex({ x, y, w, h }) {
    const indexes = [],
      w2 = w / 2,
      h2 = h / 2,
      x2 = x + w2,
      y2 = y + h2;
    //an array of node origins where the array index equals the node index
    const nodes = [
      [x2, y],
      [x, y],
      [x, y2],
      [x2, y2],
    ];
    //test all nodes for circle intersections
    for (let i = 0; i < nodes.length; i++) {
      if (
        Circle.intersectRect(
          this.x,
          this.y,
          this.r,
          nodes[i][0],
          nodes[i][1],
          nodes[i][0] + w2,
          nodes[i][1] + h2
        )
      ) {
        indexes.push(i);
      }
    }
    return indexes;
  }

  static intersectRect(x, y, r, minX, minY, maxX, maxY) {
    const deltaX = x - Math.max(minX, Math.min(x, maxX));
    const deltaY = y - Math.max(minY, Math.min(y, maxY));
    return deltaX * deltaX + deltaY * deltaY < r * r;
  }

  // prettier-ignore
  intersect(other) {
    if (other instanceof Rectangle) {
      return CollideUtils.circleRect(this.x, this.y, this.r, other.x, other.y, other.w, other.h);
    }
    if (other instanceof Circle) {
      return CollideUtils.circleCircle(this.x, this.y, this.r, other.x, other.y, other.r);
    }
    if (other instanceof Line) {
      return CollideUtils.lineCircle(other.x1, other.y1, other.x2, other.y2, this.x, this.y, this.r);
    }
  }
}

class Line {
  constructor({ x1, y1, x2, y2, data }) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.data = data;
    this.bounds = {
      minX: Math.min(x1, x2),
      minY: Math.min(y1, y2),
      maxX: Math.max(x1, x2),
      maxY: Math.max(y1, y2),
    }; // for BVH
  }

  qtIndex({ x, y, w, h }) {
    const indexes = [],
      w2 = w / 2,
      h2 = h / 2,
      x2 = x + w2,
      y2 = y + h2;
    //an array of node origins where the array index equals the node index
    const nodes = [
      [x2, y],
      [x, y],
      [x, y2],
      [x2, y2],
    ];
    //test all nodes for line intersections
    for (let i = 0; i < nodes.length; i++) {
      if (
        Line.intersectRect(
          this.x1,
          this.y1,
          this.x2,
          this.y2,
          nodes[i][0],
          nodes[i][1],
          nodes[i][0] + w2,
          nodes[i][1] + h2
        )
      ) {
        indexes.push(i);
      }
    }
    return indexes;
  }

  static intersectRect(x1, y1, x2, y2, minX, minY, maxX, maxY) {
    // Completely outside
    if (
      (x1 <= minX && x2 <= minX) ||
      (y1 <= minY && y2 <= minY) ||
      (x1 >= maxX && x2 >= maxX) ||
      (y1 >= maxY && y2 >= maxY)
    )
      return false;
    // Single point inside
    if (
      (x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY) ||
      (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY)
    )
      return true;
    const m = (y2 - y1) / (x2 - x1);
    let y = m * (minX - x1) + y1;
    if (y > minY && y < maxY) return true;
    y = m * (maxX - x1) + y1;
    if (y > minY && y < maxY) return true;
    let x = (minY - y1) / m + x1;
    if (x > minX && x < maxX) return true;
    x = (maxY - y1) / m + x1;
    if (x > minX && x < maxX) return true;
    return false;
  }

  // prettier-ignore
  intersect(other) {
    if (other instanceof Rectangle) {
      return CollideUtils.lineRect(this.x1, this.y1, this.x2, this.y2, other.x, other.y, other.w, other.h);
    }
    if (other instanceof Circle) {
      return CollideUtils.lineCircle(this.x1, this.y1, this.x2, this.y2, other.x, other.y, other.r);
    }
    if (other instanceof Line) {
      return CollideUtils.lineLine(this.x1, this.y1, this.x2, this.y2, other.x1, other.y1, other.x2, other.y2);
    }
  }
}

export { Circle, Line, Quadtree, Rectangle };
