import Game from './Game.js';
import RemoteChampion from '../game/gameObject/attackableUnits/RemoteChampion.js';
import { getChampionPresetRandom } from './preset.js';
import { SpellHotKeys } from './constants.js';
import PeerManager from '../managers/PeerManager.js';

export default class MultiplayerGame extends Game {
  constructor(options = {}) {
    super(options);

    console.log('MultiplayerGame constructor called');

    // Set up peer manager
    this.peerManager = options.peerManager || new PeerManager();
    this.peerManager.onGameStateUpdate = this.handleGameStateUpdate.bind(this);
    this.peerManager.onPlayerUpdate = this.handlePlayerUpdate.bind(this);

    // Set up player
    this.player = options.player;
    console.log('Player exists:', !!this.player);

    // Set up game state
    this.paused = true;
    console.log('Game paused:', this.paused);

    // Remove all AI champions
    this.removeAllAIChampions();

    // Set up sync interval
    this.setupSyncInterval();

    // Initialize game state
    this.clickedPoint = { x: 0, y: 0, size: 0 };

    console.log('MultiplayerGame initialized with player:', this.player ? 'yes' : 'no');
    console.log('Game paused state:', this.paused);
  }

  update() {
    // Make sure the game is not paused
    if (this.paused) {
      console.log('Game is paused, skipping update');
      return;
    }

    // Call the parent update method
    super.update();
  }

  draw() {
    try {
      // Make sure the game is not paused
      if (this.paused) {
        console.log('Game is paused, skipping draw');
        return;
      }

      background(30);

      this.camera.makeDraw(() => {
        this.terrainMap.draw();

        if (this.clickedPoint && this.clickedPoint.size > 0) {
          push();
          noStroke();
          fill('green');
          ellipse(this.clickedPoint.x, this.clickedPoint.y, this.clickedPoint.size);
          pop();
        }

        if (this.player && this.player.spells) {
          this.player.spells.forEach(spell => {
            if (spell && spell.willDrawPreview) spell.drawPreview?.();
          });
        }

        this.objectManager.draw();
      });

      this.fogOfWar.draw(); // draw fog of war on top of everything
    } catch (error) {
      console.error('Error in MultiplayerGame.draw:', error);
    }
  }

  setupPeerEvents() {
    // Handle player joined event
    this.peerManager.onPlayerJoined = peerId => {
      console.log(`Player joined: ${peerId}`);
      this.syncGameState(peerId);
    };

    // Handle player left event
    this.peerManager.onPlayerLeft = peerId => {
      console.log(`Player left: ${peerId}`);
      this.removeRemotePlayer(peerId);
    };

    // Handle game state update
    this.peerManager.onGameStateUpdate = data => {
      this.handleGameStateUpdate(data);
    };
  }

  setupSyncInterval() {
    // Broadcast player updates at regular intervals
    this.syncInterval = setInterval(() => {
      if (this.player) {
        this.peerManager.broadcastPlayerUpdate();
      }
    }, 33); // 30 updates per second for smoother gameplay
  }

  syncGameState(peerId) {
    // If we're the host, send the game state to the new player
    if (this.peerManager.isHost) {
      try {
        const gameState = {
          type: 'game_state',
          mapSize: this.mapSize,
          players: {},
          timestamp: Date.now(),
        };

        // Add all players to the game state
        this.objectManager.objects.forEach(obj => {
          if (obj instanceof Champion && !(obj instanceof RemoteChampion)) {
            gameState.players[obj.id] = {
              id: obj.id,
              position: { x: obj.position.x, y: obj.position.y },
              preset: this.peerManager.serializePreset(obj.preset),
              health: obj.stats?.health?.value,
              maxHealth: obj.stats?.maxHealth?.value,
              mana: obj.stats?.mana?.value,
              maxMana: obj.stats?.maxMana?.value,
              score: obj.score,
            };
          }
        });

        console.log(`Sending game state to peer ${peerId}`);

        // Send the game state to the new player
        if (this.peerManager.peers[peerId]) {
          this.peerManager.peers[peerId].send(gameState);
        }
      } catch (error) {
        console.error('Error in syncGameState:', error);
      }
    }
  }

  handleGameStateUpdate(data) {
    try {
      console.log('Processing game state update');

      // Handle game state update from the host
      if (data.mapSize) {
        this.mapSize = data.mapSize;
      }

      // Handle players data
      if (data.players) {
        console.log(`Processing ${Object.keys(data.players).length} players from game state`);

        for (const playerId in data.players) {
          if (playerId === this.peerManager.id) {
            console.log('Skipping self in game state update');
            continue; // Skip self
          }

          const playerData = data.players[playerId];
          console.log(`Processing player ${playerId} from game state`);
          this.addOrUpdateRemotePlayer(playerId, playerData);
        }
      }
    } catch (error) {
      console.error('Error in handleGameStateUpdate:', error);
    }
  }

  addOrUpdateRemotePlayer(playerId, playerData) {
    try {
      // Check if the remote player already exists
      let remotePlayer = this.findRemotePlayerById(playerId);

      if (!remotePlayer) {
        console.log(`Creating new remote player for ${playerId}`);

        // Get a preset based on the serialized data or use a random one
        const preset = playerData.preset
          ? this.deserializePreset(playerData.preset)
          : getChampionPresetRandom();

        // Create a new remote player
        remotePlayer = new RemoteChampion({
          game: this,
          id: playerId,
          position: createVector(
            playerData.position?.x || this.mapSize / 2,
            playerData.position?.y || this.mapSize / 2
          ),
          preset: preset,
        });

        // Set additional properties if available
        if (playerData.health !== undefined) remotePlayer.stats.health.value = playerData.health;
        if (playerData.maxHealth !== undefined)
          remotePlayer.stats.maxHealth.value = playerData.maxHealth;
        if (playerData.mana !== undefined) remotePlayer.stats.mana.value = playerData.mana;
        if (playerData.maxMana !== undefined) remotePlayer.stats.maxMana.value = playerData.maxMana;
        if (playerData.score !== undefined) remotePlayer.score = playerData.score;

        this.objectManager.addObject(remotePlayer);
        console.log(`Remote player ${playerId} added to game`);
      } else {
        // Update the remote player's position
        if (playerData.position) {
          remotePlayer.position.x = playerData.position.x;
          remotePlayer.position.y = playerData.position.y;
        }

        // Update other properties if available
        if (playerData.health !== undefined) {
          remotePlayer.stats.health.value = playerData.health;
        }

        if (playerData.maxHealth !== undefined) {
          remotePlayer.stats.maxHealth.value = playerData.maxHealth;
        }

        if (playerData.mana !== undefined) {
          remotePlayer.stats.mana.value = playerData.mana;
        }

        if (playerData.maxMana !== undefined) {
          remotePlayer.stats.maxMana.value = playerData.maxMana;
        }

        if (playerData.score !== undefined) {
          remotePlayer.score = playerData.score;
        }

        if (
          playerData.spellsCasting &&
          Array.isArray(playerData.spellsCasting) &&
          remotePlayer.spells
        ) {
          for (
            let i = 0;
            i < Math.min(playerData.spellsCasting.length, remotePlayer.spells.length);
            i++
          ) {
            if (remotePlayer.spells[i]) {
              remotePlayer.spells[i].isCasting = playerData.spellsCasting[i]?.isCasting || false;
              remotePlayer.spells[i].castingProgress =
                playerData.spellsCasting[i]?.castingProgress || 0;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error in addOrUpdateRemotePlayer:', error);
    }
  }

  deserializePreset(serializedPreset) {
    try {
      // Get a random preset as a base
      const preset = getChampionPresetRandom();

      // Override with the serialized data if available
      if (serializedPreset) {
        if (serializedPreset.name) preset.name = serializedPreset.name;
        if (serializedPreset.avatar) preset.avatar = serializedPreset.avatar;
      }

      // Keep the spells from the random preset since they contain functions
      // that can't be serialized over the network

      return preset;
    } catch (error) {
      console.error('Error in deserializePreset:', error);
      return getChampionPresetRandom();
    }
  }

  findRemotePlayerById(playerId) {
    return this.objectManager.objects.find(
      obj => obj instanceof RemoteChampion && obj.id === playerId
    );
  }

  removeRemotePlayer(playerId) {
    const remotePlayer = this.findRemotePlayerById(playerId);
    if (remotePlayer) {
      this.objectManager.removeObject(remotePlayer);
    }
  }

  destroy() {
    try {
      console.log('Destroying MultiplayerGame');

      // Clear sync interval
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
        this.syncInterval = null;
      }

      // Disconnect from all peers
      if (this.peerManager) {
        this.peerManager.disconnectAll();
      }

      // Call the parent destroy method
      super.destroy();

      console.log('MultiplayerGame destroyed');
    } catch (error) {
      console.error('Error in MultiplayerGame.destroy:', error);
    }
  }

  fixedUpdate() {
    try {
      // Update camera and world mouse position
      this.camera.update();
      this.worldMouse = this.camera.screenToWorld(mouseX, mouseY);

      // Update game objects
      this.objectManager.update();

      // Update terrain map, check for collision
      this.terrainMap.update();

      // Handle player movement
      if (mouseIsPressed && mouseButton === RIGHT) {
        if (this.player) {
          this.player.moveTo(this.worldMouse.x, this.worldMouse.y);

          this.clickedPoint = {
            x: this.worldMouse.x,
            y: this.worldMouse.y,
            size: 40,
          };
        }
      }

      if (this.clickedPoint) {
        this.clickedPoint.size *= 0.9;
      }

      // Handle spell casting
      if (keyIsPressed && this.player) {
        for (let i = 0; i < SpellHotKeys.length; i++) {
          if (keyIsDown(SpellHotKeys[i])) {
            this.player.spells[i]?.cast();
          }
        }
      }
    } catch (error) {
      console.error('Error in MultiplayerGame.fixedUpdate:', error);
    }
  }

  removeAllAIChampions() {
    // Find and remove all AI champions
    if (this.objectManager && this.objectManager.objects) {
      const aiChampions = this.objectManager.objects.filter(
        obj => obj.constructor.name === 'AIChampion'
      );

      console.log(`Removing ${aiChampions.length} AI champions`);

      // Remove each AI champion
      aiChampions.forEach(aiChamp => {
        this.objectManager.removeObject(aiChamp);
      });
    }
  }

  handlePlayerUpdate(data) {
    try {
      if (!data || !data.id) {
        console.warn('Received invalid player update data:', data);
        return;
      }

      const playerId = data.id;

      // Skip updates from ourselves
      if (playerId === this.peerManager.id) {
        return;
      }

      // Calculate latency if timestamp is available
      if (data.timestamp) {
        const latency = Date.now() - data.timestamp;
        if (latency > 200) {
          console.warn(`High latency (${latency}ms) for player ${playerId}`);
        }
      }

      // Add or update the remote player with the received data
      this.addOrUpdateRemotePlayer(playerId, data);
    } catch (error) {
      console.error('Error handling player update:', error);
    }
  }
}
