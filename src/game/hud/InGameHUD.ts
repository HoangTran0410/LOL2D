/* eslint-disable @typescript-eslint/no-explicit-any */
import { createApp, toRaw } from 'vue';
import Game from '../Game';
import AIChampion from '../gameObject/attackableUnits/AIChampion';
import { SpellHotKeys } from '../constants';
import { removeAccents } from '../../utils/index';
import * as AllSpells from '../gameObject/spells/index';
import { SpellGroups } from '../preset';
import AssetManager, { type AssetHandle, type AssetKey } from '../../managers/AssetManager';

function ensureVisibleAsset(asset: Pick<AssetHandle, 'key' | 'status'> | undefined): void {
  if (asset?.key && asset.status === 'idle') {
    void AssetManager.ensure(asset.key).catch(error => console.warn(error));
  }
}

/**
 * How often the HUD reads the game, in milliseconds.
 *
 * It used to run on every animation frame, which meant rebuilding the spell and
 * buff arrays sixty times a second and handing Vue a fresh identity for every
 * one of them — style recalculation and patching on a phone that is already
 * several times slower than the desktop this was written on. Nothing here
 * changes fast enough to need it: the health bar carries a 0.1s CSS transition
 * that smooths the gaps, the cooldown numbers are whole seconds, and the wedge
 * is a percentage nobody can read to the frame. 50ms is twenty reads a second,
 * which is still four times finer than the fastest thing on screen.
 */
const HUD_UPDATE_INTERVAL_MS = 50;

/**
 * How long a thumb must rest on a spell icon before its description appears.
 *
 * The tooltip is opened by hover on the desktop, and a touch screen has no
 * hover — which left the only place in the game that says what an ability does
 * unreachable on the device where a player is least likely to know already.
 * 400ms is the usual long-press: past a tap, short of feeling stuck.
 */
const LONG_PRESS_MS = 400;

/** How long the description stays up after the thumb lifts. */
const LONG_PRESS_DISMISS_MS = 2500;

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
  /** True only for a real wait. A swing rhythm gets the wedge and nothing else. */
  lockedOut: boolean;
  small: boolean;
  canCast: boolean;
  hotKey: string;
  /** Undefined for spells that do not accumulate anything. */
  stackCount?: number;
  manaCost: number;
  /** False once the pool has dropped below manaCost, which greys the icon. */
  affordable: boolean;
}

interface BuffDisplay {
  image: string;
  duration: number;
  timeElapsed: number;
  timeLeftText: number;
  stacks: number;
}

interface SpellGroupDisplay {
  name: string;
  image: string;
  background: string;
  imageKey: AssetKey | null;
  backgroundKey: AssetKey | null;
  spells: SpellItemDisplay[];
}

interface SpellItemDisplay {
  name: string;
  image: string;
  description: string;
  coolDown: number;
  manaCost: number;
  spellClass: any;
  assetKey: AssetKey | null;
}

interface StatsDisplay {
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  healthPercent: number;
  manaPercent: number;
  shieldPercent: number;
  shieldLeftPercent: number;
  shield: number;
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
              manaCost: spellInstance.manaCost,
              spellClass: spellClass,
              assetKey: spellInstance.image?.key ?? null,
            })),

          spellGroups: (SpellGroups as any[]).map((group: any) => {
            return {
              name: group.name,
              image: group.image
                ? AssetManager.get(group.image).url
                : AssetManager.placeholder(group.name).url,
              background: group.background ? AssetManager.get(group.background).url : '',
              imageKey: group.image,
              backgroundKey: group.background,
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
                    manaCost: spellInstance.manaCost,
                    spellClass: spellClass,
                    assetKey: spellInstance.image?.key ?? null,
                  };
                }),
            };
          }),
          backgroundPicker: null as string | null,
          spellHover: null as any,
          spellInfo: { top: 'auto', bottom: '0px', left: '0px', width: '300px' },
          isDead: false,

          /** Mirrors game.touchControls.enabled; drives the whole touch layout. */
          touchUi: false,
          longPressTimer: 0,
          longPressDismissTimer: 0,
          longPressFired: false,
        };
      },
      methods: {
        pick(spell: any) {
          // Same rule as changeSpell: a long press was a request to read the
          // description, not to equip the thing.
          if (this.longPressFired) {
            this.longPressFired = false;
            return;
          }
          const bots = this.game.objectManager.objects.filter((o: any) => o instanceof AIChampion);

          if (this.oneForAll) {
            this.game.player.replaceSpells(
              this.game.player.spells.map(() => new spell.spellClass(toRaw(this.game.player)))
            );
            bots.forEach((bot: any) => {
              bot._respawnWithNewPreset = false;
              bot.replaceSpells(bot.spells.map(() => new spell.spellClass(toRaw(bot))));
            });
          } else if (
            this.spellIndexToSwap >= 0 &&
            this.spellIndexToSwap <= this.game.player.spells.length
          ) {
            const spellInstance = new spell.spellClass(toRaw(this.game.player));
            this.game.player.replaceSpell(this.spellIndexToSwap, spellInstance);

            bots.forEach((bot: any) => {
              if (this.cloneMySpell) {
                bot._respawnWithNewPreset = false;
                const botSpellInstance = new spell.spellClass(toRaw(bot));
                bot.replaceSpell(this.spellIndexToSwap, botSpellInstance);
              } else {
                bot._respawnWithNewPreset = true;
              }
            });
          }
          this.showSpellsPicker = false;
          this.game.unpause();

          this.spellHover = null;
        },
        toggleTouchUi() {
          const next = !this.touchUi;
          this.touchUi = next;
          this.game.setTouchControlsEnabled(next);
        },
        /**
         * A thumb has landed on a spell icon. The description is armed here and
         * fires if the thumb is still there 400ms later; anything shorter is a
         * tap, which opens the picker exactly as a click does.
         *
         * `currentTarget` is read now rather than inside the timer: the browser
         * nulls it the moment the handler returns.
         */
        touchSpellStart(spellProxy: any, event: any) {
          const element = event.currentTarget || event.target;
          this.cancelLongPress();
          this.longPressFired = false;
          this.longPressTimer = window.setTimeout(() => {
            this.longPressFired = true;
            this.showSpellInfo(spellProxy, element);
          }, LONG_PRESS_MS);
        },
        touchSpellEnd() {
          if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = 0;
          }
          if (!this.longPressFired) return;
          // Nothing to hover away from on a touch screen, so the description
          // times itself out rather than waiting for a gesture nobody will make.
          this.longPressDismissTimer = window.setTimeout(() => {
            this.spellHover = null;
          }, LONG_PRESS_DISMISS_MS);
        },
        cancelLongPress() {
          if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = 0;
          }
          if (this.longPressDismissTimer) {
            clearTimeout(this.longPressDismissTimer);
            this.longPressDismissTimer = 0;
          }
        },
        changeSpell(index: number) {
          // A long press has already done something with this icon; the click
          // the browser synthesises when the thumb lifts is not a second
          // intention, and must not open the picker on top of the tooltip.
          if (this.longPressFired) {
            this.longPressFired = false;
            return;
          }
          this.spellIndexToSwap = index;
          this.showSpellsPicker = !this.showSpellsPicker;

          if (this.showSpellsPicker) {
            this.loadSpellPickerAssets();
            this.game.pause();
          } else this.game.unpause();

          this.spellHover = null;
        },
        loadSpellPickerAssets() {
          const keys = new Set<AssetKey>();
          const add = (key: AssetKey | null) => {
            if (key) keys.add(key);
          };
          for (const spell of (this as any).allSpells as SpellItemDisplay[]) add(spell.assetKey);
          for (const group of (this as any).spellGroups as SpellGroupDisplay[]) {
            add(group.imageKey);
            add(group.backgroundKey);
            for (const spell of group.spells) add(spell.assetKey);
          }
          void AssetManager.ensureMany([...keys]).catch(error => console.warn(error));
        },
        closeSpellPicker() {
          this.showSpellsPicker = false;
          this.game.unpause();
        },
        mouseover(spellProxy: any, event: any) {
          // Hover is a mouse gesture. On a touch screen the browser fires one
          // anyway on the way to a click, which would flash the description for
          // an instant every time a player opened the picker.
          if (this.touchUi) return;
          this.showPreview(spellProxy, true);
          this.showSpellInfo(spellProxy, event.currentTarget || event.target);
        },
        /**
         * Place the description panel next to `element`.
         *
         * Above it with a mouse, because the spell bar is along the bottom of
         * the screen. Below it under a thumb, because in touch mode the bar has
         * moved to the top and "above" would be off the screen entirely. The
         * panel also stops being a fixed 300px there — that is most of a phone
         * held sideways — and is kept inside the viewport on both edges.
         */
        showSpellInfo(spellProxy: any, element: any) {
          if (!element?.getBoundingClientRect) return;
          this.spellHover = spellProxy;
          const { width, x, y, bottom } = element.getBoundingClientRect();

          if (!this.touchUi) {
            this.spellInfo = {
              top: 'auto',
              bottom: 'calc(100vh - ' + (y - 5) + 'px)',
              left: Math.max(x + width / 2 - 150, 0) + 'px',
              width: '300px',
            };
            return;
          }

          const panelWidth = Math.min(300, window.innerWidth * 0.78);
          const left = Math.min(
            Math.max(x + width / 2 - panelWidth / 2, 6),
            Math.max(6, window.innerWidth - panelWidth - 6)
          );
          this.spellInfo = {
            top: bottom + 8 + 'px',
            bottom: 'auto',
            left: left + 'px',
            width: panelWidth + 'px',
          };
        },
        mouseout(spellProxy: any) {
          if (this.touchUi) return;
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
            const s = toRaw(spellProxy.instance);
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
        <button class="touch-toggle" :class="touchUi ? 'on' : ''" @click="toggleTouchUi()"
            :title="touchUi ? 'Chuyển sang chuột và bàn phím' : 'Chuyển sang điều khiển cảm ứng'">
          <i class="fa-solid fa-gamepad"></i>
        </button>

        <div v-if="spellHover" class="spell-info"
            :style="'top:'+spellInfo.top+';bottom:'+spellInfo.bottom+';left:'+spellInfo.left+';width:'+spellInfo.width">
            <div class="header">
              <div>
                <img :src="spellHover.image" alt="spell" />
                <h4>{{spellHover.name}}</h4>
              </div>
              <div class="costs">
                <span>{{spellHover.coolDown/1000}}s</span>
                <span v-if="spellHover.manaCost > 0" class="mana">{{spellHover.manaCost}} mana</span>
              </div>
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
                        @mouseout="mouseout(spell, $event)"
                        @touchstart="touchSpellStart(spell, $event)"
                        @touchend="touchSpellEnd()"
                        @touchcancel="cancelLongPress()"
                        @touchmove="cancelLongPress()">
                        <img :src="spell.image" alt="spell"
                            :style="(spell.disabled || spell.lockedOut || !spell.canCast || !spell.affordable) ? 'filter: grayscale(100%)' : ''" />

                        <span v-if="spell.hotKey" class="hotKey">{{spell.hotKey}}</span>
                        <span v-if="spell.stackCount !== undefined" class="stacks">{{spell.stackCount}}</span>
                        <span v-if="spell.manaCost > 0" :class="spell.affordable ? 'mana-cost' : 'mana-cost short'">{{spell.manaCost}}</span>
                        <div v-if="spell.showCoolDown">
                            <div :class="spell.lockedOut ? 'cooldown-overlay' : 'cooldown-overlay rhythm'"
                                 :style="'height:'+ spell.coolDownPercent +'%'"></div>
                            <div v-if="spell.lockedOut" class="cooldown">
                                <p>{{spell.coolDownText}}</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="health-bar">
                    <div class="bar">
                        <div :style="'width:'+ stats.healthPercent +'%; background-color:#0ca20c'">
                        </div>
                        <div v-if="stats.shield > 0" class="shield"
                          :style="'position:absolute; top:0; bottom:0; left:'+ stats.shieldLeftPercent +'%; width:'+ stats.shieldPercent +'%; background-color:rgba(225,230,238,0.85)'">
                        </div>
                        <p>{{stats.health}} / {{stats.maxHealth}}<span v-if="stats.shield > 0"> (+{{stats.shield}})</span></p>
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
                        <span v-if="buff.stacks > 1" class="stacks">{{buff.stacks}}</span>
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
                  @mouseout="mouseout(spell, $event)"
                  @touchstart="touchSpellStart(spell, $event)"
                  @touchend="touchSpellEnd()"
                  @touchcancel="cancelLongPress()"
                  @touchmove="cancelLongPress()">
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
    let lastUpdateMs = 0;
    const tick = () => {
      const now = performance.now();
      // Still driven by rAF, so the HUD stops dead when the tab is hidden —
      // but the work inside is rationed. See HUD_UPDATE_INTERVAL_MS.
      if (now - lastUpdateMs >= HUD_UPDATE_INTERVAL_MS) {
        lastUpdateMs = now;
        this.update();
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  update() {
    const player = this.game?.player;
    if (!player) return;

    // The HUD does not own the flag — the toggle, the query parameter and the
    // stored preference all reach the controls first — so it reads it back
    // rather than assuming its own button was the last thing to change it.
    this.vueInstance.touchUi = this.game.touchControls?.enabled ?? false;

    ensureVisibleAsset(player.avatar);

    const { health, maxHealth, mana, maxMana } = player.stats || {};
    this.vueInstance.stats.health = ~~health?.value;
    this.vueInstance.stats.maxHealth = ~~maxHealth?.value;
    this.vueInstance.stats.mana = ~~mana?.value;
    this.vueInstance.stats.maxMana = ~~maxMana?.value;
    this.vueInstance.stats.healthPercent =
      Math.min((health?.value as number) / maxHealth?.value, 1) * 100;
    this.vueInstance.stats.manaPercent =
      Math.min((mana?.value as number) / maxMana?.value, 1) * 100;

    const shield = player.shieldAmount ?? 0;
    const shieldPercent = Math.min(shield / (maxHealth?.value || 1), 1) * 100;
    this.vueInstance.stats.shield = ~~shield;
    this.vueInstance.stats.shieldPercent = shieldPercent;
    this.vueInstance.stats.shieldLeftPercent = Math.min(
      this.vueInstance.stats.healthPercent,
      100 - shieldPercent
    );

    this.vueInstance.avatar = player.avatar?.path || '';
    this.vueInstance.isDead = player.isDead;
    this.vueInstance.reviveAfter = ~~((player.deathData?.reviveAfter ?? 0) / 1000);

    this.vueInstance.spells = (player.spells || [])
      .filter((i: any) => i?.image?.path)
      .map((spell: any, index: number) => {
        ensureVisibleAsset(spell.image);
        const isInternalSpell = index === 0;
        const isSummonerSpell = index > 4;
        const hotKey = SpellHotKeys[index]
          ? String.fromCharCode(SpellHotKeys[index]).toUpperCase()
          : '';

        const {
          disabled,
          image,
          coolDown,
          state,
          currentCooldown,
          name,
          description,
          stackCount,
          manaCost,
        } = spell || {};
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
          // `!== false` so a spell that never heard of the flag still reads as a
          // lockout, which is what every cooldown but the swing timer is
          lockedOut: currentCooldown > 0 && spell?.cooldownLocksOut !== false,
          small: isInternalSpell || isSummonerSpell,
          canCast: player.canCast && !player.isDead,
          hotKey,
          stackCount,
          manaCost: manaCost ?? 0,
          affordable: (mana?.value ?? 0) >= (manaCost ?? 0),
        };
      });

    // One row per kind of buff, not per stack: Veigar Q alone can hold hundreds
    // of StatAmp instances, which used to render hundreds of icons. The longest
    // remaining instance drives the countdown.
    const buffRows = new Map<any, BuffDisplay>();
    for (const buff of player.buffs || []) {
      if (!buff?.image?.path) continue;
      ensureVisibleAsset(buff.image);

      const key = buff.stackId ?? buff.constructor;
      const timeLeft = (buff.duration || 0) - (buff.timeElapsed || 0);
      const existing = buffRows.get(key);

      if (existing) {
        existing.stacks++;
        if (timeLeft > existing.duration - existing.timeElapsed) {
          existing.duration = buff.duration;
          existing.timeElapsed = buff.timeElapsed;
          existing.timeLeftText = Math.ceil(timeLeft / 1000);
        }
        continue;
      }

      buffRows.set(key, {
        image: buff.image.path,
        duration: buff.duration,
        timeElapsed: buff.timeElapsed,
        timeLeftText: Math.ceil(timeLeft / 1000),
        stacks: 1,
      });
    }
    this.vueInstance.buffs = [...buffRows.values()];
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
