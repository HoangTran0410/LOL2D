import { uuidv4 } from '../../utils/index.js';
import TeamId from '../enums/TeamId.js';

export default class GameObject {
  toRemove = false;
  // willDraw = true;
  // isAffectedByFogOfWar = false;
  // _visibleByTeamIds = new Set();
  // _visibleForPlayers = new Set();
  _body = null;

  constructor({
    game,
    position = createVector(0, 0),
    visionRadius = 0,
    teamId = uuidv4(),
    id = uuidv4(),
  }) {
    this.game = game;

    this.position = position;
    this.visionRadius = visionRadius;
    this.teamId = teamId;
    this.id = id;
  }

  get body() {
    return this._body;
  }

  set body(body) {
    this._body = body;
    this._body.gameObject = this;
  }

  onAdded() {}
  onRemoved() {}

  update(dt) {}
  draw() {}

  isCollidingWith(other) {
    return this.game.objectManager.checkCollision(this, other);
  }
  onCollision(other) {}

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
