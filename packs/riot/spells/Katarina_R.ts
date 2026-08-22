import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CancelReason, CastContext, CastSpec } from '@moba2d/core/content/types';
import { makeKatarina_Blade_Impact } from './Katarina_Q';
import { KATARINA_BLOOD, KATARINA_DAGGER_LENGTH, KATARINA_STEEL, drawKatarinaDagger } from './Katarina_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Katarina_R = InstanceType<ReturnType<typeof makeKatarina_R>>;
type Katarina_R_Lotus = InstanceType<ReturnType<typeof makeKatarina_R_Lotus>>;
type Katarina_Blade_Impact = InstanceType<ReturnType<typeof makeKatarina_Blade_Impact>>;



export const KATARINA_R_DURATION_MS = 2_500;

export const KATARINA_R_RADIUS = 350;

export const KATARINA_R_TICK_MS = 166;

export const KATARINA_R_TICK_DAMAGE = 8;

export const KATARINA_R_TICK_COUNT = Math.floor(KATARINA_R_DURATION_MS / KATARINA_R_TICK_MS);

const VOLLEY_MS = 200;


function __buildKatarina_R(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const Spell = api.Spell;
  const Katarina_R_Lotus = makeKatarina_R_Lotus(api);
  class Katarina_R extends Spell {
    image = api.asset('spell_katarina_r');
    name = 'Bông Sen Tử Thần (Katarina_R)';
    description = `Xoay tròn liên tục trong ${KATARINA_R_DURATION_MS / 1000} giây, phóng bão dao ra mọi hướng:
      <span class="damage">${KATARINA_R_TICK_DAMAGE} sát thương</span> mỗi
      ${KATARINA_R_TICK_MS / 1000} giây cho tối đa 3 kẻ địch trong vùng ${KATARINA_R_RADIUS}
      (tổng cộng <span class="damage">${KATARINA_R_TICK_COUNT * KATARINA_R_TICK_DAMAGE}</span>).
      Bị choáng hoặc di chuyển sẽ ngắt kênh niệm.`;
    coolDown = 10_000;
    manaCost = 0;
    range = KATARINA_R_RADIUS;

    private lotus: Katarina_R_Lotus | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'SELF',
        channel: { durationMs: KATARINA_R_DURATION_MS, tickEveryMs: KATARINA_R_TICK_MS },
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'start', durationMs: this.coolDown },
      };
    }

    onCastStart(_context: CastContext): void {
      if (this.lotus && !this.lotus.toRemove) return;
      const lotus = new Katarina_R_Lotus(this.owner, effectiveRange(this.range, this.owner));
      this.lotus = lotus;
      this.game.objectManager.addObject(lotus);
    }

    onCancel(_context: CastContext, _reason: CancelReason): void {
      this.endChannel();
    }

    onComplete(_context: CastContext): void {
      this.endChannel();
    }

    private endChannel(): void {
      this.lotus?.finish();
      this.lotus = null;
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Katarina_R;
}
const __cacheKatarina_R = new WeakMap<ContentApi, ReturnType<typeof __buildKatarina_R>>();
export default function makeKatarina_R(api: ContentApi) {
  const cached = __cacheKatarina_R.get(api);
  if (cached) return cached;
  const built = __buildKatarina_R(api);
  __cacheKatarina_R.set(api, built);
  return built;
}


interface LotusVolley {
  elapsed: number;
  blades: { angle: number; reach: number; landed: boolean }[];
}


/**
 * Rapidly spinning death lotus storm with crimson whirlwind and flying daggers.
 */
function __buildKatarina_R_Lotus(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const Katarina_Blade_Impact = makeKatarina_Blade_Impact(api);
  class Katarina_R_Lotus extends SpellObject {
    radius: number;
    lifeTime = KATARINA_R_DURATION_MS;
    age = 0;
    ticksDone = 0;
    volleys: LotusVolley[] = [];
    spokes: number[] = [];

    constructor(owner: AttackableUnit, radius: number) {
      super(owner);
      this.radius = radius;
      this.position = createVector(owner.position.x, owner.position.y);
      for (let i = 0; i < 10; i++) {
        this.spokes.push((i / 10) * TWO_PI + random(-0.1, 0.1));
      }
    }

    finish(): void {
      this.toRemove = true;
    }

    update(): void {
      // `ObjectManager.update` updates every object and *then* culls the dead, so
      // anything marked `toRemove` from outside that loop — an interrupt reaching
      // `Katarina_R.onCancel` — still gets one more frame here. Without this guard
      // a stunned Katarina lands one extra volley after the channel was broken.
      if (this.toRemove) return;
      if (this.owner.isDead || this.owner.toRemove) {
        this.finish();
        return;
      }
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.age += deltaTime;

      while (
        this.ticksDone < KATARINA_R_TICK_COUNT &&
        this.age >= (this.ticksDone + 1) * KATARINA_R_TICK_MS
      ) {
        this.ticksDone++;
        this.throwVolley();
      }

      const alive: LotusVolley[] = [];
      for (const volley of this.volleys) {
        volley.elapsed += deltaTime;
        if (volley.elapsed < VOLLEY_MS) alive.push(volley);
      }
      this.volleys = alive;

      if (this.age >= this.lifeTime) this.finish();
    }

    private throwVolley(): void {
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      }) as AttackableUnit[];

      // Sort by nearest distance to hit up to 3 closest enemies
      candidates.sort((a, b) => {
        const distA = Math.hypot(a.position.x - this.position.x, a.position.y - this.position.y);
        const distB = Math.hypot(b.position.x - this.position.x, b.position.y - this.position.y);
        return distA - distB;
      });

      const targets = candidates.slice(0, 3);
      const blades: { angle: number; reach: number; landed: boolean }[] = [];

      for (const victim of targets) {
        victim.takeDamage(KATARINA_R_TICK_DAMAGE, this.owner);
        this.game.objectManager.addObject(
          new Katarina_Blade_Impact(this.owner, victim.position.x, victim.position.y, 35)
        );
        const dx = victim.position.x - this.position.x;
        const dy = victim.position.y - this.position.y;
        blades.push({ angle: Math.atan2(dy, dx), reach: Math.hypot(dx, dy), landed: true });
      }

      // If no targets found, still spin and throw wild blades into air
      if (blades.length === 0) {
        for (const angle of this.spokes) {
          blades.push({ angle, reach: this.radius * 0.6, landed: false });
        }
      }
      this.volleys.push({ elapsed: 0, blades });
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const remaining = 1 - t;
      const spin = (this.age / 35) * TWO_PI;

      push();
      translate(this.position.x, this.position.y);

      // Outer range boundary with cast arc
      noFill();
      stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 75);
      strokeWeight(2);
      circle(0, 0, this.radius * 2);

      stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 230);
      strokeWeight(4);
      arc(0, 0, this.radius * 2, this.radius * 2, -HALF_PI, -HALF_PI + TWO_PI * remaining);

      // Spinning blood hurricane vortex
      noStroke();
      fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 50);
      circle(0, 0, 160);

      // 6 spinning scythe blades around Katarina
      stroke(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], 240);
      strokeWeight(3);
      noFill();
      for (let i = 0; i < 6; i++) {
        const a = spin + (i * TWO_PI) / 6;
        const r1 = 30;
        const r2 = 95;
        arc(0, 0, r2 * 2, r2 * 2, a, a + PI * 0.35);
        stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 220);
        line(cos(a) * r1, sin(a) * r1, cos(a + 0.4) * r2, sin(a + 0.4) * r2);
      }

      // Flying dagger missiles
      for (const volley of this.volleys) {
        const flight = constrain(volley.elapsed / VOLLEY_MS, 0, 1);
        const flown = 1 - (1 - flight) * (1 - flight);
        const fade = 1 - flight;

        for (const blade of volley.blades) {
          const tipX = cos(blade.angle) * blade.reach * flown;
          const tipY = sin(blade.angle) * blade.reach * flown;

          // A real blade rather than a 22px line: at three a tick these were the
          // hardest thing on screen to read, and they are what the damage is.
          const reach = blade.landed ? KATARINA_DAGGER_LENGTH : KATARINA_DAGGER_LENGTH * 0.62;
          push();
          translate(tipX, tipY);
          // `- HALF_PI` turns the shared point-down blade to point along its flight
          rotate(blade.angle - HALF_PI);
          drawKatarinaDagger(reach, (blade.landed ? 255 : 150) * fade);
          pop();

          // the hit itself, on the body that took it
          if (blade.landed) {
            noStroke();
            fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 240 * fade);
            circle(tipX, tipY, 18 * flown);
          }
        }
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Katarina_R_Lotus;
}
const __cacheKatarina_R_Lotus = new WeakMap<ContentApi, ReturnType<typeof __buildKatarina_R_Lotus>>();
export function makeKatarina_R_Lotus(api: ContentApi) {
  const cached = __cacheKatarina_R_Lotus.get(api);
  if (cached) return cached;
  const built = __buildKatarina_R_Lotus(api);
  __cacheKatarina_R_Lotus.set(api, built);
  return built;
}