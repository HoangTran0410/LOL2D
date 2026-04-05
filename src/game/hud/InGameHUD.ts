/* eslint-disable @typescript-eslint/no-explicit-any */
import { createApp, toRaw } from 'vue';
import Game from '../Game';
import AIChampion from '../gameObject/attackableUnits/AIChampion';
import { SpellHotKeys } from '../constants';
import { removeAccents } from '../../utils/index';
import * as AllSpells from '../gameObject/spells/index';
import { SpellGroups } from '../preset';
import AssetManager from '../../managers/AssetManager';

// Types for Vue component data
interface SpellDisplay {
  instance: any;
  image: string;
  disabled: boolean;
  coolDown: number;
  currentCooldown: number;
  state: string;
  name: string;
  description: string;
  coolDownText: number;
  coolDownPercent: number;
  showCoolDown: boolean;
  small: boolean;
  canCast: boolean;
  hotKey: string;
}

interface BuffDisplay {
  image: string;
  duration: number;
  timeElapsed: number;
  timeLeftText: number;
}

interface SpellGroupDisplay {
  name: string;
  image: string;
  background: string;
  spells: SpellItemDisplay[];
}

interface SpellItemDisplay {
  name: string;
  image: string;
  description: string;
  coolDown: number;
  spellClass: any;
}

interface StatsDisplay {
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  healthPercent: number;
  manaPercent: number;
}

export default class InGameHUD {
  private game: Game;
  private _rafId: number | null = null;
  private app: any;
  private vueInstance: any;

  constructor(game: Game) {
    this.game = game;
    this._rafId = null;
    this.initVue(game);
    this._startUpdateLoop();
  }

  initVue(game: Game) {
    const VueAny = (window as any).Vue;
    const { toRaw, createApp } = VueAny;

    this.app = createApp({
      data() {
        return {
          reviveAfter: 0,
          avatar: '',
          stats: {} as StatsDisplay,
          spells: [] as SpellDisplay[],
          buffs: [] as BuffDisplay[],

          oneForAll: false,
          cloneMySpell: false,

          game: game,
          searchSpellText: '',
          showSpellsPicker: false,
          spellIndexToSwap: 0,
          allSpells: Object.values<any>(AllSpells)
            // create instance. TODO: optimize this
            .map((SpellClass: any) => ({
              spellInstance: new SpellClass(null),
              spellClass: SpellClass,
            }))
            .map(({ spellInstance, spellClass }: { spellInstance: any; spellClass: any }) => ({
              name: spellInstance.name,
              image: spellInstance.image?.path,
              description: spellInstance.description,
              coolDown: spellInstance.coolDown,
              spellClass: spellClass,
            })),

          spellGroups: (SpellGroups as any[]).map((group: any) => {
            return {
              name: group.name,
              image: AssetManager.getAsset(group.image)?.path,
              background: group.background,
              spells: group.spells
                .map((SpellClass: any) => ({
                  spellInstance: new SpellClass(null),
                  spellClass: SpellClass,
                }))
                .map(({ spellInstance, spellClass }: { spellInstance: any; spellClass: any }) => {
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
          backgroundPicker: null as string | null,
          spellHover: null as any,
          spellInfo: { bottom: '0px', left: '0px' },
          isDead: false,
        };
      },
      methods: {
        pick(spell: any) {
          const bots = this.game.objectManager.objects.filter((o: any) => o instanceof AIChampion);

          if (this.oneForAll) {
            this.game.player.spells = this.game.player.spells.map(
              () => new spell.spellClass(toRaw(this.game.player))
            );
            bots.forEach((bot: any) => {
              bot._respawnWithNewPreset = false;
              bot.spells = bot.spells.map(() => new spell.spellClass(toRaw(bot)));
            });
          } else if (
            this.spellIndexToSwap >= 0 &&
            this.spellIndexToSwap <= this.game.player.spells.length
          ) {
            const spellInstance = new spell.spellClass(toRaw(this.game.player));
            this.game.player.spells[this.spellIndexToSwap] = spellInstance;

            bots.forEach((bot: any) => {
              if (this.cloneMySpell) {
                bot._respawnWithNewPreset = false;
                const botSpellInstance = new spell.spellClass(toRaw(bot));
                bot.spells[this.spellIndexToSwap] = botSpellInstance;
              } else {
                bot._respawnWithNewPreset = true;
              }
            });
          }
          this.showSpellsPicker = false;
          this.game.unpause();

          this.spellHover = null;
        },
        changeSpell(index: number) {
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
        mouseover(spellProxy: any, event: any) {
          this.showPreview(spellProxy, true);
          this.spellHover = spellProxy;

          const element = event.currentTarget || event.target;
          const { width, x, y } = element.getBoundingClientRect();

          this.spellInfo = {
            bottom: 'calc(100vh - ' + (y - 5) + 'px)',
            left: Math.max(x + width / 2 - 150, 0) + 'px',
          };
        },
        mouseout(spellProxy: any) {
          this.showPreview(spellProxy, false);
          this.spellHover = null;
        },
        mouseoverGroup(group: any) {
          if (group.background) this.backgroundPicker = group.background;
        },
        mouseoutGroup() {
          this.backgroundPicker = null;
        },
        showPreview(spellProxy: any, show: boolean) {
          try {
            const s = VueAny.toRaw(spellProxy.instance);
            if (s) s.willDrawPreview = show || false;
          } catch (e) {
            console.error(e);
          }
        },
      },
      computed: {
        filteredSpells() {
          return (this as any).allSpells.filter((spell: any) => {
            const search = removeAccents((this as any).searchSpellText.toLowerCase());
            const name = removeAccents(spell.name.toLowerCase());
            const desc = removeAccents(spell.description.toLowerCase());

            return search === '' || name.includes(search) || desc.includes(search);
          });
        },
      },
      template: /*html*/ `
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
                        @click="changeSpell(index)"
                        @mouseover="mouseover(spell, $event)"
                        @mouseout="mouseout(spell, $event)">
                        <img :src="spell.image" alt="spell"
                            :style="(spell.disabled || spell.showCoolDown || !spell.canCast) ? 'filter: grayscale(100%)' : ''" />

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
            <img
              alt="background"
              class="background-picker"
              :src="backgroundPicker"
            />
            <button class="close-btn" @click="closeSpellPicker()">
              <i class="fa-solid fa-xmark"></i>
            </button>
            <p class="title">Chọn chiêu thức</p>

            <p>
              Chế độ (mới):
              <span class="tooltip">
                <input type="checkbox" id="oneForAll" v-model="oneForAll" />
                <label for="oneForAll">ONE spell for ALL</label>
                <span class="tooltiptext">Tất cả đều chỉ dùng 1 chiêu thức</span>
              </span>

              <span class="tooltip" >
                <input type="checkbox" id="cloneMySpell" v-model="cloneMySpell" />
                <label for="cloneMySpell">Clone my spells</label>
                <span class="tooltiptext">Tất cả đều dùng bộ chiêu thức giống bạn</span>
              </span>
            </p>

            <div class="list">
              <div
                class="group"
                v-for="group of spellGroups"
                @mouseover="mouseoverGroup(group, $event)">
                <div class="group-header">
                  <img v-if="group.image" :src="group.image" alt="spell" />
                  <p>{{group.name}}</p>
                </div>
                <div v-for="spell of group.spells" class="spell"
                  @click="pick(spell, $event)"
                  @mouseover="mouseover(spell, $event)"
                  @mouseout="mouseout(spell, $event)">
                    <img :src="spell.image" alt="spell" />
                </div>
              </div>
            </div>

            <div class="change-logs">
              <p class="title">Lịch sử cập nhật</p>

              <p>
              2024-09-12:
                <ul>
                  <li>MỚI: Graves W  - Bom mù</li>
                  <li>MỚI: Cơ chế giảm tầm nhìn</li>
                  <li>CẬP NHẬT: Teemo R nay có thể nảy</li>
                  <li>CẬP NHẬT: Giảm thời gian đợi Q2 của yasuo - tích cộng dồn nhanh hơn</li>
                  <li>Cập nhật hình ảnh các bộ chiêu thức</li>
                </ul>
              </p>
            </div>
        </div>
      </div>
      `,
    });

    this.vueInstance = this.app.mount('#InGameHUD');

    (document.querySelector('#InGameHUD') as any).oncontextmenu = () => false;
  }

  _startUpdateLoop() {
    const tick = () => {
      this.update();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  update() {
    const player = this.game?.player;
    if (!player) return;

    const { health, maxHealth, mana, maxMana } = player.stats || {};
    this.vueInstance.stats.health = ~~health?.value;
    this.vueInstance.stats.maxHealth = ~~maxHealth?.value;
    this.vueInstance.stats.mana = ~~mana?.value;
    this.vueInstance.stats.maxMana = ~~maxMana?.value;
    this.vueInstance.stats.healthPercent = Math.min((health?.value as number) / maxHealth?.value, 1) * 100;
    this.vueInstance.stats.manaPercent = Math.min((mana?.value as number) / maxMana?.value, 1) * 100;

    this.vueInstance.avatar = player.avatar?.path || '';
    this.vueInstance.isDead = player.isDead;
    this.vueInstance.reviveAfter = ~~((player.deathData?.reviveAfter ?? 0) / 1000);

    this.vueInstance.spells = (player.spells || [])
      .filter((i: any) => i?.image?.path)
      .map((spell: any, index: number) => {
        const isInternalSpell = index === 0;
        const isSummonerSpell = index > 4;
        const hotKey = SpellHotKeys[index]
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
          coolDownText: Math.ceil(currentCooldown / 1000),
          coolDownPercent: Math.min((currentCooldown / coolDown) * 100, 100),
          showCoolDown: currentCooldown > 0,
          small: isInternalSpell || isSummonerSpell,
          canCast: player.canCast && !player.isDead,
          hotKey,
        };
      });

    this.vueInstance.buffs = (player.buffs || [])
      .filter((i: any) => i?.image?.path)
      .map((buff: any) => {
        const { image, duration, timeElapsed } = buff || {};
        const timeLeft = duration - timeElapsed;
        return {
          image: image?.path,
          duration,
          timeElapsed,
          timeLeftText: Math.ceil(timeLeft / 1000),
        };
      });
  }

  destroy() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.app.unmount();
    this.app = null;
  }
}
