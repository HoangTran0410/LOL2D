import { createApp, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import DomUtils from '@/utils/dom.utils';
import GameScene from './GameScene';
import SetupScene from './SetupScene';
import MenuSceneView from './MenuScene.vue';

/**
 * The lifecycle half of the main menu. The background carousel, the logo and
 * the buttons all live in `MenuScene.vue`; this owns mounting and the two
 * scene transitions the component can only ask for, not perform itself.
 *
 * Mounted in `enter()` and unmounted in `exit()`, not `setup()`: this scene
 * is entered repeatedly (every "Quay lại" from the pregame screen), and a
 * fresh mount is what gives the background carousel a clean restart each
 * time instead of accumulating intervals across visits.
 */
export default class MenuScene extends Scene {
  private host!: HTMLElement;
  private app: App | null = null;

  setup() {
    this.host = document.querySelector('#menu-scene') as HTMLElement;
    DomUtils.preventZoom();
  }

  enter() {
    this.host.style.display = 'flex';
    // "Chơi" stays a single click into a match, with whatever config is
    // already persisted (defaults, if the player has never opened the setup
    // screen) — the setup screen is additive, never a gate in front of Play.
    this.app = createApp(MenuSceneView, {
      onPlay: () => this.sceneManager.showScene(GameScene),
      onOpenConfig: () => this.sceneManager.showScene(SetupScene),
    });
    this.app.mount(this.host);
  }

  exit() {
    this.app?.unmount();
    this.app = null;
    this.host.style.display = 'none';
  }
}
