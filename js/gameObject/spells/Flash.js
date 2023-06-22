import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class Flash extends Spell {
  image = ASSETS.Spells.flash;
  description = 'Tốc biến 1 tới vị trí con trỏ, tối đa 180px khoảng cách';
  coolDown = 1;

  onSpellCast() {
    let maxDistance = 180;

    let target = this.game.camera.screenToWorld(mouseX, mouseY);
    let direction = p5.Vector.sub(target, this.owner.position);
    let distance = direction.mag();
    let distToMove = Math.min(distance, maxDistance);

    let oldPos = this.owner.position.copy();
    this.owner.position.add(direction.setMag(distToMove));
    this.owner.destination = this.owner.position.copy();

    // add smoke effect
    let flashObject = new Flash_Object(this.owner);
    this.game.objects.push(flashObject);

    let flashObject2 = new Flash_Object(this.owner);
    flashObject2.position = oldPos;
    this.game.objects.push(flashObject2);
  }
}

export class Flash_Object extends SpellObject {
  init() {
    this.position = this.owner.position.copy();

    this.smokes = [];
    let size = this.owner.stats.size.value / 2;
    for (let i = 0; i < 10; i++) {
      this.smokes.push({
        x: random(-size, size),
        y: random(-size, size),
        size: random(10, 20),
        opacity: random(100, 200),
      });
    }
  }

  update() {
    for (let s of this.smokes) {
      s.x += random(-1, 1);
      s.y += random(-1, 1);
      s.opacity -= 2;
      s.size += 0.1;
    }

    for (let i = this.smokes.length - 1; i >= 0; i--) {
      if (this.smokes[i].opacity <= 0) {
        this.smokes.splice(i, 1);
      }
    }

    if (this.smokes.length == 0) {
      this.toRemove = true;
    }
  }

  draw() {
    push();

    noStroke();
    for (let s of this.smokes) {
      fill(255, 255, 0, s.opacity);
      circle(this.position.x + s.x, this.position.y + s.y, s.size);
    }

    pop();
  }
}
