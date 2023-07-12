let pmouseIsPressed = false;
let peer;
let connectedPeers = [];
let otherMouses = {};

function setup() {
  createCanvas(500, 500);

  textAlign(CENTER, CENTER);

  let id = prompt('Enter your id', 'peer id');
  peer = new Peer(id);
  peer.on('connection', function (conn) {
    connectedPeers.push(conn);
    conn.on('data', function (data) {
      if (data?.type === 'mouse') {
        otherMouses[conn.peer] = data;
      }
    });
  });
}

function draw() {
  background(0);

  fill(255);
  text('Your id: ' + peer.id, width / 2, height - 20);
  text('Connected peers: ' + connectedPeers.length, width / 2, height - 40);

  fill(0, 255, 0);
  ellipse(mouseX, mouseY, 20, 20);

  for (let key in otherMouses) {
    let mouse = otherMouses[key];
    fill(0, 0, 255);
    ellipse(mouse.x, mouse.y, 20, 20);
  }

  for (let conn of connectedPeers) {
    let data = { type: 'mouse', x: mouseX, y: mouseY };
    conn.send(data);
  }

  if (button('Connect peer', 0, 0, 100, 50)) {
    let peerid = prompt('Enter peer id', 'peer id');
    if (peerid) {
      var conn = peer.connect(peerid);
      // on open will be launch when you successfully connect to PeerServer
      conn.on('open', function () {
        connectedPeers.push(conn);
      });
      conn.on('data', function (data) {
        if (data?.type === 'mouse') {
          otherMouses[conn.peer] = data;
        }
      });
    }
  }

  pmouseIsPressed = mouseIsPressed;
}

function button(t, x, y, w, h) {
  let isHover = mouseX > x && mouseX < x + w && mouseY > y && mouseY < y + h;
  let isClick = !pmouseIsPressed && mouseIsPressed && isHover;

  push();
  fill(isHover ? 200 : 150);
  rect(x, y, w, h);
  fill(0);
  text(t, x + w / 2, y + h / 2);
  pop();

  return isClick;
}
