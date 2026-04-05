// https://status.peerjs.com/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// @ts-ignore - PeerJS loaded via CDN
type Peer = any;

interface PeerConnection {
  on(event: string, handler: (...args: any[]) => void): void;
  send(data: any): void;
  close(): void;
  peer: string;
}

export default class PeerManager {
  game: any;
  peers: Record<string, PeerConnection> = {};
  peer!: Peer;
  id?: string;

  constructor(game: any) {
    this.game = game;
    this.init();
  }

  onConnected(id: string): void {}

  init(): void {
    // @ts-ignore - PeerJS loaded via CDN
    this.peer = new Peer(null, {
      pingInterval: 1000,
      debug: 2, // 0 Prints no logs. 1 Prints only errors. 2 Prints errors and warnings. 3 Prints all logs.
    });
    this.peer.on('open', (id: string) => {
      console.log('My peer ID is: ' + id);
      this.id = id;
      this.onConnected?.(id);
    });
    this.peer.on('connection', (conn: PeerConnection) => {
      this.conn(conn);
    });
  }

  connect(peerId: string): void {
    if (this.peers[peerId]) return;
    const conn = this.peer.connect(peerId);
    this.conn(conn);
  }

  disconnect(peerId: string): void {
    if (!this.peers[peerId]) return;
    this.peers[peerId].close();
    delete this.peers[peerId];
  }

  conn(conn: PeerConnection): void {
    conn.on('error', (err: any) => {
      console.log('Connection error', err);
      delete this.peers[conn.peer];
    });
    conn.on('open', () => {
      console.log('Connected to: ' + conn.peer);
      this.peers[conn.peer] = conn;

      this.syncData(conn);

      conn.on('data', (data: any) => {
        this.syncDataFromOther(conn, data);
      });

      conn.on('close', () => {
        delete this.peers[conn.peer];
      });

      conn.on('error', (err: any) => {
        console.log('Connection error', err);
        delete this.peers[conn.peer];
      });
    });
  }

  syncData(conn: PeerConnection): void {
    conn.send({
      data: {
        a: 1,
      }, // this.game.objectManager.getObjects(),
    });
  }

  syncDataFromOther(conn: PeerConnection, data: any): void {
    // TODO: sync data
    console.log(data);
  }
}
