import Champion from './Champion.js';

export default class RemoteChampion extends Champion {
  constructor({
    game,
    id,
    position,
    collisionRadius,
    visionRadius,
    teamId,
    stats,
    avatar,
    preset,
  }) {
    super({ game, position, collisionRadius, visionRadius, teamId, stats, avatar, preset });

    // Store the remote player's ID
    this.id = id;

    // Remote champions don't respond to local input
    this.isRemote = true;
  }

  update() {
    // Call the parent update method but skip movement input handling
    super.update();
  }

  // Override movement methods to prevent local control
  moveTo() {
    // Do nothing - movement is controlled by network updates
  }

  moveTowards() {
    // Do nothing - movement is controlled by network updates
  }

  // Override spell casting to be controlled by network updates
  castSpell() {
    // Do nothing - spell casting is controlled by network updates
  }
}
