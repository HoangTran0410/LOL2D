import { uuidv4 } from '../../utils';

export default class GameObject {
  toRemove = false;

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
    this.isAffectedByFogOfWar = false;

    this.visibleByTeamIds = new Set();
    this.visibleForPlayers = new Set();
  }

  onAdded() {}
  onRemoved() {}

  update() {}
  lateUpdate() {}
  draw() {}

  isCollidingWith(other) {
    return this.position.dist(other.position) <= this.collisionRadius + other.collisionRadius;
  }
  onCollision(other, isTerrain = false) {
    // TODO: verify if this is needed
  }

  setTeamId(teamId) {
    // TODO: remove visioin from old team
    // TODO: add vision to new team
  }

  onEnterVision(playerId, teamId) {}
  isVisibleByTeam(teamId) {
    return !this.isAffectedByFogOfWar || this.visibleByTeamIds.has(teamId);
  }
  setVisibleByTeam(teamId, isVisible) {
    if (isVisible) {
      this.visibleByTeamIds.add(teamId);
    } else {
      this.visibleByTeamIds.delete(teamId);
    }
  }
  isVisibleForPlayer(playerId) {
    return !this.isAffectedByFogOfWar || this.visibleForPlayers.has(playerId);
  }
  setVisibleForPlayer(playerId, isVisible) {
    if (isVisible) {
      this.visibleForPlayers.add(playerId);
    } else {
      this.visibleForPlayers.delete(playerId);
    }
  }

  // Gets a list of all teams that have vision of this object.
  getTeamsHasVisionOnThis() {
    return Array.from(this.visibleByTeamIds);
  }

  teleportTo(x, y) {
    // TODO: get closest terrain exit
    this.position.x = x;
    this.position.y = y;
  }
}
