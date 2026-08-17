import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Slow from '../buffs/Slow';
import Shield from '../buffs/Shield';
import { PredefinedFilters } from '../../managers/ObjectManager';
import { Circle, Rectangle } from '../../../libs/quadtree';
import Champion from '../attackableUnits/Champion';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem';

export const JARVAN_W_BASE_SHIELD = 50;
export const JARVAN_W_SHIELD_PER_CHAMPION = 15;
export const JARVAN_W_SHIELD_MS = 4000;
export const JARVAN_W_SLOW_PERCENT = 0.25;
export const JARVAN_W_SLOW_MS = 2000;

export default class JarvanIV_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_jarvaniv_w');
  name = 'Hoàng Kim Giáp (JarvanIV_W)';
  description =
    'Tạo lá chắn bảo vệ bản thân và <span class="buff">Làm Chậm 25%</span> kẻ địch xung quanh trong <span class="time">2 giây</span>. Lớp giáp tăng thêm dựa trên số lượng tướng địch xung quanh.';
  coolDown = 10000;
  manaCost = 30;
  range = 300;

  onSpellCast() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: this.range }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    let enemyChampCount = 0;
    for (const enemy of enemies) {
      if (enemy instanceof Champion) enemyChampCount++;
      const slow = new Slow(JARVAN_W_SLOW_MS, this.owner, enemy);
      slow.percent = JARVAN_W_SLOW_PERCENT;
      enemy.addBuff(slow);
    }

    const shieldAmount = JARVAN_W_BASE_SHIELD + enemyChampCount * JARVAN_W_SHIELD_PER_CHAMPION;
    const shield = new Shield(JARVAN_W_SHIELD_MS, this.owner, this.owner);
    shield.amount = shieldAmount;
    this.owner.addBuff(shield);

    // Golden Aegis expanding wave VFX
    const wave = new JarvanIV_W_WaveObject(this.owner, this.range);
    wave.position = this.owner.position.copy();
    // the aegis stands on him for as long as the shield does, so the buff is
    // something you can see on his body and not only in the buff bar
    wave.aegisDuration = JARVAN_W_SHIELD_MS;
    wave.attachTo(this.owner, shield);
    this.game.objectManager.addObject(wave);
  }
}

/**
 * Golden Aegis — the banner slamming down, and the plates it leaves standing.
 *
 * The wave alone was the whole effect before, which meant the spell was over
 * visually in 450ms while its shield had another three and a half seconds to
 * run. The plates now ride his body for the shield's real duration: whether
 * Jarvan is still armoured is the question the enemy is actually asking.
 */
export class JarvanIV_W_WaveObject extends SpellObject {
  maxRadius: number;
  lifeTime = 520;
  timer = 0;
  /** How long the shield plates stay up on him after the wave has passed. */
  aegisDuration = JARVAN_W_SHIELD_MS;

  particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#ffd700');

  constructor(owner: any, maxRadius: number) {
    super(owner);
    this.maxRadius = maxRadius;
  }

  onAdded() {
    super.onAdded();
    this.useParticles(this.particleSystem);
  }

  update() {
    // the plates belong to the shield: they go when it does
    if (this.dropIfAttachmentLost()) return;

    this.timer += deltaTime;
    if (this.timer <= this.lifeTime) {
      const r = (this.timer / this.lifeTime) * this.maxRadius;
      if (frameCount % 3 === 0) {
        const angle = random(TWO_PI);
        this.particleSystem.addParticle({
          x: this.owner.position.x + cos(angle) * r,
          y: this.owner.position.y + sin(angle) * r,
          r: random(6, 12),
        });
      }
    }

    if (this.timer >= this.aegisDuration) {
      this.toRemove = true;
    }
  }

  draw() {
    push();
    translate(this.owner.position.x, this.owner.position.y);

    // THE WAVE — one pass out to the slow radius
    if (this.timer <= this.lifeTime) {
      const progress = constrain(this.timer / this.lifeTime, 0, 1);
      // ease-out so it leaves fast and settles at the rim
      const eased = 1 - (1 - progress) * (1 - progress);
      const r = eased * this.maxRadius;
      const alpha = (1 - progress) * 220;

      noFill();
      stroke(255, 215, 0, alpha);
      strokeWeight(7);
      circle(0, 0, r * 2);
      stroke(255, 255, 200, alpha * 0.7);
      strokeWeight(3);
      circle(0, 0, r * 0.85 * 2);

      // banner chevrons riding the wave outward — Demacian, not a plain ring
      stroke(255, 235, 150, alpha * 0.9);
      strokeWeight(3);
      for (let i = 0; i < 12; i++) {
        const a = (TWO_PI / 12) * i;
        push();
        rotate(a);
        translate(r, 0);
        line(-10, -9, 2, 0);
        line(-10, 9, 2, 0);
        pop();
      }
    }

    // THE AEGIS — golden plates standing around him while the shield holds
    const aegisLeft = constrain(1 - this.timer / this.aegisDuration, 0, 1);
    if (aegisLeft > 0) {
      const bodyR = (this.owner.stats?.size?.value ?? 30) * 0.85 + 8;
      // fades out over the last half second rather than blinking off
      const near = constrain((this.aegisDuration - this.timer) / 500, 0, 1);
      const plateAlpha = 200 * near;

      push();
      rotate(frameCount * 0.012);
      for (let i = 0; i < 6; i++) {
        push();
        rotate((TWO_PI / 6) * i);
        translate(bodyR, 0);
        // each plate is a kite shield, tilted outward
        stroke(190, 140, 30, plateAlpha);
        strokeWeight(2);
        fill(255, 205, 60, plateAlpha * 0.45);
        beginShape();
        vertex(0, -11);
        vertex(7, -7);
        vertex(7, 6);
        vertex(0, 13);
        vertex(-7, 6);
        vertex(-7, -7);
        endShape(CLOSE);
        pop();
      }
      pop();

      // the ring binding the plates together, brighter the more shield is left
      noFill();
      stroke(255, 225, 120, plateAlpha * 0.8);
      strokeWeight(2);
      circle(0, 0, bodyR * 2 + 6);
      // and how much of the duration remains, as an arc
      stroke(255, 250, 210, plateAlpha);
      strokeWeight(3);
      arc(0, 0, bodyR * 2 + 16, bodyR * 2 + 16, -HALF_PI, -HALF_PI + TWO_PI * aegisLeft);
    }
    pop();
  }

  getDisplayBoundingBox() {
    const r = this.maxRadius + 30;
    const x = this.owner?.position?.x ?? this.position.x;
    const y = this.owner?.position?.y ?? this.position.y;
    return new Rectangle({ x: x - r, y: y - r, w: r * 2, h: r * 2, data: this });
  }
}
