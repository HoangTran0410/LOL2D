import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Dash from '../buffs/Dash';
import Slow from '../buffs/Slow';
import StatAmp from '../buffs/StatAmp';
import { createReveal } from '../buffs/TrueSight';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

export const XINZHAO_E_RANGE = 420;
export const XINZHAO_E_DAMAGE = 22;
export const XINZHAO_E_SPLASH_RADIUS = 160;
export const XINZHAO_E_SLOW_PERCENT = 0.3;
export const XINZHAO_E_SLOW_MS = 900;
export const XINZHAO_E_ATTACK_SPEED_BONUS = 0.4;
export const XINZHAO_E_ATTACK_SPEED_MS = 4_000;
export const XINZHAO_E_DASH_SPEED = 17;
/** How long the charge marks its victim. Crescent Guard reads this mark. */
export const XINZHAO_E_CHALLENGE_MS = 5_000;
/**
 * The mark's own buff slot. Required rather than defaulted: four other spells
 * apply `TrueSight` and `addBuff` groups by `stackId`, so sharing the class's
 * default would let any of them cut this one short.
 */
export const XINZHAO_E_CHALLENGE_STACK_ID = 'xinzhao-challenge';

/** Whether `source` has this target marked by Audacious Charge right now. */
export function isChallengedBy(target: AttackableUnit, source: AttackableUnit): boolean {
  return target.buffs.some(
    buff =>
      buff.stackId === XINZHAO_E_CHALLENGE_STACK_ID && buff.sourceUnit === source && !buff.toRemove
  );
}

export default class XinZhao_E extends Spell {
  // Picks its own victim rather than taking `context.target`; see the
  // "auto-locking spells" section of docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_xinzhao_e');
  name = 'Can Trường (XinZhao_E)';
  description =
    'Lao tới kẻ địch gần con trỏ, gây <span class="damage">22 sát thương</span> cho mục tiêu và kẻ địch xung quanh, ' +
    '<span class="buff">làm chậm 30%</span> và <span class="buff">đánh dấu</span> mục tiêu trong <span class="time">5 giây</span>. ' +
    'Sau đó Xin Zhao nhận <span class="buff">40% tốc đánh</span> trong <span class="time">4 giây</span>.';
  coolDown = 10_000;
  manaCost = 50;
  range = XINZHAO_E_RANGE;

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner) && !!this.findVictim();
  }

  onSpellCast(): void {
    const victim = this.findVictim();
    if (!victim) return;

    // The mark goes on at the launch, not the landing: it is what makes the
    // charge a commitment the target can see coming.
    victim.addBuff(
      createReveal({
        stackId: XINZHAO_E_CHALLENGE_STACK_ID,
        durationMs: XINZHAO_E_CHALLENGE_MS,
        source: this.owner,
        target: victim,
        image: this.image,
      })
    );

    const dx = victim.position.x - this.owner.position.x;
    const dy = victim.position.y - this.owner.position.y;
    const distance = Math.hypot(dx, dy) || 1;
    // stop at contact rather than inside him: two bodies cannot occupy one spot,
    // and a dash that aims at the centre spends its last frames being pushed out
    const contact = (this.owner.collisionRadius ?? 0) + (victim.collisionRadius ?? 0);
    const travel = Math.max(0, distance - contact);

    const charge = new Dash(1_200, this.owner, this.owner);
    charge.image = this.image;
    charge.dashSpeed = XINZHAO_E_DASH_SPEED;
    charge.dashDestination = createVector(
      this.owner.position.x + (dx / distance) * travel,
      this.owner.position.y + (dy / distance) * travel
    );

    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      this.impact(victim);
    };
    charge.onReachedDestination = land;
    // A charge that is knocked out of the air still connected with whatever it
    // reached; the alternative is a spell that silently costs mana and does
    // nothing every time the target has a friend with a stun.
    charge.onCancelled = land;
    this.owner.addBuff(charge);
  }

  private impact(victim: AttackableUnit): void {
    const centre = victim.isDead ? this.owner.position : victim.position;
    const burst = new XinZhao_E_Object(this.owner, createVector(centre.x, centre.y));
    this.game.objectManager.addObject(burst);

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: centre.x, y: centre.y, r: XINZHAO_E_SPLASH_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    // The mark's victim is hit even if it walked out of the blast: the charge
    // does not miss the unit it chose.
    const hit = new Set<AttackableUnit>(enemies);
    if (!victim.isDead) hit.add(victim);

    for (const enemy of hit) {
      enemy.takeDamage(XINZHAO_E_DAMAGE, this.owner);
      const slow = new Slow(XINZHAO_E_SLOW_MS, this.owner, enemy);
      slow.percent = XINZHAO_E_SLOW_PERCENT;
      enemy.addBuff(slow);
    }

    const frenzy = new StatAmp(XINZHAO_E_ATTACK_SPEED_MS, this.owner, this.owner);
    frenzy.stackId = 'xinzhao-charge-frenzy';
    frenzy.name = 'Can Trường';
    frenzy.image = this.image;
    frenzy.bonuses = { attackSpeed: { percentBaseBonus: XINZHAO_E_ATTACK_SPEED_BONUS } };
    this.owner.addBuff(frenzy);
  }

  /** Nearest enemy to the cursor inside the charge's reach, and only ones he can see. */
  findVictim(): AttackableUnit | null {
    const aim = this.aimPoint;
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(XINZHAO_E_RANGE, this.owner),
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        // Acquisition, so it is gated on vision: without this the charge finds
        // bodies through walls and inside bushes. See target-vision-seam.test.ts.
        PredefinedFilters.visibleTo(this.owner),
      ],
    }) as AttackableUnit[];

    let best: AttackableUnit | null = null;
    let nearestDistance = Infinity;
    for (const candidate of candidates) {
      const distance = Math.hypot(candidate.position.x - aim.x, candidate.position.y - aim.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(XINZHAO_E_RANGE, this.owner));
  }
}

/**
 * The landing: a ring on the exact splash radius plus the spear-plant shock.
 *
 * Its own object rather than caster VFX because it paints 160px past his body,
 * and `Champion.draw` is skipped the moment he is culled or fogged.
 */
export class XinZhao_E_Object extends SpellObject {
  // Ground art: the ring is scoured into the floor, so it paints *under* the
  // bodies standing in it. A SpellObject subclass otherwise falls through to
  // DEFAULT_Z_INDEX (99) and covers everyone's feet — see Nocturne's Dusk Trail.
  zIndex = 2;
  age = 0;
  lifeTime = 420;
  /** Spoke angles, seeded once — rolling them per frame flickers instead of animating. */
  private spokes: number[] = [];

  particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#9fd7ff', 0.5);

  constructor(owner: AttackableUnit, centre: p5.Vector) {
    super(owner);
    this.position = centre.copy();
  }

  onAdded(): void {
    this.useParticles(this.particleSystem);
    for (let i = 0; i < 8; i++) this.spokes.push(random(-0.3, 0.3));
    // the shock happens on landing, which is now
    for (let i = 0; i < 12; i++) {
      const angle = (TWO_PI / 12) * i;
      this.particleSystem.addParticle({
        x: this.position.x + cos(angle) * 24,
        y: this.position.y + sin(angle) * 24,
        r: random(5, 12),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    // ease-out so the ring snaps to its true radius and then holds
    const eased = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    // hard rim on the real splash radius: the hitbox is stated, not implied
    noFill();
    stroke(150, 215, 255, 230 * fade);
    strokeWeight(4 * fade + 1);
    circle(0, 0, XINZHAO_E_SPLASH_RADIUS * 2 * eased);
    stroke(220, 245, 255, 180 * fade);
    strokeWeight(2);
    circle(0, 0, XINZHAO_E_SPLASH_RADIUS * 1.5 * eased);

    // spokes thrown outward by the spear plant
    stroke(190, 230, 255, 200 * fade);
    strokeWeight(3);
    for (let i = 0; i < this.spokes.length; i++) {
      const angle = (TWO_PI / this.spokes.length) * i + this.spokes[i];
      const inner = XINZHAO_E_SPLASH_RADIUS * 0.35 * eased;
      const outer = XINZHAO_E_SPLASH_RADIUS * (0.6 + 0.4 * eased);
      line(cos(angle) * inner, sin(angle) * inner, cos(angle) * outer, sin(angle) * outer);
    }

    // the first fifth is a white flash, gone before the ring finishes
    if (t < 0.2) {
      noStroke();
      fill(255, 255, 255, 200 * (1 - t / 0.2));
      circle(0, 0, XINZHAO_E_SPLASH_RADIUS * 0.9);
    }
    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    const r = XINZHAO_E_SPLASH_RADIUS + 40;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
