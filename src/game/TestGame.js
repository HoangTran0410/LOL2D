import PeerManager from '../managers/PeerManager.js';
import ObjectManager from './ObjectManager.js';
import Champion from './gameObject/attackableUnits/AI/Champion.js';
import { ChampionPreset } from './preset.js';

export default class TestGame {
  constructor() {
    this.peerManager = new PeerManager(this);
    this.objectManager = new ObjectManager(this);

    this.player = new Champion({
      game: this,
      position: createVector(100, 100),
      preset: ChampionPreset.leesin,
    });
    this.objectManager.addObject(this.player);
    this.peerManager.onConnected = id => {
      this.player.id = id;
    };

    setTimeout(() => {
      let id = prompt('Enter other player id');
      if (id) this.peerManager.connect(id);
    }, 3000);
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
