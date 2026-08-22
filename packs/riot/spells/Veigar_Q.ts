import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { ExecuteSpell } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Veigar_Q = InstanceType<ReturnType<typeof makeVeigar_Q>>;
type Veigar_Q_Implode = InstanceType<ReturnType<typeof makeVeigar_Q_Implode>>;
type Veigar_Q_Object = InstanceType<ReturnType<typeof makeVeigar_Q_Object>>;
type Veigar_Q_Power = InstanceType<ReturnType<typeof makeVeigar_Q_Power>>;



/** Diameter of the orb, shared by the missile, the aim line and the preview. */
export const ORB_SIZE = 26;


function __buildVeigar_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const CollideUtils = api.utils.CollideUtils;
  const VectorUtils = api.utils.VectorUtils;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const liveStacks = makeLiveStacks(api);
  const createPowerStack = makeCreatePowerStack(api);
  const Veigar_Q_Object = makeVeigar_Q_Object(api);
  class Veigar_Q extends Spell implements ExecuteSpell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_veigar_q');
    name = 'Điềm Gở (Veigar_Q)';
    description =
      'Bắn ra một quả cầu năng lượng hắc ám xuyên qua mọi kẻ địch, gây <span class="damage">22 sát thương</span>.' +
      ' Mỗi kẻ địch <span class="buff">bị tiêu diệt</span> bởi quả cầu giúp Veigar' +
      ' <span class="buff">cộng dồn vĩnh viễn +20 năng lượng tối đa</span>, và hồi lại' +
      ' <span class="buff">20 năng lượng</span> ngay lập tức';
    coolDown = 5000;
    manaCost = 20;

    range = 550;
    damage = 22;
    manaPerStack = 20;
    /** Effectively permanent — 10 minutes is longer than any match lasts. */
    stackDuration = 600000;
    maxStacks = 999;

    /**
     * How many stacks Veigar is carrying, for the HUD badge and for the practice
     * panel. `Veigar_Q_Power` is a `countedStacks` buff — at most one live
     * instance ever exists, carrying the true count on `stacks` — but this
     * still sums across `liveStacks()` rather than reading index 0 directly,
     * covering the one-tick window where an old (already `toRemove`) instance
     * and a freshly-created one could both be in `owner.buffs` at once.
     */
    get stackCount(): number {
      return liveStacks(this.owner).reduce((sum, buff) => sum + buff.stacks, 0);
    }

    /**
     * The practice panel's write side. An absolute, uncapped set on the one
     * live instance's `stacks` — there is deliberately no `maxStacks` clamp
     * here, the same reasoning as `ChoGath_R.setStackCount`: this cheat has to
     * keep reaching whatever the tester asks for, and capped growth in real
     * play is `AttackableUnit.addBuff`'s job, not this method's.
     */
    setStackCount(count: number): boolean {
      if (!this.owner) return false;
      const target = Math.max(0, Math.floor(count));
      const existing = liveStacks(this.owner)[0];

      if (target <= 0) {
        existing?.deactivateBuff();
      } else if (existing) {
        existing.stacks = target;
        existing.onStacksChanged();
      } else {
        const buff = createPowerStack(this.owner, {
          image: this.image,
          manaPerStack: this.manaPerStack,
          stackDuration: this.stackDuration,
          maxStacks: this.maxStacks,
        });
        buff.stacks = target;
        this.owner.addBuff(buff);
      }
      return true;
    }

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);

      const obj = new Veigar_Q_Object(this.owner);
      obj.destination = to;
      obj.damage = this.damage;
      obj.manaPerStack = this.manaPerStack;
      obj.stackDuration = this.stackDuration;
      obj.maxStacks = this.maxStacks;

      this.game.objectManager.addObject(obj);
    }

    /**
     * Who the orb would hit *if fired this instant*, which for an aimed spell is
     * the only honest reading of `ExecuteSpell.executeCandidates`.
     *
     * `ExecuteMarks` promises "press the key and this one dies". For a spell that
     * picks its own victim that is unconditional; here it is conditional on the
     * cursor — and the cursor is known every frame, so the promise still holds at
     * the moment it is drawn. What makes it hold is testing the *line*: marking
     * everyone within 550px would light up a whole wave the shot cannot reach,
     * which is a promise the cast would break immediately.
     *
     * The line is the segment the orb really flies (always the full `range`,
     * wherever the cursor is), and the width is the same overlap the missile
     * resolves with — its own radius plus the body's. One `lineCircle` per
     * candidate, on a query that already had to happen.
     */
    executeCandidates(): AttackableUnit[] {
      const { from, to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      // A disc around the caster wide enough to contain the whole shot; the line
      // test below is what actually narrows it.
      const nearby = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: this.range + ORB_SIZE,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      const inTheWay: AttackableUnit[] = [];
      for (const enemy of nearby) {
        const reach = (enemy.stats?.size?.value ?? 0) / 2 + ORB_SIZE / 2;
        if (
          CollideUtils.lineCircle(
            from.x,
            from.y,
            to.x,
            to.y,
            enemy.position.x,
            enemy.position.y,
            reach
          )
        ) {
          inTheWay.push(enemy);
        }
      }
      return inTheWay;
    }

    /** Flat, and it pierces — so every body on the line is measured against it. */
    executeDamageAgainst(_target: AttackableUnit): number {
      return this.damage;
    }

    /**
     * The path, not a ring. `Spell.drawPreview`'s circle is right for a spell
     * with a radius and a lie for one that travels in a straight line: it showed
     * a 550px disc for a shot that only ever threatens a 26px-wide corridor.
     * `Blitzcrank_E` overrides it for the same reason, with its cone.
     */
    drawPreview() {
      const { from, to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      push();
      // the corridor the orb sweeps, at the width it actually hits
      stroke(120, 60, 190, 55);
      strokeWeight(ORB_SIZE);
      line(from.x, from.y, to.x, to.y);
      // a hard centre line, so the aim reads at a glance over pale ground
      stroke(20, 8, 34, 120);
      strokeWeight(4);
      line(from.x, from.y, to.x, to.y);
      stroke(200, 150, 255, 170);
      strokeWeight(2);
      line(from.x, from.y, to.x, to.y);
      // where it stops
      noFill();
      stroke(200, 150, 255, 150);
      strokeWeight(2);
      circle(to.x, to.y, ORB_SIZE);
      pop();
    }
  }
  return Veigar_Q;
}
const __cacheVeigar_Q = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_Q>>();
export default function makeVeigar_Q(api: ContentApi) {
  const cached = __cacheVeigar_Q.get(api);
  if (cached) return cached;
  const built = __buildVeigar_Q(api);
  __cacheVeigar_Q.set(api, built);
  return built;
}


/** The live stacks on `owner` — see `Veigar_Q.stackCount` on why `toRemove` is skipped. */
function __buildliveStacks(api: ContentApi) {
  const Veigar_Q_Power = makeVeigar_Q_Power(api);
  const liveStacks = (owner: any): Veigar_Q_Power[] =>
    (owner?.buffs ?? []).filter((buff: any) => buff instanceof Veigar_Q_Power && !buff.toRemove);
  return liveStacks;
}
const __cacheliveStacks = new WeakMap<ContentApi, ReturnType<typeof __buildliveStacks>>();
export function makeLiveStacks(api: ContentApi) {
  const cached = __cacheliveStacks.get(api);
  if (cached) return cached;
  const built = __buildliveStacks(api);
  __cacheliveStacks.set(api, built);
  return built;
}


/**
 * One stack, configured the one way it is ever configured.
 *
 * Called from `Veigar_Q_Object.onHit` (a real kill) and from
 * `Veigar_Q.setStackCount` (the practice panel), so the cheat cannot drift
 * from the real thing — the `stackId`, the add type and the bonus are what
 * make a stack stack, and a second copy of them is a second definition of the
 * spell.
 */
function __buildcreatePowerStack(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const Veigar_Q_Power = makeVeigar_Q_Power(api);
  function createPowerStack(
    owner: any,
    options: { image: any; manaPerStack: number; stackDuration: number; maxStacks: number }
  ): Veigar_Q_Power {
    const buff = new Veigar_Q_Power(options.stackDuration, owner, owner);
    buff.stackId = 'veigar_q_power';
    buff.image = options.image;
    buff.name = 'Sức Mạnh Hắc Ám';
    buff.buffAddType = BuffAddType.STACKS_AND_CONTINUE;
    buff.maxStacks = options.maxStacks;
    buff.bonuses = { maxMana: { baseBonus: options.manaPerStack } };
    return buff;
  }
  return createPowerStack;
}
const __cachecreatePowerStack = new WeakMap<ContentApi, ReturnType<typeof __buildcreatePowerStack>>();
export function makeCreatePowerStack(api: ContentApi) {
  const cached = __cachecreatePowerStack.get(api);
  if (cached) return cached;
  const built = __buildcreatePowerStack(api);
  __cachecreatePowerStack.set(api, built);
  return built;
}


/**
 * The permanent power Veigar collects. A plain `StatAmp` has no visuals at all,
 * which makes the whole point of the spell invisible; this subclass only adds a
 * drawing, the stacking behaviour is untouched.
 */
function __buildVeigar_Q_Power(api: ContentApi) {
  const StatAmp = api.buffs.StatAmp;
  class Veigar_Q_Power extends StatAmp {
    /**
     * Permanent and uniform, the same reasoning as `ChoGath_R_Growth`: no
     * per-stack duration or source, every stack worth exactly `manaPerStack`,
     * so N instances are N copies of the same information. One instance, a
     * `stacks` counter — see `Buff.countedStacks` and
     * `.superpowers/perf-healthbar-report.md`.
     */
    countedStacks = true;
    /**
     * One stack draws the whole orbit — otherwise every stack redraws all of
     * it. `countedStacks` already makes that automatic (there is only ever one
     * live instance), but this stays set anyway: it is the general mechanism
     * `AttackableUnit.drawBuffs()` reads, independent of any one buff being
     * counted, and it is what protects a *timed* stacking buff at high N.
     *
     * The orbit says "a lot of stacks"; the exact figure is on the buff-icon row
     * above the health bar, which `Champion.drawHealthBar` builds for every
     * champion by grouping buffs on `stackId`. See the same note on
     * `ChoGath_R_Growth.draw` — one convention, no per-spell number plates.
     */
    singleRepresentativeDraw = true;

    draw(): void {
      if (this.targetUnit.isDead) return;

      // The one live instance's own count — `countedStacks` means there is
      // never a second one to sum across.
      const n = this.stacks;
      const pos = this.targetUnit.position;
      const radius = this.targetUnit.animatedValues.displaySize / 2 + 14;
      const shown = Math.min(n, 12);

      push();
      translate(pos.x, pos.y);

      blendMode(ADD);
      noStroke();
      fill(90, 30, 150, Math.min(90, 22 + n * 7));
      circle(0, 0, radius * 2.2);
      blendMode(BLEND);

      // one dark mote in orbit per stack, up to a dozen; past that the ring is
      // simply "full" and the icon badge carries the exact count
      for (let i = 0; i < shown; i++) {
        const a = (i / shown) * TWO_PI + frameCount / 55;
        const r = radius + sin(frameCount / 30 + i) * 4;
        const x = cos(a) * r;
        const y = sin(a) * r;

        noStroke();
        blendMode(ADD);
        fill(120, 50, 210, 150);
        circle(x, y, 20);
        blendMode(BLEND);
        fill(185, 130, 255, 235);
        circle(x, y, 13);
        fill(22, 6, 40, 245);
        circle(x, y, 7);
      }

      pop();
    }
  }
  return Veigar_Q_Power;
}
const __cacheVeigar_Q_Power = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_Q_Power>>();
export function makeVeigar_Q_Power(api: ContentApi) {
  const cached = __cacheVeigar_Q_Power.get(api);
  if (cached) return cached;
  const built = __buildVeigar_Q_Power(api);
  __cacheVeigar_Q_Power.set(api, built);
  return built;
}


function __buildVeigar_Q_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const TrailSystem = api.helpers.TrailSystem;
  const createPowerStack = makeCreatePowerStack(api);
  const Veigar_Q_Implode = makeVeigar_Q_Implode(api);
  class Veigar_Q_Object extends MissileSpellObject {
    image = api.asset('spell_veigar_q');
    speed = 8;
    size = ORB_SIZE;
    // pierces everything, and every victim it *finishes* feeds the stacking
    maxHitCount = Infinity;

    damage = 22;
    manaPerStack = 20;
    stackDuration = 600000;
    maxStacks = 999;

    trailSystem = new TrailSystem({
      trailColor: '#6A2CA855',
      trailSize: this.size,
    });

    _pulse = 0;

    onAfterMove() {
      this._pulse += deltaTime;
    }

    onHit(enemy: any) {
      // The power is paid for by the corpse. The orb pierces, so stacking per
      // body it touched made one cast into a wave five permanent points of max
      // mana — the same "landed, not killed" mistake Nasus Q and Cho'Gath R had.
      const wasAlive = !enemy.isDead;
      enemy.takeDamage(this.damage, this.owner);

      if (wasAlive && enemy.isDead) {
        this.owner.addBuff(
          createPowerStack(this.owner, {
            image: this.image,
            manaPerStack: this.manaPerStack,
            stackDuration: this.stackDuration,
            maxStacks: this.maxStacks,
          })
        );
        // The room is worth nothing empty — `ChoGath_R` heals its new max health
        // for the same reason. `restoreMana` is the granting seam; a spell may
        // not name `stats.mana` itself (see the mana-spend seam test).
        this.owner.restoreMana(this.manaPerStack);
      }

      // the orb flies on through, so the hit gets its own collapse
      const implode = new Veigar_Q_Implode(this.owner);
      implode.position = enemy.position.copy();
      implode.targetSize = enemy.animatedValues?.displaySize ?? 40;
      this.game.objectManager.addObject(implode);
    }

    draw() {
      const s = this.size;
      const beat = 1 + 0.1 * sin(this._pulse / 90);

      push();
      translate(this.position.x, this.position.y);

      // corona: additive, so the orb glows rather than sitting flat on the ground
      blendMode(ADD);
      noStroke();
      fill(95, 35, 170, 55);
      circle(0, 0, s * 2.4 * beat);
      fill(150, 70, 235, 45);
      circle(0, 0, s * 1.5 * beat);
      blendMode(BLEND);

      // event horizon: bright rim, black core
      noStroke();
      fill(120, 55, 195);
      circle(0, 0, s * 1.06);
      fill(8, 2, 18);
      circle(0, 0, s * 0.72);

      // matter spiralling in
      noFill();
      stroke(205, 150, 255, 210);
      strokeWeight(2);
      for (let i = 0; i < 3; i++) {
        const a = this._pulse / 130 + (i * TWO_PI) / 3;
        arc(0, 0, s * (0.85 + i * 0.16), s * (0.85 + i * 0.16), a, a + 1.5);
      }

      // dark lightning licking off the rim
      stroke(190, 130, 255, 200);
      strokeWeight(1.5);
      for (let i = 0; i < 4; i++) {
        const a = this._pulse / 70 + (i * TWO_PI) / 4;
        const r0 = s * 0.55;
        const r1 = s * (0.75 + 0.25 * Math.abs(sin(this._pulse / 45 + i)));
        const mx = cos(a + 0.18) * ((r0 + r1) / 2);
        const my = sin(a + 0.18) * ((r0 + r1) / 2);
        beginShape();
        vertex(cos(a) * r0, sin(a) * r0);
        vertex(mx, my);
        vertex(cos(a - 0.14) * r1, sin(a - 0.14) * r1);
        endShape();
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 1.6;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Veigar_Q_Object;
}
const __cacheVeigar_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_Q_Object>>();
export function makeVeigar_Q_Object(api: ContentApi) {
  const cached = __cacheVeigar_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildVeigar_Q_Object(api);
  __cacheVeigar_Q_Object.set(api, built);
  return built;
}


/** Dark matter collapsing on whoever the orb passed through. */
function __buildVeigar_Q_Implode(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Veigar_Q_Implode extends SpellObject {
    targetSize = 40;
    age = 0;
    lifeTime = 380;
    maxRadius = 55;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);

      // ring rushing inward: the damage collapses onto the target
      noFill();
      stroke(180, 110, 255, 230 * fade);
      strokeWeight(4 * fade + 1);
      circle(0, 0, this.targetSize * 0.5 + this.maxRadius * 2 * (1 - t));

      // then a violet flash where it lands
      blendMode(ADD);
      noStroke();
      fill(140, 60, 220, 150 * t * fade * 3);
      circle(0, 0, this.targetSize * (0.8 + t));
      blendMode(BLEND);

      // shards of void flicking outward
      stroke(215, 175, 255, 220 * fade);
      strokeWeight(2);
      for (let i = 0; i < 6; i++) {
        const a = (i * TWO_PI) / 6 + t;
        const r0 = this.targetSize * 0.35 + 22 * t;
        line(cos(a) * r0, sin(a) * r0, cos(a) * (r0 + 12 * fade), sin(a) * (r0 + 12 * fade));
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius * 2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Veigar_Q_Implode;
}
const __cacheVeigar_Q_Implode = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_Q_Implode>>();
export function makeVeigar_Q_Implode(api: ContentApi) {
  const cached = __cacheVeigar_Q_Implode.get(api);
  if (cached) return cached;
  const built = __buildVeigar_Q_Implode(api);
  __cacheVeigar_Q_Implode.set(api, built);
  return built;
}