import { createApp, h, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import MatchConfigPanel from '@/game/hud/config/MatchConfigPanel.vue';
import PregameConfigSource from '@/game/hud/config/PregameConfigSource';
import { loadGameScene } from './gamePreload';

/**
 * The match-config panel, opened from the menu.
 *
 * There used to be a whole screen here — `SetupScene.vue` and six components
 * under `setup/` — answering the same questions the in-game practice panel
 * answered, in different words and with a different subset of the controls.
 * They are one component now (`MatchConfigPanel`), and the only thing that
 * differs between the two places it is mounted is which `MatchConfigSource` it
 * gets. Out here that is `PregameConfigSource`: pure `localStorage`, no match,
 * so `source.live` is `null` and the controls that act on a running match are
 * not rendered.
 *
 * This class is the lifecycle half and nothing else: it mounts the panel,
 * unmounts it, and forwards the two navigation events a Vue component cannot
 * perform itself.
 *
 * Mounted in `enter()` and unmounted in `exit()`, not `setup()`: this scene is
 * entered repeatedly, and a fresh mount means a fresh `PregameConfigSource`,
 * i.e. a fresh `localStorage` read, on every entry — so the panel always
 * reflects what is actually saved, including anything the *in-game* panel wrote
 * during the last match.
 *
 * "Bắt Đầu" is deliberately identical to the menu's own "Chơi": both just show
 * `GameScene`, which is what keeps Play a one-click path from the menu whether
 * or not a player ever opens this panel. `Game.ts` reads the persisted config
 * once, at construction — this scene never reaches into a running game, and a
 * running game never reaches back here.
 *
 * The whole file is reached through a dynamic `import()` from `MenuScene.ts`
 * (`loadSetupScene`), so the panel, the spell catalogue it needs for its kit
 * icons, and the loadout editor are all fetched when the button is pressed
 * rather than sitting in the menu's chunk.
 */
export default class SetupScene extends Scene {
  private host!: HTMLElement;
  private app: App | null = null;

  setup() {
    this.host = document.querySelector('#pregame-scene') as HTMLElement;
  }

  enter() {
    this.host.style.display = 'flex';
    const source = new PregameConfigSource();

    // A render function rather than a wrapper `.vue` file: the panel takes one
    // prop and two events, and a component whose entire body is `<PanelX
    // v-bind=... />` is a file to keep in step for no behaviour.
    this.app = createApp({
      render: () =>
        h(MatchConfigPanel, {
          source,
          // `./MenuScene` is imported dynamically for the same reason
          // `MenuScene` imports this file dynamically: the two referencing each
          // other statically is a cycle, and a cycle is a single chunk — which
          // is how the whole game ended up inside the menu's own bundle.
          onClose: () => {
            void import('./MenuScene').then(module =>
              this.sceneManager.showScene(module.default)
            );
          },
          onStart: () => {
            void loadGameScene().then(scene => this.sceneManager.showScene(scene));
          },
        }),
    });
    this.app.mount(this.host);
  }

  exit() {
    this.app?.unmount();
    this.app = null;
    this.host.style.display = 'none';
  }
}
