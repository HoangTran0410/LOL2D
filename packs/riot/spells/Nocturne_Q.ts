import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatsModifier = InstanceType<ContentApi['units']['StatsModifier']>;
type Nocturne_Dusk = InstanceType<ReturnType<typeof makeNocturne_Dusk>>;
type Nocturne_Q = InstanceType<ReturnType<typeof makeNocturne_Q>>;
type Nocturne_Q_Object = InstanceType<ReturnType<typeof makeNocturne_Q_Object>>;
type Nocturne_Q_Trail = InstanceType<ReturnType<typeof makeNocturne_Q_Trail>>;



export const RANGE = 620;

export const DAMAGE = 26;

/** Wiki: "Dusk Trails last 5 seconds and will slowly disappear afterwards." */
export const TRAIL_MS = 5000;

export const TRAIL_RADIUS = 55;

/** How far the source travels before it drops another patch of trail. */
export const TRAIL_STEP = 22;

export const SPEED_PERCENT = 0.35;

export const BONUS_ATTACK_DAMAGE = 8;

/** How long the buff outlives the last frame Nocturne was on the trail. */
export const DUSK_GRACE_MS = 250;


/**
 * Duskbringer.
 *
 * `docs/abilities/nocturne/q.json`: the blade *"leaves a Dusk Trail in its
 * wake"*, enemy champions it hits *"leave a Dusk Trail behind while moving"*,
 * the trails last 5 seconds, and — the part that matters —
 * **"while on the Dusk Trail, Nocturne is ghosted and gains bonus attack
 * damage and bonus movement speed."**
 *
 * The first version read the tooltip as "casting gives Nocturne speed" and
 * just applied a `Speedup` on cast. That is a different ability: it deleted
 * the trail, deleted the ghosting and the attack damage, and deleted the whole
 * point — that Duskbringer is a *lane* Nocturne carves and then has to stand
 * in, and that hitting a champion paints one wherever they run.
 */
function __buildNocturne_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Nocturne_Q_Object = makeNocturne_Q_Object(api);
  const Nocturne_Q_Trail = makeNocturne_Q_Trail(api);
  class Nocturne_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_nocturne_q');
    name = 'Thanh Gươm Bóng Tối (Nocturne_Q)';
    description =
      `Phóng lưỡi hái xuyên thẳng <span>${RANGE}px</span>, gây <span class="damage">${DAMAGE} sát thương</span>` +
      ` và <span class="buff">để lại Vệt Hoàng Hôn</span> dọc đường bay trong` +
      ` <span class="time">${TRAIL_MS / 1000} giây</span>. Tướng địch trúng chiêu cũng <span class="buff">rớt vệt</span>` +
      ` khi di chuyển. <span class="buff">Khi đứng trên vệt</span>, Nocturne` +
      ` <span class="buff">+${SPEED_PERCENT * 100}% tốc chạy</span>,` +
      ` <span class="buff">+${BONUS_ATTACK_DAMAGE} sát thương đánh thường</span> và` +
      ` <span class="buff">đi xuyên qua mọi đơn vị</span>`;
    coolDown = 8000;
    manaCost = 30;

    range = RANGE;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);
      const blade = new Nocturne_Q_Object(this.owner);
      blade.destination = to;
      this.game.objectManager.addObject(blade);

      // The blade's own trail, laid down as it flies. Nothing is granted here:
      // the buff is the trail's to give, and only while he is standing on it.
      const trail = new Nocturne_Q_Trail(this.owner);
      trail.source = blade;
      this.game.objectManager.addObject(trail);
      blade.trail = trail;
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Nocturne_Q;
}
const __cacheNocturne_Q = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_Q>>();
export default function makeNocturne_Q(api: ContentApi) {
  const cached = __cacheNocturne_Q.get(api);
  if (cached) return cached;
  const built = __buildNocturne_Q(api);
  __cacheNocturne_Q.set(api, built);
  return built;
}


function __buildNocturne_Q_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Nocturne_Q_Trail = makeNocturne_Q_Trail(api);
  class Nocturne_Q_Object extends MissileSpellObject {
    speed = 15;
    size = 24;
    maxHitCount = Infinity;
    trail: Nocturne_Q_Trail | null = null;

    onHit(enemy: AttackableUnit) {
      enemy.takeDamage(DAMAGE, this.owner);

      // "Enemy champions hit will leave a Dusk Trail behind while moving" — the
      // victim becomes a second source, so running paints Nocturne a road.
      const painted = new Nocturne_Q_Trail(this.owner);
      painted.source = enemy;
      painted.sourceLifeMs = TRAIL_MS;
      this.game.objectManager.addObject(painted);
    }

    draw() {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      push();
      translate(this.position.x, this.position.y);
      rotate(angle);
      noStroke();
      fill(40, 20, 70, 190);
      ellipse(-16, 0, 44, 20);
      fill(190, 120, 255, 235);
      arc(0, 0, 34, 30, -1.1, 1.1);
      pop();
    }
  }
  return Nocturne_Q_Object;
}
const __cacheNocturne_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_Q_Object>>();
export function makeNocturne_Q_Object(api: ContentApi) {
  const cached = __cacheNocturne_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildNocturne_Q_Object(api);
  __cacheNocturne_Q_Object.set(api, built);
  return built;
}


/** One patch of ground the trail covers, with its own clock. */
interface DuskPatch {
  x: number;
  y: number;
  age: number;
}


/**
 * A Dusk Trail: a line of ground that outlives whatever drew it.
 *
 * Its `source` is whatever is currently painting — the blade in flight, or a
 * champion who was hit and is running. When the source is gone the trail keeps
 * living on its own until its last patch has aged out, which is what makes it
 * terrain rather than an attachment.
 */
function __buildNocturne_Q_Trail(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Nocturne_Dusk = makeNocturne_Dusk(api);
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Nocturne_Q_Trail extends SpellObject {
    source: SpellObject | AttackableUnit | null = null;
    /** For a painted champion: how long they keep dropping patches. */
    sourceLifeMs = Infinity;
    sourceAge = 0;
    patches: DuskPatch[] = [];
    visionRadius = TRAIL_RADIUS;

    /**
     * Under the units standing on it.
     *
     * `classLayerOf` walks a `SpellObject` subclass with no zIndex of its own up
     * to `SPELL_EFFECT_Z_INDEX`, which paints over champions. That is right for
     * a missile and wrong for a stain on the floor: the trail was covering the
     * feet of everyone walking down it. Same value `Singed_W` and `Cassiopeia_W`
     * set, for the same reason.
     */
    zIndex = GROUND_Z_INDEX;

    update() {
      const step = deltaTime;
      for (const patch of this.patches) patch.age += step;
      // A trail is a queue: the oldest end fades first, so it retreats rather
      // than blinking out all at once.
      while (this.patches.length && this.patches[0].age >= TRAIL_MS) this.patches.shift();

      this.paint(step);
      this.grantDusk();

      if (!this.patches.length && !this.source) this.toRemove = true;
    }

    /** Drops a patch every `TRAIL_STEP` the source covers, not every frame. */
    paint(step: number) {
      const source = this.source as { position?: p5.Vector; toRemove?: boolean; isDead?: boolean };
      if (!source?.position || source.toRemove || source.isDead) {
        this.source = null;
        return;
      }

      this.sourceAge += step;
      if (this.sourceAge >= this.sourceLifeMs) {
        this.source = null;
        return;
      }

      const last = this.patches[this.patches.length - 1];
      const { x, y } = source.position;
      if (last && Math.hypot(x - last.x, y - last.y) < TRAIL_STEP) return;
      this.patches.push({ x, y, age: 0 });
      this.position.set(x, y);
    }

    /** True while Nocturne's body is over any live patch. */
    get ownerIsOnTrail(): boolean {
      const { x, y } = this.owner.position;
      for (const patch of this.patches) {
        if (Math.hypot(x - patch.x, y - patch.y) <= TRAIL_RADIUS) return true;
      }
      return false;
    }

    /**
     * Refreshed every frame he is on it rather than applied once: the buff is a
     * *state*, and `DUSK_GRACE_MS` is only long enough that stepping between two
     * patches does not flicker it off.
     */
    grantDusk() {
      if (this.owner.isDead || !this.ownerIsOnTrail) return;
      const dusk = new Nocturne_Dusk(DUSK_GRACE_MS, this.owner, this.owner);
      dusk.image = api.asset('spell_nocturne_q');
      this.owner.addBuff(dusk);
    }

    draw() {
      if (!this.patches.length) return;

      push();
      // A path, not a string of beads.
      //
      // Each patch used to be drawn as its own circle, so a trail read as a row
      // of overlapping discs with scalloped edges — the one shape it must not
      // have, because the thing the player needs to judge is *where the band is*
      // and a scalloped edge makes its boundary a guess. Stroking segment by
      // segment with round caps gives one continuous ribbon that still fades from
      // the oldest end, which a single stroked polyline could not do.
      strokeCap(ROUND);
      strokeJoin(ROUND);
      noFill();

      // one patch and there is no segment to stroke yet
      if (this.patches.length === 1) {
        const only = this.patches[0];
        const left = 1 - only.age / TRAIL_MS;
        noStroke();
        fill(60, 20, 100, 90 * left);
        circle(only.x, only.y, TRAIL_RADIUS * 2);
        fill(160, 90, 240, 120 * left);
        circle(only.x, only.y, TRAIL_RADIUS * 1.1);
        pop();
        return;
      }

      // pass one: the wide bruise, so no segment's edge cuts across another
      for (let i = 1; i < this.patches.length; i++) {
        const a = this.patches[i - 1];
        const b = this.patches[i];
        const left = 1 - b.age / TRAIL_MS;
        stroke(60, 20, 100, 90 * left);
        strokeWeight(TRAIL_RADIUS * 2);
        line(a.x, a.y, b.x, b.y);
      }

      // pass two: the brighter core down the middle of it
      for (let i = 1; i < this.patches.length; i++) {
        const a = this.patches[i - 1];
        const b = this.patches[i];
        const left = 1 - b.age / TRAIL_MS;
        stroke(160, 90, 240, 120 * left);
        strokeWeight(TRAIL_RADIUS * 1.1);
        line(a.x, a.y, b.x, b.y);
      }

      // pass three: shadow crawling along it toward the leading end, so a live
      // trail is visibly different from one that has stopped being painted
      const head = this.patches[this.patches.length - 1];
      stroke(220, 180, 255, 150);
      strokeWeight(3);
      for (let i = 1; i < this.patches.length; i++) {
        const b = this.patches[i];
        const left = 1 - b.age / TRAIL_MS;
        const wave = (i / this.patches.length + (frameCount % 90) / 90) % 1;
        if (wave > 0.12) continue;
        const a = this.patches[i - 1];
        stroke(220, 180, 255, 170 * left);
        line(a.x, a.y, b.x, b.y);
      }
      // and a soft head where the paint is being laid down
      noStroke();
      fill(200, 150, 255, 90);
      circle(head.x, head.y, TRAIL_RADIUS * 1.3);
      pop();
    }

    getDisplayBoundingBox() {
      if (!this.patches.length) {
        return new Rectangle({ x: this.position.x, y: this.position.y, w: 1, h: 1, data: this });
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const patch of this.patches) {
        if (patch.x < minX) minX = patch.x;
        if (patch.y < minY) minY = patch.y;
        if (patch.x > maxX) maxX = patch.x;
        if (patch.y > maxY) maxY = patch.y;
      }
      return new Rectangle({
        x: minX - TRAIL_RADIUS,
        y: minY - TRAIL_RADIUS,
        w: maxX - minX + TRAIL_RADIUS * 2,
        h: maxY - minY + TRAIL_RADIUS * 2,
        data: this,
      });
    }
  }
  return Nocturne_Q_Trail;
}
const __cacheNocturne_Q_Trail = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_Q_Trail>>();
export function makeNocturne_Q_Trail(api: ContentApi) {
  const cached = __cacheNocturne_Q_Trail.get(api);
  if (cached) return cached;
  const built = __buildNocturne_Q_Trail(api);
  __cacheNocturne_Q_Trail.set(api, built);
  return built;
}


/** Ghosted, faster, hitting harder — the three things the trail is worth. */
function __buildNocturne_Dusk(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const StatusFlags = api.enums.StatusFlags;
  const Buff = api.buffs.Buff;
  const StatsModifier = api.units.StatsModifier;
  class Nocturne_Dusk extends Buff {
    name = 'Vệt Hoàng Hôn';
    buffAddType = BuffAddType.RENEW_EXISTING;
    maxStacks = 1;

    statusFlagsToEnable = StatusFlags.Ghosted;
    statsModifier: StatsModifier = new StatsModifier();

    onCreate(): void {
      this.statsModifier = new StatsModifier();
      this.statsModifier.speed.percentBaseBonus = SPEED_PERCENT;
      this.statsModifier.attackDamage.baseBonus = BONUS_ATTACK_DAMAGE;
    }

    onActivate(): void {
      this.targetUnit.stats.addModifier(this.statsModifier);
    }

    onDeactivate(): void {
      this.targetUnit.stats.removeModifier(this.statsModifier);
    }
  }
  return Nocturne_Dusk;
}
const __cacheNocturne_Dusk = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_Dusk>>();
export function makeNocturne_Dusk(api: ContentApi) {
  const cached = __cacheNocturne_Dusk.get(api);
  if (cached) return cached;
  const built = __buildNocturne_Dusk(api);
  __cacheNocturne_Dusk.set(api, built);
  return built;
}