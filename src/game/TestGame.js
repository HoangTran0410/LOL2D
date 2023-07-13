import ObjectManager from './ObjectManager.js';
import Champion from './gameObject/attackableUnits/AI/Champion.js';
import { ChampionPreset } from './preset.js';

export default class TestGame {
  constructor() {
    this.objectManager = new ObjectManager(this);

    this.player = new Champion({
      game: this,
      position: createVector(100, 100),
      preset: ChampionPreset.leesin,
    });
    this.objectManager.addObject(this.player);
  }

  update() {
    this.objectManager.update();

    if (mouseIsPressed && mouseButton === RIGHT) {
      this.player.moveTo(createVector(mouseX, mouseY));
    }
  }

  draw() {
    background(35);
    this.objectManager.draw();
  }
}
