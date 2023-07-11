import GameObject from '../GameObject.js';

export default class AttackableUnit extends GameObject {
  constructor({
    game,
    position = createVector(),
    collisionRadius = 25,
    visionRadius = 0,
    teamId = uuidv4(),
    id = uuidv4(),
  }) {
    super({ game, position, collisionRadius, visionRadius, teamId, id });
  }
}
