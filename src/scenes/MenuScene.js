import { Scene } from '../managers/SceneManager.js';
import GameScene from './GameScene.js';

export default class MenuScene extends Scene {
  setup() {
    this.menuSceneDiv = document.querySelector('#menu-scene');
    this.background = document.querySelector('#menu-scene .background');
    this.playBtn = document.querySelector('#play-btn');

    this.playBtn.addEventListener('click', () => {
      this.sceneManager.showScene(GameScene);
    });
  }

  nextBackground() {
    let maxIndex = 7;
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
  }

  exit() {
    // hide dom
    this.menuSceneDiv.style.display = 'none';

    clearInterval(this.interval);
  }
}
