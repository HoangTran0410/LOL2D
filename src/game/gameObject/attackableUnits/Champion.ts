import AssetManager, { type AssetHandle, type AssetKey } from '../../../managers/AssetManager';
import type Spell from '../Spell';
import BasicAttackController from '../../combat/BasicAttackController';
import AttackableUnit from './AttackableUnit';
import type {
  AttackableUnitOptions,
  AttackableUnitRenderOptions,
  UnitDeathData,
} from './AttackableUnit';
import Airborne from '../buffs/Airborne';
import Charm from '../buffs/Charm';
import Dash from '../buffs/Dash';
import Fear from '../buffs/Fear';
import Root from '../buffs/Root';
import Silence from '../buffs/Silence';
import Slow from '../buffs/Slow';
import Stun from '../buffs/Stun';
import Taunt from '../buffs/Taunt';
import type { BuffStackId } from '../Buff';

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
 * by. Roles now declare their own profile — see `ATTACK` in `src/game/preset.ts`
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
  avatar?: AssetKey;
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
 * grown-out Cho'Gath bar turns into a solid block of lines.
 */
const TICK_LADDER = [50, 100, 250, 500, 1_000, 2_500] as const;
const MAX_TICKS = 20;

export const healthTickStep = (maxHealth: number): number => {
  for (const step of TICK_LADDER) {
    if (maxHealth / step <= MAX_TICKS) return step;
  }
  return TICK_LADDER[TICK_LADDER.length - 1];
};

export default class Champion extends AttackableUnit {
  static displayZIndex = 4;
  score = 0;
  name?: string;
  spells: Spell[] = [];

  /** Standing attack order, swing timer and delivery. Never scans on its own. */
  basicAttack: BasicAttackController = new BasicAttackController(this);

  constructor({ game, position, collisionRadius, visionRadius, teamId, id, stats, avatar, preset }: ChampionOptions) {
    super({
      game,
      position,
      collisionRadius,
      visionRadius,
      teamId,
      id,
      avatar: avatar ?? (preset?.avatar ? AssetManager.get(preset.avatar) : undefined),
      stats,
    });

    this.score = 0;
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
   * that lives on a spell instance and nowhere else: Nasus Q's stacks went to
   * zero when the player swapped W. Running cooldowns and active phases went
   * the same way.
   */
  applyPreset(preset: ChampionPresetData): void {
    this.name = preset.name;
    if (preset.avatar) this.avatar = AssetManager.get(preset.avatar);
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
  }

  draw(options: AttackableUnitRenderOptions = {}) {
    super.draw(options);
    this.drawAttackOrder();
    this.spells.forEach(spell => spell.drawVfx());
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
      rect(
        x - k,
        y - k,
        barWidth + 2 * k,
        healthHeight + (hasMana ? manaHeight + 3 * k : 2 * k)
      );
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
    // Veigar Q can hold hundreds of StatAmp stacks, which used to draw hundreds
    // of icons straight off the side of the screen.
    // (buff.draw() belongs to AttackableUnit.drawBuffs(); calling it here too
    // drew every buff twice, and inside this block's tint().)
    const buffCounts = new Map<BuffStackId, { image: AssetHandle; count: number }>();
    for (const buff of this.buffs) {
      if (!buff.image) continue;
      const key = buff.stackId;
      const row = buffCounts.get(key);
      if (row) row.count++;
      else buffCounts.set(key, { image: buff.image, count: 1 });
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
      let statusString = [Airborne, Root, Silence, Dash, Stun, Slow, Charm, Fear, Taunt]
        .map(BuffClass => {
          let buff = this.buffs.find(b => b instanceof BuffClass);
          if (buff && buff.sourceUnit !== this) return buff.name;
        })
        .filter(Boolean)
        .join(', ');

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
    super.die(deathData);
    this.basicAttack.clear();
    this.score--;
    if (deathData.attacker instanceof Champion) deathData.attacker.score++;
  }
}
