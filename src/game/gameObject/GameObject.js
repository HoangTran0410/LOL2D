import { Rectangle } from '../../../libs/quadtree.js';
import { uuidv4 } from '../../utils/index.js';

export default class GameObject {
  toRemove = false;
  willDraw = true;
  // isAffectedByFogOfWar = false;
  // _visibleByTeamIds = new Set();
  // _visibleForPlayers = new Set();

  constructor({
    game,
    position = createVector(),
    collisionRadius = 25,
    visionRadius = 0,
    teamId = uuidv4(),
    id = uuidv4(),
  }) {
    this.game = game;

    this.position = position;
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

  setTeamId(teamId) {
    // TODO: remove vision from old team
    // TODO: add vision to new team
    this.teamId = teamId;
  }

  teleportTo(x, y) {
    // TODO: get closest terrain exit
    this.position.set(x, y);
  }

  getBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.visionRadius,
      y: this.position.y - this.visionRadius,
      w: this.visionRadius * 2,
      h: this.visionRadius * 2,
      data: this,
    });
  }

  drawBoundingBox() {
    let bb = this.getBoundingBox();
    push();
    stroke(255, 0, 0);
    noFill();
    rect(bb.x, bb.y, bb.w, bb.h);
    pop();
  }

  // isCollidingWith(other) {
  //   return this.position.dist(other.position) <= this.collisionRadius + other.collisionRadius;
  // }
  // onCollision(other, isTerrain = false) {
  //   // TODO: verify if this is needed
  // }

  // onEnterVision(playerId, teamId) {}
  // onLeaveVision(playerId, teamId) {}

  // isVisibleByTeam(teamId) {
  //   return !this.isAffectedByFogOfWar || this._visibleByTeamIds.has(teamId);
  // }
  // setVisibleByTeam(teamId, isVisible) {
  //   if (isVisible) {
  //     this._visibleByTeamIds.add(teamId);
  //   } else {
  //     this._visibleByTeamIds.delete(teamId);
  //   }
  // }
  // isVisibleForPlayer(playerId) {
  //   return !this.isAffectedByFogOfWar || this._visibleForPlayers.has(playerId);
  // }
  // setVisibleForPlayer(playerId, isVisible) {
  //   if (isVisible) {
  //     this._visibleForPlayers.add(playerId);
  //   } else {
  //     this._visibleForPlayers.delete(playerId);
  //   }
  // }

  // isVisibleForOther(other) {
  //   return this.isVisibleByTeam(other.teamId) || this.isVisibleForPlayer(other.id);
  // }

  // Gets a list of all teams that have vision of this object.
  // getTeamsHasVisionOnThis() {
  //   return Array.from(this._visibleByTeamIds);
  // }
}
