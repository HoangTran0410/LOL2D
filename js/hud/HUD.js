import SpellState from '../enums/SpellState.js';

export default class HUD {
  constructor(game) {
    this.game = game;
  }

  udpate() {}

  draw() {
    this.drawSpells();
    this.drawBuffs();
  }

  drawBuffs() {
    let buffs = this.game.player.buffs;

    push();

    let size = 30;
    let x = width / 2 - (buffs.length * size) / 2;
    let y = height - 130;

    for (let buff of buffs) {
      const { duration, timeElapsed } = buff;

      if (buff.image) {
        image(buff.image, x, y, size, size);
      }
      // draw a rect at bottom
      stroke(200);
      fill(20, timeElapsed === 0 ? 0 : 150);
      rect(x, y, size, size);

      // draw timeElapsed
      const h = (size * (duration - timeElapsed)) / duration;
      fill(150, 200);
      rect(x, y + size - h, size, h);

      x += size;
    }

    pop();
  }

  // draw spells of the player
  drawSpells() {
    let spells = this.game.player.spells;

    push();
    let size = 60;
    let x = width / 2 - (spells.length * size) / 2;
    let y = height - 100;
    for (let spell of spells) {
      const { coolDown, currentCooldown, state } = spell;

      if (spell.image) {
        image(spell.image, x, y, size, size);
      }
      stroke(200);
      fill(20, state === SpellState.READY ? 0 : 200);
      rect(x, y, size, size);

      // draw cooldown
      if (state !== SpellState.READY) {
        const h = (size * currentCooldown) / coolDown;
        fill(150, 150);
        rect(x, y + size - h, size, h);

        // cooldown text
        fill(255, 200);
        textAlign(CENTER, CENTER);
        text(
          currentCooldown < 1 ? currentCooldown.toFixed(2) : Math.ceil(currentCooldown / 1000),
          x + size / 2,
          y + size / 2
        );
      }

      // draw text
      fill(255);
      textAlign(CENTER, CENTER);
      text(spell.key || 'Q', x + size - 10, y + size - 10);

      x += size;
    }
    pop();
  }
}
