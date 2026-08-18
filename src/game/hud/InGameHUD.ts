/**
 * The HUD's whole job, now: read the game on a timer, hand the result to
 * whichever view is showing, mount/unmount the Vue app.
 *
 * Everything that used to live in this one 26KB file has moved to four
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
 *   - `InGameHUD.vue` — the app root: the always-visible touch/mouse toggle
 *     and the switch between the two layouts on `hud.touchUi`, the same flag
 *     the on-screen toggle and `Game.applyTouchUiClass` already use — not a
 *     viewport breakpoint, see `styles/hud.css`'s "Touch layout" section for
 *     why.
 *   - `DesktopHudView.vue` / `MobileHudView.vue` — the two layouts. Neither
 *     computes anything; both just read `state` (a prop) and `hud`
 *     (injected) and lay them out differently.
 *
 * This class is the lifecycle half, same shape as `LoadingScene.ts`: the
 * markup and the state live in the `.vue` components, this owns mounting,
 * the game/asset wiring the components cannot reach on their own (`hud`
 * needs a `Game` to be constructed), and the update loop.
 */
import { createApp, type App } from 'vue';
import Game from '@/game/Game';
import { computeHudState, HUD_UPDATE_INTERVAL_MS, type HudState } from './hudState';
import { createHudInteractions, type HudInteractions } from './hudInteractions';
import InGameHUDView from './InGameHUD.vue';

/** What `InGameHUD.vue` exposes back to the class driving it. */
interface HudView {
  hud: HudInteractions;
  setState(next: HudState | null): void;
}

export default class InGameHUD {
  private game: Game;
  private _rafId: number | null = null;
  private app: App | null = null;
  private view: HudView | null = null;
  /**
   * Kept public under this exact name: `tests/e2e/drive-mobile-hud.mjs` and
   * `drive-touch-controls.mjs` reach `game.inGameHUD.vueInstance.hud`
   * directly to read/drive the picker with real CDP touch events, rather
   * than calling a method on this class — the same touch-vs-click
   * distinction that caught the original bug those scripts guard, so the
   * scripts deliberately do not go through a friendlier API.
   */
  vueInstance: HudView | null = null;

  constructor(game: Game) {
    this.game = game;
    this._rafId = null;
    this.initVue(game);
    this._startUpdateLoop();
  }

  private initVue(game: Game) {
    const hud = createHudInteractions(game);
    const host = document.querySelector('#InGameHUD') as HTMLElement;

    this.app = createApp(InGameHUDView, { hud });
    this.view = this.app.mount(host) as unknown as HudView;
    this.vueInstance = this.view;

    host.oncontextmenu = () => false;
  }

  private _startUpdateLoop() {
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

  private update() {
    if (!this.view) return;
    // The HUD does not own the flag — the toggle, the query parameter and the
    // stored preference all reach the controls first — so it reads it back
    // rather than assuming its own button was the last thing to change it.
    this.view.hud.touchUi = this.game.touchControls?.enabled ?? false;
    if (this.game.paused) return;
    this.view.setState(computeHudState(this.game));
  }

  setUpdatesPaused(paused: boolean): void {
    if (paused) {
      if (this._rafId !== null) cancelAnimationFrame(this._rafId);
      this._rafId = null;
    } else if (this._rafId === null) {
      this._startUpdateLoop();
    }
  }

  setTouchUi(enabled: boolean): void {
    if (this.view) this.view.hud.touchUi = enabled;
  }

  destroy() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.app?.unmount();
    this.app = null;
    this.view = null;
    this.vueInstance = null;
  }
}
