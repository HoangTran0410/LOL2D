import ASSETS from '../../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Stun from '../buffs/Stun.js';

export default class Ashe_R extends Spell {
  image = ASSETS.Spells.ashe_r;
  name = 'Đại Băng Tiễn (Ashe_R)';
  description =
    'Bắn mũi tên băng bay xuyên bản đồ, làm choáng diện rộng những kẻ địch trúng chiêu trong 2.5s và gây 30 sát thương.';
  coolDown = 10000;

  onSpellCast() {
    let mouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let direction = p5.Vector.sub(mouse, this.owner.position).normalize();

    let obj = new Ashe_R_Object(this.owner);
    obj.position = this.owner.position.copy();
    obj.direction = direction;
    obj.speed = 10;

    this.game.objects.push(obj);
  }
}

export class Ashe_R_Object extends SpellObject {
  isMissile = true;
  position = createVector();
  direction = createVector();
  speed = 10;
  size = 35;
  lifeTime = 10000;
  age = 0;

  exploreSize = 250;
  exploring = false;
  exploreLifeTime = 1000;

  update() {
    this.age += deltaTime;
    if (this.age > this.lifeTime) {
      this.toRemove = true;
    }

    // moving
    if (!this.exploring) {
      this.position.add(this.direction.copy().mult(this.speed));

      // check collide enemy
      for (let enemy of this.game.players) {
        if (
          enemy != this.owner &&
          !enemy.isDead &&
          p5.Vector.dist(this.position, enemy.position) < enemy.stats.size.value / 2
        ) {
          this.exploring = true;
          this.age = this.lifeTime - this.exploreLifeTime; // reset age to display explore animation

          //   add buff to enemies
          this.game.players
            .filter(
              p =>
                p != this.owner &&
                p5.Vector.dist(this.position, p.position) <
                  this.exploreSize / 2 + enemy.stats.size.value / 2
            )
            .forEach(p => {
              let stunBuff = new Stun(2500, this.owner, p);
              stunBuff.buffAddType = BuffAddType.RENEW_EXISTING;
              stunBuff.image = ASSETS.Spells.ashe_r;
              p.addBuff(stunBuff);
              p.takeDamage(30, this.owner);
            });
        }
      }
    } else {
      this.size = lerp(this.size, this.exploreSize, 0.2);
    }
  }

  draw() {
    push();

    // expore
    if (this.exploring) {
      let alpha = Math.min(this.lifeTime - this.age, 150);

      stroke(200, alpha);
      fill(100, 100, 200, alpha);
      circle(this.position.x, this.position.y, this.size);

      fill(200, alpha + 50);
      for (let i = 0; i < 5; i++) {
        let randPos = p5.Vector.random2D().mult(random(this.size / 2));
        circle(this.position.x + randPos.x, this.position.y + randPos.y, random(10, 20));
      }
    }

    // moving
    else {
      translate(this.position.x, this.position.y);
      rotate(this.direction.heading());

      stroke(random(100, 255));
      fill(50, 50, 200);
      rect(-60, -10, 30, 20);
      triangle(
        this.randSize(),
        0,
        -this.randSize(),
        -this.randSize() / 2,
        -this.randSize(),
        this.randSize() / 2
      );
    }
    pop();
  }

  randSize() {
    return random(this.size / 1.5, this.size * 1.5);
  }
}