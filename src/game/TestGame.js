import ObjectManager from './ObjectManager.js';
import { SpellHotKeys } from './constants.js';
import Champion from './gameObject/attackableUnits/AI/Champion.js';
import Camera from './gameObject/map/Camera.js';
import InGameHUD from './hud/InGameHUD.js';
import { ChampionPreset } from './preset.js';

const fps = 60;
let accumulator = 0;

export default class TestGame {
  constructor() {
    this.camera = new Camera();
    this.inGameHUD = new InGameHUD(this);
    this.objectManager = new ObjectManager(this);

    this.player = new Champion({
      game: this,
      position: createVector(100, 100),
      preset: ChampionPreset.leesin,
    });
    this.objectManager.addObject(this.player);

    window.game = this;
    this.camera.target = this.player.position;
    this.clickedPoint = { x: 0, y: 0, size: 0 };
    this.worldMouse = createVector(0, 0);
  }

  fixedUpdate() {
    this.camera.update();
    this.worldMouse = this.camera.screenToWorld(mouseX, mouseY);

    this.objectManager.update();

    if (mouseIsPressed && mouseButton === RIGHT) {
      this.player.moveTo(this.worldMouse.x, this.worldMouse.y);

      this.clickedPoint = {
        x: this.worldMouse.x,
        y: this.worldMouse.y,
        size: 40,
      };
    }
    this.clickedPoint.size *= 0.9;

    if (keyIsPressed) {
      for (let i = 0; i < SpellHotKeys.length; i++) {
        if (keyIsDown(SpellHotKeys[i])) {
          this.player.spells[i].cast();
        }
      }
    }
  }

  update() {
    if (this.paused) return;

    accumulator += Math.min(deltaTime, 250);

    // always update at 60 fps, no matter the frame rate
    while (accumulator > 1000 / (fps + 1)) {
      this.fixedUpdate();
      accumulator -= 1000 / (fps - 1);
      if (accumulator < 1000 / (fps - 1) - 1000 / fps) accumulator = 0;
    }

    this.inGameHUD.update();
  }

  draw() {
    background(45);

    this.camera.makeDraw(() => {
      this.camera.drawGrid();
      if (this.clickedPoint.size > 0) {
        push();
        fill('green');
        ellipse(this.clickedPoint.x, this.clickedPoint.y, this.clickedPoint.size);
        pop();
      }

      this.objectManager.draw();
    });
  }

  addSpellObject(spellObject) {
    this.objectManager.addObject(spellObject);
  }
}
