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
  timeSinceCloneCreated = 0;
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
    clone.championOwner = this.owner;
    clone.maxRange = this.maxRange;
    clone.teamId = this.owner.teamId;
    this.game.addPlayer(clone);

    this.clonePlayer = clone;
    this.currentCooldown = 0;
    this.timeSinceCloneCreated = 0;
    this.image = AssetManager.getAsset('spell_shaco_r2');
  }

  onUpdate() {
    if (this.clonePlayer) {
      this.timeSinceCloneCreated += deltaTime;

      // move clone to owner position if too far away
      if (this.clonePlayer.position.dist(this.owner.position) > this.maxRange) {
        this.clonePlayer.position.set(this.owner.position.x, this.owner.position.y);
      }

      // explode if clone is dead or time is up
      if (this.timeSinceCloneCreated >= this.cloneLifeTime || this.clonePlayer.isDead) {
        let explodeRadius = 100;
        let clonePos = this.clonePlayer.position.copy();

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
          let p = this.clonePlayer.position.copy();
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
          excludePlayers: [this.owner, this.clonePlayer],
        });

        enemies.forEach(e => {
          let fearBuff = new Fear(1000, this.owner, e);
          fearBuff.sourcePosition = clonePos;
          e.addBuff(fearBuff);
          e.takeDamage(30, this.owner);
        });

        // create 3 shaco W objects, place around dead clone
        for (let i = 0; i < 3; i++) {
          let obj = new Shaco_W_Object(this.owner);
          obj.lifeTime = 3000;
          obj.position = this.clonePlayer.position.copy();
          obj.destination = this.clonePlayer.position.copy().add(
            Math.cos((i * 2 * Math.PI) / 3) * 100, // 100 is the radius
            Math.sin((i * 2 * Math.PI) / 3) * 100
          );
          this.game.addSpellObject(obj);
        }

        this.clonePlayer.toRemove = true;
        this.clonePlayer = null;
        this.image = AssetManager.getAsset('spell_shaco_r');
        this.currentCooldown = this.coolDown;
      }
    }
  }
}

class Shaco_R_Clone extends Champion {
  championOwner = null;
  maxRange = 1000;

  draw() {
    super.draw();

    // draw circle if clone too far away from owner
    if (this.championOwner != this.game.player) return;
    let distance = this.position.dist(this.championOwner.position);
    if (distance > this.maxRange / 2) {
      let alpha = map(distance, this.maxRange / 2, this.maxRange, 0, 255);
      noFill();
      stroke(255, alpha);
      circle(this.position.x, this.position.y, this.maxRange * 2);
    }
  }
}
