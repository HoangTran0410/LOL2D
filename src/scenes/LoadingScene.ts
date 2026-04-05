import { Scene } from '../managers/SceneManager';
import AssetManager from '../managers/AssetManager';
import type MenuScene from './MenuScene';

export default class LoadingScene extends Scene {
  loadingSceneDiv!: HTMLElement;
  progressBar!: HTMLElement;
  loadingText!: HTMLElement;
  errorText!: HTMLElement;

  setup() {
    this.loadingSceneDiv = document.querySelector('#loading-scene') as HTMLElement;
    this.progressBar = this.loadingSceneDiv.querySelector('.progress-bar') as HTMLElement;
    this.loadingText = this.loadingSceneDiv.querySelector('.loading-text') as HTMLElement;
    this.errorText = this.loadingSceneDiv.querySelector('.error-text') as HTMLElement;
  }

  enter() {
    // reset dom
    this.loadingSceneDiv.style.display = 'block';
    this.progressBar.style.display = 'block';
    this.loadingText.innerHTML = 'Đang tải tài nguyên game...';
    this.errorText.innerHTML = '';

    const errorAssets: string[] = [];

    // load assets
    AssetManager.loadAssets(
      // progress
      ({ index, total, path }) => {
        const percent = Math.round((index / total) * 100);
        this.progressBar.style.width = percent + '%';
        this.loadingText.innerHTML = path;
      },

      // success
      () => {
        this.loadingText.innerHTML = 'Đang khởi tạo game...';
        import('./MenuScene')
          .then(({ default: MenuSceneClass }: { default: typeof MenuScene }) => {
            setTimeout(() => this.sceneManager.showScene(MenuSceneClass), 1000);
          })
          .catch(error => {
            console.error(error);
            this.errorText.innerHTML =
              'LỖI: Khởi tạo game không thành công. Vui lòng tải lại trang.<br/>' + error.message;
          });
      },

      // failed
      ({ path, error }) => {
        this.progressBar.style.display = 'none';
        errorAssets.push(path);
        this.errorText.innerHTML =
          'LỖI: Tải game không thành công. Vui lòng tải lại trang. <br/>' + errorAssets.join('\n');
      }
    );
  }

  exit() {
    // hide dom
    this.loadingSceneDiv.style.display = 'none';
  }
}
