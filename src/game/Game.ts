import { SpellHotKeys } from './constants';
import Champion from './gameObject/attackableUnits/Champion';
import AIChampion from './gameObject/attackableUnits/AIChampion';
import Monster from './gameObject/attackableUnits/Monster';
import Camera from './gameObject/map/Camera';
import FogOfWar from './gameObject/map/FogOfWar';
import TerrainMap from './gameObject/map/TerrainMap';
import Fountain from './gameObject/structures/Fountain';
import Turret from './gameObject/structures/Turret';
import InGameHUD from './hud/InGameHUD';
import {
  FountainPreset,
  MonsterPreset,
  getChampionPresetRandom,
  getTurretPositions,
} from './preset';
import ObjectManager from './managers/ObjectManager';
import EventManager from '../managers/EventManager';

export default class Game {
  readonly mapSize = 6400;
  readonly fps = 60;

  camera!: Camera;
  objectManager!: ObjectManager;
  eventManager!: EventManager;
  terrainMap!: TerrainMap;
  fogOfWar!: FogOfWar;
  inGameHUD!: InGameHUD;
  player!: Champion;

  fountains: Fountain[] = [];
  turrets: Turret[] = [];
  monsters: Monster[] = [];

  clickedPoint = { x: 0, y: 0, size: 0 };
  worldMouse!: p5.Vector;
  paused = false;

  constructor() {
    this.worldMouse = createVector(0, 0);
    this.camera = new Camera();
    this.objectManager = new ObjectManager(this);
    this.eventManager = new EventManager();
    this.terrainMap = new TerrainMap(this, this.mapSize);
    this.fogOfWar = new FogOfWar(this);
    this.inGameHUD = new InGameHUD(this);

    // fountains first: randomSpawnPoint() is defined in terms of them, and both
    // the player and every AI champion are placed with it
    this.spawnFountains();

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

    // anything reading `isAllied` needs this.player, so these come after it
    this.spawnJungle();
    this.spawnTurrets();

    this.camera.target = this.player.position;
    this.camera.position = this.player.position.copy();
  }

  spawnFountains() {
    for (const preset of FountainPreset) {
      const fountain = new Fountain({ game: this, preset });
      this.fountains.push(fountain);
      this.objectManager.addObject(fountain);
    }
  }

  spawnJungle() {
    for (const key in MonsterPreset) {
      const monster = new Monster({ game: this, preset: MonsterPreset[key] });
      this.monsters.push(monster);
      this.objectManager.addObject(monster);
    }
  }

  spawnTurrets() {
    for (const { x, y } of getTurretPositions()) {
      const turret = new Turret({ game: this, position: createVector(x, y) });
      this.turrets.push(turret);
      this.objectManager.addObject(turret);
    }
  }

  pause() { this.paused = true; }
  unpause() { this.paused = false; }

  fixedUpdate() {
    this.camera.update();
    this.worldMouse = this.camera.screenToWorld(mouseX, mouseY);
    this.objectManager.update();
    this.terrainMap.update();

    if (mouseIsPressed && mouseButton === RIGHT) {
      this.player.moveTo(this.worldMouse.x, this.worldMouse.y);
      this.clickedPoint = { x: this.worldMouse.x, y: this.worldMouse.y, size: 40 };
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

    this.fogOfWar.draw();
  }

  destroy() {
    this.fogOfWar.destroy();
    this.inGameHUD.destroy();
  }

  /**
   * Spawn and respawn point (AttackableUnit.respawn() calls this too). Picking a
   * fountain rather than scattering everyone around the map centre is what makes
   * the platforms worth having: you come back on one and heal up before leaving.
   */
  randomSpawnPoint() {
    if (this.fountains.length > 0) {
      const fountain = this.fountains[Math.floor(random(this.fountains.length))];
      return fountain.randomPointInside();
    }

    return createVector(
      this.mapSize / 2 + random(-1000, 1000),
      this.mapSize / 2 + random(-1000, 1000)
    );
  }

  resize(w: number, h: number) { this.fogOfWar.resize(w, h); }

  keyPressed() {
    if (key === ' ') {
      this.camera.target = this.camera.target ? null! : this.player.position;
    }
  }
}
