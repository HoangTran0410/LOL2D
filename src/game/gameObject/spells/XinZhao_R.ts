import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import StatusFlags from '../../enums/StatusFlags';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastSpec } from '../../spell/runtime/types';
import CastTelegraph from '../../vfx/CastTelegraph';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Dash from '../buffs/Dash';
import Shield from '../buffs/Shield';
import Stun from '../buffs/Stun';
import { pointInWall } from '../map/DynamicTerrain';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import { isChallengedBy } from './XinZhao_E';

export const XINZHAO_R_RADIUS = 300;
export const XINZHAO_R_DAMAGE = 50;
export const XINZHAO_R_KNOCKBACK_DISTANCE = 220;
export const XINZHAO_R_KNOCKBACK_MS = 500;
export const XINZHAO_R_STUN_MS = 600;
/** The "guard" half of Crescent Guard, as a shield rather than conditional immunity. */
export const XINZHAO_R_SHIELD = 30;
export const XINZHAO_R_SHIELD_MS = 3_000;
/** The wind-up. He plants and turns before the spear comes round. */
export const XINZHAO_R_CAST_MS = 300;

/**
 * The shove itself.
 *
 * A `Dash` on the victim rather than a teleport, exactly as Janna's Monsoon
 * does it, so the displacement is animated, is interrupted by nothing (it is
 * not the victim's own movement) and puts them down where it says it will.
 */
class XinZhao_R_Knockback extends Dash {
  statusFlagsToEnable = StatusFlags.Immovable;

  onActivate(): void {
    this.targetUnit.markDisplaced?.();
    this.targetUnit.stopMovement?.();
  }

  onDeactivate(): void {
    if (!this.dashDestination) return;
    this.targetUnit.position.set(this.dashDestination.x, this.dashDestination.y);
    this.targetUnit.destination?.set(this.dashDestination.x, this.dashDestination.y);
  }
}

export default class XinZhao_R extends Spell {
  image = AssetManager.get('spell_xinzhao_r');
  name = 'Bán Nguyệt Thương (XinZhao_R)';
  description =
    'Quét thương quanh mình gây <span class="damage">50 sát thương</span> cho mọi kẻ địch trong <span>300px</span>, ' +
    '<span class="buff">hất văng và choáng</span> những kẻ chưa bị <span class="buff">đánh dấu</span> bởi Can Trường. ' +
    'Xin Zhao nhận <span class="buff">30 giáp ảo</span> trong <span class="time">3 giây</span>.';
  // Ten seconds, like every other ultimate here: this game's cooldown ceiling is
  // arcade-short on purpose and `tests/game/spells/cooldowns.test.ts` holds it.
  coolDown = 10_000;
  manaCost = 100;
  range = XINZHAO_R_RADIUS;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      // A 300ms plant: an ultimate that shoves half a teamfight has to be
      // something the people standing in it can start walking out of.
      castTimeMs: XINZHAO_R_CAST_MS,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
      vfx: {
        castStart: context =>
          new CastTelegraph(context, XINZHAO_R_RADIUS, undefined, () => this.owner.position),
      },
    };
  }

  onSpellCast(): void {
    const origin = createVector(this.owner.position.x, this.owner.position.y);
    this.game.objectManager.addObject(new XinZhao_R_Object(this.owner, origin));

    const guard = new Shield(XINZHAO_R_SHIELD_MS, this.owner, this.owner);
    guard.stackId = 'xinzhao-crescent-guard';
    guard.name = 'Bán Nguyệt Thương';
    guard.image = this.image;
    guard.amount = XINZHAO_R_SHIELD;
    guard.color = [255, 214, 130];
    this.owner.addBuff(guard);

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: origin.x, y: origin.y, r: XINZHAO_R_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const enemy of enemies) {
      enemy.takeDamage(XINZHAO_R_DAMAGE, this.owner);
      // The mark is the whole decision in the kit: whoever he charged stays in
      // the pit with him, everyone else is thrown out of it.
      if (isChallengedBy(enemy, this.owner)) continue;
      this.knockBack(enemy, origin);
    }
  }

  private knockBack(target: AttackableUnit, origin: p5.Vector): void {
    const dx = target.position.x - origin.x;
    const dy = target.position.y - origin.y;
    const distance = Math.hypot(dx, dy);
    const directionX = distance === 0 ? 1 : dx / distance;
    const directionY = distance === 0 ? 0 : dy / distance;
    const carry = this.clearDistance(target, directionX, directionY);

    const knockback = new XinZhao_R_Knockback(XINZHAO_R_KNOCKBACK_MS, this.owner, target);
    knockback.image = this.image;
    knockback.dashDestination = createVector(
      target.position.x + directionX * carry,
      target.position.y + directionY * carry
    );
    knockback.dashSpeed = Math.max(1, carry / (XINZHAO_R_KNOCKBACK_MS / (1000 / 60)));
    knockback.showTrail = false;
    // Its own stun would otherwise cancel it: `Stun` is in DASH_INTERRUPT_BUFFS.
    knockback.cancelable = false;
    knockback.stayAtDestination = false;
    target.addBuff(knockback);
    target.addBuff(new Stun(XINZHAO_R_STUN_MS, this.owner, target));
  }

  /**
   * How far the shove can actually carry before it would put someone inside a
   * wall — the map's own walls *and* the ones spells are holding up, which is
   * why this asks `pointInWall` rather than `terrainMap` (see DynamicTerrain).
   */
  private clearDistance(target: AttackableUnit, directionX: number, directionY: number): number {
    const step = 20;
    let carried = 0;
    for (let travelled = step; travelled <= XINZHAO_R_KNOCKBACK_DISTANCE; travelled += step) {
      const x = target.position.x + directionX * travelled;
      const y = target.position.y + directionY * travelled;
      if (pointInWall(this.game, x, y)) break;
      carried = travelled;
    }
    return carried;
  }
}

/**
 * The sweep: a crescent that travels all the way round him, then the shock ring
 * on the true radius.
 *
 * Earth-and-steel, deliberately unlike Janna's wind or Jarvan's crags — a hard
 * gold arc with dust kicked off the ground it scours.
 */
export class XinZhao_R_Object extends SpellObject {
  // Ground art — the scoured disc covers 300px of floor, so it goes under the
  // units standing on it rather than over their feet (DEFAULT_Z_INDEX is 99).
  zIndex = 2;
  origin: p5.Vector;
  age = 0;
  lifeTime = 620;
  /** Dust angles, seeded once in `onAdded`. */
  private dust: number[] = [];

  particleSystem = PredefinedParticleSystems.smoke([210, 180, 130], 0.35, 5);

  constructor(owner: AttackableUnit, origin: p5.Vector) {
    super(owner);
    this.origin = origin.copy();
    this.position = origin.copy();
  }

  onAdded(): void {
    this.useParticles(this.particleSystem);
    for (let i = 0; i < 16; i++) this.dust.push(random(-0.2, 0.2));
    // the spear is already scouring the ground, so the dust goes up now
    for (let i = 0; i < 16; i++) {
      const angle = (TWO_PI / 16) * i + this.dust[i];
      const r = XINZHAO_R_RADIUS * 0.75;
      this.particleSystem.addParticle({
        x: this.origin.x + cos(angle) * r,
        y: this.origin.y + sin(angle) * r,
        size: random(14, 30),
        opacity: 190,
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    // the crescent completes its circuit in the first 45% of the life
    const sweep = constrain(this.age / (this.lifeTime * 0.45), 0, 1);
    const eased = 1 - (1 - sweep) * (1 - sweep);

    push();
    translate(this.origin.x, this.origin.y);

    // scoured ground: a filled disc that drains away
    noStroke();
    fill(190, 150, 90, 55 * fade);
    circle(0, 0, XINZHAO_R_RADIUS * 2 * eased);

    // the crescent itself, a thick gold arc chasing its own tail
    noFill();
    stroke(255, 214, 120, 240 * fade);
    strokeWeight(10 * fade + 3);
    const head = -HALF_PI + TWO_PI * eased;
    arc(
      0,
      0,
      XINZHAO_R_RADIUS * 1.7,
      XINZHAO_R_RADIUS * 1.7,
      head - Math.min(TWO_PI * eased, 1.5),
      head
    );
    // leading edge: the tip of the spear, brightest thing on screen
    stroke(255, 250, 220, 250 * fade);
    strokeWeight(5);
    const tipR = XINZHAO_R_RADIUS * 0.85;
    line(cos(head) * tipR * 0.55, sin(head) * tipR * 0.55, cos(head) * tipR, sin(head) * tipR);

    // hard rim on the real radius, so nobody has to guess where the shove ends
    stroke(255, 236, 180, 220 * fade);
    strokeWeight(3);
    circle(0, 0, XINZHAO_R_RADIUS * 2 * eased);

    // outward chevrons: the knockback made legible rather than implied
    stroke(255, 200, 120, 190 * fade);
    strokeWeight(3);
    for (let i = 0; i < this.dust.length; i++) {
      const angle = (TWO_PI / this.dust.length) * i + this.dust[i];
      const inner = XINZHAO_R_RADIUS * (0.55 + 0.35 * t);
      const outer = inner + 34 * t;
      line(cos(angle) * inner, sin(angle) * inner, cos(angle) * outer, sin(angle) * outer);
    }
    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    const r = XINZHAO_R_RADIUS + XINZHAO_R_KNOCKBACK_DISTANCE;
    return new Rectangle({
      x: this.origin.x - r,
      y: this.origin.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
