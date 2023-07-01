import ASSETS from '../../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import { hasFlag } from '../../../utils/index.js';
import Buff from '../Buff.js';
import Airborne from './Airborne.js';
import Root from './Root.js';
import Silence from './Silence.js';

// Lướt
export default class Dash extends Buff {
  image = ASSETS.Buffs.root;
  name = 'Lướt';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;

  // for update
  trailsDelayFrame = 0;
  showTrail = true;
  trails = [];
  dashSpeed = 6;
  dashDestination = null;
  cancelable = true;

  static CanDash(targetUnit) {
    return hasFlag(targetUnit.status, StatusFlags.CanMove);
  }

  onUpdate() {
    if (this.toRemove) return;

    // apply ghosted every frame
    this.targetUnit.status |= StatusFlags.Ghosted;

    // apply dash
    if (this.dashDestination) {
      let dir = this.dashDestination.copy().sub(this.targetUnit.position);
      this.targetUnit.position.add(dir.setMag(this.dashSpeed));

      if (this.targetUnit.position.dist(this.dashDestination) < this.dashSpeed) {
        this.onReachedDestination?.();
        this.dashDestination = null;
        this.deactivateBuff();
      }
    }

    // cancel if target unit is have other buffs
    if (
      this.cancelable &&
      this.targetUnit.buffs.find(
        buff =>
          buff !== this &&
          buff.sourceUnit !== this.sourceUnit && // cancel if target unit is have other buffs from other source unit
          (buff instanceof Airborne || // cancel if target unit is airborne
            buff instanceof Root || // cancel if target unit is rooted
            buff instanceof Silence) // cancel if target unit is silenced
      )
    ) {
      this.deactivateBuff();
    }

    // update trails
    if (this.trailsDelayFrame == 0) {
      this.trails.push(this.targetUnit.position.copy());
      if (this.trails.length > 20) this.trails.shift();
    }
    this.trailsDelayFrame++;
    if (this.trailsDelayFrame >= 5) this.trailsDelayFrame = 0;
  }

  onReachedDestination() {}

  onDeactivate() {
    this.targetUnit.status &= ~StatusFlags.Ghosted;
  }

  draw() {
    if (!this.showTrail) return;
    push();
    // draw trails
    stroke(255, 100);
    strokeWeight(this.targetUnit.stats.size.value);
    noFill();

    beginShape();
    this.trails.forEach(trail => {
      vertex(trail.x, trail.y);
    });
    endShape();
    pop();
  }
}
