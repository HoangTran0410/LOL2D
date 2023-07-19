import { SpellHotKeys } from '../constants.js';
import { removeAccents } from '../../utils/index.js';
import * as AllSpells from '../gameObject/spells/index.js';
import { SpellGroups } from '../preset.js';
import AssetManager from '../../managers/AssetManager.js';

export default class InGameHUD {
  constructor(game) {
    this.game = game;
    this.initVue(game);
    this.updateLoop();
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

          spellGroups: SpellGroups.map(group => {
            return {
              name: group.name,
              image: AssetManager.getAsset(group.image)?.path,
              spells: group.spells
                .map(SpellClass => ({
                  spellInstance: new SpellClass(null),
                  spellClass: SpellClass,
                }))
                .map(({ spellInstance, spellClass }) => {
                  return {
                    name: spellInstance.name,
                    image: spellInstance.image?.path,
                    description: spellInstance.description,
                    coolDown: spellInstance.coolDown,
                    spellClass: spellClass,
                  };
                }),
            };
          }),
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

          this.spellHover = null;
        },
        changeSpell(index) {
          this.spellIndexToSwap = index;
          this.showSpellsPicker = !this.showSpellsPicker;

          if (this.showSpellsPicker) this.game.pause();
          else this.game.unpause();

          this.spellHover = null;
        },
        closeSpellPicker() {
          this.showSpellsPicker = false;
          this.game.unpause();
        },
        mouseover(spellProxy, event) {
          // clearTimeout(this.mouseOutSpellTimeout);
          this.showPreview(spellProxy, true);
          this.spellHover = spellProxy;

          let element = event.target;
          let { width, height, x, y } = element.getBoundingClientRect();
          let { clientX, clientY } = event;

          this.spellInfo = {
            bottom: 'calc(100vh - ' + (y - 5) + 'px)',
            left: Math.max(x + width / 2 - 150, 0) + 'px',
          };
        },
        mouseout(spellProxy, event) {
          this.showPreview(spellProxy, false);
          // this.mouseOutSpellTimeout = setTimeout(() => {
          this.spellHover = null;
          // }, 250);
        },
        showPreview(spellProxy, show) {
          try {
            let s = Vue.toRaw(spellProxy.instance);
            if (s) s.willDrawPreview = show || false;
          } catch (e) {
            console.error(e);
          }
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
      <div>
        <div v-if="spellHover" class="spell-info" :style="'bottom:'+spellInfo.bottom+';left:'+spellInfo.left">
            <div class="header">
              <div>
                <img :src="spellHover.image" alt="spell" />
                <h4>{{spellHover.name}}</h4>
              </div>
              <span>{{spellHover.coolDown/1000}}s</span>
            </div>
            <p class="body" v-html="spellHover.description"></p>
        </div>
      
        <div v-if="avatar && spells && buffs" class="bottom-HUD">
            <div class="champion-avatar">
                <img :src="avatar" alt="champion-avatar" :style="isDead ? 'filter: grayscale(100%)' : ''">
                <span v-if="isDead" class="revive-counter">{{reviveAfter}}</span>
            </div>

            <div class="champion-details">
                <div class="spells">
                    <div v-for="(spell, index) of spells" :class="spell.small ? 'spell small' : 'spell'"
                        @click="changeSpell(index)">
                        <img :src="spell.image" alt="spell"
                            :style="(spell.disabled || spell.showCoolDown || !spell.canCast) ? 'filter: grayscale(100%)' : ''" 
                            @mouseover="mouseover(spell, $event)" 
                            @mouseout="mouseout(spell, $event)"/>

                        <span v-if="spell.hotKey" class="hotKey">{{spell.hotKey}}</span>
                        <div v-if="spell.showCoolDown">
                            <div class="cooldown-overlay" :style="'height:'+ spell.coolDownPercent +'%'"></div>
                            <div class="cooldown">
                                <p>{{spell.coolDownText}}</p>
                            </div>
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
            <button class="close-btn" @click="closeSpellPicker()">
              <i class="fa-solid fa-xmark"></i>
            </button>
            <p class="title">Chọn chiêu thức</p>
            <div class="list">
              <div class="group" v-for="group of spellGroups">
                <div class="group-header">
                  <img v-if="group.image" :src="group.image" alt="spell" />
                  <p>{{group.name}}</p>
                </div>
                <div v-for="spell of group.spells" class="spell" 
                  @click="pick(spell, $event)">
                    <img :src="spell.image" alt="spell" 
                      @mouseover="mouseover(spell, $event)" 
                      @mouseout="mouseout(spell, $event)"/>
                </div>
              </div>
            </div>
        </div>
      </div>
      `,
    });

    this.vueInstance = this.app.mount('#InGameHUD');

    document.querySelector('#InGameHUD').oncontextmenu = () => false;
  }

  updateLoop() {
    this.update();

    if (this.app)
      setTimeout(() => {
        this.updateLoop();
      }, 1000 / 15);
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
  }

  destroy() {
    this.app.unmount();
    this.app = null;
    clearInterval(this.intervalId);
  }
}
