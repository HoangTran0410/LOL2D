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
    // update stats
    const { health, maxHealth, mana, maxMana } = this.game?.player?.stats || {};
    this.vueInstance.stats.health = health?.value;
    this.vueInstance.stats.maxHealth = maxHealth?.value;
    this.vueInstance.stats.mana = mana?.value;
    this.vueInstance.stats.maxMana = maxMana?.value;

    // update avatar
    const { spells = [], buffs = [], avatar } = this.game?.player || {};
    this.vueInstance.avatar = avatar?.path || '';

    // update spells
    this.vueInstance.spells = spells
      .filter(i => i?.image?.path)
      .map(spell => {
        const { image, coolDown, state, currentCooldown, name, description } = spell || {};
        return {
          image: image?.path,
          coolDown,
          currentCooldown,
          state,
          name,
          description,

          // custom properties for display
          coolDownText: Math.ceil(currentCooldown / 1000),
          coolDownPercent: (currentCooldown / coolDown) * 100,
          showCoolDown: currentCooldown > 0,
        };
      });

    // update buffs
    this.vueInstance.buffs = buffs
      .filter(i => i?.image?.path)
      .map(buff => {
        const { image, duration, timeElapsed } = buff || {};
        let timeLeft = duration - timeElapsed;
        return {
          image: image?.path,
          duration,
          timeElapsed,

          timeLeftText: Math.ceil(timeLeft / 1000),
        };
      });
  }
}
