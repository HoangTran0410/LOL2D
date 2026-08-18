import { createApp, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import SetupSceneView from './SetupScene.vue';
import { loadGameScene } from './gamePreload';

/**
 * The lifecycle half of the pregame setup screen. Every control, every field
 * of `PregameConfig`, and the localStorage read/write all live in
 * `SetupScene.vue` (via `setup/usePregameConfig.ts`) — this class only mounts
 * and unmounts that component and forwards its two navigation events to the
 * scene manager, since a Vue component has no access to `sceneManager`
 * itself.
 *
 * "Bắt Đầu" is deliberately identical to the menu's own "Chơi" button: both
 * just show `GameScene`, which is what keeps Play a one-click path from the
 * menu whether or not a player ever opens this screen. `Game.ts` reads the
 * persisted config once, at construction — this scene never reaches into a
 * running game, and a running game never reaches back here.
 *
 * Mounted in `enter()` and unmounted in `exit()`, not `setup()`: this scene
 * is entered repeatedly (every time "Cấu Hình Trận Đấu" or "Quay lại" is
 * clicked), and a fresh mount means a fresh `usePregameConfig()` call, i.e. a
 * fresh `localStorage` read, on every entry — the same "always reflects
 * what's actually saved" behaviour the old `enter() { this.config =
 * loadPregameConfig(); ... }` had.
 */
export default class SetupScene extends Scene {
  private host!: HTMLElement;
  private app: App | null = null;

  setup() {
    this.host = document.querySelector('#pregame-scene') as HTMLElement;
  }

  enter() {
    this.host.style.display = 'flex';
    this.app = createApp(SetupSceneView, {
      // `./MenuScene` is imported dynamically for the same reason `MenuScene`
      // imports this file dynamically: the two referencing each other statically
      // is a cycle, and a cycle is a single chunk — which is how the whole game
      // ended up inside the menu's own bundle.
      onBack: () => {
        void import('./MenuScene').then(module => this.sceneManager.showScene(module.default));
      },
      onStart: () => {
        void loadGameScene().then(scene => this.sceneManager.showScene(scene));
      },
    });
    this.app.mount(this.host);
  }

  exit() {
    this.app?.unmount();
    this.app = null;
    this.host.style.display = 'none';
  }
}
