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

    AssetManager.ensure('json_summoner_map')
      .then(() => {
        this.progressBar.style.width = '100%';
        this.loadingText.innerHTML = 'Đang khởi tạo game...';
        return import('./MenuScene');
      })
      .then(({ default: MenuSceneClass }: { default: typeof MenuScene }) => {
        this.sceneManager.showScene(MenuSceneClass);
      })
      .catch(error => {
        console.error(error);
        this.progressBar.style.display = 'none';
        this.errorText.innerHTML =
          'LỖI: Khởi tạo game không thành công. Vui lòng tải lại trang.<br/>' + error.message;
      });
  }

  exit() {
    // hide dom
    this.loadingSceneDiv.style.display = 'none';
  }
}
