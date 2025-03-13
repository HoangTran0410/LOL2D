// https://status.peerjs.com/

export default class PeerManager {
  constructor(game) {
    this.game = game || null;
    this.peers = {};
    this.remotePlayers = {};
    this.isHost = false;
    this.isConnected = false;
    this.connectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'error'
    this.connectionError = null;

    this.init();
  }

  onConnected(id) {}
  onPlayerJoined(peerId) {}
  onPlayerLeft(peerId) {}
  onGameStateUpdate(data) {}
  onConnectionStatusChanged(status, error) {}

  init() {
    this.connectionStatus = 'connecting';
    this.onConnectionStatusChanged?.(this.connectionStatus);

    try {
      this.peer = new Peer(null, {
        pingInterval: 1000,
        debug: 1, // 0 Prints no logs. 1 Prints only errors. 2 Prints errors and warnings. 3 Prints all logs.
      });

      this.peer.on('open', id => {
        console.log('My peer ID is: ' + id);
        this.id = id;
        this.isConnected = true;
        this.connectionStatus = 'connected';
        this.onConnectionStatusChanged?.(this.connectionStatus);
        this.onConnected?.(id);
      });

      this.peer.on('connection', conn => {
        this.conn(conn);
      });

      this.peer.on('error', err => {
        console.error('PeerJS error:', err);
        this.connectionError = err.message || 'Unknown error';
        this.connectionStatus = 'error';
        this.onConnectionStatusChanged?.(this.connectionStatus, this.connectionError);
      });

      this.peer.on('disconnected', () => {
        console.log('PeerJS disconnected');
        this.isConnected = false;
        this.connectionStatus = 'disconnected';
        this.onConnectionStatusChanged?.(this.connectionStatus);

        // Try to reconnect
        setTimeout(() => {
          if (this.peer && this.connectionStatus === 'disconnected') {
            console.log('Attempting to reconnect...');
            this.connectionStatus = 'connecting';
            this.onConnectionStatusChanged?.(this.connectionStatus);
            this.peer.reconnect();
          }
        }, 3000);
      });
    } catch (error) {
      console.error('Error initializing PeerJS:', error);
      this.connectionError = error.message || 'Failed to initialize connection';
      this.connectionStatus = 'error';
      this.onConnectionStatusChanged?.(this.connectionStatus, this.connectionError);
    }
  }

  createRoom() {
    this.isHost = true;
    return this.id;
  }

  joinRoom(peerId) {
    if (this.peers[peerId]) return false;
    if (!this.isConnected) return false;

    try {
      this.isHost = false;
      var conn = this.peer.connect(peerId);
      this.conn(conn);
      return true;
    } catch (error) {
      console.error('Error joining room:', error);
      this.connectionError = error.message || 'Failed to join room';
      this.connectionStatus = 'error';
      this.onConnectionStatusChanged?.(this.connectionStatus, this.connectionError);
      return false;
    }
  }

  disconnect(peerId) {
    if (!this.peers[peerId]) return;
    this.peers[peerId].close();
    delete this.peers[peerId];
    delete this.remotePlayers[peerId];
    this.onPlayerLeft?.(peerId);
  }

  disconnectAll() {
    for (let peerId in this.peers) {
      this.disconnect(peerId);
    }
  }

  conn(conn) {
    conn.on('error', err => {
      console.log('Connection error', err);
      delete this.peers[conn.peer];
      delete this.remotePlayers[conn.peer];
      this.onPlayerLeft?.(conn.peer);
    });

    conn.on('open', () => {
      console.log('Connected to: ' + conn.peer);
      this.peers[conn.peer] = conn;
      this.onPlayerJoined?.(conn.peer);

      // Initial sync
      this.syncPlayerData(conn);

      conn.on('data', data => {
        this.handleIncomingData(conn.peer, data);
      });

      conn.on('close', () => {
        delete this.peers[conn.peer];
        delete this.remotePlayers[conn.peer];
        this.onPlayerLeft?.(conn.peer);
      });
    });
  }

  syncPlayerData(conn) {
    if (!this.game || !this.game.player) return;

    try {
      const playerData = {
        type: 'player_init',
        id: this.id,
        position: {
          x: this.game.player.position.x,
          y: this.game.player.position.y,
        },
        preset: this.serializePreset(this.game.player.preset),
      };

      conn.send(playerData);
    } catch (error) {
      console.error('Error in syncPlayerData:', error);
    }
  }

  serializePreset(preset) {
    if (!preset) return null;

    try {
      // Create a simplified version of the preset without functions
      return {
        name: preset.name || 'Unknown',
        avatar: preset.avatar || '',
        // Don't include spells as they contain functions
        // Instead, we'll recreate them on the receiving end
        spellNames: Array.isArray(preset.spells)
          ? preset.spells.map(spell =>
              typeof spell === 'function' ? spell.name : spell?.name || 'Unknown'
            )
          : [],
      };
    } catch (error) {
      console.error('Error in serializePreset:', error);
      return {
        name: 'Unknown',
        avatar: '',
        spellNames: [],
      };
    }
  }

  broadcastPlayerUpdate() {
    if (!this.game || !this.game.player) return;

    try {
      const playerUpdate = {
        type: 'player_update',
        id: this.id,
        timestamp: Date.now(),
        position: {
          x: this.game.player.position.x,
          y: this.game.player.position.y,
        },
        health: this.game.player.stats.health.value,
        mana: this.game.player.stats.mana.value,
        score: this.game.player.score,
        spellsCasting: this.game.player.spells.map(spell => ({
          isCasting: spell.isCasting || false,
          castingProgress: spell.castingProgress || 0,
        })),
      };

      // Only broadcast if we have peers
      if (Object.keys(this.peers).length > 0) {
        this.broadcast(playerUpdate);
      }
    } catch (error) {
      console.error('Error in broadcastPlayerUpdate:', error);
    }
  }

  broadcast(data) {
    for (let peerId in this.peers) {
      this.peers[peerId].send(data);
    }
  }

  handleIncomingData(peerId, data) {
    try {
      if (!data || !data.type) {
        console.warn('Received invalid data from peer:', peerId, data);
        return;
      }

      switch (data.type) {
        case 'player_init':
          console.log(`Received player_init from ${peerId}:`, data);
          if (data.player) {
            this.remotePlayers[peerId] = {
              id: peerId,
              position: data.player.position,
              preset: data.player.preset,
              health: data.player.health,
              maxHealth: data.player.maxHealth,
              mana: data.player.mana,
              maxMana: data.player.maxMana,
              score: data.player.score,
            };
          }
          break;

        case 'player_update':
          // Update remote player data
          if (!this.remotePlayers[peerId]) {
            this.remotePlayers[peerId] = {
              id: peerId,
              position: data.position || { x: 0, y: 0 },
              health: data.health,
              maxHealth: data.maxHealth,
              mana: data.mana,
              maxMana: data.maxMana,
              score: data.score,
              spellsCasting: data.spellsCasting || [],
            };
          } else {
            if (data.position) {
              this.remotePlayers[peerId].position = data.position;
            }
            if (data.health !== undefined) {
              this.remotePlayers[peerId].health = data.health;
            }
            if (data.maxHealth !== undefined) {
              this.remotePlayers[peerId].maxHealth = data.maxHealth;
            }
            if (data.mana !== undefined) {
              this.remotePlayers[peerId].mana = data.mana;
            }
            if (data.maxMana !== undefined) {
              this.remotePlayers[peerId].maxMana = data.maxMana;
            }
            if (data.score !== undefined) {
              this.remotePlayers[peerId].score = data.score;
            }
            if (data.spellsCasting) {
              this.remotePlayers[peerId].spellsCasting = data.spellsCasting;
            }
          }

          // Call the game's handlePlayerUpdate method if available
          if (this.onPlayerUpdate) {
            this.onPlayerUpdate({
              id: peerId,
              ...data,
            });
          }
          break;

        case 'game_state':
          console.log(`Received game_state from ${peerId}`);
          if (this.onGameStateUpdate) {
            this.onGameStateUpdate(data);
          }
          break;

        default:
          console.warn(`Unknown data type received from ${peerId}:`, data.type);
      }
    } catch (error) {
      console.error(`Error handling data from ${peerId}:`, error);
    }
  }
}
