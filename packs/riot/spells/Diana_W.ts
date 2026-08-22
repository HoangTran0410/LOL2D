import type { ContentApi } from '@moba2d/core/content/ContentApi';
import { MOON_CORE, MOON_PALE, drawCrescent } from './Diana_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Diana_W = InstanceType<ReturnType<typeof makeDiana_W>>;
type Diana_W_Bloom = InstanceType<ReturnType<typeof makeDiana_W_Bloom>>;
type Diana_W_Orbit = InstanceType<ReturnType<typeof makeDiana_W_Orbit>>;



export const W_SPHERES = 3;

export const W_ORBIT = 90;

export const W_DURATION_MS = 4_000;

export const W_SPHERE_DAMAGE = 10;

export const W_SPHERE_RADIUS = 60;

export const W_SHIELD = 22;

/** How close a body has to come to an orbiting crescent to pop it. */
export const W_CONTACT_RADIUS = 32;

/** What the ability actually threatens: the orbit plus the bloom it leaves. */
export const W_THREAT = W_ORBIT + W_SPHERE_RADIUS;


const W_ORBIT_PERIOD_MS = 2_400;

const W_BLOOM_MS = 340;

const W_REFRESH_PULSE_MS = 340;

const W_SHIELD_STACK_ID = 'diana_w_shield';


/** One of the three. Never four: three spheres has to mean three shapes on screen. */
export interface MoonSphere {
  angleOffset: number;
  detonated: boolean;
  poppedAt: number;
}


function __buildDiana_W(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const Shield = api.buffs.Shield;
  const Spell = api.Spell;
  const Diana_W_Orbit = makeDiana_W_Orbit(api);
  class Diana_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_diana_w');
    name = 'Thác Bạc (Diana_W)';
    description = `Ba lưỡi liềm bay quanh Diana. Mỗi lưỡi nổ khi chạm kẻ địch, gây
      <span class="damage">${W_SPHERE_DAMAGE} sát thương</span> trong vùng nhỏ. Diana nhận lá
      chắn ${W_SHIELD}; nổ hết cả ba lưỡi thì lá chắn được làm mới một lần.`;
    coolDown = 10_000;
    manaCost = 40;
    range = W_THREAT;

    onSpellCast(): void {
      const shield = new Shield(W_DURATION_MS, this.owner, this.owner);
      shield.amount = W_SHIELD;
      shield.color = [MOON_CORE[0], MOON_CORE[1], MOON_CORE[2]];
      shield.stackId = W_SHIELD_STACK_ID;
      this.owner.addBuff(shield);

      const orbit = new Diana_W_Orbit(this.owner, shield);
      orbit.attachTo(this.owner);
      this.game.objectManager.addObject(orbit);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Diana_W;
}
const __cacheDiana_W = new WeakMap<ContentApi, ReturnType<typeof __buildDiana_W>>();
export default function makeDiana_W(api: ContentApi) {
  const cached = __cacheDiana_W.get(api);
  if (cached) return cached;
  const built = __buildDiana_W(api);
  __cacheDiana_W.set(api, built);
  return built;
}


/**
 * The three crescents. Reaches well past her body, so it is a SpellObject riding her rather
 * than caster VFX — Champion.draw() is skipped whenever she is culled, and the spheres would
 * keep detonating invisibly.
 */
function __buildDiana_W_Orbit(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Buff = api.buffs.Buff;
  const Shield = api.buffs.Shield;
  const SpellObject = api.SpellObject;
  const Diana_W_Bloom = makeDiana_W_Bloom(api);
  class Diana_W_Orbit extends SpellObject {
    age = 0;
    readonly spheres: MoonSphere[] = [];
    /** Counted, not flagged: the spec allows exactly one refresh per cast. */
    shieldRefreshCount = 0;
    private shieldBuff: Buff | null;
    private lastPopAt = -1;
    private refreshPulseAt = -1;

    constructor(owner: AttackableUnit, shield: Buff | null) {
      super(owner);
      this.shieldBuff = shield;
      for (let i = 0; i < W_SPHERES; i++) {
        this.spheres.push({
          angleOffset: (i / W_SPHERES) * Math.PI * 2,
          detonated: false,
          poppedAt: -1,
        });
      }
    }

    get liveSpheres(): MoonSphere[] {
      const alive: MoonSphere[] = [];
      for (const sphere of this.spheres) if (!sphere.detonated) alive.push(sphere);
      return alive;
    }

    get spentCount(): number {
      return this.spheres.length - this.liveSpheres.length;
    }

    spherePosition(sphere: MoonSphere): { x: number; y: number } {
      const spin = (this.age / W_ORBIT_PERIOD_MS) * Math.PI * 2 + sphere.angleOffset;
      return {
        x: this.position.x + Math.cos(spin) * W_ORBIT,
        y: this.position.y + Math.sin(spin) * W_ORBIT,
      };
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      for (const sphere of this.spheres) {
        if (sphere.detonated) continue;
        const at = this.spherePosition(sphere);
        const touching = this.game.objectManager.queryObjects({
          area: new Circle({ x: at.x, y: at.y, r: W_CONTACT_RADIUS }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        }) as AttackableUnit[];
        if (touching.length === 0) continue;
        // The contact point is on the body that walked into it, not out at the orbit.
        this.detonate(sphere, touching[0].position.copy());
      }

      if (this.age >= W_DURATION_MS) this.toRemove = true;
      if (this.liveSpheres.length === 0 && this.age - this.lastPopAt >= W_REFRESH_PULSE_MS) {
        this.toRemove = true;
      }
    }

    detonate(sphere: MoonSphere, at: p5.Vector): void {
      if (sphere.detonated) return;
      sphere.detonated = true;
      sphere.poppedAt = this.age;
      this.lastPopAt = this.age;

      const caught = this.game.objectManager.queryObjects({
        area: new Circle({ x: at.x, y: at.y, r: W_SPHERE_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
      for (const victim of caught) {
        victim.takeDamage(W_SPHERE_DAMAGE, this.owner);
      }

      this.game.objectManager.addObject(new Diana_W_Bloom(this.owner, at.copy()));

      if (this.liveSpheres.length === 0 && this.shieldRefreshCount === 0) {
        this.refreshShield();
      }
    }

    private refreshShield(): void {
      this.shieldRefreshCount += 1;
      this.refreshPulseAt = this.age;
      const live = this.shieldBuff ? SpellObject.liveBuffOn(this.owner, this.shieldBuff) : null;
      if (live) {
        live.renewBuff();
        return;
      }
      const fresh = new Shield(W_DURATION_MS, this.owner, this.owner);
      fresh.amount = W_SHIELD;
      fresh.color = [MOON_CORE[0], MOON_CORE[1], MOON_CORE[2]];
      fresh.stackId = W_SHIELD_STACK_ID;
      this.owner.addBuff(fresh);
      this.shieldBuff = fresh;
    }

    draw(): void {
      const spent = constrain(this.age / W_DURATION_MS, 0, 1);
      const pulse =
        this.refreshPulseAt < 0
          ? 0
          : constrain(1 - (this.age - this.refreshPulseAt) / W_REFRESH_PULSE_MS, 0, 1);

      push();
      noFill();
      // The shell the shield sits on: one bright pulse when it is made new, nothing else.
      stroke(MOON_CORE[0], MOON_CORE[1], MOON_CORE[2], 50 * (1 - spent * 0.5) + 190 * pulse);
      strokeWeight(1.4 + 5 * pulse);
      circle(this.position.x, this.position.y, W_ORBIT * 2 * (1 - 0.05 * pulse));

      for (const sphere of this.spheres) {
        if (sphere.detonated) continue;
        const at = this.spherePosition(sphere);
        const spin = (this.age / W_ORBIT_PERIOD_MS) * Math.PI * 2 + sphere.angleOffset;
        const breathe = 1 + 0.15 * sin(this.age / 180 + sphere.angleOffset);

        // Outer soft moonlight aura
        noStroke();
        fill(MOON_CORE[0], MOON_CORE[1], MOON_CORE[2], 75);
        circle(at.x, at.y, 36 * breathe);

        // Bright lunar halo
        stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 220);
        strokeWeight(2.5);
        fill(MOON_CORE[0], MOON_CORE[1], MOON_CORE[2], 180);
        circle(at.x, at.y, 22 * breathe);

        // Brilliant white core
        fill(255, 255, 255, 250);
        noStroke();
        circle(at.x, at.y, 14 * breathe);

        // Orbital sparkle trail
        const trailAngle = spin - 0.28;
        stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 180);
        strokeWeight(3.5);
        point(
          this.position.x + Math.cos(trailAngle) * W_ORBIT,
          this.position.y + Math.sin(trailAngle) * W_ORBIT
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((W_ORBIT + 46) * 2);
    }
  }
  return Diana_W_Orbit;
}
const __cacheDiana_W_Orbit = new WeakMap<ContentApi, ReturnType<typeof __buildDiana_W_Orbit>>();
export function makeDiana_W_Orbit(api: ContentApi) {
  const cached = __cacheDiana_W_Orbit.get(api);
  if (cached) return cached;
  const built = __buildDiana_W_Orbit(api);
  __cacheDiana_W_Orbit.set(api, built);
  return built;
}


/** A crescent bloom where a sphere met a body. */
function __buildDiana_W_Bloom(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Diana_W_Bloom extends SpellObject {
    lifeTime = W_BLOOM_MS;
    age = 0;
    private petals: number[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      for (let i = 0; i < 3; i++) this.petals.push(random(0, TWO_PI));
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      push();
      noFill();
      // Glowing lunar blast fill
      fill(MOON_CORE[0], MOON_CORE[1], MOON_CORE[2], 60 * (1 - t));
      circle(this.position.x, this.position.y, W_SPHERE_RADIUS * 2 * opened);

      // Hard rim on the real damage radius, so the pop states its own area.
      noFill();
      stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 230 * (1 - t));
      strokeWeight(3.5 * (1 - t) + 1);
      circle(this.position.x, this.position.y, W_SPHERE_RADIUS * 2 * opened);
      for (const petal of this.petals) {
        drawCrescent(
          this.position.x,
          this.position.y,
          W_SPHERE_RADIUS * 0.55 * opened + 5,
          petal,
          1.7,
          5 * (1 - t) + 1,
          MOON_CORE,
          225 * (1 - t)
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((W_SPHERE_RADIUS + 26) * 2);
    }
  }
  return Diana_W_Bloom;
}
const __cacheDiana_W_Bloom = new WeakMap<ContentApi, ReturnType<typeof __buildDiana_W_Bloom>>();
export function makeDiana_W_Bloom(api: ContentApi) {
  const cached = __cacheDiana_W_Bloom.get(api);
  if (cached) return cached;
  const built = __buildDiana_W_Bloom(api);
  __cacheDiana_W_Bloom.set(api, built);
  return built;
}