import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';
import makeGhost from './Ghost';
import makeHeal from './Heal';
import makeIgnite from './Ignite';
import { makeNotifyJannaControlLanded } from './Janna_E';

type AreaSpellObject = InstanceType<ContentApi['AreaSpellObject']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type CastBar = InstanceType<ContentApi['vfx']['CastBar']>;
type CastTelegraph = InstanceType<ContentApi['vfx']['CastTelegraph']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Spell = InstanceType<ContentApi['Spell']>;
type VfxGroup = InstanceType<ContentApi['vfx']['VfxGroup']>;
type Janna_R = InstanceType<ReturnType<typeof makeJanna_R>>;
type Janna_R_Knockback = InstanceType<ReturnType<typeof makeJanna_R_Knockback>>;
type Janna_R_Object = InstanceType<ReturnType<typeof makeJanna_R_Object>>;
type Ghost = InstanceType<ReturnType<typeof makeGhost>>;
type Heal = InstanceType<ReturnType<typeof makeHeal>>;
type Ignite = InstanceType<ReturnType<typeof makeIgnite>>;



// Exported so the suite asserts the knockback and channel-tick wiring, not a
// copy of the numbers — retuning a value should not mean editing the test.
export const CHANNEL_DURATION_MS = 3_000;

export const TICK_EVERY_MS = 250;

export const HEAL_PER_TICK = 2;

// Both scaled to the ~1600x1600 canvas rather than carried over from the PC
// values: at 700 the vortex covered nearly half the map's width and the 450
// knockback threw a champion most of a lane away. 420/260 keeps Monsoon the
// largest AoE in the game while leaving room to walk out of it.
export const KNOCKBACK_DISTANCE = 260;

export const KNOCKBACK_DURATION_MS = 500;

export const MANA_COST = 100;

export const RADIUS = 420;


type JannaTarget = AttackableUnit;


function __buildJanna_R_Knockback(api: ContentApi) {
  const StatusFlags = api.enums.StatusFlags;
  const Dash = api.buffs.Dash;
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
  return Janna_R_Knockback;
}
const __cacheJanna_R_Knockback = new WeakMap<ContentApi, ReturnType<typeof __buildJanna_R_Knockback>>();
export function makeJanna_R_Knockback(api: ContentApi) {
  const cached = __cacheJanna_R_Knockback.get(api);
  if (cached) return cached;
  const built = __buildJanna_R_Knockback(api);
  __cacheJanna_R_Knockback.set(api, built);
  return built;
}


function __buildJanna_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const EventType = api.enums.EventType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const CastTelegraph = api.vfx.CastTelegraph;
  const CastBar = api.vfx.CastBar;
  const unitCastBarAnchor = api.vfx.unitCastBarAnchor;
  const VfxGroup = api.vfx.VfxGroup;
  const Spell = api.Spell;
  const sweepToWall = api.terrain.sweepToWall;
  const AttackableUnit = api.units.AttackableUnit;
  const Ghost = makeGhost(api);
  const Heal = makeHeal(api);
  const Ignite = makeIgnite(api);
  const notifyJannaControlLanded = makeNotifyJannaControlLanded(api);
  const Janna_R_Knockback = makeJanna_R_Knockback(api);
  const Janna_R_Object = makeJanna_R_Object(api);
  class Janna_R extends Spell {
    image = api.asset('spell_janna_r');
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
          channelLoop: context =>
            new VfxGroup([
              new CastTelegraph(context, this.radius, undefined, () => this.owner.position),
              new CastBar(
                context,
                () => this.channelElapsedMs / this.channelDurationMs,
                undefined,
                () => unitCastBarAnchor(this.owner)
              ),
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
          !target.isDead &&
          target.teamId === this.owner.teamId &&
          typeof target.takeHeal === 'function',
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
          ) >
            this.radius + target.collisionRadius
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
        if (
          target.isDead ||
          target.teamId === this.owner.teamId ||
          typeof target.addBuff !== 'function'
        ) {
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
          if (spell !== this && spell.owner === this.owner && !this.isPermittedDuringChannel(spell)) {
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

    /**
     * As far out as the monsoon can actually carry someone.
     *
     * This used to intersect the knockback line against every edge of every wall
     * outline and take the nearest crossing. Exact where it applies, and it has a
     * hole that a `sweepToWall` does not: intersection only finds a wall the line
     * *crosses*, so a victim who is already inside one — which used to be a state
     * a body could get stuck in permanently, see `map/TerrainField.ts` — has no
     * crossing anywhere along the line, and the monsoon blew them clean through
     * the wall at full distance.
     *
     * Sweeping also asks the question with the victim's body rather than as a
     * bare line, so the padding that used to be subtracted from the answer
     * afterwards is now part of it.
     */
    private clampKnockbackDestination(
      target: JannaTarget,
      desired: { x: number; y: number }
    ): { x: number; y: number } {
      const start = target.position;
      // Walls of both kinds: the monsoon used to blow people straight through an
      // Anivia wall and through Jarvan's arena, because only the map's own
      // polygons were consulted. `sweepToWall` answers for both at once.
      const contact = sweepToWall(
        this.game,
        start.x,
        start.y,
        desired.x,
        desired.y,
        target.collisionRadius
      );
      return contact ? { x: contact.x, y: contact.y } : desired;
    }
  }
  return Janna_R;
}
const __cacheJanna_R = new WeakMap<ContentApi, ReturnType<typeof __buildJanna_R>>();
export default function makeJanna_R(api: ContentApi) {
  const cached = __cacheJanna_R.get(api);
  if (cached) return cached;
  const built = __buildJanna_R(api);
  __cacheJanna_R.set(api, built);
  return built;
}


// AreaSpellObject on its own inherits GameObject's no-op draw() — it only
// tracks membership/ticks. Every other area effect (see Anivia_R_Object)
// subclasses it to actually paint something; Monsoon previously did not,
// which is why the ultimate fired, knocked back, and healed with nothing
// drawn on screen. This subclass is that missing visual.
function __buildJanna_R_Object(api: ContentApi) {
  const AreaSpellObject = api.AreaSpellObject;
  class Janna_R_Object extends AreaSpellObject {
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
  return Janna_R_Object;
}
const __cacheJanna_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildJanna_R_Object>>();
export function makeJanna_R_Object(api: ContentApi) {
  const cached = __cacheJanna_R_Object.get(api);
  if (cached) return cached;
  const built = __buildJanna_R_Object(api);
  __cacheJanna_R_Object.set(api, built);
  return built;
}