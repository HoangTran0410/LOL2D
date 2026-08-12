import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import CastTelegraph from '../../vfx/CastTelegraph';
import Spell from '../Spell';
import Dash from '../buffs/Dash';
import AreaSpellObject, { type AreaTarget } from '../spellObjects/AreaSpellObject';

interface JannaTarget extends AreaTarget {
  readonly teamId: string;
  readonly isDead: boolean;
  addBuff(buff: unknown): void;
  takeHeal(amount: number, healer: unknown): void;
}

export default class Janna_R extends Spell {
  image = AssetManager.getAsset('spell_janna_r');
  name = 'Gió Mùa (Janna_R)';
  description =
    'Đẩy lùi kẻ địch gần đó, rồi vận sức tối đa <span class="time">3 giây</span>, hồi <span class="damage">2 máu mỗi 0.25 giây</span> cho bản thân và đồng minh trong vùng';
  coolDown = 10_000;
  manaCost = 100;

  private readonly radius = 700;
  private readonly channelDurationMs = 3_000;
  private readonly tickEveryMs = 250;
  private readonly healPerTick = 2;
  private readonly knockbackDistance = 875;
  private readonly knockbackDurationMs = 500;
  private activeArea?: AreaSpellObject<JannaTarget>;

  protected get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      channel: { durationMs: this.channelDurationMs, tickEveryMs: this.tickEveryMs },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      vfx: { channelLoop: context => new CastTelegraph(context, this.radius) },
    };
  }

  onSpellCast(context: CastContext): void {
    this.knockEnemies(context);
    this.activeArea = new AreaSpellObject<JannaTarget>(this.owner, context.origin, this.radius, {
      durationMs: this.channelDurationMs,
      tickEveryMs: this.tickEveryMs,
      candidateFilter: target =>
        !target.isDead && target.teamId === this.owner.teamId && typeof target.takeHeal === 'function',
      onTick: target => target.takeHeal(this.healPerTick, this.owner),
    });
    this.game.objectManager.addObject(this.activeArea);
  }

  onCancel(): void {
    this.stopArea();
  }

  onComplete(): void {
    this.stopArea();
  }

  private knockEnemies(context: CastContext): void {
    const targets = this.game.objectManager.queryObjects({
      area: new Circle({ x: context.origin.x, y: context.origin.y, r: this.radius }),
    }) as unknown as JannaTarget[];

    for (const target of targets) {
      if (target.isDead || target.teamId === this.owner.teamId || typeof target.addBuff !== 'function') {
        continue;
      }

      const dx = target.position.x - context.origin.x;
      const dy = target.position.y - context.origin.y;
      const distance = Math.hypot(dx, dy);
      if (distance > this.radius) continue;

      const directionX = distance === 0 ? 1 : dx / distance;
      const directionY = distance === 0 ? 0 : dy / distance;
      const displacement = this.knockbackDistance - distance;
      const knockback = new Dash(this.knockbackDurationMs, this.owner, target);
      knockback.image = this.image;
      knockback.dashDestination = createVector(
        context.origin.x + directionX * this.knockbackDistance,
        context.origin.y + directionY * this.knockbackDistance
      );
      knockback.dashSpeed = displacement / (this.knockbackDurationMs / (1000 / 60));
      knockback.showTrail = false;
      knockback.cancelable = false;
      target.addBuff(knockback);
    }
  }

  private stopArea(): void {
    if (!this.activeArea) return;
    this.activeArea.toRemove = true;
    this.activeArea = undefined;
  }
}
