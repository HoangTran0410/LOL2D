// https://github.com/timohausmann/quadtree-ts

class Quadtree {
  constructor({ x = 0, y = 0, w, h, maxObjects = 10, maxLevels = 4 } = {}, level = 0) {
    this.bounds = { x, y, w, h };
    this.maxObjects = typeof maxObjects === 'number' ? maxObjects : 10;
    this.maxLevels = typeof maxLevels === 'number' ? maxLevels : 4;
    this.level = level;
    this.objects = [];
    this.nodes = [];
  }

  getIndex(obj) {
    return obj.qtIndex(this.bounds);
  }

  split() {
    const level = this.level + 1,
      width = this.bounds.w / 2,
      height = this.bounds.h / 2,
      x = this.bounds.x,
      y = this.bounds.y;
    const coords = [
      { x: x + width, y: y },
      { x: x, y: y },
      { x: x, y: y + height },
      { x: x + width, y: y + height },
    ];
    for (let i = 0; i < 4; i++) {
      this.nodes[i] = new Quadtree(
        {
          x: coords[i].x,
          y: coords[i].y,
          w: width,
          h: height,
          maxObjects: this.maxObjects,
          maxLevels: this.maxLevels,
        },
        level
      );
    }
  }

  insert(obj) {
    //if we have subnodes, call insert on matching subnodes
    if (this.nodes.length) {
      const indexes = this.getIndex(obj);
      for (let i = 0; i < indexes.length; i++) {
        this.nodes[indexes[i]].insert(obj);
      }
      return;
    }
    //otherwise, store object here
    this.objects.push(obj);
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

  retrieve(obj) {
    const indexes = this.getIndex(obj);
    let returnObjects = this.objects;
    //if we have subnodes, retrieve their objects
    if (this.nodes.length) {
      for (let i = 0; i < indexes.length; i++) {
        returnObjects = returnObjects.concat(this.nodes[indexes[i]].retrieve(obj));
      }
    }
    //remove duplicates
    returnObjects = returnObjects.filter(function (item, index) {
      return returnObjects.indexOf(item) >= index;
    });
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

class Rectangle {
  constructor(props) {
    this.x = props.x;
    this.y = props.y;
    this.w = props.w;
    this.h = props.h;
    this.data = props.data;
  }

  qtIndex(node) {
    const indexes = [],
      boundsCenterX = node.x + node.w / 2,
      boundsCenterY = node.y + node.h / 2;
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
}

class Circle {
  constructor(props) {
    this.x = props.x;
    this.y = props.y;
    this.r = props.r;
    this.data = props.data;
  }

  qtIndex(node) {
    const indexes = [],
      w2 = node.w / 2,
      h2 = node.h / 2,
      x2 = node.x + w2,
      y2 = node.y + h2;
    //an array of node origins where the array index equals the node index
    const nodes = [
      [x2, node.y],
      [node.x, node.y],
      [node.x, y2],
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
}

class Line {
  constructor(props) {
    this.x1 = props.x1;
    this.y1 = props.y1;
    this.x2 = props.x2;
    this.y2 = props.y2;
    this.data = props.data;
  }

  qtIndex(node) {
    const indexes = [],
      w2 = node.w / 2,
      h2 = node.h / 2,
      x2 = node.x + w2,
      y2 = node.y + h2;
    //an array of node origins where the array index equals the node index
    const nodes = [
      [x2, node.y],
      [node.x, node.y],
      [node.x, y2],
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
}

export { Circle, Line, Quadtree, Rectangle };
