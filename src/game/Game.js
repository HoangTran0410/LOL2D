import Camera from './gameObject/map/Camera.js';
import Champion from './gameObject/attackableUnits/Champion.js';
import AIChampion from './gameObject/attackableUnits/AIChampion.js';
import { ChampionPreset, getRandomChampionPreset } from './preset.js';
import { SpellHotKeys } from './constants.js';
import TerrainMap from './gameObject/map/TerrainMap.js';
import FogOfWar from './gameObject/map/FogOfWar.js';
import InGameHUD from './hud/InGameHUD.js';
import DummyChampion from './gameObject/attackableUnits/DummyChampion.js';
import SpellObject from './gameObject/SpellObject.js';

const fps = 60;
let accumulator = 0;

export default class Game {
  constructor() {
    this.camera = new Camera();
    this.InGameHUD = new InGameHUD(this);
    this.terrainMap = new TerrainMap(this);
    this.fogOfWar = new FogOfWar(this);

    this.objects = [];
    this.players = [];
    this.clickedPoint = { x: 0, y: 0, size: 0 };
    this.accumulator = 0;
    this.worldMouse = createVector(0, 0);

    // init players
    for (let i = 0; i < 1; i++) {
      let preset = getRandomChampionPreset();
      let pos = this.getRandomSpawnLocation();
      // pos = createVector(3200 + random(-200, 200), 3200 + random(-200, 200));
      let champ = new AIChampion(this, pos.x, pos.y, preset);
      this.players.push(champ);
    }

    let preset = ChampionPreset.ahri; // getRandomChampionPreset();
    // let pos = this.getRandomSpawnLocation();
    let pos = createVector(3200, 3200);
    this.player = new Champion(this, pos.x, pos.y, preset);
    this.players.push(this.player);

    // dummy
    preset = getRandomChampionPreset();
    pos = createVector(3200, 3200);
    this.players.push(new DummyChampion(this, pos.x, pos.y, preset));

    preset = getRandomChampionPreset();
    pos = createVector(3400, 3200);
    this.players.push(new DummyChampion(this, pos.x, pos.y, preset));

    // camera follow player
    this.camera.target = this.player.position;
  }

  pause() {
    this.paused = true;
  }

  unpause() {
    this.paused = false;
  }

  destroy() {
    this.objects = [];
    this.players = [];
    this.InGameHUD.destroy();
  }

  fixedUpdate() {
    this.camera.update();
    this.worldMouse = this.camera.screenToWorld(mouseX, mouseY);

    // remove objects that are marked to be removed + call onBeforeRemove
    this.objects = this.objects.filter(o => {
      if (o.toRemove) {
        o.onBeforeRemove?.();
        return false;
      }
      return true;
    });

    for (let o of this.objects) o.update();
    for (let p of this.players) p.update();

    // update terrain map, check for collision
    this.terrainMap.update();

    // control player
    if (mouseIsPressed && mouseButton === RIGHT) {
      this.player.moveTo(this.worldMouse.x, this.worldMouse.y);

      this.clickedPoint = {
        x: this.worldMouse.x,
        y: this.worldMouse.y,
        size: 50,
      };
    }

    if (keyIsPressed) {
      // cast spell
      for (let i = 0; i < SpellHotKeys.length; i++) {
        if (keyIsDown(SpellHotKeys[i])) {
          this.player.spells[i].cast();
        }
      }

      // camera follow player
      // if (keyIsDown(32)) {
      //   this.camera.target.set(this.player.position.x, this.player.position.y);
      // }
    }

    this.clickedPoint.size *= 0.9;
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

    this.InGameHUD.update();
  }

  draw() {
    if (this.paused) return;
    background(45);

    this.camera.makeDraw(() => {
      // this.camera.drawGrid();
      this.terrainMap.draw();
      this.terrainMap.drawEdges();

      for (let o of this.objects) o.draw();
    });

    this.fogOfWar.draw(); // draw fog of war on top of everything, except players

    this.camera.makeDraw(() => {
      if (this.clickedPoint.size > 0) {
        push();
        fill('green');
        ellipse(this.clickedPoint.x, this.clickedPoint.y, this.clickedPoint.size);
        pop();
      }

      // for (let p of this.players) p.draw();
      // let playerToDraw = this.players;
      let playerToDraw = this.player.visiblePlayers ?? [];
      for (let p of playerToDraw) p.isDead && p.draw();
      for (let p of playerToDraw) !p.isDead && p.draw(); // alive players on top of dead players
    });
  }

  keyPressed() {
    // let spellIndex = SpellHotKeys.indexOf(keyCode);
    // if (spellIndex !== -1) {
    //   this.player.spells[spellIndex].cast();
    // }
  }

  resize(w, h) {
    this.fogOfWar.resize(w, h);
  }

  addSpellObject(spellObject) {
    if (!(spellObject instanceof SpellObject))
      throw new Error('spellObject must be an instance of SpellObject');
    this.objects.push(spellObject);
  }

  queryObjects({ type, getOnlyOne = false, customFilter = null }) {
    let result = [];
    for (let o of this.objects) {
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
    let result = [];
    for (let p of this.players) {
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
  getRandomSpawnLocation() {
    let mapSize = this.terrainMap.size;
    let x = mapSize / 2 + random(-mapSize / 3, mapSize / 3);
    let y = mapSize / 2 + random(-mapSize / 3, mapSize / 3);
    return createVector(x, y);
  }
}
