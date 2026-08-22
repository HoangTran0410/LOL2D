import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { ExecuteFallback, ExecuteSpell } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type ChoGath_R = InstanceType<ReturnType<typeof makeChoGath_R>>;
type ChoGath_R_Growth = InstanceType<ReturnType<typeof makeChoGath_R_Growth>>;
type ChoGath_R_Object = InstanceType<ReturnType<typeof makeChoGath_R_Object>>;



/** One Feast stack. Kept as constants so the heal matches the max health gained. */
export const SIZE_PER_STACK = 6;

export const MAX_HEALTH_PER_STACK = 75;


function __buildChoGath_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const pickExecuteTarget = api.combat.ExecuteTargeting.pickExecuteTarget;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const MAX_UNIT_SIZE = api.units.MAX_UNIT_SIZE;
  const AttackableUnit = api.units.AttackableUnit;
  const liveStacks = makeLiveStacks(api);
  const createGrowthStack = makeCreateGrowthStack(api);
  const ChoGath_R_Object = makeChoGath_R_Object(api);
  class ChoGath_R extends Spell implements ExecuteSpell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_chogath_r');
    name = "Xơi Tái (Cho'Gath_R)";
    description =
      `Ngoạm một kẻ địch trong phạm vi <span>200px</span> — <span class="buff">ưu tiên kẻ sẽ chết vì cú ngoạm này</span>, ` +
      `nếu không có thì kẻ gần nhất — gây <span class="damage">40 sát thương</span>. ` +
      `Chỉ khi <span class="buff">ăn tươi nuốt sống</span> (hạ gục bằng chiêu này), Cho'Gath mới ` +
      `<span class="buff">To Lên Vĩnh Viễn</span>: cộng dồn <span>+${SIZE_PER_STACK} kích thước</span> ` +
      `(tối đa <span>${MAX_UNIT_SIZE}</span>) và <span class="buff">+${MAX_HEALTH_PER_STACK} máu tối đa</span> (không giới hạn)`;
    coolDown = 10000;
    manaCost = 50;

    range = 200;
    damage = 40;
    /** Effectively permanent — long enough that a match ends before it reverts. */
    growthDuration = 600000;

    /**
     * How many Feast stacks Cho'Gath is carrying, for the HUD badge and for the
     * practice panel. `ChoGath_R_Growth` is a `countedStacks` buff — at most
     * one live instance ever exists, and it carries the true count on
     * `stacks` — but this still sums across `liveStacks()` rather than reading
     * index 0 directly, so it stays correct through the one-tick window where
     * an old (already `toRemove`) instance and a freshly-created one could
     * both be in `owner.buffs` at once.
     */
    get stackCount(): number {
      return liveStacks(this.owner).reduce((sum, buff) => sum + buff.stacks, 0);
    }

    /**
     * The practice panel's write side. An absolute, uncapped set — `stacks` is
     * one number on one instance now, so "give me 1000" costs exactly the same
     * as "give me 4"; there is deliberately no `maxStacks` clamp here, because
     * this cheat has to keep reaching whatever the tester asks for, capped
     * growth in real play is a different question (`AttackableUnit.addBuff`),
     * and `.superpowers/perf-healthbar-report.md` is what happens when the two
     * get conflated. Raising heals the health it just added, exactly as
     * `onSpellCast` does; lowering does not heal, and has to clamp health back
     * under the new (lower) maximum by hand — see the note in the body.
     */
    setStackCount(count: number): boolean {
      if (!this.owner) return false;
      const target = Math.max(0, Math.floor(count));
      const existing = liveStacks(this.owner)[0];
      const before = existing?.stacks ?? 0;
      if (target === before) return true;

      if (target <= 0) {
        existing?.deactivateBuff();
      } else if (existing) {
        existing.stacks = target;
        existing.onStacksChanged();
      } else {
        const growth = createGrowthStack(this.owner, this.growthDuration, this.image);
        growth.stacks = target;
        this.owner.addBuff(growth);
      }

      const delta = target - before;
      if (delta > 0) this.owner.takeHeal(MAX_HEALTH_PER_STACK * delta, this.owner);
      if (delta < 0) {
        // `Stats.update()` does constrain health to `maxHealth.value` — but only
        // when it runs, and it cannot: the panel that drives this holds the
        // match paused. Without this line Cho'Gath sits above his own maximum,
        // with a health bar past the end of itself, until the panel closes.
        this.owner.stats.health.baseValue = Math.min(
          this.owner.stats.health.baseValue,
          this.owner.stats.maxHealth.value
        );
      }
      return true;
    }

    /** A bite that kills nobody is still a bite: 40 damage on the nearest body. */
    readonly executeFallback: ExecuteFallback = 'nearest';

    checkCastCondition() {
      return !!this.findVictim();
    }

    onSpellCast() {
      const target = this.findVictim();
      if (!target) return;

      // The growth is paid for by the meal, not by the bite. Before this, holding
      // R next to anything at all bought permanent max health and size — the one
      // uncapped stat in the game, farmed off targets that never died.
      const wasAlive = !target.isDead;
      target.takeDamage(this.damage, this.owner);
      const devoured = wasAlive && target.isDead;

      if (devoured) {
        this.owner.addBuff(createGrowthStack(this.owner, this.growthDuration, this.image));
        // the extra max health is only worth something if it comes filled in
        this.owner.takeHeal(MAX_HEALTH_PER_STACK, this.owner);
      }

      const obj = new ChoGath_R_Object(this.owner);
      obj.position = target.position.copy();
      obj.angle = VectorUtils.getAngle(this.owner.position, target.position);
      obj.targetSize = target.animatedValues?.displaySize ?? 50;
      obj.devoured = devoured;
      this.game.objectManager.addObject(obj);
    }

    /** The one he should eat: killable first, otherwise nearest. */
    findVictim(): AttackableUnit | null {
      return pickExecuteTarget(this);
    }

    executeDamageAgainst(_target: AttackableUnit): number {
      return this.damage;
    }

    executeCandidates(): AttackableUnit[] {
      return this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          // The spell that causes the problem is also subject to it: every stack
          // grows Cho'Gath, and the next Feast has to reach past the wider gap
          // his own body now enforces.
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return ChoGath_R;
}
const __cacheChoGath_R = new WeakMap<ContentApi, ReturnType<typeof __buildChoGath_R>>();
export default function makeChoGath_R(api: ContentApi) {
  const cached = __cacheChoGath_R.get(api);
  if (cached) return cached;
  const built = __buildChoGath_R(api);
  __cacheChoGath_R.set(api, built);
  return built;
}


/** The live stacks on `owner` — see `ChoGath_R.stackCount` on why `toRemove` is skipped. */
function __buildliveStacks(api: ContentApi) {
  const ChoGath_R_Growth = makeChoGath_R_Growth(api);
  const liveStacks = (owner: any): ChoGath_R_Growth[] =>
    (owner?.buffs ?? []).filter((buff: any) => buff instanceof ChoGath_R_Growth && !buff.toRemove);
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
 * One Feast stack, configured the one way it is ever configured. Called from
 * `onSpellCast` (a real bite) and from `setStackCount` (the practice panel),
 * so the cheat cannot drift from the real thing.
 */
function __buildcreateGrowthStack(api: ContentApi) {
  const ChoGath_R_Growth = makeChoGath_R_Growth(api);
  function createGrowthStack(owner: any, duration: number, image: any): ChoGath_R_Growth {
    const growth = new ChoGath_R_Growth(duration, owner, owner);
    growth.image = image;
    return growth;
  }
  return createGrowthStack;
}
const __cachecreateGrowthStack = new WeakMap<ContentApi, ReturnType<typeof __buildcreateGrowthStack>>();
export function makeCreateGrowthStack(api: ContentApi) {
  const cached = __cachecreateGrowthStack.get(api);
  if (cached) return cached;
  const built = __buildcreateGrowthStack(api);
  __cachecreateGrowthStack.set(api, built);
  return built;
}


/**
 * Its own class rather than a bare `StatAmp`: `addBuff` groups stacks by
 * constructor, so a one-stack StatAmp from some other spell would otherwise
 * knock a Feast stack off the moment it landed.
 */
function __buildChoGath_R_Growth(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const StatAmp = api.buffs.StatAmp;
  class ChoGath_R_Growth extends StatAmp {
    name = 'Ăn Thịt';
    buffAddType = BuffAddType.STACKS_AND_CONTINUE;
    maxStacks = 99;

    /**
     * Permanent and uniform — no stack has its own expiry or source, every
     * stack is worth exactly `SIZE_PER_STACK`/`MAX_HEALTH_PER_STACK`, so N
     * instances carrying identical bonuses would carry exactly zero
     * information the number N does not. One instance, a `stacks` counter:
     * `AttackableUnit.addBuff()` grows it in place instead of pushing a new
     * instance per kill, and `StatAmp` scales `bonuses` by `stacks`
     * automatically. See `Buff.countedStacks` and
     * `.superpowers/perf-healthbar-report.md`.
     */
    countedStacks = true;

    bonuses = {
      size: { baseBonus: SIZE_PER_STACK },
      maxHealth: { baseBonus: MAX_HEALTH_PER_STACK },
    };

    /**
     * One stack draws the whole crown of horns for all of them — doing it per
     * stack would redraw the same ring N times. `countedStacks` makes that
     * automatic now (there is only ever one live instance to call `.draw()`
     * on), but `singleRepresentativeDraw` stays set too: it is the general
     * mechanism `AttackableUnit.drawBuffs()` and `Champion`'s status-text scan
     * both read, independent of whether any given buff happens to be counted,
     * and it is what protects a *timed* stacking buff at high N (see
     * `Buff.ts`) — nothing here should look like this flag stopped earning
     * its place just because this particular buff no longer needs the skip.
     *
     * The horns are the *feel* of the count, not the count. The exact number is
     * already on the buff-icon row above the health bar, which `Champion`
     * assembles for every champion on screen by grouping buffs on `stackId` —
     * one place, every stacking ability, friend and enemy alike. This used to
     * paint its own number plate under the model as well; so did Veigar Q, and
     * every future stacking spell would have had to invent a third. Nothing
     * world-space prints a tally any more.
     */
    singleRepresentativeDraw = true;

    draw(): void {
      if (this.targetUnit.isDead) return;

      // The one live instance's own count — `countedStacks` means there is
      // never a second one to sum across.
      const n = this.stacks;

      const pos = this.targetUnit.position;
      const radius = this.targetUnit.animatedValues.displaySize / 2;
      const beat = 1 + 0.04 * sin(frameCount / 18);

      push();
      translate(pos.x, pos.y);

      // one horn per Feast stack, so the count is readable at a glance
      const shown = Math.min(n, 14);
      for (let i = 0; i < shown; i++) {
        const a = (i / shown) * TWO_PI - HALF_PI + frameCount / 400;
        const r = (radius + 5) * beat;
        push();
        rotate(a + HALF_PI);
        stroke(50, 24, 28, 235);
        strokeWeight(2);
        fill(238, 228, 205, 245);
        triangle(0, -r - 17, -7, -r + 3, 7, -r + 3);
        noStroke();
        fill(160, 140, 120, 200);
        triangle(0, -r - 17, 0, -r + 3, 7, -r + 3);
        pop();
      }

      // a dark, hungry aura that deepens as he eats
      noFill();
      stroke(150, 45, 60, Math.min(190, 70 + n * 16));
      strokeWeight(3);
      circle(0, 0, (radius + 20) * 2 * beat);
      pop();
    }
  }
  return ChoGath_R_Growth;
}
const __cacheChoGath_R_Growth = new WeakMap<ContentApi, ReturnType<typeof __buildChoGath_R_Growth>>();
export function makeChoGath_R_Growth(api: ContentApi) {
  const cached = __cacheChoGath_R_Growth.get(api);
  if (cached) return cached;
  const built = __buildChoGath_R_Growth(api);
  __cacheChoGath_R_Growth.set(api, built);
  return built;
}


/** The bite mark left on the victim. */
function __buildChoGath_R_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class ChoGath_R_Object extends SpellObject {
    size = 90;
    lifeTime = 400;
    age = 0;
    angle = 0;
    targetSize = 50;
    /** The bite that actually fed him. Only difference is how hard it reads. */
    devoured = false;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const alpha = 235 * (1 - t);
      // the jaws start wide open and snap shut
      const gap = (1 - t) * (PI / 3);
      const r = this.size / 2;

      push();
      translate(this.position.x, this.position.y);
      rotate(this.angle);

      // flash of the bite landing — bigger and hotter when the jaws close on a
      // kill, which is the only bite that feeds him
      if (t < 0.4) {
        const bite = this.devoured ? 1.6 : 1.1;
        blendMode(ADD);
        noStroke();
        fill(255, 120, 110, (this.devoured ? 190 : 110) * (1 - t / 0.4));
        circle(0, 0, this.size * bite);
        blendMode(BLEND);
      }

      // upper and lower jaw, dark gums with a hard rim
      for (let side = -1; side <= 1; side += 2) {
        push();
        scale(1, side);

        noStroke();
        fill(95, 25, 35, alpha);
        arc(0, 0, this.size, this.size, gap, PI - gap, PIE);

        noFill();
        stroke(190, 70, 80, alpha);
        strokeWeight(3);
        arc(0, 0, this.size, this.size, gap, PI - gap);

        // teeth around the jaw line
        noStroke();
        fill(245, 240, 225, alpha);
        const teeth = 6;
        for (let i = 0; i <= teeth; i++) {
          const a = gap + ((PI - gap * 2) * i) / teeth;
          const tx = cos(a) * r;
          const ty = sin(a) * r;
          push();
          translate(tx, ty);
          rotate(a - HALF_PI);
          triangle(0, -13, -4.5, 2, 4.5, 2);
          pop();
        }
        pop();
      }

      // blood flicking out of the closing jaws
      noStroke();
      fill(170, 40, 55, alpha * 0.9);
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.45;
        const d = r * (0.5 + t * 1.1);
        circle(cos(a) * d, sin(a) * d, (7 - i * 0.6) * (1 - t));
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 0.8;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return ChoGath_R_Object;
}
const __cacheChoGath_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildChoGath_R_Object>>();
export function makeChoGath_R_Object(api: ContentApi) {
  const cached = __cacheChoGath_R_Object.get(api);
  if (cached) return cached;
  const built = __buildChoGath_R_Object(api);
  __cacheChoGath_R_Object.set(api, built);
  return built;
}