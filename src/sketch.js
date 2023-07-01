import SceneManager from './managers/SceneManager.js';
import LoadingScene from './scenes/LoadingScene.js';

export function setup() {
  createCanvas(windowWidth, windowHeight).parent('game-scene');

  // scene manager
  let mgr = new SceneManager();
  mgr.wire();

  // holding global data
  mgr.gameData = {};

  // open loading scene
  mgr.showScene(LoadingScene);
}

export function windowResized() {
  resizeCanvas(windowWidth, windowHeight, true);
}
