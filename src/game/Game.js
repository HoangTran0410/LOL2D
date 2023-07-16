import ObjectManager from './ObjectManager.js';
import { SpellHotKeys } from './constants.js';
import Champion from './gameObject/attackableUnits/Champion.js';
import AIChampion from './gameObject/attackableUnits/AIChampion.js';
import Camera from './gameObject/map/Camera.js';
import FogOfWar from './gameObject/map/FogOfWar.js';
import TerrainMap from './gameObject/map/TerrainMap.js';
import InGameHUD from './hud/InGameHUD.js';
import { ChampionPreset, getPresetRandom } from './preset.js';

const fps = 60;
let accumulator = 0;

export default class TestGame {
  constructor() {
    this.camera = new Camera();
    this.inGameHUD = new InGameHUD(this);
    this.objectManager = new ObjectManager(this);
    this.terrainMap = new TerrainMap(this);
    this.fogOfWar = new FogOfWar(this);

    this.player = new Champion({
      game: this,
      position: this.randomSpawnPoint(),
      preset: getPresetRandom(),
    });
    this.objectManager.addObject(this.player);

    for (let i = 0; i < 5; i++) {
      this.objectManager.addObject(
        new AIChampion({
          game: this,
          position: this.randomSpawnPoint(),
          preset: getPresetRandom(),
        })
      );
    }

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

    background(50);

    this.camera.makeDraw(() => {
      this.terrainMap.draw();
      this.terrainMap.drawEdges();

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
    this.inGameHUD.destroy();
  }

  addObject(object) {
    this.objectManager.addObject(object);
  }

  addPlayer(player) {
    this.objectManager.addObject(player);
  }

  queryObjects({ type, teamId, getOnlyOne = false, customFilter = null }) {
    let result = [];
    // TODO: optimize + use exported method from ObjectManager
    for (let o of this.objectManager.objects) {
      if (teamId && o.teamId !== teamId) continue;
      if (type && !(o instanceof type)) continue;
      if (typeof customFilter === 'function' && !customFilter(o)) continue;
      if (getOnlyOne) return o;
      result.push(o);
    }
    return getOnlyOne ? null : result;
  }

  queryPlayersInRange({
    position,
    range, // radius
    teamId,
    excludePlayers = [],
    includePlayerSize = false,
    includeDead = false,
    getOnlyOne = false,
    customFilter = null,
  }) {
    let champions = this.objectManager.getAllChampions();

    let result = [];
    for (let p of champions) {
      if (teamId && o.teamId !== teamId) continue;
      if (!includeDead && p.isDead) continue;
      if (excludePlayers.includes(p)) continue;
      if (p.position.dist(position) > range + (includePlayerSize ? p.stats.size.value / 2 : 0))
        continue;
      if (typeof customFilter === 'function' && !customFilter(p)) continue;
      if (getOnlyOne) return p;
      result.push(p);
    }
    return getOnlyOne ? null : result;
  }

  get players() {
    return this.objectManager.getAllChampions();
  }

  get mapSize() {
    return this.terrainMap.size;
  }

  randomSpawnPoint() {
    let range = 2000;
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
