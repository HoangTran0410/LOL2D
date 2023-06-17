import Stats from 'https://cdnjs.cloudflare.com/ajax/libs/stats.js/r17/Stats.min.js';
import Game from './Game.js';
import Champion from './gameObject/Champion.js';
import Obstacle from './gameObject/Obstacle.js';
import Buff from './gameObject/Buff.js';
import Blitzcrank_W from './gameObject/buffs/Blitzcrank_W.js';

let game, stats;
let mapData;

export function preload() {
  Champion.avatars = [
    loadImage('assets/blitzcrank.png'),
    loadImage('assets/lux.png'),
    loadImage('assets/jinx.png'),
    loadImage('assets/yasuo.png'),
  ];

  mapData = loadJSON('assets/map.json');
}

export function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.elt.oncontextmenu = () => false;

  rectMode(CORNER);
  imageMode(CORNER);
  frameRate(60);

  Obstacle.Predefined = mapData.wall
    .filter(arr => arr.length > 3)
    .map(arr => {
      // calculate center of polygon
      let x = 0,
        y = 0;
      for (let [_x, _y] of arr) {
        x += _x;
        y += _y;
      }
      x /= arr.length;
      y /= arr.length;

      // then normalize all vertices to center
      return arr.map(v => [v[0] - x, v[1] - y]);
    });

  game = new Game();

  stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.body.appendChild(stats.dom);
}

export function draw() {
  stats.begin();

  game.update();
  game.draw();

  stats.end();
}

export function keyPressed() {
  if (keyCode === 81) {
    let buff = new Buff(game, Blitzcrank_W, 3000, game.player, game.player);
    game.player.addBuff(buff);
  }
}

export function mouseWheel(event) {
  // game.camera.zoomBy(game.camera.currentZoom * 0.1 * (event.delta > 0 ? -1 : 1));
}

export function windowResized() {
  resizeCanvas(windowWidth, windowHeight, true);
}
