import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CancelReason, CastContext, CastSpec } from '../../spell/runtime/types';
import Spell from '../Spell';
import type SpellObject from '../SpellObject';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import AreaSpellObject from '../spellObjects/AreaSpellObject';
import Slow from '../buffs/Slow';
import Stasis from '../buffs/Stasis';
import { Circle } from '../../../libs/quadtree';

const GROWTH_MS = 1_500;
const DAMAGE_TICK_MS = 500;
const UPKEEP_TICK_MS = 1_000;
const UPKEEP_COST = 35;
const SLOW_TICK_MS = 250;
// Restored from the spell's original tuning (306a1d4). A later refactor onto
// AreaSpellObject pushed these to 200/400, which made the storm cover an eighth
// of the map and dwarf every other area spell.
const START_RADIUS = 70;
const END_RADIUS = 190;
const TETHER_RANGE = 450;
const NORMAL_DAMAGE = 4;
const EMPOWERED_DAMAGE = 12;
const NORMAL_SLOW = 0.2;
const EMPOWERED_SLOW = 0.3;
const SNOW_COUNT = 14;
const stormRadiusAt = (elapsedMs: number): number =>
  Math.round(START_RADIUS + Math.min(1, elapsedMs / GROWTH_MS) * (END_RADIUS - START_RADIUS));

type StormTarget = AttackableUnit;

export default class Anivia_R extends Spell {
  image = AssetManager.get('spell_anivia_r');
  name = 'Bão Tuyết (Anivia_R)';
  description =
    'Tạo một cơn bão tuyết có thể bật/tắt tại vị trí chỉ định. Bão lớn dần trong <span class="time">1.5 giây</span>, gây <span class="damage">4 sát thương mỗi 0.5 giây</span> và làm chậm kẻ địch trong vùng.';
  coolDown = 4_000;
  manaCost = 60;
  range = TETHER_RANGE;
  activeStorm?: Anivia_R_Object;
  private upkeepElapsedMs = 0;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'TOGGLE',
      targeting: 'POINT',
      active: {},
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      interrupts: { move: false, displacement: false },
    };
  }

  onActivate(context: CastContext): void {
    const center = this.pointInRange(context.cursorWorld);
    const storm = new Anivia_R_Object(this.owner, center);
    this.activeStorm = storm;
    this.upkeepElapsedMs = 0;
    storm.activate();
    this.game.objectManager.addObject(storm);
  }

  onRecast(): void {
    this.finishActive(true);
  }

  onCancel(_context: CastContext, reason: CancelReason): void {
    this.finishActive(reason !== 'SCENE_EXIT');
  }

  onComplete(): void {
    this.finishActive(false);
  }

  onUpdate(): void {
    if (this.state !== 'ACTIVE' || !this.activeStorm) return;
    if (this.owner.isDead) {
      this.cancel('DEATH');
      return;
    }
    if (!this.owner.canCast && !this.owner.hasBuff?.(Stasis)) {
      this.cancel('SILENCE');
      return;
    }
    if (this.distanceToStorm() > TETHER_RANGE) {
      this.cancel('OUT_OF_RANGE');
      return;
    }

    this.upkeepElapsedMs += Math.max(0, deltaTime);
    while (this.upkeepElapsedMs >= UPKEEP_TICK_MS) {
      if (this.owner.stats.mana.value < UPKEEP_COST) {
        this.cancel('OUT_OF_RESOURCE');
        return;
      }
      this.owner.stats.mana.baseValue -= UPKEEP_COST;
      this.upkeepElapsedMs -= UPKEEP_TICK_MS;
    }
  }

  deactivate(): void {
    this.finishActive(false);
    super.deactivate();
  }

  onRemoved(): void {
    this.finishActive(false);
    super.onRemoved();
  }

  drawPreview(): void {
    super.drawPreview(this.range);
  }

  protected ignoresOwnerInterrupts(): boolean {
    return Boolean(this.owner.hasBuff?.(Stasis));
  }

  private pointInRange(point: { x: number; y: number }): { x: number; y: number } {
    const dx = point.x - this.owner.position.x;
    const dy = point.y - this.owner.position.y;
    const distance = Math.hypot(dx, dy);
    const ratio = distance > this.range ? this.range / distance : 1;
    return { x: this.owner.position.x + dx * ratio, y: this.owner.position.y + dy * ratio };
  }

  private distanceToStorm(): number {
    return Math.hypot(
      this.owner.position.x - this.activeStorm!.center.x,
      this.owner.position.y - this.activeStorm!.center.y
    );
  }

  private finishActive(finalTick: boolean): void {
    const storm = this.activeStorm;
    if (!storm) return;
    if (finalTick) storm.applyFinalTick();
    storm.toRemove = true;
    this.activeStorm = undefined;
  }
}

export class Anivia_R_Object extends AreaSpellObject {
  private nextDamageAtMs = DAMAGE_TICK_MS;
  private nextSlowAtMs = DAMAGE_TICK_MS;

  constructor(owner: SpellObject['owner'], center: { x: number; y: number }) {
    super(owner, center, START_RADIUS, {
      candidates: () =>
        this.game.objectManager.queryObjects({
          area: new Circle({ x: center.x, y: center.y, r: END_RADIUS }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(owner.teamId)],
        }),
      radiusAt: stormRadiusAt,
    });
  }

  activate(): void {
    this.refreshMembers(START_RADIUS);
    this.applyDamage(0, this.members);
    this.applySlow(0, this.members);
  }

  update(deltaMs = deltaTime): void {
    const previousElapsedMs = this.elapsedMs;
    super.update(deltaMs);
    const elapsedMs = this.elapsedMs;
    while (this.nextDamageAtMs <= elapsedMs) {
      if (this.nextDamageAtMs > previousElapsedMs) {
        this.applyDamage(
          this.nextDamageAtMs,
          this.targetsAt(this.stormRadiusAtMs(this.nextDamageAtMs))
        );
      }
      this.nextDamageAtMs += DAMAGE_TICK_MS;
    }
    while (this.nextSlowAtMs <= elapsedMs) {
      if (this.nextSlowAtMs > previousElapsedMs) {
        this.applySlow(this.nextSlowAtMs, this.targetsAt(this.stormRadiusAtMs(this.nextSlowAtMs)));
      }
      this.nextSlowAtMs += this.nextSlowAtMs >= GROWTH_MS ? SLOW_TICK_MS : DAMAGE_TICK_MS;
    }
  }

  applyFinalTick(): void {
    this.refreshMembers(this.radius);
    this.applyDamage(this.elapsedMs, this.members);
  }

  draw(): void {
    const pulse = 0.65 + 0.35 * sin(this.elapsedMs / 180);
    const swirl = this.elapsedMs / 900;

    push();
    translate(this.center.x, this.center.y);

    noStroke();
    fill(120, 185, 235, 55);
    circle(0, 0, this.radius * 2);
    fill(190, 230, 255, 40);
    circle(0, 0, this.radius * 1.15);

    noFill();
    stroke(25, 70, 115, 200);
    strokeWeight(6);
    circle(0, 0, this.radius * 2);
    stroke(225, 248, 255, 185 + 70 * pulse);
    strokeWeight(2.5);
    circle(0, 0, this.radius * 2);

    // three spiral arms turning around the eye of the storm
    stroke(255, 170);
    strokeWeight(2);
    for (let arm = 0; arm < 3; arm++) {
      const offset = swirl + (arm / 3) * TWO_PI;
      beginShape();
      for (let t = 0; t <= 1.001; t += 0.1) {
        const r = this.radius * (0.15 + t * 0.85);
        const a = offset + t * 2.4;
        vertex(cos(a) * r, sin(a) * r);
      }
      endShape();
    }

    // Snow riding the storm. Placed off elapsedMs rather than random() so the
    // flecks actually drift instead of flickering to new spots every frame.
    noStroke();
    fill(255, 200);
    for (let i = 0; i < SNOW_COUNT; i++) {
      const seed = i * 2.399_963;
      const spin = swirl * (0.6 + (i % 4) * 0.22) + seed;
      const r = this.radius * (0.18 + ((i * 0.137 + this.elapsedMs / 4_200) % 1) * 0.8);
      circle(cos(spin) * r, sin(spin) * r, 2 + (i % 3));
    }

    pop();
  }

  private stormRadiusAtMs(atMs: number): number {
    return stormRadiusAt(atMs);
  }

  private targetsAt(radius: number): StormTarget[] {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.center.x, y: this.center.y, r: radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    return candidates.filter(target =>
      Math.hypot(target.position.x - this.center.x, target.position.y - this.center.y) <=
        radius + target.collisionRadius
    );
  }

  private refreshMembers(radius: number): void {
    this.members.clear();
    for (const target of this.targetsAt(radius)) this.members.add(target);
  }

  private applySlow(atMs: number, targets: Iterable<StormTarget>): void {
    const empowered = atMs >= GROWTH_MS;
    for (const target of targets) {
      const slow = new Slow(empowered ? 1_500 : 1_000, this.owner, target);
      slow.percent = empowered ? EMPOWERED_SLOW : NORMAL_SLOW;
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.image = AssetManager.get('spell_anivia_r');
      target.addBuff(slow);
    }
  }

  private applyDamage(atMs: number, targets: Iterable<StormTarget>): void {
    const damage = atMs >= GROWTH_MS ? EMPOWERED_DAMAGE : NORMAL_DAMAGE / 2;
    for (const target of targets) target.takeDamage(damage, this.owner);
  }
}
