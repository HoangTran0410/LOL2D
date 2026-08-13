import AssetManager, { type AssetHandle, type AssetKey } from '../../../managers/AssetManager';
import type Spell from '../Spell';
import AttackableUnit from './AttackableUnit';
import type { AttackableUnitOptions, UnitDeathData } from './AttackableUnit';
import Airborne from '../buffs/Airborne';
import Charm from '../buffs/Charm';
import Dash from '../buffs/Dash';
import Fear from '../buffs/Fear';
import Root from '../buffs/Root';
import Silence from '../buffs/Silence';
import Slow from '../buffs/Slow';
import Stun from '../buffs/Stun';
import type { BuffStackId } from '../Buff';

export interface ChampionPresetData {
  name?: string;
  avatar?: AssetKey;
  spells?: Array<new (owner: Champion) => Spell>;
}

export interface ChampionOptions extends Omit<AttackableUnitOptions, 'avatar'> {
  avatar?: AssetHandle;
  preset?: ChampionPresetData;
}

export default class Champion extends AttackableUnit {
  static displayZIndex = 4;
  score = 0;
  name?: string;
  spells: Spell[] = [];

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
    this.name = preset?.name;
    this.spells = preset?.spells?.map(spell => new spell(this)) || [];
  }

  update() {
    super.update();
    this.spells.forEach(spell => spell.update());
  }

  draw() {
    this.spells.forEach(spell => spell.drawVfx());
    super.draw();
  }

  onRemoved() {
    this.spells.forEach(spell => this.removeSpell(spell));
  }

  replaceSpells(spells: Spell[]) {
    this.spells.forEach(spell => this.removeSpell(spell));
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

  drawHealthBar() {
    let pos = this.position;
    let { displaySize: size, alpha } = this.animatedValues;
    let health = this.stats.health.value;
    let maxHealth = this.stats.maxHealth.value;
    let mana = this.stats.mana.value;
    let maxMana = this.stats.maxMana.value;

    push();
    let borderWidth = 3,
      barWidth = 125,
      barHeight = 17,
      manaHeight = 5,
      topleft = {
        x: pos.x - barWidth / 2,
        y: pos.y - size / 2 - barHeight - 15,
      };

    fill(2, 15, 21, alpha);
    stroke(91, 92, 87, alpha);
    strokeWeight(3);
    rect(
      topleft.x - borderWidth * 0.5,
      topleft.y - borderWidth * 0.5,
      barWidth + borderWidth,
      barHeight + borderWidth
    );

    fill(242, 242, 242, alpha);
    textSize(12);
    text(this.score, topleft.x + 3, topleft.y + 12);

    noStroke();

    const healthContainerW = barWidth - barHeight;
    const healthW = map(health, 0, maxHealth, 0, healthContainerW);
    fill(
      this.isDead
        ? [153, 153, 153, alpha]
        : this.isAllied
        ? [67, 196, 29, alpha]
        : [196, 67, 29, alpha]
    );
    rect(topleft.x + barHeight, topleft.y, healthW, barHeight - manaHeight - 1);

    // Shields sit to the right of current health, since they are eaten first.
    // On a healthy champion there is no room there, so the segment slides left
    // and overlays the health instead — a shield must never be invisible.
    const shield = this.shieldAmount;
    if (shield > 0) {
      const shieldW = Math.min(map(shield, 0, maxHealth, 0, healthContainerW), healthContainerW);
      const shieldX = Math.min(healthW, healthContainerW - shieldW);
      fill(225, 230, 238, alpha * 0.85);
      rect(
        topleft.x + barHeight + shieldX,
        topleft.y,
        shieldW,
        barHeight - manaHeight - 1
      );
    }

    const manaW = map(mana, 0, maxMana, 0, barWidth - barHeight);
    fill(this.isDead ? [153, 153, 153, alpha] : [108, 179, 213, alpha]);
    rect(topleft.x + barHeight, topleft.y + barHeight - manaHeight, manaW, manaHeight);

    push();
    let x = topleft.x + 10;
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
      image(AssetManager.renderable(buffImage), x, topleft.y - 13, 20, 20);
      if (count > 1) {
        noStroke();
        fill(255, alpha);
        textAlign(RIGHT, BOTTOM);
        textSize(10);
        text(count, x + 10, topleft.y - 3);
        textAlign(LEFT, BASELINE);
      }
      x += 20;
    }
    pop();

    if (this.isDead) {
      noStroke();
      fill(200);
      textAlign(CENTER, CENTER);
      textSize(13);
      if (this.deathData) {
        text(
          `Hồi Sinh Sau ${~~(this.deathData.reviveAfter / 1000)}...`,
          pos.x,
          topleft.y + barHeight + 8
        );
      }
    } else {
      let statusString = [Airborne, Root, Silence, Dash, Stun, Slow, Charm, Fear]
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
        textSize(13);
        text(statusString, pos.x, topleft.y + barHeight + 8);
      }
    }
    pop();
  }

  die(deathData: UnitDeathData) {
    super.die(deathData);
    this.score--;
    if (deathData.attacker instanceof Champion) deathData.attacker.score++;
  }
}
