let editor = {
  camera: {
    x: 0,
    y: 0,
    scale: 1,
    xTo: 0,
    yTo: 0,
    scaleTo: 1,
  },

  points: [],
  draggingPoint: null,
};

function setup() {
  createCanvas(windowWidth, windowHeight);

  editor.camera = JSON.parse(localStorage.getItem('shape-maker-camera')) || editor.camera;
  editor.points = convertArrayToPoints(
    JSON.parse(localStorage.getItem('shape-maker-points')) || []
  );

  window.addEventListener('beforeunload', () => {
    localStorage.setItem('shape-maker-points', JSON.stringify(convertPointsToArray(editor.points)));
    localStorage.setItem('shape-maker-camera', JSON.stringify(editor.camera));
  });
}

function draw() {
  background(30);

  updateCamera(editor.camera);
  beginStateCamera(editor.camera);

  textSize(14 / editor.camera.scale);
  strokeWeight(1 / editor.camera.scale);
  drawGrid(editor.camera);

  // draw points
  stroke('#fff9');
  fill('#a00');

  beginShape();
  editor.points.forEach(point => {
    vertex(point.x, point.y);
    drawPoint(point);
  });
  endShape(CLOSE);

  // highlight nearest point
  if (editor.draggingPoint) {
    let p = editor.draggingPoint;
    drawPoint(p, 'yellow');
    text(`(${~~p.x}, ${~~p.y})`, p.x, p.y - 10 / editor.camera.scale);
  }

  let point = getPointNearMouse();
  if (point) {
    editor.draggingPoint = point;
  } else if (!mouseIsPressed) {
    editor.draggingPoint = null;
  }

  endStateCamera();

  help();
}

function keyPressed() {
  let mouse = canvasToWorld(createVector(mouseX, mouseY), editor.camera);

  if (key === 'a') {
    editor.points.push(createVector(~~mouse.x, ~~mouse.y));
  }

  if (key === 'd') {
    if (editor.draggingPoint) {
      editor.points.splice(editor.points.indexOf(editor.draggingPoint), 1);
    }
  }

  if (key === 'c') {
    editor.points = [];
  }

  if (key === 'e') {
    let arr = convertPointsToArray(editor.points);
    window.prompt('Copy this', JSON.stringify(arr));
  }

  if (key === 'i') {
    let points = JSON.parse(window.prompt('Paste points here:'));
    editor.points = convertArrayToPoints(points);
  }
}

function mousePressed() {
  if (mouseButton === LEFT) {
  }
}

function mouseDragged() {
  if (mouseButton === LEFT) {
    if (editor.draggingPoint) {
      let mouse = canvasToWorld(createVector(mouseX, mouseY), editor.camera);
      editor.draggingPoint.x = ~~mouse.x;
      editor.draggingPoint.y = ~~mouse.y;
    } else {
      editor.camera.xTo -= movedX / editor.camera.scale;
      editor.camera.yTo -= movedY / editor.camera.scale;
    }
  }
}

function mouseWheel(e) {
  editor.camera.scaleTo += (editor.camera.scaleTo / 5) * (e.delta > 0 ? -1 : 1);
  editor.camera.scaleTo = constrain(editor.camera.scaleTo, 0.01, 50);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight, true);
}

// ===================== Grid =====================

function drawGrid(cam) {
  let topleft = canvasToWorld(createVector(0, 0), cam);
  let bottomright = canvasToWorld(createVector(width, height), cam);

  let left = topleft.x;
  let top = topleft.y;
  let right = bottomright.x;
  let bottom = bottomright.y;

  // center line
  stroke('#fff9');
  line(0, top, 0, bottom);
  line(left, 0, right, 0);

  // calculate grid size
  let gridSize = 50;
  while (gridSize * cam.scale < 100) {
    gridSize *= 2;
  }
  while (gridSize * cam.scale > 200) {
    gridSize = gridSize / 2;
  }

  // draw grid
  stroke('#5559');
  fill('#9995');
  let i;

  for (i = 0; i > left; i -= gridSize) {
    line(i, top, i, bottom);
    text(i, i, 0);
  }

  for (i = 0; i < right; i += gridSize) {
    line(i, top, i, bottom);
    text(i, i, 0);
  }

  for (i = 0; i > top; i -= gridSize) {
    line(left, i, right, i);
    text(i, 0, i);
  }

  for (i = 0; i < bottom; i += gridSize) {
    line(left, i, right, i);
    text(i, 0, i);
  }
}

// ===================== Camera =====================
function updateCamera(cam) {
  cam.x = lerp(cam.x, cam.xTo, 0.2);
  cam.y = lerp(cam.y, cam.yTo, 0.2);
  cam.scale = lerp(cam.scale, cam.scaleTo, 0.2);
}
function canvasToWorld(pos, cam) {
  return createVector(
    (pos.x - width * 0.5) / cam.scale + cam.x,
    (pos.y - height * 0.5) / cam.scale + cam.y
  );
}
function beginStateCamera(cam) {
  push();
  translate(width * 0.5, height * 0.5);
  scale(cam.scale);
  translate(-cam.x, -cam.y);
}
function endStateCamera() {
  pop();
}

// ===================== Utils =====================
function getPointNearMouse(maxDistance = 20 / editor.camera.scale) {
  let mouse = canvasToWorld(createVector(mouseX, mouseY), editor.camera);
  let nearestPoint = null;
  let nearestDistance = Infinity;
  editor.points.forEach(point => {
    let distance = point.dist(mouse);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPoint = point;
    }
  });
  if (nearestDistance > maxDistance) {
    return null;
  }
  return nearestPoint;
}

function drawPoint(point, color = '#a00') {
  stroke('#fff9');
  fill(color);
  circle(point.x, point.y, 10 / editor.camera.scale);
}

function help() {
  // draw help at top left
  textSize(14);
  strokeWeight(1);
  fill('#fff9');
  text('a: add point', 10, 20);
  text('d: delete point', 10, 40);
  text('c: clear all points', 10, 60);
  text('e: export points', 10, 80);
  text('i: import points', 10, 100);
}
function convertPointsToArray(points = []) {
  return points.map(p => [p.x, p.y]);
}
function convertArrayToPoints(array = []) {
  return array?.map(p => createVector(p[0], p[1])) || [];
}
