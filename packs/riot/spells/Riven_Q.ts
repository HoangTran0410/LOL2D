import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';
import { makeRiven_R_Reforge } from './Riven_R';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Riven_Q = InstanceType<ReturnType<typeof makeRiven_Q>>;
type Riven_Q_GroundCrack = InstanceType<ReturnType<typeof makeRiven_Q_GroundCrack>>;
type Riven_Q_Slash = InstanceType<ReturnType<typeof makeRiven_Q_Slash>>;
type Riven_R_Reforge = InstanceType<ReturnType<typeof makeRiven_R_Reforge>>;



export const Q_CHARGES = 3;

export const Q_WINDOW_MS = 4_000;

export const Q_STEP = 160;

export const Q_STEP_FINAL = 200;

export const Q_RADIUS = 130;

export const Q_ARC_DEG = 90;

export const Q_DAMAGE = 14;

export const Q_DAMAGE_FINAL = 18;

export const Q_KNOCKUP_MS = 500;

export const Q_RANGE = Q_STEP_FINAL + Q_RADIUS;


/** Between charges she only pauses; the real cooldown waits for the third. */
const Q_CHARGE_GAP_MS = 260;

const Q_DASH_MS = 320;

const Q_DASH_SPEED = 15;


const IRON: [number, number, number] = [30, 39, 46];

const RUNE: [number, number, number] = [0, 210, 168];

const RUNE_HOT: [number, number, number] = [150, 255, 228];


function __buildRiven_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Airborne = api.buffs.Airborne;
  const Dash = api.buffs.Dash;
  const Spell = api.Spell;
  const Riven_R_Reforge = makeRiven_R_Reforge(api);
  const Riven_Q_Slash = makeRiven_Q_Slash(api);
  const Riven_Q_GroundCrack = makeRiven_Q_GroundCrack(api);
  class Riven_Q extends Spell {
    image = api.asset('spell_riven_q');
    name = 'Tam Bộ Kiếm (Riven_Q)';
    description =
      `Lao ${Q_STEP} về phía trước rồi chém một hình quạt ${Q_ARC_DEG}° bán kính ${Q_RADIUS}, ` +
      `gây <span class="damage">${Q_DAMAGE} sát thương</span>. Có ${Q_CHARGES} lần đánh trong ` +
      `${Q_WINDOW_MS / 1000} giây; nhát thứ ba lao ${Q_STEP_FINAL}, gây ` +
      `<span class="damage">${Q_DAMAGE_FINAL} sát thương</span> và hất tung mục tiêu.`;
    coolDown = 3_500;
    manaCost = 0;
    range = Q_RANGE;

    /** Charges left in the open combo. Refilled lazily, so the HUD badge is always honest. */
    charges = Q_CHARGES;
    /** ms since the FIRST cast of the open combo; -1 when no combo is open. */
    comboElapsedMs = -1;

    get stackCount(): number {
      return this.charges;
    }

    setStackCount(count: number): boolean {
      this.charges = Math.max(0, Math.min(Q_CHARGES, Math.floor(count)));
      return true;
    }

    get castSpec(): Readonly<CastSpec> {
      // The spec is resolved before the cast is committed, so `charges` is still what this
      // press is about to spend: 1 means this is the third and the real cooldown starts.
      const isFinal = this.charges <= 1;
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: {
          startAt: 'release',
          durationMs: isFinal ? this.coolDown : Q_CHARGE_GAP_MS,
        },
      };
    }

    checkCastCondition(): boolean {
      return Dash.CanDash(this.owner);
    }

    onUpdate(): void {
      if (this.comboElapsedMs < 0) return;
      this.comboElapsedMs += deltaTime;
      if (this.comboElapsedMs >= Q_WINDOW_MS) this.resetCombo();
    }

    resetCombo(): void {
      this.charges = Q_CHARGES;
      this.comboElapsedMs = -1;
    }

    onSpellCast(context: CastContext): void {
      const lapsed = this.comboElapsedMs < 0 || this.comboElapsedMs >= Q_WINDOW_MS;
      if (lapsed || this.charges <= 0) {
        this.charges = Q_CHARGES;
        this.comboElapsedMs = 0;
      }

      const isFinal = this.charges <= 1;
      this.charges = Math.max(0, this.charges - 1);

      const aim = this.firingDirection(context);
      const span = Math.hypot(aim.x, aim.y) || 1;
      const forwardX = aim.x / span;
      const forwardY = aim.y / span;
      const step = isFinal ? Q_STEP_FINAL : Q_STEP;
      const arrivalX = this.owner.position.x + forwardX * step;
      const arrivalY = this.owner.position.y + forwardY * step;
      const heading = Math.atan2(forwardY, forwardX);
      const empowered = this.owner.hasBuff(Riven_R_Reforge);

      this.slash(arrivalX, arrivalY, heading, isFinal, empowered);

      const dash = new Dash(Q_DASH_MS, this.owner, this.owner);
      dash.dashDestination = createVector(arrivalX, arrivalY);
      dash.dashSpeed = Q_DASH_SPEED;
      // The crescent is the subject; a dash trail behind it would only fight with it.
      dash.showTrail = false;
      this.owner.addBuff(dash);
    }

    /**
     * One crescent in front of the arrival point. Its own `Set`, so the three casts are
     * three independent slashes and a unit standing still can eat all three.
     */
    private slash(
      atX: number,
      atY: number,
      heading: number,
      isFinal: boolean,
      empowered: boolean
    ): void {
      const damage = isFinal ? Q_DAMAGE_FINAL : Q_DAMAGE;
      const halfArc = (Q_ARC_DEG * Math.PI) / 360;
      const hit = new Set<AttackableUnit>();
      const cuts: { x: number; y: number }[] = [];

      // No vision filter: an area slash still lands on the champion standing in a bush.
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({ x: atX, y: atY, r: effectiveRange(Q_RADIUS, this.owner) }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const victim of candidates) {
        if (hit.has(victim)) continue;

        const dx = victim.position.x - atX;
        const dy = victim.position.y - atY;
        const away = Math.hypot(dx, dy);
        let offAxis = Math.atan2(dy, dx) - heading;
        while (offAxis > Math.PI) offAxis -= Math.PI * 2;
        while (offAxis < -Math.PI) offAxis += Math.PI * 2;
        // A wide body just outside the wedge edge is still cut by it; a body ON the arrival
        // point is inside whatever its heading says.
        const bodyArc = Math.atan2(victim.collisionRadius || 0, Math.max(away, 1));
        if (Math.abs(offAxis) > halfArc + bodyArc) continue;

        hit.add(victim);
        victim.takeDamage(damage, this.owner);
        if (isFinal) victim.addBuff(new Airborne(Q_KNOCKUP_MS, this.owner, victim));
        cuts.push({ x: victim.position.x, y: victim.position.y });
      }

      this.game.objectManager.addObject(
        new Riven_Q_Slash(this.owner, atX, atY, heading, isFinal, empowered, cuts)
      );
      if (isFinal) {
        this.game.objectManager.addObject(new Riven_Q_GroundCrack(this.owner, atX, atY, heading));
      }
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Riven_Q;
}
const __cacheRiven_Q = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_Q>>();
export default function makeRiven_Q(api: ContentApi) {
  const cached = __cacheRiven_Q.get(api);
  if (cached) return cached;
  const built = __buildRiven_Q(api);
  __cacheRiven_Q.set(api, built);
  return built;
}


/**
 * The crescent: hard straight leading edge, torn trailing one, black iron with rune light
 * bleeding out of the cracks. The third charge is visibly wider and brighter because it is
 * the one that knocks up, and R adds a long green energy edge past the blade.
 */
function __buildRiven_Q_Slash(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Riven_Q_Slash extends SpellObject {
    lifeTime = 300;
    age = 0;
    readonly heading: number;
    readonly isFinal: boolean;
    readonly empowered: boolean;
    readonly cuts: { x: number; y: number }[];
    /** Seeded once in onAdded — random() inside draw() flickers instead of animating. */
    tears: number[] = [];

    constructor(
      owner: AttackableUnit,
      atX: number,
      atY: number,
      heading: number,
      isFinal: boolean,
      empowered: boolean,
      cuts: { x: number; y: number }[]
    ) {
      super(owner);
      this.position = createVector(atX, atY);
      this.heading = heading;
      this.isFinal = isFinal;
      this.empowered = empowered;
      this.cuts = cuts;
    }

    onAdded(): void {
      for (let i = 0; i < 12; i++) this.tears.push(random(-1, 1));
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    get outerRadius(): number {
      const reach = Q_RADIUS * (this.isFinal ? 1.12 : 1);
      return this.empowered ? reach * 1.16 : reach;
    }

    draw(): void {
      const t = Math.min(1, this.age / this.lifeTime);
      // one clock: the wedge sweeps open fast, then the whole thing fades
      const swept = 1 - (1 - t) * (1 - t);
      const fade = 1 - t * t;
      const halfArc = (Q_ARC_DEG * Math.PI) / 360;
      const from = this.heading - halfArc;
      const outer = this.outerRadius;
      const inner = outer * 0.34;
      const steps = 12;
      const opened = halfArc * 2 * swept;

      push();
      noStroke();
      // black iron body of the slash
      fill(IRON[0], IRON[1], IRON[2], 200 * fade);
      beginShape();
      for (let i = 0; i <= steps; i++) {
        const spin = from + opened * (i / steps);
        vertex(this.position.x + Math.cos(spin) * outer, this.position.y + Math.sin(spin) * outer);
      }
      for (let i = steps; i >= 0; i--) {
        const spin = from + opened * (i / steps);
        const torn = this.tears.length > 0 ? this.tears[i % this.tears.length] : 0;
        const edge = inner + torn * 15;
        vertex(this.position.x + Math.cos(spin) * edge, this.position.y + Math.sin(spin) * edge);
      }
      endShape(CLOSE);

      // rune light bleeding out of the cracks, on the real hit radius
      noFill();
      stroke(RUNE[0], RUNE[1], RUNE[2], 235 * fade);
      strokeWeight(this.isFinal ? 5 : 3);
      beginShape();
      for (let i = 0; i <= steps; i++) {
        const spin = from + opened * (i / steps);
        vertex(this.position.x + Math.cos(spin) * outer, this.position.y + Math.sin(spin) * outer);
      }
      endShape();

      // the straight leading edge that makes it a cut and not an arc
      const lead = from + opened;
      stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 250 * fade);
      strokeWeight(this.isFinal ? 4 : 2.5);
      line(
        this.position.x + Math.cos(lead) * inner,
        this.position.y + Math.sin(lead) * inner,
        this.position.x + Math.cos(lead) * (outer + (this.empowered ? 46 : 0)),
        this.position.y + Math.sin(lead) * (outer + (this.empowered ? 46 : 0))
      );

      // the cut on each body that took it
      strokeWeight(3);
      for (const cut of this.cuts) {
        const reach = (this.isFinal ? 22 : 15) * (0.4 + 0.6 * swept);
        stroke(RUNE_HOT[0], RUNE_HOT[1], RUNE_HOT[2], 240 * fade);
        line(
          cut.x - Math.cos(this.heading + Math.PI / 3) * reach,
          cut.y - Math.sin(this.heading + Math.PI / 3) * reach,
          cut.x + Math.cos(this.heading + Math.PI / 3) * reach,
          cut.y + Math.sin(this.heading + Math.PI / 3) * reach
        );
        noFill();
        stroke(RUNE[0], RUNE[1], RUNE[2], 170 * fade);
        strokeWeight(2);
        circle(cut.x, cut.y, reach * 2.2);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.outerRadius + 60) * 2);
    }
  }
  return Riven_Q_Slash;
}
const __cacheRiven_Q_Slash = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_Q_Slash>>();
export function makeRiven_Q_Slash(api: ContentApi) {
  const cached = __cacheRiven_Q_Slash.get(api);
  if (cached) return cached;
  const built = __buildRiven_Q_Slash(api);
  __cacheRiven_Q_Slash.set(api, built);
  return built;
}


/**
 * The third charge's ground crack. Ground art, so zIndex is `GROUND_Z_INDEX`: an un-overridden SpellObject
 * subclass would otherwise resolve to `SPELL_EFFECT_Z_INDEX`, over the feet
 * of everyone standing on it.
 */
function __buildRiven_Q_GroundCrack(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Riven_Q_GroundCrack extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    lifeTime = 520;
    age = 0;
    readonly heading: number;
    /** Seeded once in onAdded: the crack must not re-shatter every frame. */
    forks: { at: number; side: number; length: number }[] = [];

    constructor(owner: AttackableUnit, atX: number, atY: number, heading: number) {
      super(owner);
      this.position = createVector(atX, atY);
      this.heading = heading;
    }

    onAdded(): void {
      for (let i = 0; i < 7; i++) {
        this.forks.push({
          at: 0.2 + (i / 7) * 0.75,
          side: i % 2 === 0 ? 1 : -1,
          length: 16 + random(0, 22),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = Math.min(1, this.age / this.lifeTime);
      const split = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;
      const reach = Q_RADIUS * 1.12 * split;
      const acrossX = -Math.sin(this.heading);
      const acrossY = Math.cos(this.heading);

      push();
      stroke(IRON[0], IRON[1], IRON[2], 220 * fade);
      strokeWeight(7);
      line(
        this.position.x,
        this.position.y,
        this.position.x + Math.cos(this.heading) * reach,
        this.position.y + Math.sin(this.heading) * reach
      );
      stroke(RUNE[0], RUNE[1], RUNE[2], 230 * fade);
      strokeWeight(3);
      line(
        this.position.x,
        this.position.y,
        this.position.x + Math.cos(this.heading) * reach,
        this.position.y + Math.sin(this.heading) * reach
      );
      for (const fork of this.forks) {
        const rootX = this.position.x + Math.cos(this.heading) * reach * fork.at;
        const rootY = this.position.y + Math.sin(this.heading) * reach * fork.at;
        const grown = fork.length * split;
        stroke(RUNE[0], RUNE[1], RUNE[2], 190 * fade);
        strokeWeight(2);
        line(
          rootX,
          rootY,
          rootX + acrossX * fork.side * grown + Math.cos(this.heading) * grown * 0.4,
          rootY + acrossY * fork.side * grown + Math.sin(this.heading) * grown * 0.4
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((Q_RADIUS * 1.12 + 50) * 2);
    }
  }
  return Riven_Q_GroundCrack;
}
const __cacheRiven_Q_GroundCrack = new WeakMap<ContentApi, ReturnType<typeof __buildRiven_Q_GroundCrack>>();
export function makeRiven_Q_GroundCrack(api: ContentApi) {
  const cached = __cacheRiven_Q_GroundCrack.get(api);
  if (cached) return cached;
  const built = __buildRiven_Q_GroundCrack(api);
  __cacheRiven_Q_GroundCrack.set(api, built);
  return built;
}