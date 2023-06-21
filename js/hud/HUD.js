import SpellState from '../enums/SpellState.js';

export default class HUD {
  constructor(game) {
    this.game = game;

    this.initVue();
  }

  initVue() {
    const { createApp } = Vue;
    this.vueInstance = createApp({
      data() {
        // init default values
        return {
          avatar: 'assets/champions/blitzcrank.png',
          stats: {
            health: 100,
            maxHealth: 200,
            mana: 100,
            maxMana: 100,
          },
          spells: [
            { image: 'assets/spells/blitzcrank_internal.png', coolDown: 0, small: true },

            { image: 'assets/spells/blitzcrank_q.png', coolDown: 0 },
            { image: 'assets/spells/blitzcrank_w.png', coolDown: 0 },
            { image: 'assets/spells/blitzcrank_e.png', coolDown: 0 },
            { image: 'assets/spells/blitzcrank_r.png', coolDown: 0 },

            { image: 'assets/spells/flash.png', coolDown: 0, small: true },
            { image: 'assets/spells/heal.png', coolDown: 0, small: true },
          ],
          buffs: [
            { image: 'assets/spells/blitzcrank_w.png', coolDown: 0 },
            { image: 'assets/spells/blitzcrank_w.png', coolDown: 0 },
          ],
        };
      },
      methods: {},
    }).mount('#HUD');
  }

  update() {
    const { health, maxHealth, mana, maxMana } = this.game?.player?.stats || {};
    this.vueInstance.stats.health = health?.value;
    this.vueInstance.stats.maxHealth = maxHealth?.value;
    this.vueInstance.stats.mana = mana?.value;
    this.vueInstance.stats.maxMana = maxMana?.value;

    const { spells = [], buffs = [], avatar } = this.game?.player || {};
    this.vueInstance.avatar = avatar?.path || '';

    this.vueInstance.spells = spells.map(spell => {
      const { image, coolDown, state, currentCooldown } = spell || {};
      return {
        image: image?.path,
        coolDown,
        currentCooldown,
        state,

        // custom properties for display
        coolDownText:
          currentCooldown < 1000
            ? (currentCooldown / 1000).toFixed(1)
            : Math.ceil(currentCooldown / 1000),
        coolDownPercent: (currentCooldown / coolDown) * 100,
        showCoolDown: currentCooldown > 0,
      };
    });

    this.vueInstance.buffs = buffs.map(buff => {
      const { image, coolDown, currentCooldown } = buff || {};
      return { image: image?.path, coolDown, currentCooldown };
    });
  }
}
