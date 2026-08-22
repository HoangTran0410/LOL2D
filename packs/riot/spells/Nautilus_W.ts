import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Nautilus_W = InstanceType<ReturnType<typeof makeNautilus_W>>;
type Nautilus_W_Shell = InstanceType<ReturnType<typeof makeNautilus_W_Shell>>;
type Nautilus_W_Splash = InstanceType<ReturnType<typeof makeNautilus_W_Splash>>;



export const W_SHIELD = 35;

export const W_DURATION_MS = 5_000;

export const W_SPLASH = 10;

export const W_SPLASH_RADIUS = 130;

export const W_DOT_TOTAL = 8;

export const W_DOT_MS = 2_000;

export const W_DOT_TICK_MS = 500;

export const W_DOT_TICK = W_DOT_TOTAL / (W_DOT_MS / W_DOT_TICK_MS);

/** How long the plates take to close over him. */
export const W_CLOSE_MS = 280;

export const W_PLATES = 9;


const IRON: [number, number, number] = [120, 144, 156];

const RUST: [number, number, number] = [75, 101, 132];

const FOAM: [number, number, number] = [168, 230, 207];


/**
 * The carapace, and the on-hit splash it pays for.
 *
 * The splash rides `EventType.ON_ATTACK_HIT` — the one event that fires once per
 * *landed* basic attack, after the damage has resolved. That subscription
 * outlives the cast, so it is owned by the shield rather than by the cast: the
 * shield's own deactivate listener is the primary unhook, and `deactivate` /
 * `onRemoved` / a per-frame liveness check are the rest, because a listener left
 * behind would keep splashing for the whole match.
 */
function __buildNautilus_W(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const EventType = api.enums.EventType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const DamageOverTime = api.buffs.DamageOverTime;
  const Shield = api.buffs.Shield;
  const Nautilus_W_Shell = makeNautilus_W_Shell(api);
  const Nautilus_W_Splash = makeNautilus_W_Splash(api);
  class Nautilus_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_nautilus_w');
    name = 'Cơn Giận Của Người Khổng Lồ (Nautilus_W)';
    description =
      `Khoác lớp vỏ sắt hà chắn <span class="damage">${W_SHIELD} sát thương</span> trong ` +
      `${W_DURATION_MS / 1000} giây. Khi còn khiên, mỗi đòn đánh thường bắn nước ra ` +
      `${W_SPLASH_RADIUS} đơn vị quanh mục tiêu: <span class="damage">${W_SPLASH} sát thương</span> ` +
      `và <span class="damage">${W_DOT_TOTAL} sát thương</span> ăn mòn theo thời gian.`;
    coolDown = 10_000;
    manaCost = 30;

    private carapace: Shield | null = null;
    private unhook: (() => void) | null = null;

    onSpellCast(): void {
      const plates = new Shield(W_DURATION_MS, this.owner, this.owner);
      plates.amount = W_SHIELD;
      plates.color = IRON;
      plates.stackId = 'nautilus_w_carapace';
      this.owner.addBuff(plates);
      this.carapace = plates;

      this.game.objectManager.addObject(new Nautilus_W_Shell(this.owner, plates));

      this.listen();
      plates.addDeactivateListener(() => this.stopListening());
    }

    /** Belt and braces: a shield that ended without firing its listener still unhooks. */
    onUpdate(): void {
      if (!this.unhook) return;
      if (!this.carapace || this.carapace.toRemove) this.stopListening();
    }

    deactivate(): void {
      super.deactivate();
      this.stopListening();
    }

    onRemoved(): void {
      super.onRemoved();
      this.stopListening();
    }

    private listen(): void {
      this.stopListening();
      this.unhook = this.game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) => {
        // Every event on the bus is global; only his own swings splash.
        if (hit.attacker !== this.owner) return;
        this.splash(hit.victim);
      });
    }

    private stopListening(): void {
      this.unhook?.();
      this.unhook = null;
      this.carapace = null;
    }

    /**
     * Water thrown out around whoever he just hit. Centred on the victim, so the
     * radius is not a caster-centred reach and `Reach` has no say in it.
     */
    private splash(victim: AttackableUnit): void {
      if (!victim?.position) return;
      this.game.objectManager.addObject(new Nautilus_W_Splash(this.owner, victim.position.copy()));

      const soaked = new Set<AttackableUnit>();
      const nearby = this.game.objectManager.queryObjects({
        area: new Circle({ x: victim.position.x, y: victim.position.y, r: W_SPLASH_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const soaker of nearby) {
        if (soaked.has(soaker)) continue;
        soaked.add(soaker);
        soaker.takeDamage(W_SPLASH, this.owner);
        const corrosion = new DamageOverTime(W_DOT_MS, this.owner, soaker);
        corrosion.damagePerTick = W_DOT_TICK;
        corrosion.tickInterval = W_DOT_TICK_MS;
        corrosion.flameColor = IRON;
        corrosion.emberColor = FOAM;
        corrosion.stackId = 'nautilus_w_corrosion';
        soaker.addBuff(corrosion);
      }
    }
  }
  return Nautilus_W;
}
const __cacheNautilus_W = new WeakMap<ContentApi, ReturnType<typeof __buildNautilus_W>>();
export default function makeNautilus_W(api: ContentApi) {
  const cached = __cacheNautilus_W.get(api);
  if (cached) return cached;
  const built = __buildNautilus_W(api);
  __cacheNautilus_W.set(api, built);
  return built;
}


/**
 * Barnacled plates that swing shut over him and split as the shield is chipped.
 * Drawn as its own object rather than from `Champion.draw`, so it survives the
 * frames on which the caster is culled.
 */
function __buildNautilus_W_Shell(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Shield = api.buffs.Shield;
  class Nautilus_W_Shell extends SpellObject {
    age = 0;
    lifeTime = W_DURATION_MS;
    /** Seeded once in onAdded — the barnacles must not crawl. */
    barnacles: { angle: number; size: number }[] = [];
    cracks: number[] = [];

    private plates: Shield;

    constructor(owner: AttackableUnit, plates: Shield) {
      super(owner);
      this.plates = plates;
      this.attachTo(owner, plates);
    }

    onAdded(): void {
      for (let i = 0; i < W_PLATES; i++) {
        this.barnacles.push({ angle: random(0, TWO_PI), size: random(4, 9) });
        this.cracks.push(random(0, TWO_PI));
      }
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const closed = constrain(this.age / W_CLOSE_MS, 0, 1);
      const shut = 1 - (1 - closed) * (1 - closed);
      const worn = 1 - constrain(this.plates.amount / W_SHIELD, 0, 1);
      const reach = this.owner.animatedValues.displaySize * 0.5 + 14;

      push();
      translate(this.owner.position.x, this.owner.position.y);
      // Layer one: the plates, swinging in from outside until they meet.
      noFill();
      for (let i = 0; i < W_PLATES; i++) {
        const seat = (TWO_PI * i) / W_PLATES;
        const swung = seat + (1 - shut) * 0.6;
        const span = (TWO_PI / W_PLATES) * (0.55 + 0.35 * shut);
        stroke(IRON[0], IRON[1], IRON[2], 120 + 110 * shut);
        strokeWeight(6);
        arc(0, 0, reach * 2, reach * 2, swung, swung + span);
        const knob = this.barnacles[i];
        if (knob) {
          stroke(RUST[0], RUST[1], RUST[2], 220);
          strokeWeight(2);
          circle(cos(knob.angle) * reach, sin(knob.angle) * reach, knob.size * shut + 1);
        }
      }
      // Layer two: what the shield has already eaten, as splits in the iron.
      if (worn > 0.02) {
        stroke(FOAM[0], FOAM[1], FOAM[2], 90 + 150 * worn);
        strokeWeight(2);
        for (const split of this.cracks) {
          const inner = reach * 0.45;
          const outer = reach * (0.5 + 0.55 * worn);
          line(cos(split) * inner, sin(split) * inner, cos(split) * outer, sin(split) * outer);
        }
      }
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      return this.squareDisplayBoundingBox((this.owner.animatedValues.displaySize * 0.5 + 26) * 2);
    }
  }
  return Nautilus_W_Shell;
}
const __cacheNautilus_W_Shell = new WeakMap<ContentApi, ReturnType<typeof __buildNautilus_W_Shell>>();
export function makeNautilus_W_Shell(api: ContentApi) {
  const cached = __cacheNautilus_W_Shell.get(api);
  if (cached) return cached;
  const built = __buildNautilus_W_Shell(api);
  __cacheNautilus_W_Shell.set(api, built);
  return built;
}


/** The low sheet of water, on the ground, at exactly the radius that hit. */
function __buildNautilus_W_Splash(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Nautilus_W_Splash extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    lifeTime = 420;
    age = 0;

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;
      push();
      noFill();
      stroke(FOAM[0], FOAM[1], FOAM[2], 210 * fade);
      strokeWeight(4 * fade + 1);
      circle(this.position.x, this.position.y, W_SPLASH_RADIUS * 2 * opened);
      // The hard rim sits on the real radius, so the zone can be read from inside it.
      stroke(RUST[0], RUST[1], RUST[2], 150 * fade + 40);
      strokeWeight(2);
      circle(this.position.x, this.position.y, W_SPLASH_RADIUS * 2);
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      return this.squareDisplayBoundingBox((W_SPLASH_RADIUS + 12) * 2);
    }
  }
  return Nautilus_W_Splash;
}
const __cacheNautilus_W_Splash = new WeakMap<ContentApi, ReturnType<typeof __buildNautilus_W_Splash>>();
export function makeNautilus_W_Splash(api: ContentApi) {
  const cached = __cacheNautilus_W_Splash.get(api);
  if (cached) return cached;
  const built = __buildNautilus_W_Splash(api);
  __cacheNautilus_W_Splash.set(api, built);
  return built;
}