import { createApp, type App } from 'vue';
import { Scene } from '../managers/SceneManager';
import AssetManager from '../managers/AssetManager';
import LoadingSceneView from './LoadingScene.vue';
import type MenuScene from './MenuScene';

/** What `LoadingScene.vue` exposes back to the scene driving it. */
interface LoadingView {
  setMessage(text: string): void;
  setProgress(percent: number): void;
  fail(text: string): void;
  reset(): void;
}

/**
 * The lifecycle half of the loading screen. The markup and the state live in
 * `LoadingScene.vue`; this owns mounting, the asset load, and the handover to
 * the menu.
 *
 * Mounted in `setup()` rather than `enter()` because this scene is entered
 * exactly once, at boot, and the container has to exist before p5 draws its
 * first frame. Scenes that are entered repeatedly should mount in `enter()`
 * and unmount in `exit()` instead, so a re-entry starts from clean state.
 */
export default class LoadingScene extends Scene {
  private app: App | null = null;
  private view: LoadingView | null = null;
  private host!: HTMLElement;

  setup() {
    this.host = document.querySelector('#loading-scene') as HTMLElement;
    this.app = createApp(LoadingSceneView);
    this.view = this.app.mount(this.host) as unknown as LoadingView;
  }

  enter() {
    this.host.style.display = 'block';
    this.view?.reset();

    AssetManager.ensure('json_summoner_map')
      .then(() => {
        this.view?.setProgress(100);
        this.view?.setMessage('Đang khởi tạo game...');
        return import('./MenuScene');
      })
      .then(({ default: MenuSceneClass }: { default: typeof MenuScene }) => {
        this.sceneManager.showScene(MenuSceneClass);
      })
      .catch(error => {
        console.error(error);
        this.view?.fail(
          'LỖI: Khởi tạo game không thành công. Vui lòng tải lại trang.<br/>' + error.message
        );
      });
  }

  exit() {
    this.host.style.display = 'none';
  }
}
