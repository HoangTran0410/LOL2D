import AssetManager from '../managers/AssetManager.js';
import { Scene } from '../managers/SceneManager.js';

export default class LoadingScene extends Scene {
  setup() {
    this.loadingSceneDiv = document.querySelector('#loading-scene');
    this.loadingAnimation = this.loadingSceneDiv.querySelector('.loading');
    this.loadingText = this.loadingSceneDiv.querySelector('.loading-text');
    this.errorText = this.loadingSceneDiv.querySelector('.error-text');
  }

  enter() {
    // reset dom
    this.loadingSceneDiv.style.display = 'block';
    this.loadingAnimation.style.display = 'block';
    this.loadingText.innerHTML = '0%';
    this.errorText.innerHTML = '';

    const errorAssets = [];

    // load assets
    AssetManager.loadAssets(
      // progress
      ({ index, total, path }) => {
        let percent = round((index / total) * 100);
        this.loadingText.innerHTML = percent + '%' + `<br/>${path}`;
      },

      // success
      () => {
        this.loadingText.innerHTML = '99%<br/>Đang khởi tạo game...';
        import('./MenuScene.js')
          .then(({ default: MenuScene }) => this.sceneManager.showScene(MenuScene))
          .catch(error => {
            console.error(error);
            this.errorText.innerHTML =
              'LỖI: Khởi tạo game không thành công. Vui lòng tải lại trang.<br/>' + error.message;
          });
      },

      // failed
      ({ path, error }) => {
        this.loadingAnimation.style.display = 'none';
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
