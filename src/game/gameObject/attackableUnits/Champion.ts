import AssetManager, { type AssetHandle, type AssetKey } from '@/managers/AssetManager';
import { packAsset } from '@/game/config/packAsset';
import { CHAMPION_Z_INDEX } from '@/game/managers/ObjectManager';
import type Spell from '@/game/gameObject/Spell';
import BasicAttackController from '@/game/combat/BasicAttackController';
import AttackableUnit from './AttackableUnit';
import type {
  AttackableUnitOptions,
  AttackableUnitRenderOptions,
  UnitDeathData,
} from './AttackableUnit';
import type { KillCredit } from '@/game/combat/MatchTally';
import Airborne from '@/game/gameObject/buffs/Airborne';
import Charm from '@/game/gameObject/buffs/Charm';
import Dash from '@/game/gameObject/buffs/Dash';
import Fear from '@/game/gameObject/buffs/Fear';
import Root from '@/game/gameObject/buffs/Root';
import Silence from '@/game/gameObject/buffs/Silence';
import Slow from '@/game/gameObject/buffs/Slow';
import Stun from '@/game/gameObject/buffs/Stun';
import Taunt from '@/game/gameObject/buffs/Taunt';
import type Buff from '@/game/gameObject/Buff';
import type { BuffStackId } from '@/game/gameObject/Buff';

/** A champion's basic attack profile. `range` alone decides melee or ranged. */
export interface ChampionAttackTuning {
  /** Damage per swing. */
  damage: number;
  /** Swings per second. */
  attacksPerSecond: number;
  /** Surface-to-surface reach. Above MELEE_RANGE_THRESHOLD this fires a bolt. */
  range: number;
}

/**
 * Basic attack numbers for a champion with no profile of its own.
 *
 * A champion pool is 100 health, a minion 140, a turret 400 dealing 12 per
 * 1.3s (9.2 dps). 14 per swing at 1.1/s is 15.4 dps, so autos alone take about
 * seven connected swings — a little over six seconds once regeneration is
 * counted — to end a champion. That is long enough that a duel is a fight with
 * room for spells and disengages, and short enough that autoing is worth doing.
 *
 * 0.8/s was the previous rate, and it was the same rate for every champion in
 * the game: a kit designed to be carried by attack speed had none to be carried
 * by. Roles now declare their own profile — see `ATTACK` in `packs/riot/data.ts`
 * — and this is only the fallback for anything that names no role.
 *
 * The range is 300, comfortably inside the 500 sight radius (so you can attack
 * what you can see and the leash never fires first) and below a turret's 430.
 */
export const DEFAULT_CHAMPION_ATTACK: ChampionAttackTuning = {
  damage: 14,
  attacksPerSecond: 1.1,
  range: 300,
};

export interface ChampionPresetData {
  name?: string;
  /**
   * A pack's own asset key — a plain string, not core's generated `AssetKey`
   * union, because a pack's art is its own to type-check, not core's. See
   * `preset.ts`'s `PlayableChampionKit` for the write side and
   * `@/game/config/packAsset` for the read side, below.
   */
  avatar?: string;
  spells?: Array<new (owner: Champion) => Spell>;
  /** Overrides DEFAULT_CHAMPION_ATTACK. Drop `range` below the melee threshold
   *  and the champion swings instead of shooting; nothing else changes. */
  attack?: ChampionAttackTuning;
}

export interface ChampionOptions extends Omit<AttackableUnitOptions, 'avatar'> {
  avatar?: AssetHandle;
  preset?: ChampionPresetData;
}

/**
 * Health per tick mark on a champion's bar. The frame is a fixed width, so the
 * number of ticks is what communicates pool size: more ticks means more health.
 * The step widens once a pool would draw more than MAX_TICKS, otherwise a
 * grown-out health pool's bar turns into a solid block of lines.
 */
/**
 * Crowd-control buffs named under the health bar, in the order they print.
 * Module-level because the list is fixed and `drawHealthBar` runs per champion
 * per frame — rebuilding it there made a nine-element array 60 times a second
 * per champion for a label that is usually empty.
 */
const STATUS_TEXT_BUFFS = [Airborne, Root, Silence, Dash, Stun, Slow, Charm, Fear, Taunt];

/**
 * `STATUS_TEXT_BUFFS[Cls.prototype]` -> that class's index, so a buff's slot
 * can be found in one lookup instead of nine sequential `instanceof` checks.
 *
 * The naive version of this ("index by `buff.constructor`") is wrong: a
 * content pack subclasses these freely — two ultimates on the bundled roster
 * ship a knockback extending `Dash`, and one ships a movement debuff
 * extending `Slow` — so an exact-constructor match would silently stop
 * showing "Ghosted"/"Chậm" for anyone hit by those. Walking the buff's
 * own prototype chain and checking each level against this map reproduces
 * `instanceof`'s subclass-matching exactly, at whatever depth a future spell
 * adds — see `champion-status-text-scan-cost.test.ts`'s subclass case.
 */
const STATUS_TEXT_BUFF_INDEX = new Map<unknown, number>(
  STATUS_TEXT_BUFFS.map((BuffClass, index) => [BuffClass.prototype, index])
);

/**
 * `instanceof` against every `STATUS_TEXT_BUFFS` entry in one prototype-chain
 * walk instead of nine separate chain walks, one per candidate class. -1 if
 * `buff` is none of them (the common case for a champion carrying a large
 * permanent stat stack, none of which are crowd control). See the O(9N)
 * note on `STATUS_TEXT_BUFFS` above.
 *
 * Held as a method on a plain object, not a bare function, so a test can
 * `vi.spyOn` it directly to count calls — the seam for
 * `champion-status-text-duplicate-skip.test.ts`, which proves
 * `drawHealthBar` stops calling it for the 2nd..Nth instance of a
 * `singleRepresentativeDraw` stack (`Buff.ts`) once the first has answered
 * for that `stackId`, same idea as `AttackableUnit.drawBuffs()`'s skip and
 * for the same reason: at N in the thousands (a cheat-console stack count,
 * not a design limit — see `.superpowers/perf-healthbar-report.md`), a
 * prototype-chain walk run once per instance instead of once per *group* is
 * a real, measured, avoidable cost.
 */
export const ChampionStatusText = {
  indexOf(buff: Buff): number {
    let proto: unknown = Object.getPrototypeOf(buff);
    while (proto) {
      const index = STATUS_TEXT_BUFF_INDEX.get(proto);
      if (index !== undefined) return index;
      proto = Object.getPrototypeOf(proto);
    }
    return -1;
  },
};

export const TICK_LADDER = [50, 100, 250, 500, 1_000, 2_500] as const;
export const MAX_TICKS = 20;

/** Rounds `raw` up to the next "nice" step — 1, 2 or 5 times a power of ten —
 *  the standard technique for picking readable axis/tick spacing. Always
 *  `>= raw`, so a step from this function can never let a tick count exceed
 *  `maxHealth / step`'s ceiling. Only ever called past `TICK_LADDER`'s own
 *  reach (health > 50,000), so `raw` here is always a few thousand or more —
 *  not a general-purpose helper asked to behave at zero or negative input. */
const niceStepAtLeast = (raw: number): number => {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const niceMultiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceMultiplier * magnitude;
};

export const healthTickStep = (maxHealth: number): number => {
  for (const step of TICK_LADDER) {
    if (maxHealth / step <= MAX_TICKS) return step;
  }
  // Past the curated ladder — reachable, not theoretical: a permanent
  // per-stack max-health bonus has no cap of its own, so several uncapped
  // max-health sources can compound a pool past 50,000 (TICK_LADDER's last
  // rung x MAX_TICKS) over a long game.
  // The old code returned the ladder's last rung here regardless of how far
  // past it `maxHealth` had grown, so MAX_TICKS silently stopped holding
  // right at this threshold. Deriving the step directly keeps the cap true
  // at any input.
  return niceStepAtLeast(maxHealth / MAX_TICKS);
};

export default class Champion extends AttackableUnit {
  static displayZIndex = CHAMPION_Z_INDEX;
  killCredit: KillCredit = 'champion';

  /**
   * Whether a `BotBrain` is driving this body. `AIChampion` overrides it to
   * true.
   *
   * A flag rather than an `instanceof AIChampion` at the read sites, because
   * the one place that needs the answer is `TeamBlackboard` — and importing
   * `AIChampion` there would close a cycle (`AIChampion` -> `BotBrain` ->
   * `TeamBlackboard`). The board hands out lane assignments, and a human on
   * the roster must not consume one: nothing would ever act on it, and the
   * lane it took would be a lane no bot walked to.
   */
  readonly isBot: boolean = false;

  /**
   * The number on the health bar, now a view of the ledger rather than its own
   * counter. It means exactly what it always did — kills minus deaths — but the
   * two halves are separately readable, which is what a scoreboard needs.
   */
  get score(): number {
    return this.tally.score;
  }

  name?: string;
  spells: Spell[] = [];

  /** Standing attack order, swing timer and delivery. Never scans on its own. */
  basicAttack: BasicAttackController = new BasicAttackController(this);

  /**
   * This champion's way home, or null on a map that grants none.
   *
   * Not built here. Recall needs a fountain to return to, and a fountain is
   * something a map supplies — a battle-royale map has none, and on one the
   * `B` key and the touch button do nothing rather than doing something
   * meaningless. `preset.ts` fills this in today; a content pack declares it
   * per champion (`ChampionEntry.recall`) once the boot path reads packs.
   *
   * Deliberately **not** in `spells[]` even when present — see the header of
   * `spells/Recall.ts`: that array is indexed by `SpellHotKeys` and an eighth
   * entry ripples into the loadout editor's slots, `hudState`'s
   * summoner-spell test, `MatchDirectorSource` and the generated catalogue. A
   * champion swap does not take the ability to go home away, so
   * `replaceSpells`/`applyPreset` never touch it either.
   */
  recall: Spell | null = null;

  constructor({
    game,
    position,
    collisionRadius,
    visionRadius,
    teamId,
    id,
    stats,
    avatar,
    preset,
  }: ChampionOptions) {
    super({
      game,
      position,
      collisionRadius,
      visionRadius,
      teamId,
      id,
      avatar: avatar ?? (preset?.avatar ? packAsset(preset.avatar) : undefined),
      stats,
    });

    // A champion with no preset at all is still a champion: it gets the default
    // attack profile rather than a unit that cannot swing.
    if (preset) this.applyPreset(preset);
    else this.applyAttackTuning(DEFAULT_CHAMPION_ATTACK);
  }

  /**
   * Everything a `ChampionPresetData` decides about a champion, in one place.
   *
   * Written as a method rather than left in the constructor because a champion
   * takes a preset in more than one situation: at construction, and on a
   * respawn that rolls a new champion (`AIChampion.respawn`). Those used to be
   * two partial copies of this, and the respawn copy restored only `avatar`
   * and `spells` — so a bot that respawned as a new champion kept the old
   * one's name and its attack damage, speed and range for the rest of the
   * match.
   *
   * Deliberately does NOT touch health or mana. The constructor must not (the
   * unit is still being built) and `respawn()` must not (`super.respawn()` has
   * already refilled). Refilling the bars belongs to whoever swaps a champion
   * under a unit that is standing there, which is a different act entirely.
   *
   * A slot still holding the same spell class keeps its *instance*, rather than
   * being rebuilt into an identical-looking new one. The practice panel's
   * loadout editor commits a whole loadout even when the player changed a
   * single slot, so rebuilding unconditionally charged every edit the state
   * that lives on a spell instance and nowhere else: a stacking spell's stacks went to
   * zero when the player swapped a different slot. Running cooldowns and active phases went
   * the same way.
   */
  applyPreset(preset: ChampionPresetData): void {
    this.name = preset.name;
    if (preset.avatar) this.avatar = packAsset(preset.avatar);
    const previous = this.spells;
    this.replaceSpells(
      (preset.spells ?? []).map((SpellClass, index) => {
        const standing = previous[index];
        return standing?.constructor === SpellClass ? standing : new SpellClass(this);
      })
    );
    this.applyAttackTuning(preset.attack ?? DEFAULT_CHAMPION_ATTACK);
  }

  private applyAttackTuning(attack: ChampionAttackTuning): void {
    this.stats.attackDamage.baseValue = attack.damage;
    this.stats.attackSpeed.baseValue = attack.attacksPerSecond;
    this.stats.attackRange.baseValue = attack.range;
  }

  update() {
    super.update();
    this.basicAttack.update();
    this.spells.forEach(spell => spell.update());
    // `?.` for the same reason `drawAttackOrder` uses it: prototype-only
    // champions built with Object.create never run a field initializer.
    this.recall?.update();
  }

  draw(options: AttackableUnitRenderOptions = {}) {
    super.draw(options);
    this.drawAttackOrder();
    this.spells.forEach(spell => spell.drawVfx());
    this.recall?.drawVfx();
  }

  /**
   * Order this champion to attack a unit: walk into range, then swing on the
   * interval until it dies, leaves sight or a different order arrives.
   */
  orderAttack(target: AttackableUnit): void {
    this.basicAttack.order(target);
  }

  /**
   * A move order is also the cancel for an attack order. It routes around
   * terrain: clicking across a wall walks around the wall rather than into it.
   *
   * `urgent` puts the route at the front of the search queue. Game passes it
   * for the local player's own clicks, because a frame of search latency on a
   * bot is invisible and a frame of it on a click is not.
   */
  orderMove(x: number, y: number, urgent = false): void {
    this.basicAttack.clear();
    this.navigateTo(x, y, urgent);
  }

  /**
   * The reticle. Only the local player draws one: six overlapping rings would
   * turn a teamfight into noise, and the bots' targets are already legible from
   * the bolts in the air.
   */
  drawAttackOrder(): void {
    // `?.` because the draw path is reached by prototype-only champions built
    // with Object.create, which never run a field initializer
    const target = this.basicAttack?.target;
    if (!target || this.isDead || this.game.player !== this) return;

    const size = target.animatedValues.displaySize;
    push();
    noFill();
    stroke(255, 92, 78, 190);
    strokeWeight(2);
    circle(target.position.x, target.position.y, size + 16);
    stroke(255, 92, 78, 55);
    circle(this.position.x, this.position.y, this.basicAttack.reachTo(target) * 2);
    pop();
  }

  onRemoved() {
    this.spells.forEach(spell => this.removeSpell(spell));
    // `?? undefined`: `removeSpell` takes `Spell | undefined`, and `recall` is
    // `Spell | null` now that a map without a fountain can leave it unset.
    this.removeSpell(this.recall ?? undefined);
  }

  /**
   * Retires whatever the incoming kit does not carry over. A spell present in
   * both lists is being *kept*, not replaced, so it must not be deactivated —
   * `applyPreset` hands back the instances of the slots it did not change.
   */
  replaceSpells(spells: Spell[]) {
    this.spells.forEach(spell => {
      if (spells.indexOf(spell) === -1) this.removeSpell(spell);
    });
    this.spells = spells;
  }

  replaceSpell(index: number, spell: Spell) {
    this.removeSpell(this.spells[index]);
    this.spells[index] = spell;
  }

  private removeSpell(spell?: Spell) {
    spell?.deactivate();
    spell?.onRemoved?.();
  }

  /** A champion fights through its standing order, so a taunt writes that. */
  forceAttackTarget(attacker: AttackableUnit): void {
    this.basicAttack.order(attacker);
  }

  drawHealthBar(compact = false) {
    let pos = this.position;
    let { displaySize: size, alpha } = this.animatedValues;
    let health = this.stats.health.value;
    let maxHealth = this.stats.maxHealth.value;
    let mana = this.stats.mana.value;
    let maxMana = this.stats.maxMana.value;

    // At minimum mobile zoom a champion body is only ~10–15 screen pixels, but
    // the normal health frame deliberately stays 125px and also paints score,
    // ticks, buff icons and status text. Eight of those cost more than the
    // terrain pass and cover the fight they are meant to explain. The compact
    // path keeps the three combat signals that still read at that scale.
    if (compact) {
      const k = this.game?.camera?.constantSize?.(1) ?? 1;
      const barWidth = 52 * k;
      const healthHeight = 6 * k;
      const manaHeight = 2 * k;
      const x = pos.x - barWidth / 2;
      const y = pos.y - size / 2 - 12 * k;
      const healthRatio = maxHealth > 0 ? constrain(health / maxHealth, 0, 1) : 0;
      const shieldRatio = maxHealth > 0 ? constrain(this.shieldAmount / maxHealth, 0, 1) : 0;

      // A unit with no mana pool gets no mana strip, and the backing shrinks to
      // match. An empty channel under the health bar reads as a resource the
      // unit has and has spent, which for a summon is simply false.
      const hasMana = maxMana > 0;

      push();
      noStroke();
      fill(2, 15, 21, alpha);
      rect(x - k, y - k, barWidth + 2 * k, healthHeight + (hasMana ? manaHeight + 3 * k : 2 * k));
      fill(
        this.isDead
          ? [153, 153, 153, alpha]
          : this.isAllied
            ? [67, 196, 29, alpha]
            : [196, 67, 29, alpha]
      );
      rect(x, y, barWidth * healthRatio, healthHeight);
      if (shieldRatio > 0) {
        const shieldWidth = barWidth * shieldRatio;
        const shieldX = Math.min(barWidth * healthRatio, barWidth - shieldWidth);
        fill(225, 230, 238, alpha * 0.85);
        rect(x + shieldX, y, shieldWidth, healthHeight);
      }
      if (hasMana) {
        fill(this.isDead ? [153, 153, 153, alpha] : [108, 179, 213, alpha]);
        const manaRatio = constrain(mana / maxMana, 0, 1);
        rect(x, y + healthHeight + k, barWidth * manaRatio, manaHeight);
      }
      pop();
      return;
    }

    push();
    // Overlay, not world: the whole frame — bar, ticks, buff icons and their
    // text — compensates for the camera scale together. See Camera.constantSize.
    const k = this.game?.camera?.constantSize?.(1) ?? 1;
    let borderWidth = 3 * k,
      barWidth = 125 * k,
      barHeight = 17 * k,
      manaHeight = 5 * k;
    const healthContainerW = barWidth - barHeight;
    // The bar is a fixed frame: a shield is a share of it, never an extension of
    // it. Growing the frame made a heavily shielded champion bar sprawl across the
    // screen, and left no way to read how hurt someone actually was.
    const frameWidth = barWidth;
    const healthRatio = maxHealth > 0 ? constrain(health / maxHealth, 0, 1) : 0;
    const shieldRatio = maxHealth > 0 ? constrain(this.shieldAmount / maxHealth, 0, 1) : 0;
    const healthW = healthRatio * healthContainerW;
    // Shield sits to the right of current health because it is eaten first. With
    // no room left it slides back over the health so it can never be invisible.
    const shieldW = shieldRatio * healthContainerW;
    const shieldX = Math.min(healthW, healthContainerW - shieldW);
    const shieldOverflows = this.shieldAmount > maxHealth;
    const topleft = {
      x: pos.x - frameWidth / 2,
      y: pos.y - size / 2 - barHeight - 15 * k,
    };

    fill(2, 15, 21, alpha);
    stroke(91, 92, 87, alpha);
    strokeWeight(3);
    rect(
      topleft.x - borderWidth * 0.5,
      topleft.y - borderWidth * 0.5,
      frameWidth + borderWidth,
      barHeight + borderWidth
    );

    fill(242, 242, 242, alpha);
    textSize(12 * k);
    text(this.score, topleft.x + 3 * k, topleft.y + 12 * k);

    noStroke();

    fill(
      this.isDead
        ? [153, 153, 153, alpha]
        : this.isAllied
          ? [67, 196, 29, alpha]
          : [196, 67, 29, alpha]
    );
    const healthRowH = barHeight - manaHeight - 1 * k;
    rect(topleft.x + barHeight, topleft.y, healthW, healthRowH);

    if (shieldW > 0) {
      fill(225, 230, 238, alpha * 0.85);
      rect(topleft.x + barHeight + shieldX, topleft.y, shieldW, healthRowH);

      // The bar cannot grow, so a shield larger than the whole health pool is
      // flagged instead of drawn past the end.
      if (shieldOverflows) {
        fill(255, 246, 200, alpha);
        rect(topleft.x + barHeight + healthContainerW - 2 * k, topleft.y, 2 * k, healthRowH);
      }
    }

    // Ticks every `tickStep` health. The frame is fixed, so a champion with a
    // bigger pool simply shows more of them — that is what makes two bars
    // comparable at a glance, and it also reads the shield against real health.
    const tickStep = healthTickStep(maxHealth);
    stroke(2, 15, 21, alpha * 0.6);
    strokeWeight(1);
    for (let mark = tickStep; mark < maxHealth; mark += tickStep) {
      const tickX = topleft.x + barHeight + (mark / maxHealth) * healthContainerW;
      line(tickX, topleft.y + 1 * k, tickX, topleft.y + healthRowH - 1 * k);
    }
    noStroke();

    const manaW = maxMana > 0 ? constrain(mana / maxMana, 0, 1) * healthContainerW : 0;
    fill(this.isDead ? [153, 153, 153, alpha] : [108, 179, 213, alpha]);
    rect(topleft.x + barHeight, topleft.y + barHeight - manaHeight, manaW, manaHeight);

    push();
    let x = topleft.x + 10 * k;
    if (alpha < 255) tint(255, alpha);
    // One icon per kind of buff with a stack count, not one per instance:
    // one stacking spell can hold hundreds of StatAmp stacks, which used to draw hundreds
    // of icons straight off the side of the screen.
    // (buff.draw() belongs to AttackableUnit.drawBuffs(); calling it here too
    // drew every buff twice, and inside this block's tint().)
    // `buff.stacks` rather than "one per array entry": a `countedStacks`
    // buff is a single instance carrying its whole count on `.stacks`, and
    // every other buff in the game leaves
    // `.stacks` at `Buff`'s default of 1 — so summing it is exactly the old
    // per-instance count for them, and the real stack count for a counted
    // buff instead of always reading 1.
    const buffCounts = new Map<BuffStackId, { image: AssetHandle; count: number }>();
    for (const buff of this.buffs) {
      if (!buff.image) continue;
      const key = buff.stackId;
      const row = buffCounts.get(key);
      if (row) row.count += buff.stacks;
      else buffCounts.set(key, { image: buff.image, count: buff.stacks });
    }

    for (const { image: buffImage, count } of buffCounts.values()) {
      image(AssetManager.renderable(buffImage), x, topleft.y - 13 * k, 20 * k, 20 * k);
      if (count > 1) {
        noStroke();
        fill(255, alpha);
        textAlign(RIGHT, BOTTOM);
        textSize(10 * k);
        text(count, x + 10 * k, topleft.y - 3 * k);
        textAlign(LEFT, BASELINE);
      }
      x += 20 * k;
    }
    pop();

    if (this.isDead) {
      noStroke();
      fill(200);
      textAlign(CENTER, CENTER);
      textSize(13 * k);
      if (this.deathData) {
        text(
          `Hồi Sinh Sau ${~~(this.deathData.reviveAfter / 1000)}...`,
          pos.x,
          topleft.y + barHeight + 8 * k
        );
      }
    } else {
      // One pass over `this.buffs`, not nine: the old shape re-scanned the
      // *whole* buff array once per STATUS_TEXT_BUFFS class (9 full passes)
      // to find each class's first instance, which is O(9N) every frame for
      // a champion whose N buffs are almost always none of the 9 — a large
      // permanent stat stack most of all. This
      // still gives the *first* buff of a class the final word — a
      // self-inflicted one prints nothing rather than deferring to a later
      // buff of the same class — and still prints in STATUS_TEXT_BUFFS'
      // fixed class order regardless of where in `this.buffs` each one sits.
      const firstOfClass: (Buff | undefined)[] = new Array(STATUS_TEXT_BUFFS.length);
      let unfilled = STATUS_TEXT_BUFFS.length;
      // A `singleRepresentativeDraw` stack can
      // be thousands of instances of the exact same class, and every one of
      // them resolves to the exact same answer here — so once the first
      // instance of a given `stackId` has been resolved, skip the
      // prototype-chain walk entirely for the rest of that group rather than
      // repeating it. `resolvedGroups` is only allocated if a stack that
      // opts in is actually present.
      let resolvedGroups: Set<BuffStackId> | null = null;
      for (let j = 0; j < this.buffs.length && unfilled > 0; j++) {
        const buff = this.buffs[j];
        if (buff.singleRepresentativeDraw) {
          resolvedGroups ??= new Set();
          if (resolvedGroups.has(buff.stackId)) continue;
          resolvedGroups.add(buff.stackId);
        }
        const index = ChampionStatusText.indexOf(buff);
        if (index === -1 || firstOfClass[index]) continue;
        firstOfClass[index] = buff;
        unfilled--;
      }

      let statusString = '';
      for (let i = 0; i < firstOfClass.length; i++) {
        const buff = firstOfClass[i];
        if (buff && buff.sourceUnit !== this) {
          statusString = statusString ? `${statusString}, ${buff.name}` : buff.name;
        }
      }

      if (statusString) {
        noStroke();
        fill(200);
        textAlign(CENTER, CENTER);
        textSize(13 * k);
        text(statusString, pos.x, topleft.y + barHeight + 8 * k);
      }
    }
    pop();
  }

  die(deathData: UnitDeathData) {
    // The ledger is `AttackableUnit.die`'s: it is the one place that knows
    // whether a death was already counted, and a turret's kill is a kill.
    super.die(deathData);
    this.basicAttack.clear();
  }
}
