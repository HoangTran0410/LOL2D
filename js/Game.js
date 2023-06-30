import Camera from './gameObject/Camera.js';
import Champion from './gameObject/attackableUnits/Champion.js';
import Obstacle from './gameObject/Obstacle.js';
import { Quadtree, Rectangle } from './lib/quadtree.js';
import { SpellHotKeys } from './constants.js';
import InGameHUD from './hud/InGameHUD.js';
import { hasFlag } from './utils/index.js';
import StatusFlags from './enums/StatusFlags.js';
import * as AllSpells from './gameObject/spells/index.js';
import ASSETS from '../assets/index.js';

const fps = 60;
let accumulator = 0;

const MAPSIZE = 5000;

const ChampionPreset = {
  yasuo: {
    avatar: 'yasuo',
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
    avatar: 'lux',
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
    avatar: 'blitzcrank',
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
    avatar: 'ashe',
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
    avatar: 'teemo',
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
};

export default class Game {
  constructor() {
    this.InGameHUD = new InGameHUD(this);

    this.kills = [];
    this.objects = [];
    this.players = [];
    for (let i = 0; i < 6; i++) {
      let champ = new Champion(
        this,
        MAPSIZE / 2 + random(-width, width),
        MAPSIZE / 2 + random(-height, -height)
      );
      champ.isAllied = false;
      this.players.push(champ);
    }

    this.player = new Champion(
      this,
      MAPSIZE / 2 + random(-width, width),
      MAPSIZE / 2 + random(-height, -height)
    );
    let preset = ChampionPreset[random(Object.keys(ChampionPreset))];
    this.player.isAllied = true;
    this.player.avatar = ASSETS.Champions[preset.avatar];
    this.player.spells = preset.spells.map(Spell => new Spell(this.player));
    this.players.push(this.player);

    this.camera = new Camera();
    this.camera.target = this.player.position;

    // quadtree obstacle
    this.quadtree = new Quadtree({
      x: 0,
      y: 0,
      width: MAPSIZE,
      height: MAPSIZE,
      maxObjects: 10, // optional, default: 10
      maxLevels: 6, // optional, default:  4
    });

    this.obstacles = [];
    for (let i = 0; i < 100; i++) {
      let o = new Obstacle(
        random(MAPSIZE),
        random(MAPSIZE)
        // Obstacle.rectVertices(random(100, 200), random(100, 200), random(TWO_PI))
        // Obstacle.circleVertices(random(50, 100), random(10, 20))
        // Obstacle.polygonVertices(random(3, 10), random(70, 100), random(70, 100))
      );

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

  fixedUpdate() {
    this.camera.update();

    this.objects.map(o => o.toRemove && o.onBeforeRemove?.());
    this.objects = this.objects.filter(o => !o.toRemove);
    for (let o of this.objects) o.update();

    for (let p of this.players) p.update();

    // collision with obstacles
    for (let p of this.players) {
      let area = new Rectangle({
        x: p.position.x,
        y: p.position.y,
        width: p.stats.size.value / 2,
        height: p.stats.size.value / 2,
      });
      let obstacles = this.quadtree.retrieve(area).map(o => o.data);

      if (hasFlag(p.status, StatusFlags.Ghosted)) continue;
      for (let o of obstacles) {
        let response = new SAT.Response();
        let collided = SAT.testPolygonCircle(o.toSATPolygon(), p.toSATCircle(), response);
        if (collided) {
          // let a = 0.01;
          // o.vertices = o.vertices.map(v => v.rotate(a));

          let overlap = createVector(response.overlapV.x, response.overlapV.y);
          p.position.add(overlap);

          if (p != this.player) {
            let x = random(-3000, 3000);
            let y = random(-3000, 3000);
            p.moveTo(x, y);
          }
        }
      }
    }

    // collision map edges
    for (let p of this.players) {
      let size = p.stats.size.value / 2;
      if (p.position.x < size) p.position.x = size;
      if (p.position.x > MAPSIZE - size) p.position.x = MAPSIZE - size;
      if (p.position.y < size) p.position.y = size;
      if (p.position.y > MAPSIZE - size) p.position.y = MAPSIZE - size;

      if (p != this.player) {
        if (
          p.position.x < size ||
          p.position.x > MAPSIZE - size ||
          p.position.y < size ||
          p.position.y > MAPSIZE - size
        ) {
          let x = random(MAPSIZE);
          let y = random(MAPSIZE);
          p.moveTo(x, y);
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
        size: 40,
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

    // fake ai
    for (let p of this.players) {
      if (p !== this.player) {
        let distToDest = p.position.dist(p.destination);
        if (distToDest < 10) {
          let x = random(MAPSIZE);
          let y = random(MAPSIZE);
          p.moveTo(x, y);
        }

        // random spell cast
        if (random() < 0.1) {
          let spellIndex = floor(random(p.spells.length));
          p.spells[spellIndex].cast();
        }
      }
    }
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

    for (let o of obstacles) {
      o.draw();
    }

    // draw clicked point
    if (this.clickedPoint.size > 0) {
      push();
      fill('green');
      ellipse(this.clickedPoint.x, this.clickedPoint.y, this.clickedPoint.size);
      pop();
    }

    for (let o of this.objects) {
      o.draw();
    }

    for (let p of this.players) {
      p.draw();
    }

    // draw edges
    stroke('white');
    strokeWeight(3);
    line(0, 0, MAPSIZE, 0);
    line(MAPSIZE, 0, MAPSIZE, MAPSIZE);
    line(MAPSIZE, MAPSIZE, 0, MAPSIZE);
    line(0, MAPSIZE, 0, 0);

    this.camera.pop();
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

  queryPlayerInRange({ position, range, includePlayerSize = false, includeDead = false }) {
    return this.players.filter(
      p =>
        p !== this.player &&
        (includeDead ? true : p.isDead === false) &&
        p.position.dist(position) < range / 2 + (includePlayerSize ? p.stats.size.value / 2 : 0)
    );
  }
}
