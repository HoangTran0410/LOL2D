import { Scene } from '../managers/SceneManager.js';
import DomUtils from '../utils/dom.utils.js';
import GameScene from './GameScene.js';

export default class MenuScene extends Scene {
  setup() {
    this.menuSceneDiv = document.querySelector('#menu-scene');
    this.background = document.querySelector('#menu-scene .background');
    this.playBtn = document.querySelector('#play-btn');
    this.fullscreenBtn = document.querySelector('#fullscreen-btn');

    this.playBtn.addEventListener('click', () => {
      this.sceneManager.showScene(GameScene);
    });
    this.fullscreenBtn.addEventListener('click', () => {
      let isFullscreen = DomUtils.toggleFullscreen();
      if (isFullscreen) {
        this.fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
      } else {
        this.fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
      }
    });

    DomUtils.preventZoom();
  }

  nextBackground() {
    let maxIndex = 6;
    if (this.currentBgIndex === undefined) {
      this.currentBgIndex = Math.floor(Math.random() * maxIndex) + 1;
    } else {
      this.currentBgIndex = this.currentBgIndex + 1;
      if (this.currentBgIndex > maxIndex) {
        this.currentBgIndex = 1;
      }
    }
    this.background.style.backgroundImage = `url(./assets/images/others/menu-bg-${this.currentBgIndex}.jpg)`;
  }

  enter() {
    // reset dom
    this.menuSceneDiv.style.display = 'flex';

    this.nextBackground();
    this.interval = setInterval(() => {
      this.nextBackground();
    }, 5000);

    // this.sceneManager.showScene(GameScene);
  }

  exit() {
    // hide dom
    this.menuSceneDiv.style.display = 'none';

    clearInterval(this.interval);
  }
}
