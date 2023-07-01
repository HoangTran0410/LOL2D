import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import Buff from '../Buff.js';
import { StatsModifier } from '../Stats.js';
import BuffAddType from '../../enums/BuffAddType.js';
import SpellObject from '../SpellObject.js';
import SOUNDS, { playSound } from '../../../sounds/index.js';

export default class Ghost extends Spell {
  name = 'Tốc Hành (Ghost)';
  image = ASSETS.Spells.ghost;
  description = 'Tăng 50% tốc độ di chuyển trong 5s';
  coolDown = 7000;
  manaCost = 100;

  onSpellCast() {
    let ghostBuff = new Ghost_Buff(5000, this.owner, this.owner);
    this.owner.addBuff(ghostBuff);

    let ghostBuffObject = new Ghost_Buff_Object(this.owner);
    this.game.objects.push(ghostBuffObject);

    ghostBuff.addDeactivateListener(() => {
      ghostBuffObject.toRemove = true;
    });

    playSound(SOUNDS.ghost);
  }
}

export class Ghost_Buff extends Buff {
  image = ASSETS.Spells.ghost;
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = 0.5;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}

export class Ghost_Buff_Object extends SpellObject {
  init() {
    this.trail = [];
    this.maxAge = 30;
  }

  update() {
    if (random(1) < 0.2) {
      let ownerDirection = p5.Vector.sub(this.owner.destination, this.owner.position);
      let vel = ownerDirection.normalize().mult(random(-2, -1));

      let size = this.owner.stats.size.value / 2;
      this.trail.push({
        x: this.owner.position.x + random(-size, size),
        y: this.owner.position.y + random(-size, size),
        vx: vel.x,
        vy: vel.y,
        age: 0,
      });
    }

    for (let t of this.trail) {
      t.x += t.vx;
      t.y += t.vy;
      t.age += 1;
    }

    for (let i = this.trail.length - 1; i >= 0; i--) {
      if (this.trail[i].age > this.maxAge) {
        this.trail.splice(i, 1);
      }
    }
  }

  draw() {
    push();
    strokeWeight(3);

    for (let t of this.trail) {
      stroke(255, map(t.age, 0, this.maxAge, 255, 10));
      line(t.x, t.y, t.x + t.vx * 10, t.y + t.vy * 10);
    }
    pop();
  }
}
