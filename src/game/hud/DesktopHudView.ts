/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The mouse-and-keyboard HUD: the bar along the bottom of the screen, spell
 * cooldowns drawn on its own icons, hover for the description.
 *
 * Reads `HudState` (via the `state` prop, recomputed at `HUD_UPDATE_INTERVAL_MS`
 * by `InGameHUD`) and `HudInteractions` (via `inject('hud')`, shared with
 * `MobileHudView` and `SpellPickerModal`) — it owns neither. Its whole job is
 * this layout; the desktop-specific behaviour in it is `mouseover`/`mouseout`
 * for the tooltip, everything else is the shared interaction layer.
 */
import SpellPickerModal from './SpellPickerModal';

export default {
  inject: ['hud'],
  props: {
    state: { type: Object, required: true },
  },
  components: { SpellPickerModal },

  template: /*html*/ `
  <div>
    <div v-if="hud.spellHover" class="spell-info"
        :style="'top:'+hud.spellInfo.top+';bottom:'+hud.spellInfo.bottom+';left:'+hud.spellInfo.left+';width:'+hud.spellInfo.width">
        <div class="header">
          <div>
            <img :src="hud.spellHover.image" alt="spell" />
            <h4>{{hud.spellHover.name}}</h4>
          </div>
          <div class="costs">
            <span>{{hud.spellHover.coolDown/1000}}s</span>
            <span v-if="hud.spellHover.manaCost > 0" class="mana">{{hud.spellHover.manaCost}} mana</span>
          </div>
        </div>
        <p class="body" v-html="hud.spellHover.description"></p>
    </div>

    <div v-if="state.avatar" class="bottom-HUD">
        <div class="champion-avatar">
            <img :src="state.avatar" alt="champion-avatar" :style="state.isDead ? 'filter: grayscale(100%)' : ''">
            <span v-if="state.isDead" class="revive-counter">{{state.reviveAfter}}</span>
        </div>

        <div class="champion-details">
            <div class="spells">
                <div v-for="(spell, index) of state.spells" :class="spell.small ? 'spell small' : 'spell'"
                    @click="hud.changeSpell(index)"
                    @mouseover="hud.mouseover(spell, $event)"
                    @mouseout="hud.mouseout(spell, $event)">
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
                    <div :style="'width:'+ state.stats.healthPercent +'%; background-color:#0ca20c'">
                    </div>
                    <div v-if="state.stats.shield > 0" class="shield"
                      :style="'position:absolute; top:0; bottom:0; left:'+ state.stats.shieldLeftPercent +'%; width:'+ state.stats.shieldPercent +'%; background-color:rgba(225,230,238,0.85)'">
                    </div>
                    <p>{{state.stats.health}} / {{state.stats.maxHealth}}<span v-if="state.stats.shield > 0"> (+{{state.stats.shield}})</span></p>
                </div>
                <div class="bar" style="margin-top:3px">
                    <div :style="'width:'+ state.stats.manaPercent + '%; background-color:#218bdd;'">
                    </div>
                    <p>{{state.stats.mana}} / {{state.stats.maxMana}}</p>
                </div>
            </div>
            <div class="buffs">
                <div v-for="buff of state.buffs" class="buff">
                    <img :src="buff.image" alt="buff">
                    <span>{{buff.timeLeftText}}</span>
                    <span v-if="buff.stacks > 1" class="stacks">{{buff.stacks}}</span>
                </div>
            </div>
        </div>
    </div>

    <spell-picker-modal v-if="hud.showSpellsPicker" />
  </div>
  `,
};
