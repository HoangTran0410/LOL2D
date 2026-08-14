/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The HUD's whole job, now: read the game on a timer, hand the result to
 * whichever view is showing, mount/unmount the Vue app.
 *
 * Everything that used to live in this one 26KB file has moved to three
 * places that can now be worked on independently, which was the point of
 * splitting it:
 *
 *   - `hudState.ts` — the data. What health, mana, cooldowns and buffs *are*,
 *     computed once from `Game` on the shared 20Hz tick below.
 *   - `hudInteractions.ts` — the behaviour. Picking a spell, hovering or
 *     long-pressing a description, the picker's own state. One instance,
 *     `provide()`d to every view, so opening the picker from the mobile
 *     strip is visible to the modal without the two needing to be the same
 *     component.
 *   - `DesktopHudView.ts` / `MobileHudView.ts` — the two layouts. Neither
 *     computes anything; both just read `state` (a prop) and `hud`
 *     (injected) and lay them out differently. This file picks between them
 *     on `hud.touchUi`, the same flag the on-screen toggle and
 *     `Game.applyTouchUiClass` already use — not a viewport breakpoint, see
 *     `styles/hud.css`'s "Touch layout" section for why.
 */
import { createApp } from 'vue';
import Game from '../Game';
import { computeHudState, HUD_UPDATE_INTERVAL_MS, type HudState } from './hudState';
import { createHudInteractions, type HudInteractions } from './hudInteractions';
import DesktopHudView from './DesktopHudView';
import MobileHudView from './MobileHudView';

export default class InGameHUD {
  private game: Game;
  private _rafId: number | null = null;
  private app: any;
  private vueInstance: any;
  private hud: HudInteractions;

  constructor(game: Game) {
    this.game = game;
    this._rafId = null;
    this.hud = createHudInteractions(game);
    this.initVue(game);
    this._startUpdateLoop();
  }

  initVue(game: Game) {
    const hud = this.hud;

    this.app = createApp({
      data() {
        return {
          hud,
          state: null as HudState | null,
        };
      },
      provide() {
        return { hud: this.hud };
      },
      components: { DesktopHudView, MobileHudView },
      template: /*html*/ `
      <div>
        <!-- Hidden behind the picker: both live in the top-right corner, and
             the toggle would otherwise sit on top of the picker's close
             button, which is the only way out of it. -->
        <button v-if="!hud.showSpellsPicker" class="touch-toggle" :class="hud.touchUi ? 'on' : ''"
            @click="hud.toggleTouchUi()"
            @touchend.prevent="hud.toggleTouchUi()"
            :title="hud.touchUi ? 'Chuyển sang chuột và bàn phím' : 'Chuyển sang điều khiển cảm ứng'">
          <i class="fa-solid fa-gamepad"></i>
        </button>

        <desktop-hud-view v-if="state && !hud.touchUi" :state="state" />
        <mobile-hud-view v-if="state && hud.touchUi" :state="state" />
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
    // The HUD does not own the flag — the toggle, the query parameter and the
    // stored preference all reach the controls first — so it reads it back
    // rather than assuming its own button was the last thing to change it.
    this.hud.touchUi = this.game.touchControls?.enabled ?? false;
    this.vueInstance.state = computeHudState(this.game);
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
