import { uuidv4 } from '../../utils.js';

export default class GameObject {
  toRemove = false;
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
  draw() {
    // default draw
    push();
    fill(255);
    translate(this.position.x, this.position.y);
    ellipse(0, 0, this.collisionRadius * 2);
    pop();
  }

  isCollidingWith(other) {
    return this.position.dist(other.position) <= this.collisionRadius + other.collisionRadius;
  }
  onCollision(other, isTerrain = false) {
    // TODO: verify if this is needed
  }

  setTeamId(teamId) {
    // TODO: remove visioin from old team
    // TODO: add vision to new team
    this.teamId = teamId;
  }

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

  teleportTo(x, y) {
    // TODO: get closest terrain exit
    this.position.x = x;
    this.position.y = y;
  }
}
