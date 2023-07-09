import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import Champion from '../attackableUnits/Champion.js';
import Fear from '../buffs/Fear.js';
import ParticleSystem from '../helpers/ParticleSystem.js';
import { Shaco_W_Object } from './Shaco_W.js';

export default class Shaco_R extends Spell {
  image = AssetManager.getAsset('spell_shaco_r');
  name = 'Phân Thân (Shaco_R)';
  description =
    'Tạo ra một phân thân, tồn tại trong 10s, có thể tái kích hoạt để điều khiển phân thân. Khi chết, nó phát nổ, gây 30 sát thương và gây hoảng sợ các kẻ địch gần đó, đồng thời sinh ra ba Hộp Hề Ma Quái nhỏ (tồn tại trong 3s)';
  coolDown = 10000;

  clonePlayer = null;
  cloneLifeTime = 10000;
  maxRange = 1000;

  checkCastCondition() {
    if (this.clonePlayer) {
      // move clone to mouse position
      this.clonePlayer.moveTo(this.game.worldMouse.x, this.game.worldMouse.y);

      return false;
    }

    return true;
  }

  onSpellCast() {
    let clone = new Shaco_R_Clone(this.game, this.owner.position.x, this.owner.position.y);
    clone.avatar = this.owner.avatar;
    clone.spells = [];
    clone.shacoR_championOwner = this.owner;
    clone.shacoR_maxRange = this.maxRange;
    clone.teamId = this.owner.teamId;
    clone.onExplode = () => {
      this.clonePlayer = null;
      this.image = AssetManager.getAsset('spell_shaco_r');
      this.currentCooldown = this.coolDown;
    };
    this.game.addPlayer(clone);

    this.clonePlayer = clone;
    this.currentCooldown = 0;
    this.image = AssetManager.getAsset('spell_shaco_r2');
  }
}

class Shaco_R_Clone extends Champion {
  shacoR_lifeTime = 10000;
  shacoR_age = 0;
  shacoR_championOwner = null;
  shacoR_maxRange = 1000;

  update() {
    super.update();

    // move clone to owner position if too far away
    if (this.position.dist(this.shacoR_championOwner.position) > this.shacoR_maxRange) {
      this.position.set(this.shacoR_championOwner.position.x, this.shacoR_championOwner.position.y);
    }

    this.shacoR_age += deltaTime;
    if (this.shacoR_age >= this.shacoR_lifeTime || this.isDead) {
      this.onExplode?.();
      this.shacoR_explode();
    }
  }

  draw() {
    super.draw();

    // draw circle if clone too far away from owner
    if (this.shacoR_championOwner != this.game.player) return;
    let distance = this.position.dist(this.shacoR_championOwner.position);
    if (distance > this.shacoR_maxRange / 2) {
      let alpha = map(distance, this.shacoR_maxRange / 2, this.shacoR_maxRange, 0, 255);
      noFill();
      stroke(255, alpha);
      circle(this.position.x, this.position.y, this.shacoR_maxRange * 2);
    }
  }

  shacoR_explode() {
    this.toRemove = true;

    let explodeRadius = 100;
    let clonePos = this.position.copy();

    // create explosion
    let explodeEffect = new ParticleSystem({
      isDeadFn: p => p.pos.dist(clonePos) > explodeRadius,
      updateFn: p => {
        p.pos.add(p.vel);
      },
      preDrawFn: () => {
        fill(100, 50);
        stroke(100, 150);
        circle(clonePos.x, clonePos.y, explodeRadius * 2);
      },
      drawFn: p => {
        // draw lazer beam from clone to explosion
        let alpha = map(p.pos.dist(clonePos), 0, explodeRadius, 200, 10);
        stroke(255, 255, 50, alpha);
        strokeWeight(5);
        line(p.pos.x, p.pos.y, p.pos.x - p.vel.x * 5, p.pos.y - p.vel.y * 5);
      },
    });
    for (let i = 0; i < 20; i++) {
      let p = clonePos.copy();
      let v = p5.Vector.random2D().mult(random(1, 3));
      explodeEffect.addParticle({
        pos: p,
        vel: v,
      });
    }
    this.game.addSpellObject(explodeEffect);

    // take damage + fear nearby enemies
    let enemies = this.game.queryPlayersInRange({
      position: clonePos,
      range: explodeRadius,
      includePlayerSize: true,
      excludePlayers: [this.shacoR_championOwner, this],
    });

    enemies.forEach(e => {
      let fearBuff = new Fear(1000, this.shacoR_championOwner, e);
      fearBuff.sourcePosition = clonePos;
      e.addBuff(fearBuff);
      e.takeDamage(30, this.shacoR_championOwner);
    });

    // create 3 shaco W objects, place around dead clone
    for (let i = 0; i < 3; i++) {
      let obj = new Shaco_W_Object(this.shacoR_championOwner);
      obj.lifeTime = 3000;
      obj.position = clonePos.copy();
      obj.destination = clonePos.copy().add(
        Math.cos((i * 2 * Math.PI) / 3) * 100, // 100 is the radius
        Math.sin((i * 2 * Math.PI) / 3) * 100
      );
      this.game.addSpellObject(obj);
    }
  }
}
