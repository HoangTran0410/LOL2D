import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Root = InstanceType<ContentApi['buffs']['Root']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Caitlyn_W = InstanceType<ReturnType<typeof makeCaitlyn_W>>;
type Caitlyn_W_Trap = InstanceType<ReturnType<typeof makeCaitlyn_W_Trap>>;



export const CAITLYN_W_PLACE_RANGE = 500;

/** The window in which a trap can be walked over for free. */
export const CAITLYN_W_ARM_DELAY_MS = 1000;

export const CAITLYN_W_LIFETIME_MS = 14000;

export const CAITLYN_W_TRIGGER_RADIUS = 46;

export const CAITLYN_W_ROOT_MS = 1500;

export const CAITLYN_W_REVEAL_MS = 3000;

export const CAITLYN_W_DAMAGE = 18;

export const CAITLYN_W_MAX_TRAPS = 3;

/**
 * The reveal's own slot. Required by `createReveal` and read by Caitlyn Q, which
 * pays full damage to anyone wearing it — that link is the kit's one combo and
 * it has to be a shared constant, not two copies of a string.
 */
export const CAITLYN_W_REVEAL_STACK_ID = 'caitlyn_w';


/**
 * Yordle Snap Trap — the zoning half of the kit.
 *
 * Only champions spring it: a trap that any passing minion could clear would
 * never survive a lane, and the whole point of the ability is that a bush or a
 * choke stops being free to walk through.
 */
function __buildCaitlyn_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Caitlyn_W_Trap = makeCaitlyn_W_Trap(api);
  class Caitlyn_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_caitlyn_w');
    name = 'Bẫy Yordle (Caitlyn_W)';
    description =
      `Đặt một cái bẫy, kích hoạt sau <span class="time">${CAITLYN_W_ARM_DELAY_MS / 1000} giây</span>` +
      ` và tồn tại <span class="time">${CAITLYN_W_LIFETIME_MS / 1000} giây</span>.` +
      ` Tướng địch dẫm phải bị <span class="buff">Trói ${CAITLYN_W_ROOT_MS / 1000} giây</span>,` +
      ` <span class="buff">Lộ Diện ${CAITLYN_W_REVEAL_MS / 1000} giây</span> và nhận` +
      ` <span class="damage">${CAITLYN_W_DAMAGE} sát thương</span>.` +
      ` Tối đa <span>${CAITLYN_W_MAX_TRAPS}</span> bẫy cùng lúc.`;

    coolDown = 5000;
    manaCost = 30;

    range = CAITLYN_W_PLACE_RANGE;

    /** Oldest first. The cap is enforced here rather than by a quadtree sweep. */
    traps: Caitlyn_W_Trap[] = [];

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        CAITLYN_W_PLACE_RANGE
      );

      const trap = new Caitlyn_W_Trap(this.owner);
      trap.position = to;
      this.game.objectManager.addObject(trap);

      // Prune first: a trap that has already sprung or timed out is not holding a
      // slot, and reading `toRemove` is the only way to know that while the match
      // is paused and nothing has flushed.
      const live: Caitlyn_W_Trap[] = [];
      for (const existing of this.traps) if (!existing.toRemove) live.push(existing);
      live.push(trap);
      while (live.length > CAITLYN_W_MAX_TRAPS) {
        const oldest = live.shift();
        if (oldest) oldest.expire();
      }
      this.traps = live;
    }

    get stackCount(): number | undefined {
      let count = 0;
      for (const trap of this.traps) if (!trap.toRemove) count++;
      return count;
    }
  }
  return Caitlyn_W;
}
const __cacheCaitlyn_W = new WeakMap<ContentApi, ReturnType<typeof __buildCaitlyn_W>>();
export default function makeCaitlyn_W(api: ContentApi) {
  const cached = __cacheCaitlyn_W.get(api);
  if (cached) return cached;
  const built = __buildCaitlyn_W(api);
  __cacheCaitlyn_W.set(api, built);
  return built;
}


/**
 * The trap on the floor.
 *
 * Ground art, so `zIndex = GROUND_Z_INDEX` — a `SpellObject` subclass otherwise
 * resolves to `SPELL_EFFECT_Z_INDEX` and paints over the feet of everyone standing on it, which
 * for a trap would hide the champion it just caught.
 *
 * The motif is Piltover hardware: a hexagonal brass plate with sprung jaws and a
 * hextech eye in the middle. Nothing else in the game draws a hexagon, which is
 * what makes it Caitlyn's from across the map.
 */
function __buildCaitlyn_W_Trap(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Champion = api.units.Champion;
  const Root = api.buffs.Root;
  const createReveal = api.buffs.createReveal;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Caitlyn_W_Trap extends SpellObject {
    zIndex = GROUND_Z_INDEX;

    age = 0;
    armDelay = CAITLYN_W_ARM_DELAY_MS;
    lifeTime = CAITLYN_W_LIFETIME_MS;
    triggerRadius = CAITLYN_W_TRIGGER_RADIUS;

    /** 0 = unsprung, otherwise how long the cage has been up. */
    sprungFor = 0;
    sprungDuration = 700;
    sprung = false;

    visionRadius = 180;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(120, 220, 225, 0.55)',
      0.3
    );

    /** Seeded once in `onAdded`: the cage bars only look like a cage if they hold still. */
    _bars: { angle: number; lean: number }[] = [];

    onAdded() {
      this.useParticles(this.particleSystem);
      for (let i = 0; i < 8; i++) {
        this._bars.push({ angle: (TWO_PI / 8) * i, lean: random(-0.16, 0.16) });
      }
    }

    update() {
      if (this.sprung) {
        this.sprungFor += deltaTime;
        if (this.sprungFor >= this.sprungDuration) this.toRemove = true;
        return;
      }

      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }
      if (this.age < this.armDelay) return;

      const victims = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.triggerRadius,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const victim of victims) {
        // Minions walk over it. Only a champion is worth a trap.
        if (!(victim instanceof Champion)) continue;
        this.spring(victim);
        return;
      }
    }

    /** Fires once. The trap is spent whether or not the root survives its target. */
    spring(victim: AttackableUnit) {
      if (this.sprung) return;
      this.sprung = true;
      this.sprungFor = 0;

      const root = new Root(CAITLYN_W_ROOT_MS, this.owner, victim);
      victim.addBuff(root);
      victim.addBuff(
        createReveal({
          stackId: CAITLYN_W_REVEAL_STACK_ID,
          durationMs: CAITLYN_W_REVEAL_MS,
          source: this.owner,
          target: victim,
          visionRadius: 200,
        })
      );
      victim.takeDamage(CAITLYN_W_DAMAGE, this.owner);

      for (let i = 0; i < 18; i++) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-28, 28),
          y: this.position.y + random(-28, 28),
          r: random(4, 11),
        });
      }
    }

    /** Pushed off the end of the trap list, or cleaned up. Idempotent. */
    expire() {
      this.toRemove = true;
    }

    draw() {
      const armed = this.age >= this.armDelay;
      // it screws itself into the ground over the arming second instead of
      // appearing finished — that second is the window to walk over it for free
      const arming = constrain(this.age / this.armDelay, 0, 1);
      const settle = 1 - (1 - arming) * (1 - arming);
      const d = this.triggerRadius * 2;

      push();
      translate(this.position.x, this.position.y);

      if (this.sprung) {
        this.drawCage();
        pop();
        return;
      }

      // the plate turns as it beds in, then holds still once armed
      rotate(armed ? 0 : (1 - settle) * 1.2);

      // brass hexagon body
      stroke(96, 68, 30, 235);
      strokeWeight(3);
      fill(168, 124, 52, 210);
      beginShape();
      for (let i = 0; i < 6; i++) {
        const a = (TWO_PI / 6) * i;
        vertex(cos(a) * d * 0.42 * settle, sin(a) * d * 0.42 * settle);
      }
      endShape(CLOSE);

      // the sprung jaws, folded flat and waiting
      stroke(210, 190, 150, 220);
      strokeWeight(2.5);
      for (const bar of this._bars) {
        const a = bar.angle + bar.lean;
        line(
          cos(a) * d * 0.2 * settle,
          sin(a) * d * 0.2 * settle,
          cos(a) * d * 0.44 * settle,
          sin(a) * d * 0.44 * settle
        );
      }

      // the hextech eye: dark while it beds in, then a steady live glow, so
      // "armed" is one unambiguous state change rather than a fade
      noStroke();
      if (armed) {
        const pulse = 0.55 + 0.45 * sin(frameCount * 0.07);
        fill(90, 225, 230, 90 + 90 * pulse);
        circle(0, 0, d * 0.5);
        fill(200, 255, 255, 210 + 40 * pulse);
        circle(0, 0, d * 0.16);
      } else {
        fill(70, 90, 92, 200);
        circle(0, 0, d * 0.22 * settle);
      }
      pop();
    }

    /** The catch: bars snapping up out of the plate around whoever stepped in. */
    drawCage() {
      const t = constrain(this.sprungFor / this.sprungDuration, 0, 1);
      const fade = 1 - t;
      // snap-out: the cage is up almost immediately, then holds while it fades
      const snap = 1 - (1 - constrain(t / 0.22, 0, 1)) * (1 - constrain(t / 0.22, 0, 1));
      const d = this.triggerRadius * 2;

      noFill();
      stroke(120, 235, 240, 235 * fade);
      strokeWeight(4 * fade + 1.5);
      circle(0, 0, d * (0.6 + 0.5 * snap));

      stroke(215, 250, 250, 230 * fade);
      strokeWeight(3);
      for (const bar of this._bars) {
        const a = bar.angle + bar.lean;
        const base = d * 0.24;
        const top = d * 0.24 + d * 0.42 * snap;
        // bars lean inward as they rise, so it closes over the victim
        line(cos(a) * base, sin(a) * base, cos(a) * top * 0.82, sin(a) * top * 0.82 - 16 * snap);
      }

      const flash = 1 - constrain(t / 0.18, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(230, 255, 255, 235 * flash);
        circle(0, 0, d * 0.5 * flash + 10);
      }
    }

    getDisplayBoundingBox() {
      const r = this.triggerRadius * 1.8 + 20;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Caitlyn_W_Trap;
}
const __cacheCaitlyn_W_Trap = new WeakMap<ContentApi, ReturnType<typeof __buildCaitlyn_W_Trap>>();
export function makeCaitlyn_W_Trap(api: ContentApi) {
  const cached = __cacheCaitlyn_W_Trap.get(api);
  if (cached) return cached;
  const built = __buildCaitlyn_W_Trap(api);
  __cacheCaitlyn_W_Trap.set(api, built);
  return built;
}