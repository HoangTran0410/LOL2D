import Camera from './gameObject/Camera.js';
import Champion from './gameObject/attackableUnits/Champion.js';
import AIChampion from './gameObject/attackableUnits/AIChampion.js';
import Obstacle from './gameObject/Obstacle.js';
import { Quadtree, Rectangle } from '../../libs/quadtree.js';
import { SpellHotKeys } from './constants.js';
import InGameHUD from './hud/InGameHUD.js';
import { hasFlag } from '../utils/index.js';
import StatusFlags from './enums/StatusFlags.js';
import * as AllSpells from './gameObject/spells/index.js';
import AssetManager from '../managers/AssetManager.js';
import TerrainType from './enums/TerrainType.js';

const fps = 60;
let accumulator = 0;

const ChampionPreset = {
  yasuo: {
    avatar: 'champ_yasuo',
    spells: [
      AllSpells.Heal,
      AllSpells.Yasuo_Q,
      AllSpells.Yasuo_W,
      AllSpells.Yasuo_E,
      AllSpells.Yasuo_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  lux: {
    avatar: 'champ_lux',
    spells: [
      AllSpells.Heal,
      AllSpells.Lux_Q,
      AllSpells.Yasuo_W,
      AllSpells.Lux_E,
      AllSpells.Lux_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  blitzcrank: {
    avatar: 'champ_blitzcrank',
    spells: [
      AllSpells.Heal,
      AllSpells.Blitzcrank_Q,
      AllSpells.Blitzcrank_W,
      AllSpells.Yasuo_E,
      AllSpells.Blitzcrank_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  ashe: {
    avatar: 'champ_ashe',
    spells: [
      AllSpells.Heal,
      AllSpells.Ashe_W,
      AllSpells.Ashe_W,
      AllSpells.Yasuo_W,
      AllSpells.Ashe_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  teemo: {
    avatar: 'champ_teemo',
    spells: [
      AllSpells.Heal,
      AllSpells.Blitzcrank_Q,
      AllSpells.Yasuo_W,
      AllSpells.Teemo_R,
      AllSpells.Teemo_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  leblanc: {
    avatar: 'champ_leblanc',
    spells: [
      AllSpells.Heal,
      AllSpells.Blitzcrank_Q,
      AllSpells.Leblanc_W,
      AllSpells.Leblanc_E,
      AllSpells.Leblanc_W,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
};

export default class Game {
  constructor() {
    this.InGameHUD = new InGameHUD(this);

    this.MAPSIZE = 6400;
    // this.collideCheckObstacles = [];
    this.kills = [];
    this.objects = [];
    this.players = [];
    for (let i = 0; i < 9; i++) {
      let pos = this.getRandomSpawnLocation();
      let champ = new AIChampion(this, pos.x, pos.y);
      champ.isAllied = false;
      this.players.push(champ);
    }

    let preset = ChampionPreset[random(Object.keys(ChampionPreset))];
    let pos = this.getRandomSpawnLocation();
    this.player = new Champion(this, pos.x, pos.y);
    this.player.isAllied = true;
    this.player.avatar = AssetManager.getAsset(preset.avatar);
    this.player.spells = preset.spells.map(Spell => new Spell(this.player));
    this.players.push(this.player);

    this.camera = new Camera();
    this.camera.target = this.player.position;

    // quadtree obstacle
    this.quadtree = new Quadtree({
      x: 0,
      y: 0,
      width: this.MAPSIZE,
      height: this.MAPSIZE,
      maxObjects: 10, // optional, default: 10
      maxLevels: 6, // optional, default:  4
    });

    this.obstacles = [];
    let polygons = [];
    const terrains = AssetManager.getAsset('json_summoner_map')?.data;
    for (let terrainType in terrains) {
      polygons.push(
        ...terrains[terrainType].map(_ => ({
          vertices: _,
          type:
            terrainType === 'wall'
              ? TerrainType.WALL
              : terrainType === 'bush'
              ? TerrainType.BUSH
              : TerrainType.WATER,
        }))
      );
    }
    console.log(polygons);

    for (let i = 0; i < polygons.length; i++) {
      let o = new Obstacle(0, 0, Obstacle.arrayToVertices(polygons[i].vertices), polygons[i].type);
      this.obstacles.push(o);

      const rectangle = new Rectangle({
        ...o.getBoundingBox(),
        data: o,
      });
      this.quadtree.insert(rectangle);
    }

    this.clickedPoint = {
      x: 0,
      y: 0,
      size: 0,
    };
    this.accumulator = 0;
  }

  pause() {
    this.paused = true;
  }

  unpause() {
    this.paused = false;
  }

  destroy() {
    this.objects = [];
    this.objects = [];
    this.players = [];
    this.obstacles = [];
    this.quadtree.clear();
    this.InGameHUD.destroy();
  }

  fixedUpdate() {
    this.camera.update();

    this.objects = this.objects.filter(o => {
      if (o.toRemove) {
        o.onBeforeRemove?.();
        return false;
      }
      return true;
    });
    for (let o of this.objects) o.update();

    for (let p of this.players) p.update();

    // collision with obstacles
    this.collideCheckObstacles = [];
    for (let p of this.players) {
      let area = new Rectangle({
        x: p.position.x,
        y: p.position.y,
        width: p.stats.size.value / 2,
        height: p.stats.size.value / 2,
      });
      let obstacles = this.quadtree.retrieve(area).map(o => o.data);
      // this.collideCheckObstacles.push(...obstacles);

      let walls = obstacles.filter(o => o.type === TerrainType.WALL);
      let bushes = obstacles.filter(o => o.type === TerrainType.BUSH);

      // Collide with bushes
      let isInBush = false;
      for (let b of bushes) {
        let response = new SAT.Response();
        let collided = SAT.testPolygonCircle(b.toSATPolygon(), p.toSATCircle(), response);
        if (collided) {
          isInBush = true;
          break;
        }
      }
      p.isInBush = isInBush;

      // Collide with walls
      if (hasFlag(p.status, StatusFlags.Ghosted)) continue;
      for (let o of walls) {
        let response = new SAT.Response();
        let collided = SAT.testPolygonCircle(o.toSATPolygon(), p.toSATCircle(), response);
        if (collided) {
          // let a = 0.01;
          // o.vertices = o.vertices.map(v => v.rotate(a));

          let overlap = createVector(response.overlapV.x, response.overlapV.y);
          p.position.add(overlap);

          if (p != this.player) {
            p.moveToRandomLocation();
          }
        }
      }
    }

    // collision map edges
    for (let p of this.players) {
      let size = p.stats.size.value / 2;
      if (p.position.x < size) p.position.x = size;
      if (p.position.x > this.MAPSIZE - size) p.position.x = this.MAPSIZE - size;
      if (p.position.y < size) p.position.y = size;
      if (p.position.y > this.MAPSIZE - size) p.position.y = this.MAPSIZE - size;

      if (p != this.player) {
        if (
          p.position.x < size ||
          p.position.x > this.MAPSIZE - size ||
          p.position.y < size ||
          p.position.y > this.MAPSIZE - size
        ) {
          p.moveToRandomLocation();
        }
      }
    }

    // control player
    if (mouseIsPressed && mouseButton === RIGHT) {
      let worldMouse = this.camera.screenToWorld(mouseX, mouseY);
      this.player.moveTo(worldMouse.x, worldMouse.y);

      this.clickedPoint = {
        x: worldMouse.x,
        y: worldMouse.y,
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
    // this.quadtree.clear();
    // for (let o of this.obstacles) {
    //   const rectangle = new Rectangle({
    //     ...o.getBoundingBox(),
    //     data: o,
    //   });
    //   this.quadtree.insert(rectangle);
    // }

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
    background(20);

    this.camera.push();
    this.camera.drawGrid();

    let obstacles = this.quadtree
      .retrieve(new Rectangle(this.camera.getViewBounds()))
      .map(o => o.data);

    let waters = obstacles.filter(o => o.type === TerrainType.WATER);
    let walls = obstacles.filter(o => o.type === TerrainType.WALL);
    let bushes = obstacles.filter(o => o.type === TerrainType.BUSH);

    for (let w of waters) w.draw();
    for (let b of bushes) b.draw();
    for (let w of walls) w.draw();

    // debug SAT collision check
    // push();
    // fill('#e55');
    // stroke('#e55');
    // for (let o of this.collideCheckObstacles) {
    //   beginShape();
    //   for (let v of o.vertices) vertex(v.x, v.y);
    //   endShape(CLOSE);
    // }
    // pop();

    // draw clicked point
    if (this.clickedPoint.size > 0) {
      push();
      fill('green');
      ellipse(this.clickedPoint.x, this.clickedPoint.y, this.clickedPoint.size);
      pop();
    }

    for (let o of this.objects) o.draw();
    for (let p of this.players) p.draw();

    // draw edges
    stroke('white');
    strokeWeight(3);
    line(0, 0, this.MAPSIZE, 0);
    line(this.MAPSIZE, 0, this.MAPSIZE, this.MAPSIZE);
    line(this.MAPSIZE, this.MAPSIZE, 0, this.MAPSIZE);
    line(0, this.MAPSIZE, 0, 0);

    this.camera.pop();

    // draw mouse
    // push();
    // strokeWeight(10);
    // stroke(150);
    // line(mouseX, mouseY, pmouseX, pmouseY);
    // pop();
  }

  keyPressed() {
    // let spellIndex = SpellHotKeys.indexOf(keyCode);
    // if (spellIndex !== -1) {
    //   this.player.spells[spellIndex].cast();
    // }
  }

  addKill(killer, victim) {
    this.kills.push({
      killer,
      victim,
    });
  }

  queryObjectsInRange({ position, range }) {
    return this.objects.filter(o => o.position.dist(position) < range / 2);
  }

  queryPlayerInRange({
    position,
    range,
    excludePlayers = [],
    includePlayerSize = false,
    includeDead = false,
  }) {
    return this.players.filter(
      p =>
        !excludePlayers.includes(p) &&
        (includeDead ? true : p.isDead === false) &&
        p.position.dist(position) < range / 2 + (includePlayerSize ? p.stats.size.value / 2 : 0)
    );
  }

  getRandomSpawnLocation() {
    let x = this.MAPSIZE / 2 + random(-this.MAPSIZE / 3, this.MAPSIZE / 3);
    let y = this.MAPSIZE / 2 + random(-this.MAPSIZE / 3, this.MAPSIZE / 3);
    return createVector(x, y);
  }
}
