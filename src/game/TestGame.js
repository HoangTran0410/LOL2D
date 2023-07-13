import AssetManager from '../managers/AssetManager.js';
import ObjectManager from './ObjectManager.js';
import AttackableUnit from './gameObject/attackableUnits/AttackableUnit.js';

export default class TestGame {
  constructor() {
    this.objectManager = new ObjectManager(this);

    let obj = new AttackableUnit({
      game: this,
      position: createVector(100, 100),
      avatar: AssetManager.getAsset('champ_yasuo').data,
    });
    obj.moveTo(600, 300);
    this.objectManager.addObject(obj);
  }

  update() {
    this.objectManager.update();
  }

  draw() {
    background(50);
    this.objectManager.draw();
  }
}
