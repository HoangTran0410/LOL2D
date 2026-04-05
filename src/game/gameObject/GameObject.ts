import { Circle, Line, Rectangle } from '../../libs/quadtree';
import { uuidv4 } from '../../utils/index';

export default class GameObject {
  toRemove = false;
  willDraw = true;

  game: any;
  position: p5.Vector;
  collisionRadius: number;
  visionRadius: number;
  teamId: string;
  id: string;
  direction: p5.Vector;

  constructor({
    game,
    position,
    collisionRadius = 25,
    visionRadius = 0,
    teamId = uuidv4(),
    id = uuidv4(),
  }: {
    game?: any;
    position?: p5.Vector;
    collisionRadius?: number;
    visionRadius?: number;
    teamId?: string;
    id?: string;
  }) {
    this.game = game;
    this.position = position ?? createVector();
    this.collisionRadius = collisionRadius;
    this.visionRadius = visionRadius;
    this.teamId = teamId;
    this.id = id;
    this.direction = createVector(0, 0);
  }

  onAdded() {}
  onRemoved() {}

  update() {}
  draw() {}

  setTeamId(teamId: string) {
    this.teamId = teamId;
  }

  teleportTo(x: number, y: number) {
    this.position.set(x, y);
  }

  getCollideBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.collisionRadius,
      y: this.position.y - this.collisionRadius,
      w: this.collisionRadius * 2,
      h: this.collisionRadius * 2,
      data: this,
    });
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.visionRadius,
      y: this.position.y - this.visionRadius,
      w: this.visionRadius * 2,
      h: this.visionRadius * 2,
      data: this,
    });
  }

  drawBoundingBox(collide = false) {
    let bb = collide ? this.getCollideBoundingBox() : this.getDisplayBoundingBox();
    if (!bb) return;
    push();
    stroke(255, 255, 0, 200);
    strokeWeight(2);
    noFill();
    if (bb instanceof Rectangle) {
      rect(bb.x, bb.y, bb.w, bb.h);
    }
    if (bb instanceof Circle) {
      ellipse(bb.x, bb.y, bb.r * 2, bb.r * 2);
    }
    if (bb instanceof Line) {
      line(bb.x1, bb.y1, bb.x2, bb.y2);
    }
    pop();
  }
}
