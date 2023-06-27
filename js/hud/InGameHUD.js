import { SpellHotKeys } from '../constants.js';
import StatusFlags from '../enums/StatusFlags.js';
import { hasFlag } from '../utils/index.js';
import * as AllSpells from '../gameObject/spells/index.js';

export default class InGameHUD {
  constructor(game) {
    this.game = game;

    this.initVue(game);
  }

  initVue(game) {
    const { isProxy, toRaw, createApp } = Vue;

    this.vueInstance = createApp({
      data() {
        return {
          avatar: '',
          stats: {},
          spells: [],
          buffs: [],

          game: game,
          showSpellsPicker: false,
          spellIndexToSwap: 0,
          allSpells: Object.values(AllSpells)
            // create instance. TODO: optimize this
            .map(SpellClass => ({
              instance: new SpellClass(null),
              spellClass: SpellClass,
            }))
            .map(({ instance, spellClass }) => ({
              name: instance.name,
              image: instance.image?.path,
              description: instance.description,
              coolDown: instance.coolDown,
              spellClass: spellClass,
            })),
        };
      },
      methods: {
        pick(spell) {
          if (
            this.spellIndexToSwap >= 0 &&
            this.spellIndexToSwap <= this.game.player.spells.length
          ) {
            let spellInstance = new spell.spellClass(toRaw(this.game.player));
            this.game.player.spells[this.spellIndexToSwap] = spellInstance;
          }
          this.showSpellsPicker = false;
          this.game.unpause();
        },
        changeSpell(index) {
          this.spellIndexToSwap = index;
          this.showSpellsPicker = !this.showSpellsPicker;

          if (this.showSpellsPicker) this.game.pause();
          else this.game.unpause();
        },
      },
    }).mount('#InGameHUD');

    document.querySelector('#InGameHUD').oncontextmenu = () => false;
  }

  update() {
    // update stats
    const { health, maxHealth, mana, maxMana } = this.game?.player?.stats || {};
    this.vueInstance.stats.health = ~~health?.value;
    this.vueInstance.stats.maxHealth = ~~maxHealth?.value;
    this.vueInstance.stats.mana = ~~mana?.value;
    this.vueInstance.stats.maxMana = ~~maxMana?.value;

    this.vueInstance.stats.healthPercent = Math.min(health?.value / maxHealth?.value, 1) * 100;
    this.vueInstance.stats.manaPercent = Math.min(mana?.value / maxMana?.value, 1) * 100;

    // update avatar
    const { spells = [], buffs = [], avatar, status } = this.game?.player || {};
    this.vueInstance.avatar = avatar?.path || '';

    // update spells
    let canCast = hasFlag(status, StatusFlags.CanCast);
    this.vueInstance.spells = spells
      .filter(i => i?.image?.path)
      .map((spell, index) => {
        let isInternalSpell = index == 0;
        let isSummonerSpell = index > 4;

        let hotKey = SpellHotKeys[index]
          ? String.fromCharCode(SpellHotKeys[index]).toUpperCase()
          : '';

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
          hotKey,
          canCast,
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
