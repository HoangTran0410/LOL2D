import { Scene } from '../managers/SceneManager.js';
import GameScene from './GameScene.js';

export default class MenuScene extends Scene {
  setup() {
    this.menuSceneDiv = document.querySelector('#menu-scene');
    this.playBtn = document.querySelector('#play-btn');

    this.playBtn.addEventListener('click', () => {
      this.sceneManager.showScene(GameScene);
    });
  }
  enter() {
    // reset dom
    this.menuSceneDiv.style.display = 'block';
  }

  exit() {
    // hide dom
    this.menuSceneDiv.style.display = 'none';
  }
}
