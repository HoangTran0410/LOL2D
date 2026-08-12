import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import Spell from '../Spell';
import type SpellObject from '../SpellObject';
import AreaSpellObject, { type AreaTarget } from '../spellObjects/AreaSpellObject';
import Slow from '../buffs/Slow';
import { Circle } from '../../../libs/quadtree';

const GROWTH_MS = 1_500;
const DAMAGE_TICK_MS = 500;
const SLOW_TICK_MS = 250;
const START_RADIUS = 200;
const END_RADIUS = 400;
const TETHER_RANGE = 450;
const NORMAL_DAMAGE = 4;
const EMPOWERED_DAMAGE = 12;
const NORMAL_SLOW = 0.5;
const EMPOWERED_SLOW = 0.75;

interface StormTarget extends AreaTarget {
  addBuff(buff: Slow): void;
  takeDamage(damage: number, source: SpellObject['owner']): void;
}

export default class Anivia_R extends Spell {
  image = AssetManager.getAsset('spell_anivia_r');
  name = 'Bão Tuyết (Anivia_R)';
  description =
    'Tạo một cơn bão tuyết có thể bật/tắt tại vị trí chỉ định. Bão lớn dần trong <span class="time">1.5 giây</span>, gây <span class="damage">4 sát thương mỗi 0.5 giây</span> và làm chậm kẻ địch trong vùng.';
  coolDown = 4_000;
  manaCost = 60;
  range = TETHER_RANGE;
  activeStorm?: Anivia_R_Object;

  protected get castSpec(): CastSpec {
    return {
      activation: 'TOGGLE',
      targeting: 'POINT',
      active: {},
      resource: { commitAt: 'tick', refundOn: [], tickEveryMs: DAMAGE_TICK_MS },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      interrupts: { move: false },
    };
  }

  onActivate(context: CastContext): void {
    const center = this.pointInRange(context.cursorWorld);
    const storm = new Anivia_R_Object(this.owner, center);
    this.activeStorm = storm;
    this.game.objectManager.addObject(storm);
  }

  onRecast(): void {
    this.finishActive(true);
  }

  onCancel(): void {
    this.finishActive(false);
  }

  onComplete(): void {
    this.finishActive(false);
  }

  onUpdate(): void {
    if (this.state !== 'ACTIVE' || !this.activeStorm) return;
    if (!this.owner.canCast) this.cancel('SILENCE');
    else if (this.distanceToStorm() > TETHER_RANGE) this.cancel('OUT_OF_RANGE');
  }

  drawPreview(): void {
    super.drawPreview(this.range);
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

export class Anivia_R_Object extends AreaSpellObject<StormTarget> {
  private nextDamageAtMs = DAMAGE_TICK_MS;
  private nextSlowAtMs = DAMAGE_TICK_MS;

  constructor(owner: SpellObject['owner'], center: { x: number; y: number }) {
    super(owner, center, START_RADIUS, {
      candidates: () =>
        this.game.objectManager.queryObjects({
          area: new Circle({ x: center.x, y: center.y, r: END_RADIUS }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(owner.teamId)],
        }) as unknown as Iterable<StormTarget>,
      radiusAt: elapsedMs =>
        START_RADIUS + Math.min(1, elapsedMs / GROWTH_MS) * (END_RADIUS - START_RADIUS),
    });
  }

  update(deltaMs = deltaTime): void {
    const previousElapsedMs = this.elapsedMs;
    super.update(deltaMs);
    const elapsedMs = this.elapsedMs;
    while (this.nextDamageAtMs <= elapsedMs) {
      if (this.nextDamageAtMs > previousElapsedMs) this.applyDamage(this.nextDamageAtMs);
      this.nextDamageAtMs += DAMAGE_TICK_MS;
    }
    while (this.nextSlowAtMs <= elapsedMs) {
      if (this.nextSlowAtMs > previousElapsedMs) this.applySlow(this.nextSlowAtMs);
      this.nextSlowAtMs += this.nextSlowAtMs >= GROWTH_MS ? SLOW_TICK_MS : DAMAGE_TICK_MS;
    }
  }

  applyFinalTick(): void {
    this.applyDamage(this.elapsedMs);
  }

  draw(): void {
    const pulse = 0.65 + 0.35 * sin(this.elapsedMs / 180);
    push();
    translate(this.center.x, this.center.y);
    noStroke();
    fill(120, 185, 235, 60);
    circle(0, 0, this.radius * 2);
    fill(190, 230, 255, 45);
    circle(0, 0, this.radius * 1.15);
    noFill();
    stroke(25, 70, 115, 200);
    strokeWeight(7);
    circle(0, 0, this.radius * 2);
    stroke(225, 248, 255, 185 + 70 * pulse);
    strokeWeight(3);
    circle(0, 0, this.radius * 2);
    pop();
  }

  private applySlow(atMs: number): void {
    const empowered = atMs > GROWTH_MS;
    for (const target of this.members) {
      const slow = new Slow(empowered ? 1_500 : 1_000, this.owner, target);
      slow.percent = empowered ? EMPOWERED_SLOW : NORMAL_SLOW;
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.image = AssetManager.getAsset('spell_anivia_r');
      target.addBuff(slow);
    }
  }

  private applyDamage(atMs: number): void {
    const damage = atMs > GROWTH_MS ? EMPOWERED_DAMAGE : NORMAL_DAMAGE;
    for (const target of this.members) target.takeDamage(damage, this.owner);
  }
}
