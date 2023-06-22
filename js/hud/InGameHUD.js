export default class InGameHUD {
  constructor(game) {
    this.game = game;

    this.initVue();
  }

  initVue() {
    this.vueInstance = Vue.createApp({
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
            { image: 'assets/spells/blitzcrank_internal.png' },

            { image: 'assets/spells/blitzcrank_q.png' },
            { image: 'assets/spells/blitzcrank_w.png' },
            { image: 'assets/spells/blitzcrank_e.png' },
            { image: 'assets/spells/blitzcrank_r.png' },

            { image: 'assets/spells/flash.png' },
            { image: 'assets/spells/heal.png' },
          ],
          buffs: [
            { image: 'assets/spells/blitzcrank_w.png' },
            { image: 'assets/spells/blitzcrank_w.png' },
          ],
        };
      },
      methods: {},
    }).mount('#InGameHUD');

    document.querySelector('#InGameHUD').oncontextmenu = () => false;
  }

  update() {
    // update stats
    const { health, maxHealth, mana, maxMana } = this.game?.player?.stats || {};
    this.vueInstance.stats.health = health?.value;
    this.vueInstance.stats.maxHealth = maxHealth?.value;
    this.vueInstance.stats.mana = mana?.value;
    this.vueInstance.stats.maxMana = maxMana?.value;

    this.vueInstance.stats.healthPercent = Math.min(health?.value / maxHealth?.value, 1) * 100;
    this.vueInstance.stats.manaPercent = Math.min(mana?.value / maxMana?.value, 1) * 100;

    // update avatar
    const { spells = [], buffs = [], avatar } = this.game?.player || {};
    this.vueInstance.avatar = avatar?.path || '';

    // update spells
    this.vueInstance.spells = spells
      .filter(i => i?.image?.path)
      .map((spell, index) => {
        let isInternalSpell = index == 0;
        let isSummonerSpell = index > 4;
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
          small: isInternalSpell || isSummonerSpell,
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
