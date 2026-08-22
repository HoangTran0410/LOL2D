import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Riven_W = InstanceType<ReturnType<typeof makeRiven_W>>;
type Riven_W_Burst = InstanceType<ReturnType<typeof makeRiven_W_Burst>>;
type Riven_W_Fracture = InstanceType<ReturnType<typeof makeRiven_W_Fracture>>;



export const W_RADIUS = 170;

export const W_DAMAGE = 20;

export const W_STUN_MS = 750;

/** The ground fracture crawling out to exactly W_RADIUS is the victim's reaction window. */
export const W_WINDUP_MS = 180;


const IRON: [number, number, number] = [30, 39, 46];

const RUNE: [number, number, number] = [0, 210, 168];

const RUNE_HOT: [number, number, number] = [150, 255, 228];


function __buildRiven_W(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Stun = api.buffs.Stun;
  const Spell = api.Spell;
  const Riven_W_Fracture = makeRiven_W_Fracture(api);
  const Riven_W_Burst = makeRiven_W_Burst(api);
  class Riven_W extends Spell {
    image = api.asset('spell_riven_w');
    name = 'Kình Lực (Riven_W)';
    description =
      `Đóng lưỡi kiếm xuống đất, nứt ra bán kính ${W_RADIUS} sau ${W_WINDUP_MS}ms rồi gây ` +
      `<span class="damage">${W_DAMAGE} sát thương</span> và choáng ` +
      `${W_STUN_MS / 1000} giây quanh mình.`;
    coolDown = 9_000;
    manaCost = 30;
    range = W_RADIUS;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'SELF',
        castTimeMs: W_WINDUP_MS,
        resource: { commitAt: 'start', refundOn: ['STUN', 'SILENCE', 'MOVE'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    /** The radius the damage actually uses, so the art can put its rim on the truth. */
    get hitRadius(): number {
      return effectiveRange(W_RADIUS, this.owner);
    }

    onCastStart(): void {
      this.game.objectManager.addObject(new Riven_W_Fracture(this.owner, this.hitRadius));
    }

    onSpellCast(): void {
      const reach = this.hitRadius;
      const hit = new Set<AttackableUnit>();
      const cuts: { x: number; y: number }[] = [];

      // No vision filter: an area burst still lands on the champion standing in a bush.
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: reach }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const victim of candidates) {
        if (hit.has(victim)) continue;
        hit.add(victim);
        victim.takeDamage(W_DAMAGE, this.owner);
        victim.addBuff(new Stun(W_STUN_MS, this.owner, victim));
        cuts.push({ x: victim.position.x, y: victim.position.y });
      }

      this.game.objectManager.addObject(new Riven_W_Burst(this.owner, reach, cuts));
    }

    drawPreview(): void {
      super.drawPreview(this.hitRadius);
    }
  }
  return Riven_W;
}
const __cacheRiven_W = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_W>>();
export default function makeRiven_W(api: ContentApi) {
  const cached = __cacheRiven_W.get(api);
  if (cached) return cached;
  const built = __buildRiven_W(api);
  __cacheRiven_W.set(api, built);
  return built;
}


/**
 * The windup made visible: cracks crawl out of her feet and stop dead on the hit radius
 * over W_WINDUP_MS, which is the whole reaction window for whoever is standing there.
 * Ground art, so zIndex is `GROUND_Z_INDEX` — an un-overridden subclass
 * resolves to `SPELL_EFFECT_Z_INDEX` instead, above the feet standing on it.
 */
function __buildRiven_W_Fracture(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Riven_W_Fracture extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    lifeTime = W_WINDUP_MS + 200;
    age = 0;
    readonly radius: number;
    /** Seeded once in onAdded: random() inside draw() would re-crack the ground per frame. */
    cracks: { angle: number; kink: number; kinkAt: number }[] = [];

    constructor(owner: AttackableUnit, radius: number) {
      super(owner);
      this.position = owner.position.copy();
      this.radius = radius;
    }

    onAdded(): void {
      for (let i = 0; i < 11; i++) {
        this.cracks.push({
          angle: (i / 11) * Math.PI * 2 + random(-0.12, 0.12),
          kink: random(-0.34, 0.34),
          kinkAt: 0.4 + random(0, 0.28),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      // t is the windup itself; past 1 the cracks just fade under the burst.
      const t = Math.min(1, this.age / W_WINDUP_MS);
      const crawl = t * t; // wind-in easing: slow start, arrives hard
      const fade = Math.max(0, 1 - Math.max(0, this.age - W_WINDUP_MS) / 200);
      const reach = this.radius * crawl;

      push();
      for (const crack of this.cracks) {
        const kinkX = this.position.x + Math.cos(crack.angle) * reach * crack.kinkAt;
        const kinkY = this.position.y + Math.sin(crack.angle) * reach * crack.kinkAt;
        const tipAngle = crack.angle + crack.kink;
        stroke(IRON[0], IRON[1], IRON[2], 210 * fade);
        strokeWeight(5);
        line(this.position.x, this.position.y, kinkX, kinkY);
        line(
          kinkX,
          kinkY,
          this.position.x + Math.cos(tipAngle) * reach,
          this.position.y + Math.sin(tipAngle) * reach
        );
        stroke(RUNE[0], RUNE[1], RUNE[2], 235 * fade);
        strokeWeight(2);
        line(this.position.x, this.position.y, kinkX, kinkY);
        line(
          kinkX,
          kinkY,
          this.position.x + Math.cos(tipAngle) * reach,
          this.position.y + Math.sin(tipAngle) * reach
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Riven_W_Fracture;
}
const __cacheRiven_W_Fracture = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_W_Fracture>>();
export function makeRiven_W_Fracture(api: ContentApi) {
  const cached = __cacheRiven_W_Fracture.get(api);
  if (cached) return cached;
  const built = __buildRiven_W_Fracture(api);
  __cacheRiven_W_Fracture.set(api, built);
  return built;
}


/** The one hard rim, on exactly the radius the damage used, plus a cut on each victim. */
function __buildRiven_W_Burst(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Riven_W_Burst extends SpellObject {
    lifeTime = 300;
    age = 0;
    readonly radius: number;
    readonly cuts: { x: number; y: number }[];

    constructor(owner: AttackableUnit, radius: number, cuts: { x: number; y: number }[]) {
      super(owner);
      this.position = owner.position.copy();
      this.radius = radius;
      this.cuts = cuts;
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = Math.min(1, this.age / this.lifeTime);
      const opened = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;

      push();
      noFill();
      stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 250 * fade);
      strokeWeight(4 * fade + 1.5);
      circle(this.position.x, this.position.y, this.radius * 2);

      // the shove itself, sweeping out to the rim and stopping there
      stroke(RUNE[0], RUNE[1], RUNE[2], 200 * fade);
      strokeWeight(3);
      circle(this.position.x, this.position.y, this.radius * 2 * opened);

      strokeWeight(3);
      for (const cut of this.cuts) {
        const reach = 16 * (0.4 + 0.6 * opened);
        stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 240 * fade);
        line(cut.x - reach, cut.y - reach * 0.6, cut.x + reach, cut.y + reach * 0.6);
        line(cut.x - reach, cut.y + reach * 0.6, cut.x + reach, cut.y - reach * 0.6);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Riven_W_Burst;
}
const __cacheRiven_W_Burst = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_W_Burst>>();
export function makeRiven_W_Burst(api: ContentApi) {
  const cached = __cacheRiven_W_Burst.get(api);
  if (cached) return cached;
  const built = __buildRiven_W_Burst(api);
  __cacheRiven_W_Burst.set(api, built);
  return built;
}