import SpellState from '../enums/SpellState.js';

export default class HUD {
  constructor(game) {
    this.game = game;

    this.spellKeys = ['Q', 'W', 'E', 'R'];

    this.dom = {
      avatar: document.querySelector('#HUD .champion-avatar img'),
      spells: document.querySelectorAll('#HUD .champion-details .spells .spell'),
      buffsContainer: document.querySelector('#HUD .champion-details .buffs'),
    };

    console.log(this.dom);

    this.deltaTime = 0;
  }

  update() {
    this.deltaTime += deltaTime;
    if (this.deltaTime < 1000 / 30) return; // update at 10 fps
    this.deltaTime = 0;

    // update avatar
    let avatar = this.game?.player?.avatar?.path;
    if (avatar !== this.dom.avatar.src) this.dom.avatar.src = avatar;

    // update spells
    let spells = this.game?.player?.spells;
    if (spells) {
      for (let i = 0; i < spells.length; i++) {
        let { coolDown, currentCooldown, state, image } = spells[i];
        let spellDom = this.dom.spells[i + 1]; // ignore internal spells

        // update spell image
        let spellImage = image?.path;
        let img = spellDom.querySelector('img');
        if (spellImage !== img.src) img.src = spellImage;

        // update spell cooldown
        let cooldownDom = spellDom.querySelector('.cooldown-overlay');
        let cooldownText = spellDom.querySelector('.cooldown p');
        if (state === SpellState.READY) {
          spellDom.classList.remove('in-cooldown');
          cooldownDom.style.transform = 'scaleY(0)';
          cooldownText.innerText = currentCooldown;
        } else {
          spellDom.classList.add('in-cooldown');
          cooldownDom.style.display = 'block';
          let h = (100 * currentCooldown) / coolDown;
          cooldownDom.style.transform = `scaleY(${h / 100})`;
          cooldownText.innerText =
            currentCooldown > 1000
              ? Math.round(currentCooldown / 1000)
              : (currentCooldown / 1000).toFixed(1);
        }
      }
    }

    // update buffs
    let buffs = this.game?.player?.buffs;
    this.dom.buffsContainer.innerHTML = '';
    if (buffs.length) {
      for (let buff of buffs) {
        let buffDom = document.createElement('div');
        buffDom.classList.add('buff');
        buffDom.innerHTML = `
          <img src="${buff.image?.path}" alt="${buff.name}" />
        `;
        this.dom.buffsContainer.appendChild(buffDom);
      }
    }
  }

  draw() {
    // this.drawSpells();
    // this.drawBuffs();
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
