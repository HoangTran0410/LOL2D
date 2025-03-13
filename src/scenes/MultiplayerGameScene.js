import GameScene from './GameScene.js';
import MultiplayerGame from '../game/MultiplayerGame.js';
import MenuScene from './MenuScene.js';
import Champion from '../game/gameObject/attackableUnits/Champion.js';
import { getChampionPresetRandom } from '../game/preset.js';

// Import the shared variables from GameScene
let drawAnalys, checkUpdateAnalys, realUpdateAnalys, previousTime;

export default class MultiplayerGameScene extends GameScene {
  setup() {
    // Get the game scene element
    this.gameScene = document.querySelector('#game-scene');

    // Create stats container if it doesn't exist
    if (!this.statsContainer) {
      this.statsContainer = document.createElement('div');
      this.statsContainer.id = 'stats-container';
      this.statsContainer.style.position = 'absolute';
      this.statsContainer.style.top = '10px';
      this.statsContainer.style.left = '10px';
      this.statsContainer.style.zIndex = '1000';
      this.gameScene.appendChild(this.statsContainer);
    }

    // Initialize stats
    this.drawAnalys = new Stats.Panel('Draw', '#0ff', '#002');
    this.statsContainer.appendChild(this.drawAnalys.dom);

    this.realUpdateAnalys = new Stats.Panel('Update', '#0f0', '#020');
    this.statsContainer.appendChild(this.realUpdateAnalys.dom);

    this.checkUpdateAnalys = new Stats.Panel('Check', '#f00', '#200');
    this.statsContainer.appendChild(this.checkUpdateAnalys.dom);

    // Initialize previousTime for performance tracking
    this.previousTime = performance.now();

    // Create multiplayer status container
    this.multiplayerStatusContainer = document.createElement('div');
    this.multiplayerStatusContainer.style.position = 'absolute';
    this.multiplayerStatusContainer.style.top = '10px';
    this.multiplayerStatusContainer.style.right = '10px';
    this.multiplayerStatusContainer.style.padding = '5px 10px';
    this.multiplayerStatusContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    this.multiplayerStatusContainer.style.color = 'white';
    this.multiplayerStatusContainer.style.borderRadius = '5px';
    this.multiplayerStatusContainer.style.zIndex = '1000';
    this.multiplayerStatusContainer.textContent = 'Multiplayer: Connecting...';
    this.gameScene.appendChild(this.multiplayerStatusContainer);

    // Get the PeerManager from the scene manager
    this.peerManager = this.sceneManager.gameData.peerManager;
    if (!this.peerManager) {
      console.error('PeerManager not found');
      this.showError('PeerManager not found');
      return;
    }

    // Initialize player property
    this.player = null;
  }

  enter() {
    this.gameScene.style.display = 'block';

    this.canvas = createCanvas(windowWidth, windowHeight).parent('game-scene');
    cursor('assets/cursors/normal.cur');
    pixelDensity(1);
    strokeJoin(ROUND);
    strokeCap(ROUND);
    rectMode(CORNER);
    imageMode(CENTER);

    // Show the multiplayer menu instead of starting the game automatically
    this.showMultiplayerMenu();
  }

  showMultiplayerMenu() {
    // Create a menu container
    const menuContainer = document.createElement('div');
    menuContainer.id = 'multiplayer-menu';
    menuContainer.style.position = 'absolute';
    menuContainer.style.top = '50%';
    menuContainer.style.left = '50%';
    menuContainer.style.transform = 'translate(-50%, -50%)';
    menuContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    menuContainer.style.padding = '20px';
    menuContainer.style.borderRadius = '10px';
    menuContainer.style.color = 'white';
    menuContainer.style.zIndex = '1000';
    menuContainer.style.width = '300px';
    menuContainer.style.textAlign = 'center';

    // Add title
    const title = document.createElement('h2');
    title.textContent = 'Multiplayer Game';
    title.style.marginBottom = '20px';
    menuContainer.appendChild(title);

    // Add create game button
    const createButton = document.createElement('button');
    createButton.textContent = 'Create Game';
    createButton.style.padding = '10px 20px';
    createButton.style.marginBottom = '10px';
    createButton.style.width = '100%';
    createButton.style.cursor = 'pointer';
    createButton.onclick = async () => {
      menuContainer.remove();
      const roomId = await this.createGame();
      if (roomId) {
        // Show room ID for sharing
        this.showRoomIdDisplay(roomId);
      }
    };
    menuContainer.appendChild(createButton);

    // Add join game input and button
    const joinContainer = document.createElement('div');
    joinContainer.style.marginBottom = '10px';

    const roomInput = document.createElement('input');
    roomInput.type = 'text';
    roomInput.placeholder = 'Enter Room ID';
    roomInput.style.padding = '10px';
    roomInput.style.width = '70%';
    roomInput.style.marginRight = '5px';
    joinContainer.appendChild(roomInput);

    const joinButton = document.createElement('button');
    joinButton.textContent = 'Join';
    joinButton.style.padding = '10px';
    joinButton.style.width = '25%';
    joinButton.style.cursor = 'pointer';
    joinButton.onclick = async () => {
      const roomId = roomInput.value.trim();
      if (roomId) {
        menuContainer.remove();
        await this.joinGame(roomId);
      } else {
        alert('Please enter a Room ID');
      }
    };
    joinContainer.appendChild(joinButton);
    menuContainer.appendChild(joinContainer);

    // Add back button
    const backButton = document.createElement('button');
    backButton.textContent = 'Back to Menu';
    backButton.style.padding = '10px 20px';
    backButton.style.width = '100%';
    backButton.style.cursor = 'pointer';
    backButton.onclick = () => {
      menuContainer.remove();
      this.sceneManager.showScene(MenuScene);
    };
    menuContainer.appendChild(backButton);

    // Add to game scene
    this.gameScene.appendChild(menuContainer);
    this.menuContainer = menuContainer;
  }

  showRoomIdDisplay(roomId) {
    const roomDisplay = document.createElement('div');
    roomDisplay.style.position = 'absolute';
    roomDisplay.style.bottom = '20px';
    roomDisplay.style.left = '50%';
    roomDisplay.style.transform = 'translateX(-50%)';
    roomDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    roomDisplay.style.padding = '10px 20px';
    roomDisplay.style.borderRadius = '5px';
    roomDisplay.style.color = 'white';
    roomDisplay.style.zIndex = '1000';

    roomDisplay.innerHTML = `Room ID: <strong>${roomId}</strong> (Share this with friends)`;

    this.gameScene.appendChild(roomDisplay);
    this.roomDisplay = roomDisplay;
  }

  startMultiplayerGame() {
    try {
      console.log('Starting multiplayer game...');

      // Create a new multiplayer game with the peer manager and player
      this.game = new MultiplayerGame({
        peerManager: this.peerManager,
        player: this.player,
      });

      // Make sure the game is not paused
      this.game.paused = false;
      console.log('Game paused state:', this.game.paused);

      // Start the game loop
      this.previousTime = performance.now();
      this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));

      // Set up status update interval
      this.statusUpdateInterval = setInterval(() => {
        this.updateMultiplayerStatus();
      }, 2000);

      console.log('Multiplayer game started successfully');
    } catch (error) {
      console.error('Error starting multiplayer game:', error);
      this.showError('Failed to start game: ' + error.message);
    }
  }

  updateMultiplayerStatus() {
    if (!this.multiplayerStatusContainer) return;

    const connectedPeers = Object.keys(this.peerManager.peers).length;
    const roleText = this.peerManager.isHost ? 'Host' : 'Client';

    this.multiplayerStatusContainer.textContent = `Multiplayer: ${roleText} | Connected: ${connectedPeers}`;
  }

  // Override the updateLoop method to ensure proper logging
  updateLoop() {
    try {
      if (!this.game) {
        console.log('Game is null in updateLoop');
        return;
      }

      let currentTime = performance.now();
      const elapsedTime = currentTime - this.previousTime;
      const interval = 1000 / (this.game.fps || 60);

      checkUpdateAnalys.begin();
      if (elapsedTime > interval) {
        this.previousTime = currentTime - (elapsedTime % interval);

        realUpdateAnalys.begin();
        this.game.update();
        realUpdateAnalys.end();
      }
      checkUpdateAnalys.end();

      // Continue the game loop
      this.animationFrameId = requestAnimationFrame(this.updateLoop.bind(this));
    } catch (error) {
      console.error('Error in MultiplayerGameScene.updateLoop:', error);
      // Continue the game loop even if there's an error
      this.animationFrameId = requestAnimationFrame(this.updateLoop.bind(this));
    }
  }

  // Override the draw method to ensure the game is properly rendered
  draw() {
    if (!this.game) return;

    drawAnalys.begin();
    this.game.draw();
    drawAnalys.end();
  }

  keyPressed() {
    // ESC
    if (keyCode === 27) {
      this.sceneManager.showScene(MenuScene);
    }
    this.game?.keyPressed?.();
  }

  exit() {
    // Cancel the animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Stop the game
    if (this.game) {
      this.game.destroy();
      this.game = null;
    }

    // Clear the status update interval
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
    }

    // Remove the multiplayer status container
    if (this.multiplayerStatusContainer) {
      this.multiplayerStatusContainer.remove();
      this.multiplayerStatusContainer = null;
    }

    // Remove the menu container
    if (this.menuContainer) {
      this.menuContainer.remove();
      this.menuContainer = null;
    }

    // Remove the room display
    if (this.roomDisplay) {
      this.roomDisplay.remove();
      this.roomDisplay = null;
    }

    // Hide the DOM
    this.gameScene.style.display = 'none';
  }

  stopGame() {
    // Cancel the animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Destroy the game
    if (this.game) {
      this.game.destroy();
      this.game = null;
    }
  }

  gameLoop(currentTime) {
    try {
      // Calculate delta time
      const deltaTime = (currentTime - this.previousTime) / 1000;
      this.previousTime = currentTime;

      // Update the game
      if (this.game && !this.game.paused) {
        const startUpdateTime = performance.now();
        this.game.update(deltaTime);
        const updateTime = performance.now() - startUpdateTime;

        if (this.realUpdateAnalys) {
          this.realUpdateAnalys.update(updateTime);
        }
      }

      // Draw the game
      if (this.game) {
        const startDrawTime = performance.now();
        this.draw();
        const drawTime = performance.now() - startDrawTime;

        if (this.drawAnalys) {
          this.drawAnalys.update(drawTime);
        }
      }

      // Continue the game loop
      this.animationFrameId = requestAnimationFrame(this.gameLoop.bind(this));
    } catch (error) {
      console.error('Error in game loop:', error);
      cancelAnimationFrame(this.animationFrameId);
      this.showError('Game error: ' + error.message);
    }
  }

  draw() {
    if (!this.game) return;

    // Clear the canvas
    // const ctx = this.game.ctx;
    // ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw the game
    this.game.draw();
  }

  async joinGame(roomId) {
    try {
      if (!this.peerManager) {
        throw new Error('PeerManager not initialized');
      }

      // Update status
      this.updateStatus('Connecting to room...');

      // Connect to the room
      await this.peerManager.joinRoom(roomId);

      // Update status
      this.updateStatus('Connected! Creating player...');

      // Create a player with a random champion preset
      const preset = getChampionPresetRandom();
      this.player = new Champion({
        position: createVector(this.game?.mapSize / 2 || 5000, this.game?.mapSize / 2 || 5000),
        preset: preset,
      });

      // Update status
      this.updateStatus('Starting game...');

      // Start the multiplayer game
      this.startMultiplayerGame();

      // Update status
      this.updateStatus('Game started!');

      return true;
    } catch (error) {
      console.error('Error joining game:', error);
      this.showError('Failed to join game: ' + error.message);
      return false;
    }
  }

  updateStatus(message) {
    if (this.multiplayerStatusContainer) {
      this.multiplayerStatusContainer.textContent = message;
    }
    console.log('Status:', message);
  }

  showError(message) {
    console.error(message);
    if (this.multiplayerStatusContainer) {
      this.multiplayerStatusContainer.textContent = 'ERROR: ' + message;
      this.multiplayerStatusContainer.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
    }
  }

  async createGame() {
    try {
      if (!this.peerManager) {
        throw new Error('PeerManager not initialized');
      }

      // Update status
      this.updateStatus('Creating room...');

      // Create a room
      const roomId = await this.peerManager.createRoom();

      // Update status
      this.updateStatus('Room created! Creating player...');

      // Create a player with a random champion preset
      const preset = getChampionPresetRandom();
      this.player = new Champion({
        position: createVector(this.game?.mapSize / 2 || 5000, this.game?.mapSize / 2 || 5000),
        preset: preset,
      });

      // Update status
      this.updateStatus('Starting game...');

      // Start the multiplayer game
      this.startMultiplayerGame();

      // Update status
      this.updateStatus(`Game started! Room ID: ${roomId}`);

      return roomId;
    } catch (error) {
      console.error('Error creating game:', error);
      this.showError('Failed to create game: ' + error.message);
      return null;
    }
  }
}
