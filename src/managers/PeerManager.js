// https://status.peerjs.com/

export default class PeerManager {
  constructor(game) {
    this.game = game;
    this.peers = {};

    this.init();
  }

  onConnected(id) {}

  init() {
    this.peer = new Peer(null, {
      pingInterval: 1000,
      debug: 2, //0 Prints no logs. 1 Prints only errors. 2 Prints errors and warnings. 3 Prints all logs.
    });
    this.peer.on('open', id => {
      console.log('My peer ID is: ' + id);
      this.id = id;
      this.onConnected?.(id);
    });
    this.peer.on('connection', conn => {
      this.conn(conn);
    });
  }

  connect(peerId) {
    if (this.peers[peerId]) return;
    var conn = this.peer.connect(peerId);
    this.conn(conn);
  }

  disconnect(peerId) {
    if (!this.peers[peerId]) return;
    this.peers[peerId].close();
    delete this.peers[peerId];
  }

  conn(conn) {
    conn.on('error', err => {
      console.log('Connection error', err);
      delete this.peers[conn.peer];
    });
    conn.on('open', () => {
      console.log('Connected to: ' + conn.peer);
      this.peers[conn.peer] = conn;

      conn.on('data', data => {
        this.syncDataFromOther(conn, data);
      });

      conn.on('close', () => {
        delete this.peers[conn.peer];
      });

      conn.on('error', err => {
        console.log('Connection error', err);
        delete this.peers[conn.peer];
      });
    });
  }

  syncDataFromOther(conn, data) {
    // TODO: sync data
  }
}
