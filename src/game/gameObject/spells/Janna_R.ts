import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import EventType from '../../enums/EventType';
import StatusFlags from '../../enums/StatusFlags';
import TerrainType from '../../enums/TerrainType';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import CastTelegraph from '../../vfx/CastTelegraph';
import Spell from '../Spell';
import Dash from '../buffs/Dash';
import AreaSpellObject, { type AreaTarget } from '../spellObjects/AreaSpellObject';
import Ghost from './Ghost';
import Heal from './Heal';
import Ignite from './Ignite';

interface JannaTarget extends AreaTarget {
  readonly teamId: string;
  readonly isDead: boolean;
  addBuff(buff: unknown): void;
  takeHeal(amount: number, healer: unknown): void;
}

interface Wall {
  readonly vertices: readonly { x: number; y: number }[];
}

class Janna_R_Knockback extends Dash {
  statusFlagsToEnable = StatusFlags.Immovable | StatusFlags.Silenced;

  onActivate(): void {
    this.targetUnit.stopMovement?.();
  }

  onDeactivate(): void {
    if (!this.dashDestination) return;
    this.targetUnit.position.set(this.dashDestination.x, this.dashDestination.y);
    this.targetUnit.destination?.set(this.dashDestination.x, this.dashDestination.y);
  }
}

export default class Janna_R extends Spell {
  image = AssetManager.getAsset('spell_janna_r');
  name = 'Gió Mùa (Janna_R)';
  description =
    'Đẩy lùi kẻ địch gần đó, rồi vận sức tối đa <span class="time">3 giây</span>, hồi <span class="damage">2 máu mỗi 0.25 giây</span> cho bản thân và đồng minh trong vùng';
  coolDown = 130_000;
  manaCost = 100;

  private readonly radius = 700;
  private readonly channelDurationMs = 3_000;
  private readonly tickEveryMs = 250;
  private readonly healPerTick = 2;
  private readonly knockbackDistance = 875;
  private readonly knockbackDurationMs = 500;
  private activeArea?: AreaSpellObject<JannaTarget>;
  private channelOrigin?: { x: number; y: number };
  private stopWatching: (() => void)[] = [];

  get castSpec(): Readonly<CastSpec> {
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
    this.owner.stopMovement?.();
    this.channelOrigin = context.origin;
    this.watchInterrupts();
    this.knockEnemies(context);
    this.activeArea = new AreaSpellObject<JannaTarget>(this.owner, context.origin, this.radius, {
      durationMs: this.channelDurationMs,
      candidateFilter: target =>
        !target.isDead && target.teamId === this.owner.teamId && typeof target.takeHeal === 'function',
    });
    this.game.objectManager.addObject(this.activeArea);
  }

  onChannelTick(): void {
    if (!this.channelOrigin) return;
    const targets = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.channelOrigin.x, y: this.channelOrigin.y, r: this.radius }),
    }) as unknown as JannaTarget[];

    for (const target of targets) {
      if (
        target.isDead ||
        target.teamId !== this.owner.teamId ||
        typeof target.takeHeal !== 'function' ||
        Math.hypot(
          target.position.x - this.channelOrigin.x,
          target.position.y - this.channelOrigin.y
        ) > this.radius + target.collisionRadius
      ) {
        continue;
      }
      target.takeHeal(this.healPerTick, this.owner);
    }
  }

  onCancel(): void {
    this.finishChannel();
  }

  onComplete(): void {
    this.finishChannel();
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
      const desiredDestination = {
        x: context.origin.x + directionX * this.knockbackDistance,
        y: context.origin.y + directionY * this.knockbackDistance,
      };
      const destination = this.clampKnockbackDestination(target, desiredDestination);
      const displacement = Math.hypot(
        destination.x - target.position.x,
        destination.y - target.position.y
      );
      const knockback = new Janna_R_Knockback(this.knockbackDurationMs, this.owner, target);
      knockback.image = this.image;
      knockback.dashDestination = createVector(destination.x, destination.y);
      knockback.dashSpeed = displacement / (this.knockbackDurationMs / (1000 / 60));
      knockback.showTrail = false;
      knockback.cancelable = false;
      knockback.stayAtDestination = false;
      target.addBuff(knockback);
    }
  }

  private watchInterrupts(): void {
    this.stopWatching.forEach(stop => stop());
    this.stopWatching = [
      this.game.eventManager.on(EventType.ON_POST_CAST_SPELL, (spell: Spell) => {
        if (
          spell !== this &&
          spell.owner === this.owner &&
          !this.isPermittedDuringChannel(spell)
        ) {
          this.cancel('PLAYER_CANCEL');
        }
      }),
      this.game.eventManager.on(EventType.ON_ATTACK, (attacker: unknown) => {
        if (attacker === this.owner) this.cancel('PLAYER_CANCEL');
      }),
    ];
  }

  private isPermittedDuringChannel(spell: Spell): boolean {
    return spell instanceof Ghost || spell instanceof Heal || spell instanceof Ignite;
  }

  private finishChannel(): void {
    if (this.activeArea) this.activeArea.toRemove = true;
    this.activeArea = undefined;
    this.channelOrigin = undefined;
    this.stopWatching.forEach(stop => stop());
    this.stopWatching = [];
  }

  private clampKnockbackDestination(
    target: JannaTarget,
    desired: { x: number; y: number }
  ): { x: number; y: number } {
    const start = target.position;
    const padding = target.collisionRadius;
    const walls = (this.game.terrainMap?.getObstaclesInArea?.(
      new Rectangle({
        x: Math.min(start.x, desired.x) - padding,
        y: Math.min(start.y, desired.y) - padding,
        w: Math.abs(desired.x - start.x) + padding * 2,
        h: Math.abs(desired.y - start.y) + padding * 2,
      }),
      [TerrainType.WALL]
    ) ?? []) as Wall[];

    let nearestRatio = 1;
    for (const wall of walls) {
      for (let index = 0; index < wall.vertices.length; index++) {
        const ratio = this.intersectionRatio(
          start,
          desired,
          wall.vertices[index],
          wall.vertices[(index + 1) % wall.vertices.length]
        );
        if (ratio !== undefined) nearestRatio = Math.min(nearestRatio, ratio);
      }
    }

    if (nearestRatio === 1) return desired;
    const dx = desired.x - start.x;
    const dy = desired.y - start.y;
    const length = Math.hypot(dx, dy);
    const allowedDistance = Math.max(0, length * nearestRatio - padding);
    return {
      x: start.x + (dx / length) * allowedDistance,
      y: start.y + (dy / length) * allowedDistance,
    };
  }

  private intersectionRatio(
    start: { x: number; y: number },
    end: { x: number; y: number },
    edgeStart: { x: number; y: number },
    edgeEnd: { x: number; y: number }
  ): number | undefined {
    const rayX = end.x - start.x;
    const rayY = end.y - start.y;
    const edgeX = edgeEnd.x - edgeStart.x;
    const edgeY = edgeEnd.y - edgeStart.y;
    const denominator = rayX * edgeY - rayY * edgeX;
    if (denominator === 0) return undefined;

    const offsetX = edgeStart.x - start.x;
    const offsetY = edgeStart.y - start.y;
    const rayRatio = (offsetX * edgeY - offsetY * edgeX) / denominator;
    const edgeRatio = (offsetX * rayY - offsetY * rayX) / denominator;
    return rayRatio >= 0 && rayRatio <= 1 && edgeRatio >= 0 && edgeRatio <= 1
      ? rayRatio
      : undefined;
  }
}
