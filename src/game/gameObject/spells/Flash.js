import SOUNDS, { playSound } from '../../../../assets/sounds/index.js';
import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import ParticleSystem from '../helpers/ParticleSystem.js';

export default class Flash extends Spell {
  name = 'Tốc Biến (Flash)';
  image = AssetManager.getAsset('spell_flash');
  description = 'Tốc biến 1 tới vị trí con trỏ, tối đa 180px khoảng cách';
  coolDown = 3000;
  manaCost = 100;

  onSpellCast() {
    let maxDistance = 180;

    let target = this.game.worldMouse.copy();
    let direction = p5.Vector.sub(target, this.owner.position);
    let distance = direction.mag();
    let distToMove = Math.min(distance, maxDistance);

    let oldPos = this.owner.position.copy();
    this.owner.position.add(direction.setMag(distToMove));
    this.owner.moveTo(this.owner.position.x, this.owner.position.y);

    // add smoke effect
    let newPosEffect = new Flash_Object(this.owner);
    this.game.addSpellObject(newPosEffect);

    let oldPosEffect = new Flash_Object(this.owner);
    oldPosEffect.position = oldPos;
    this.game.addSpellObject(oldPosEffect);

    playSound(SOUNDS.flash);

    // test different effect
    // let flashObject = new Flash_Object2(this.owner);
    // flashObject.position = oldPos;
    // this.game.addSpellObject(flashObject);
  }
}

export class Flash_Object extends SpellObject {
  particleSystem = new ParticleSystem({
    isDeadFn: p => p.opacity <= 0,
    updateFn: p => {
      p.x += random(-2, 2);
      p.y += random(-2, 2);
      p.size += 0.1;
      p.opacity -= 2;
    },
    drawFn: p => {
      noStroke();
      fill(255, 255, 100, p.opacity);
      circle(this.position.x + p.x, this.position.y + p.y, p.size);
    },
  });

  constructor(owner) {
    super(owner);
    this.position = this.owner.position.copy();

    let size = this.owner.stats.size.value / 2;
    for (let i = 0; i < 10; i++) {
      this.particleSystem.addParticle({
        x: random(-size, size),
        y: random(-size, size),
        size: random(10, 20),
        opacity: random(100, 200),
      });
    }
  }

  update() {
    this.particleSystem.update();
    this.toRemove = this.particleSystem.toRemove;
  }

  draw() {
    this.particleSystem.draw();
  }
}

export class Flash_Object2 extends SpellObject {
  opacity = 255;
  position = this.owner.position.copy();

  update() {
    this.opacity -= 3;

    if (this.opacity <= 0) {
      this.toRemove = true;
    }
  }

  draw() {
    // draw a circle have size = owner size
    push();
    stroke(255, 0, 0, this.opacity + random(100));
    fill(100, 100, 100, this.opacity + random(-30, 30));
    circle(this.position.x, this.position.y, this.owner.stats.size.value + 3);
    pop();
  }
}
