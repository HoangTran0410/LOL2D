import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import EventType from '../../enums/EventType';
import StatusFlags from '../../enums/StatusFlags';
import TerrainType from '../../enums/TerrainType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import CastTelegraph from '../../vfx/CastTelegraph';
import CastBar, { unitCastBarAnchor } from '../../vfx/CastBar';
import VfxGroup from '../../vfx/VfxGroup';
import Spell from '../Spell';
import Dash from '../buffs/Dash';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import AreaSpellObject from '../spellObjects/AreaSpellObject';
import Ghost from './Ghost';
import Heal from './Heal';
import Ignite from './Ignite';
import { notifyJannaControlLanded } from './Janna_E';

// Exported so the suite asserts the knockback and channel-tick wiring, not a
// copy of the numbers — retuning a value should not mean editing the test.
export const CHANNEL_DURATION_MS = 3_000;
export const TICK_EVERY_MS = 250;
export const HEAL_PER_TICK = 2;
export const KNOCKBACK_DISTANCE = 875;
export const KNOCKBACK_DURATION_MS = 500;
export const MANA_COST = 100;
export const RADIUS = 700;

type JannaTarget = AttackableUnit;

interface Wall {
  readonly vertices: readonly { x: number; y: number }[];
}

class Janna_R_Knockback extends Dash {
  statusFlagsToEnable = StatusFlags.Immovable | StatusFlags.Silenced;

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

export default class Janna_R extends Spell {
  image = AssetManager.get('spell_janna_r');
  name = 'Gió Mùa (Janna_R)';
  description =
    'Đẩy lùi kẻ địch gần đó, rồi vận sức tối đa <span class="time">3 giây</span>, hồi <span class="damage">2 máu mỗi 0.25 giây</span> cho bản thân và đồng minh trong vùng';
  coolDown = 10_000;
  manaCost = MANA_COST;

  private readonly radius = RADIUS;
  private readonly channelDurationMs = CHANNEL_DURATION_MS;
  private readonly tickEveryMs = TICK_EVERY_MS;
  private readonly healPerTick = HEAL_PER_TICK;
  private readonly knockbackDistance = KNOCKBACK_DISTANCE;
  private readonly knockbackDurationMs = KNOCKBACK_DURATION_MS;
  private activeArea?: Janna_R_Object;
  private channelOrigin?: { x: number; y: number };
  private stopWatching: (() => void)[] = [];
  private channelElapsedMs = 0;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      channel: { durationMs: this.channelDurationMs, tickEveryMs: this.tickEveryMs },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      vfx: {
        channelLoop: context => new VfxGroup([
          new CastTelegraph(context, this.radius, undefined, () => this.owner.position),
          new CastBar(context, () => this.channelElapsedMs / this.channelDurationMs, undefined, () => unitCastBarAnchor(this.owner)),
        ]),
      },
    };
  }

  onSpellCast(context: CastContext): void {
    this.channelElapsedMs = 0;
    this.owner.stopMovement?.();
    this.channelOrigin = context.origin;
    this.watchInterrupts();
    this.knockEnemies(context);
    this.activeArea = new Janna_R_Object(this.owner, context.origin, this.radius, {
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
      filters: [PredefinedFilters.type(AttackableUnit)],
    });

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

  onUpdate(): void {
    if (this.state === 'CHANNELING') this.channelElapsedMs += deltaTime;
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
      filters: [PredefinedFilters.type(AttackableUnit)],
    });

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

      notifyJannaControlLanded(this.owner, target);
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

// AreaSpellObject on its own inherits GameObject's no-op draw() — it only
// tracks membership/ticks. Every other area effect (see Anivia_R_Object)
// subclasses it to actually paint something; Monsoon previously did not,
// which is why the ultimate fired, knocked back, and healed with nothing
// drawn on screen. This subclass is that missing visual.
export class Janna_R_Object extends AreaSpellObject {
  draw(): void {
    const radius = this.radius;
    const t = this.elapsedMs;
    const spin = t / 700;
    const pulse = 0.6 + 0.4 * sin(t / 220);

    push();
    translate(this.center.x, this.center.y);

    // Atmospheric wash filling the whole vortex out to its real radius.
    noStroke();
    fill(220, 245, 250, 30);
    circle(0, 0, radius * 2);
    fill(190, 230, 245, 26);
    circle(0, 0, radius * 1.3);

    // Boundary ring, breathing with the channel.
    noFill();
    stroke(230, 250, 255, 90 + 55 * pulse);
    strokeWeight(5);
    circle(0, 0, radius * 2);
    stroke(255, 255, 255, 150);
    strokeWeight(2);
    circle(0, 0, radius * 2);

    // Four curling arms sweeping toward the eye, echoing the pull-then-fling
    // shape of the knockback.
    stroke(210, 240, 250, 150);
    strokeWeight(3);
    const ARM_COUNT = 4;
    for (let arm = 0; arm < ARM_COUNT; arm++) {
      const offset = spin + (arm / ARM_COUNT) * TWO_PI;
      beginShape();
      for (let s = 0; s <= 1.001; s += 0.1) {
        const r = radius * (0.1 + s * 0.9);
        const a = offset - s * 2.4;
        vertex(cos(a) * r, sin(a) * r);
      }
      endShape();
    }

    // Concentric gusts racing from the eye to the edge, looping — the
    // knockback's outward push made legible instead of implied.
    const GUST_COUNT = 3;
    const gustLoopMs = 900;
    noFill();
    for (let i = 0; i < GUST_COUNT; i++) {
      const phase = ((t + (i * gustLoopMs) / GUST_COUNT) % gustLoopMs) / gustLoopMs;
      stroke(255, 255, 255, 200 * (1 - phase));
      strokeWeight(2 + 3 * (1 - phase));
      circle(0, 0, radius * 2 * phase);
    }

    // Leaves and dust riding the gusts outward. Keyed off elapsedMs (never
    // random()) so every fleck drifts continuously instead of popping to a
    // new spot each frame.
    noStroke();
    fill(255, 255, 255, 210);
    const FLECK_COUNT = 20;
    for (let i = 0; i < FLECK_COUNT; i++) {
      const seed = i * 2.399_963;
      const loopMs = 1_600 + (i % 5) * 140;
      const phase = ((t + seed * 240) % loopMs) / loopMs;
      const r = radius * (0.08 + phase * 0.92);
      const a = spin * (0.6 + (i % 4) * 0.18) + seed;
      circle(cos(a) * r, sin(a) * r, 2 + (i % 3));
    }

    // Heal pulse over every ally the monsoon is currently ticking.
    noFill();
    for (const member of this.members) {
      const localX = member.position.x - this.center.x;
      const localY = member.position.y - this.center.y;
      const healPulse = 0.5 + 0.5 * sin(t / 160 + member.collisionRadius);
      stroke(150, 255, 190, 120 + 100 * healPulse);
      strokeWeight(2.5);
      circle(localX, localY, member.collisionRadius * 2 + 14 + 8 * healPulse);
      stroke(215, 255, 220, 70 + 70 * healPulse);
      strokeWeight(1.2);
      circle(localX, localY, member.collisionRadius * 2 + 24 + 12 * healPulse);
    }

    pop();
  }
}
