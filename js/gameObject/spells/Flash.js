import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';

export default class Flash extends Spell {
  image = ASSETS.Spells.flash;
  description = 'Tốc biến 1 tới vị trí con trỏ, tối đa 200px khoảng cách';
  coolDown = 5000;

  onSpellCast() {
    let maxDistance = 100;

    let target = this.game.camera.screenToWorld(mouseX, mouseY);
    let direction = p5.Vector.sub(target, this.owner.position);
    let distance = direction.mag();
    let distToMove = Math.min(distance, maxDistance);

    this.owner.position.add(direction.setMag(distToMove));
    this.owner.destination = this.owner.position.copy();
  }
}
