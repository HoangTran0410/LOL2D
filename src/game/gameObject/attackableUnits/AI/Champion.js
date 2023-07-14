import AssetManager from '../../../../managers/AssetManager.js';
import AttackableUnit from '../AttackableUnit.js';
import Airborne from '../../buffs/Airborne.js';
import Charm from '../../buffs/Charm.js';
import Dash from '../../buffs/Dash.js';
import Fear from '../../buffs/Fear.js';
import Root from '../../buffs/Root.js';
import Silence from '../../buffs/Silence.js';
import Slow from '../../buffs/Slow.js';
import Stun from '../../buffs/Stun.js';

export default class Champion extends AttackableUnit {
  constructor({ game, position, collisionRadius, visionRadius, teamId, id, stats, preset }) {
    super({
      game,
      position,
      collisionRadius,
      visionRadius,
      teamId,
      id,
      avatar: AssetManager.getAsset(preset.avatar),
      stats,
    });

    this.score = 0;
    this.name = preset.name;
    this.spells = preset.spells.map(spell => new spell(this));
  }

  onAdded() {}

  onRemoved() {}

  update() {
    super.update();
    this.spells.forEach(spell => spell.update());
  }

  draw() {
    this.drawAvatar();
    this.drawHud();
  }

  drawAvatar() {
    let pos = this.position;
    let { size, height, alpha } = this.animatedValues;
    size += height;

    push();
    noStroke();
    fill(240, alpha);
    imageMode(CENTER);

    // tint alpha for image
    if (alpha < 255) tint(255, alpha);
    image(this.avatar?.data, pos.x, pos.y, size, size);

    // draw circle around champion based on allies
    stroke(this.isAllied ? [0, 255, 0, alpha] : [255, 0, 0, alpha]);
    strokeWeight(2);
    noFill();
    circle(pos.x, pos.y, size);

    // draw direction to mouse
    if (!this.isDead && this.game.worldMouse && this === this.game.player) {
      let mouseDir = p5.Vector.sub(this.game.worldMouse, pos).setMag(size / 2 + 2);
      stroke(255, Math.min(alpha, 125));
      strokeWeight(4);
      line(pos.x, pos.y, pos.x + mouseDir.x, pos.y + mouseDir.y);
    }
    pop();
  }

  drawHud() {
    let { size, alpha, height } = this.animatedValues;
    size += height;
    let health = this.stats.health.value;
    let maxHealth = this.stats.maxHealth.value;
    let mana = this.stats.mana.value;
    let maxMana = this.stats.maxMana.value;

    push();
    // draw health bar
    let borderWidth = 3,
      barWidth = 125,
      barHeight = 17,
      manaHeight = 5,
      topleft = {
        x: this.position.x - barWidth / 2,
        y: this.position.y - size / 2 - barHeight - 15,
      };

    // if (!this.isDead) {
    fill(2, 15, 21, alpha);
    stroke(91, 92, 87, alpha);
    strokeWeight(3);
    rect(
      topleft.x - borderWidth * 0.5,
      topleft.y - borderWidth * 0.5,
      barWidth + borderWidth,
      barHeight + borderWidth
    );

    // score
    fill(242, 242, 242, alpha);
    textSize(12);
    text(this.score, topleft.x + 3, topleft.y + 12);

    noStroke();

    // health
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

    // mana
    const manaW = map(mana, 0, maxMana, 0, barWidth - barHeight);
    fill(this.isDead ? [153, 153, 153, alpha] : [108, 179, 213, alpha]);
    rect(topleft.x + barHeight, topleft.y + barHeight - manaHeight, manaW, manaHeight);
    // }

    // draw status string
    if (this.isDead) {
      noStroke();
      fill(200);
      textAlign(CENTER, CENTER);
      textSize(13);
      text(`ĐANG HỒI SINH ${~~(this.reviveAfter / 1000)}...`, pos.x, topleft.y + barHeight + 8);
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
}
