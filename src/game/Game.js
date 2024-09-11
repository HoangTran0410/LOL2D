import { SpellHotKeys } from './constants.js';
import Champion from './gameObject/attackableUnits/Champion.js';
import AIChampion from './gameObject/attackableUnits/AIChampion.js';
import Camera from './gameObject/map/Camera.js';
import FogOfWar from './gameObject/map/FogOfWar.js';
import TerrainMap from './gameObject/map/TerrainMap.js';
import InGameHUD from './hud/InGameHUD.js';
import { MonsterPreset, getChampionPresetRandom } from './preset.js';
import Monster from './gameObject/attackableUnits/Monster.js';
import ObjectManager from './managers/ObjectManager.js';
import EventManager from '../managers/EventManager.js';

export default class Game {
  constructor() {
    this.mapSize = 6400;

    this.camera = new Camera();
    this.objectManager = new ObjectManager(this);
    this.eventManager = new EventManager();
    this.terrainMap = new TerrainMap(this, this.mapSize);
    this.fogOfWar = new FogOfWar(this);
    this.inGameHUD = new InGameHUD(this);

    this.fps = 60;

    this.player = new Champion({
      game: this,
      position: this.randomSpawnPoint(),
      preset: getChampionPresetRandom(),
    });
    this.objectManager.addObject(this.player);

    for (let i = 0; i < 5; i++) {
      this.objectManager.addObject(
        new AIChampion({
          game: this,
          position: this.randomSpawnPoint(),
          preset: getChampionPresetRandom(),
        })
      );
    }

    // for (let key in MonsterPreset) {
    //   this.objectManager.addObject(
    //     new Monster({
    //       game: this,
    //       preset: MonsterPreset[key],
    //     })
    //   );
    // }

    this.camera.target = this.player.position;
    this.camera.position = this.player.position.copy();

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

    // update terrain map, check for collision
    this.terrainMap.update();

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
    this.fixedUpdate();
  }

  draw() {
    if (this.paused) return;

    background(30);

    this.camera.makeDraw(() => {
      this.terrainMap.draw();
      // this.terrainMap.drawEdges();
      // this.camera.drawGrid();

      if (this.clickedPoint.size > 0) {
        push();
        noStroke();
        fill('green');
        ellipse(this.clickedPoint.x, this.clickedPoint.y, this.clickedPoint.size);
        pop();
      }

      this.player.spells.forEach(spell => {
        if (spell.willDrawPreview) spell.drawPreview?.();
      });

      this.objectManager.draw();
    });

    this.fogOfWar.draw(); // draw fog of war on top of everything
  }

  destroy() {
    this.fogOfWar.destroy();
    this.inGameHUD.destroy();
  }

  randomSpawnPoint() {
    let range = 1000;
    return createVector(
      this.mapSize / 2 + random(-range, range),
      this.mapSize / 2 + random(-range, range)
    );
  }

  resize(w, h) {
    this.fogOfWar.resize(w, h);
  }

  keyPressed() {
    if (key === ' ') {
      if (this.camera.target) this.camera.target = null; // stop following player
      else this.camera.target = this.player.position;
    }
  }
}
