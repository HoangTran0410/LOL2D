import ObjectManager from './ObjectManager.js';
import { SpellHotKeys } from './constants.js';
import Champion from './gameObject/attackableUnits/AI/Champion.js';
import Camera from './gameObject/map/Camera.js';
import InGameHUD from './hud/InGameHUD.js';
import { ChampionPreset, getPresetRandom } from './preset.js';

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
      preset: getPresetRandom(),
    });
    this.objectManager.addObject(this.player);

    for (let i = 0; i < 5; i++) {
      this.objectManager.addObject(
        new Champion({
          game: this,
          position: createVector(100 + i * 60, 100 + i * 30),
          preset: getPresetRandom(),
        })
      );
    }

    window.game = this;
    this.camera.target = this.player.position;
    this.clickedPoint = { x: 0, y: 0, size: 0 };
    this.worldMouse = createVector(0, 0);
  }

  pause() {
    this.paused = true;
  }
  unpause() {
    this.paused = false;
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
    if (this.paused) return;

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

      this.player.spells.forEach(spell => {
        if (spell.willDrawPreview) spell.drawPreview?.();
      });
    });
  }

  destroy() {
    this.inGameHUD.destroy();
  }

  addSpellObject(spellObject) {
    this.objectManager.addObject(spellObject);
  }

  addPlayer(player) {
    this.objectManager.addObject(player);
  }

  queryObjects({ type, getOnlyOne = false, customFilter = null }) {
    let result = [];
    for (let o of this.objectManager.objects) {
      if ((!type || (type && o instanceof type)) && (customFilter === null || customFilter(o))) {
        if (getOnlyOne) return o;
        result.push(o);
      }
    }
    return getOnlyOne ? null : result;
  }

  queryPlayersInRange({
    position,
    range, // radius
    excludePlayers = [],
    includePlayerSize = false,
    includeDead = false,
    getOnlyOne = false,
    customFilter = null,
  }) {
    let champions = this.objectManager.getAllChampions();

    let result = [];
    for (let p of champions) {
      if (
        (includeDead ? true : p.isDead === false) &&
        !excludePlayers.includes(p) &&
        p.position.dist(position) < range + (includePlayerSize ? p.stats.size.value / 2 : 0) &&
        (customFilter === null || customFilter(p))
      ) {
        if (getOnlyOne) return p;
        result.push(p);
      }
    }

    return getOnlyOne ? null : result;
  }
}
