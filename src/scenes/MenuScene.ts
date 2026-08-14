import { Scene } from '../managers/SceneManager';
import DomUtils from '../utils/dom.utils';
import GameScene from './GameScene';
import SetupScene from './SetupScene';
import AssetManager, { type AssetKey } from '../managers/AssetManager';

const MENU_BACKGROUNDS: AssetKey[] = [
  'other_menu_bg_1',
  'other_menu_bg_2',
  'other_menu_bg_3',
  'other_menu_bg_4',
  'other_menu_bg_5',
  'other_menu_bg_6',
];

export default class MenuScene extends Scene {
  menuSceneDiv!: HTMLElement;
  background!: HTMLElement;
  playBtn!: HTMLElement;
  configBtn!: HTMLElement;
  fullscreenBtn!: HTMLElement;
  interval: ReturnType<typeof setInterval> | null = null;
  currentBgIndex?: number;

  setup() {
    this.menuSceneDiv = document.querySelector('#menu-scene') as HTMLElement;
    this.background = document.querySelector('#menu-scene .background') as HTMLElement;
    this.playBtn = document.querySelector('#play-btn') as HTMLElement;
    this.configBtn = document.querySelector('#config-btn') as HTMLElement;
    this.fullscreenBtn = document.querySelector('#fullscreen-btn') as HTMLElement;
    (document.querySelector('#menu-logo') as HTMLImageElement).src =
      AssetManager.get('other_newlogo_vi').url;

    // "Chơi" stays a single click into a match, with whatever config is
    // already persisted (defaults, if the player has never opened the setup
    // screen) — the setup screen is additive, never a gate in front of Play.
    this.playBtn.addEventListener('click', () => {
      this.sceneManager.showScene(GameScene);
    });
    this.configBtn.addEventListener('click', () => {
      this.sceneManager.showScene(SetupScene);
    });
    this.fullscreenBtn.addEventListener('click', () => {
      const isFullscreen = DomUtils.toggleFullscreen();
      if (isFullscreen) {
        this.fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
      } else {
        this.fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
      }
    });

    DomUtils.preventZoom();
  }

  nextBackground() {
    const maxIndex = MENU_BACKGROUNDS.length;
    if (this.currentBgIndex === undefined) {
      this.currentBgIndex = Math.floor(Math.random() * maxIndex) + 1;
    } else {
      this.currentBgIndex = this.currentBgIndex + 1;
      if (this.currentBgIndex > maxIndex) {
        this.currentBgIndex = 1;
      }
    }
    const key = MENU_BACKGROUNDS[this.currentBgIndex - 1];
    this.background.style.backgroundImage = `url(${AssetManager.get(key).url})`;
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

    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
