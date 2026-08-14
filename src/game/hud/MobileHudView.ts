/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The touch HUD: a compact strip top-left (avatar, health/mana, loadout,
 * buffs) plus whatever `TouchControls` draws on the canvas underneath it.
 *
 * Two things are deliberately different from `DesktopHudView`, both because
 * a thumb is a worse pointer than a mouse and worse still if it also has to
 * travel:
 *
 *   1. No cooldown here. `TouchControls.drawButtons` (via
 *      `TouchControls.describeButtonVisual`) puts the wedge, the seconds and
 *      the mana badge on the button a thumb is already resting on. Repeating
 *      that state up here, away from the thumb, is the exact complaint this
 *      view exists to fix, so the icons below only ever greyscale for
 *      `disabled`/`!canCast`/`!affordable` — never for `lockedOut`, which is
 *      cooldown.
 *   2. Every icon is a real, working entry point to the spell picker. It
 *      always was a `@click` in the shared markup; under a real touch it
 *      silently did nothing, because `GameScene`'s canvas-wide
 *      `preventDefault()` on touch suppresses the synthesised `click`
 *      everywhere on the page, HUD included (see `hudInteractions.ts`'s file
 *      comment). The tap is driven from `touchend` here instead, sized up
 *      for a thumb (see `styles/hud.css`'s touch block) and marked with a
 *      small pencil badge so "tap this to change it" does not have to be
 *      discovered by accident.
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
                    @touchstart="hud.touchSpellStart(spell, $event)"
                    @touchmove="hud.touchSpellMove($event)"
                    @touchend.prevent="hud.touchSpellEnd(() => hud.changeSpell(index))"
                    @touchcancel="hud.cancelLongPress()">
                    <img :src="spell.image" alt="spell"
                        :style="(spell.disabled || !spell.canCast || !spell.affordable) ? 'filter: grayscale(100%)' : ''" />

                    <span v-if="spell.stackCount !== undefined" class="stacks">{{spell.stackCount}}</span>
                    <span v-if="spell.manaCost > 0" :class="spell.affordable ? 'mana-cost' : 'mana-cost short'">{{spell.manaCost}}</span>
                    <i class="fa-solid fa-pen edit-badge"></i>
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
