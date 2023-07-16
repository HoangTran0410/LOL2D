import { SpellHotKeys } from '../constants.js';
import { removeAccents } from '../../utils/index.js';
import * as AllSpells from '../gameObject/spells/index.js';

export default class InGameHUD {
  constructor(game) {
    this.game = game;
    this.initVue(game);
  }

  initVue(game) {
    const { isProxy, toRaw, createApp } = Vue;

    this.app = createApp({
      data() {
        return {
          reviveAfter: 0,
          avatar: '',
          stats: {},
          spells: [],
          buffs: [],

          game: game,
          searchSpellText: '',
          showSpellsPicker: false,
          spellIndexToSwap: 0,
          allSpells: Object.values(AllSpells)
            // create instance. TODO: optimize this
            .map(SpellClass => ({
              spellInstance: new SpellClass(null),
              spellClass: SpellClass,
            }))
            .map(({ spellInstance, spellClass }) => ({
              name: spellInstance.name,
              image: spellInstance.image?.path,
              description: spellInstance.description,
              coolDown: spellInstance.coolDown,
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
        closeSpellPicker() {
          this.showSpellsPicker = false;
          this.game.unpause();
        },
        mouseover(spell) {
          this.spellHover = spell;
        },
        mouseout(spell) {
          this.spellHover = null;
        },
      },
      computed: {
        filteredSpells() {
          return this.allSpells.filter(spell => {
            let search = removeAccents(this.searchSpellText.toLowerCase());
            let name = removeAccents(spell.name.toLowerCase());
            let desc = removeAccents(spell.description.toLowerCase());

            return search === '' || name.includes(search) || desc.includes(search);
          });
        },
      },
      template: `
        <div v-if="avatar && spells && buffs" class="bottom-HUD">
            <div class="champion-avatar">
                <img :src="avatar" alt="champion-avatar" :style="isDead ? 'filter: grayscale(100%)' : ''">
                <span v-if="isDead" class="revive-counter">{{reviveAfter}}</span>
            </div>
            <div class="champion-details">
                <div class="spells">
                    <div v-for="(spell, index) of spells" :class="spell.small ? 'spell small' : 'spell'"
                        @click="changeSpell(index)" @mouseover="mouseover(spell)" @mouseout="mouseout(spell)">
                        <img :src="spell.image" alt="spell"
                            :style="(spell.disabled || spell.showCoolDown || !spell.canCast) ? 'filter: grayscale(100%)' : ''" />

                        <span v-if="spell.hotKey" class="hotKey">{{spell.hotKey}}</span>
                        <div v-if="spell.showCoolDown">
                            <div class="cooldown-overlay" :style="'height:'+ spell.coolDownPercent +'%'"></div>
                            <div class="cooldown">
                                <p>{{spell.coolDownText}}</p>
                            </div>
                        </div>
                        <div class="spell-info">
                            <div class="header">
                              <img :src="spell.image" alt="spell" />
                              <h4>{{spell.name}}</h4>
                            </div>
                            <p>Hồi chiêu: {{spell.coolDown/1000}}s</p>
                            <p>{{spell.description}}</p>
                        </div>
                    </div>
                </div>
                <div class="health-bar">
                    <div class="bar">
                        <div :style="'width:'+ stats.healthPercent +'%; background-color:#0ca20c'">
                        </div>
                        <p>{{stats.health}} / {{stats.maxHealth}}</p>
                    </div>
                    <div class="bar" style="margin-top:3px">
                        <div :style="'width:'+ stats.manaPercent + '%; background-color:#218bdd;'">
                        </div>
                        <p>{{stats.mana}} / {{stats.maxMana}}</p>
                    </div>
                </div>
                <div class="buffs">
                    <div v-for="buff of buffs" class="buff">
                        <img :src="buff.image" alt="buff">
                        <span>{{buff.timeLeftText}}</span>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="showSpellsPicker" class="spell-picker">
            <button class="close-btn" @click="closeSpellPicker()">X</button>
            <p class="title">Chọn chiêu thức</p>
            <input class="spell-search-box" type="text" placeholder="Tìm kiếm chiêu thức"
                v-model="searchSpellText" />
            <div class="list">
                <div v-for="spell of filteredSpells" class="spell" @click="pick(spell)">
                    <img :src="spell.image" alt="spell" />
                    <div class="spell-info">
                        <div class="header">
                            <img :src="spell.image" alt="spell" />
                            <h4>{{spell.name}}</h4>
                        </div>
                        <p>Hồi chiêu: {{spell.coolDown/1000}}s</p>
                        <p>{{spell.description}}</p>
                    </div>
                </div>
                <div v-if="filteredSpells.length === 0" class="not-found">
                    <span>Không tìm thấy chiêu thức</span>
                </div>
            </div>
        </div>
      `,
    });

    this.vueInstance = this.app.mount('#InGameHUD');

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
    const { spells = [], buffs = [], avatar, isDead, deathData, canCast } = this.game?.player || {};
    this.vueInstance.avatar = avatar?.path || '';
    this.vueInstance.isDead = isDead;
    this.vueInstance.reviveAfter = ~~(deathData?.reviveAfter / 1000);

    // update spells
    this.vueInstance.spells = spells
      .filter(i => i?.image?.path)
      .map((spell, index) => {
        let isInternalSpell = index == 0;
        let isSummonerSpell = index > 4;

        let hotKey = SpellHotKeys[index]
          ? String.fromCharCode(SpellHotKeys[index]).toUpperCase()
          : '';

        const { disabled, image, coolDown, state, currentCooldown, name, description } =
          spell || {};
        return {
          instance: spell,

          image: image?.path,
          disabled,
          coolDown,
          currentCooldown,
          state,
          name,
          description,

          // custom properties for display
          coolDownText: Math.ceil(currentCooldown / 1000),
          coolDownPercent: Math.min((currentCooldown / coolDown) * 100, 100),
          showCoolDown: currentCooldown > 0,
          small: isInternalSpell || isSummonerSpell,
          canCast: canCast && !isDead,
          hotKey,
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

    // draw spell preview on hover
    if (this.vueInstance.spellHover) {
      try {
        let spell = Vue.toRaw(this.vueInstance.spellHover.instance);
        spell.willDrawPreview = true;
      } catch (e) {
        console.error(e);
      }
    }
  }

  destroy() {
    this.app.unmount();
  }
}
