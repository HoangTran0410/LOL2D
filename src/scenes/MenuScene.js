import { Scene } from '../managers/SceneManager.js';
import DomUtils from '../utils/dom.utils.js';
import GameScene from './GameScene.js';
import MultiplayerGameScene from './MultiplayerGameScene.js';
import PeerManager from '../managers/PeerManager.js';

export default class MenuScene extends Scene {
  setup() {
    this.menuSceneDiv = document.querySelector('#menu-scene');
    this.background = document.querySelector('#menu-scene .background');
    this.playBtn = document.querySelector('#play-btn');
    this.fullscreenBtn = document.querySelector('#fullscreen-btn');

    // Create multiplayer UI elements
    this.createMultiplayerUI();

    this.playBtn.addEventListener('click', () => {
      this.sceneManager.showScene(GameScene);
    });
    this.fullscreenBtn.addEventListener('click', () => {
      let isFullscreen = DomUtils.toggleFullscreen();
      if (isFullscreen) {
        this.fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
      } else {
        this.fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
      }
    });

    DomUtils.preventZoom();
  }

  createMultiplayerUI() {
    // Create container for multiplayer buttons
    this.multiplayerContainer = document.createElement('div');
    this.multiplayerContainer.className = 'multiplayer-container';
    this.multiplayerContainer.style.display = 'flex';
    this.multiplayerContainer.style.flexDirection = 'column';
    this.multiplayerContainer.style.gap = '10px';
    this.multiplayerContainer.style.position = 'absolute';
    this.multiplayerContainer.style.right = '20px';
    this.multiplayerContainer.style.top = '20px';
    this.menuSceneDiv.appendChild(this.multiplayerContainer);

    // Create host game button
    this.hostGameBtn = document.createElement('button');
    this.hostGameBtn.className = 'hextech-btn';
    this.hostGameBtn.textContent = 'Tạo phòng';
    this.hostGameBtn.style.padding = '10px 20px';
    this.multiplayerContainer.appendChild(this.hostGameBtn);

    // Create join game button
    this.joinGameBtn = document.createElement('button');
    this.joinGameBtn.className = 'hextech-btn';
    this.joinGameBtn.textContent = 'Tham gia phòng';
    this.joinGameBtn.style.padding = '10px 20px';
    this.multiplayerContainer.appendChild(this.joinGameBtn);

    // Create room info container (initially hidden)
    this.roomInfoContainer = document.createElement('div');
    this.roomInfoContainer.className = 'room-info';
    this.roomInfoContainer.style.display = 'none';
    this.roomInfoContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    this.roomInfoContainer.style.padding = '20px';
    this.roomInfoContainer.style.borderRadius = '5px';
    this.roomInfoContainer.style.position = 'absolute';
    this.roomInfoContainer.style.top = '50%';
    this.roomInfoContainer.style.left = '50%';
    this.roomInfoContainer.style.transform = 'translate(-50%, -50%)';
    this.roomInfoContainer.style.zIndex = '100';
    this.menuSceneDiv.appendChild(this.roomInfoContainer);

    // Add event listeners
    this.hostGameBtn.addEventListener('click', () => this.hostGame());
    this.joinGameBtn.addEventListener('click', () => this.joinGame());
  }

  hostGame() {
    // Show room info UI immediately with loading state
    this.showRoomInfoLoading();

    // Initialize PeerManager if not already initialized
    if (!this.peerManager) {
      this.peerManager = new PeerManager(null);

      // Handle connection status changes
      this.peerManager.onConnectionStatusChanged = (status, error) => {
        this.handleConnectionStatusChange(status, error);
      };

      this.peerManager.onConnected = id => {
        // Update room info with the actual ID once connected
        this.updateRoomInfoWithId(id);
      };

      this.peerManager.onPlayerJoined = peerId => {
        this.addPlayerToRoomInfo(peerId);
      };
    } else {
      // If PeerManager already exists, update room info with the ID
      if (this.peerManager.isConnected) {
        this.updateRoomInfoWithId(this.peerManager.id);
      } else {
        // Handle the case where PeerManager exists but is not connected
        this.handleConnectionStatusChange(
          this.peerManager.connectionStatus,
          this.peerManager.connectionError
        );
      }
    }
  }

  joinGame() {
    const roomId = prompt('Nhập mã phòng:');
    if (!roomId) return;

    // Show joining room UI with loading state
    this.showJoiningRoomUI(roomId);

    // Initialize PeerManager if not already initialized
    if (!this.peerManager) {
      this.peerManager = new PeerManager(null);

      // Handle connection status changes
      this.peerManager.onConnectionStatusChanged = (status, error) => {
        this.handleConnectionStatusChange(status, error);
      };

      this.peerManager.onConnected = id => {
        const success = this.peerManager.joinRoom(roomId);
        if (!success) {
          this.showJoiningError('Không thể kết nối đến phòng. Vui lòng thử lại sau.');
        }
      };

      this.peerManager.onPlayerJoined = peerId => {
        // Start the game when connected to host
        this.startMultiplayerGame();
      };
    } else {
      if (this.peerManager.isConnected) {
        const success = this.peerManager.joinRoom(roomId);
        if (!success) {
          this.showJoiningError('Không thể kết nối đến phòng. Vui lòng thử lại sau.');
        }
      } else {
        // Handle the case where PeerManager exists but is not connected
        this.handleConnectionStatusChange(
          this.peerManager.connectionStatus,
          this.peerManager.connectionError
        );
      }
    }
  }

  showJoiningRoomUI(roomId) {
    // Clear previous content
    this.roomInfoContainer.innerHTML = '';

    // Create joining room title
    const joiningTitle = document.createElement('h2');
    joiningTitle.textContent = 'Đang tham gia phòng';
    this.roomInfoContainer.appendChild(joiningTitle);

    // Create room ID display
    const roomIdDisplay = document.createElement('div');
    roomIdDisplay.textContent = roomId;
    roomIdDisplay.style.padding = '10px';
    roomIdDisplay.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    roomIdDisplay.style.borderRadius = '5px';
    roomIdDisplay.style.marginBottom = '20px';
    roomIdDisplay.style.textAlign = 'center';
    roomIdDisplay.style.fontWeight = 'bold';
    this.roomInfoContainer.appendChild(roomIdDisplay);

    // Create loading indicator
    const loadingContainer = document.createElement('div');
    loadingContainer.style.display = 'flex';
    loadingContainer.style.justifyContent = 'center';
    loadingContainer.style.marginBottom = '20px';

    const loadingIndicator = document.createElement('div');
    loadingIndicator.textContent = 'Đang kết nối...';
    loadingIndicator.style.textAlign = 'center';
    loadingContainer.appendChild(loadingIndicator);

    this.roomInfoContainer.appendChild(loadingContainer);

    // Create cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'hextech-btn';
    cancelBtn.textContent = 'Hủy';
    cancelBtn.style.width = '100%';
    cancelBtn.addEventListener('click', () => {
      this.roomInfoContainer.style.display = 'none';
      if (this.peerManager) {
        this.peerManager.disconnectAll();
      }
    });
    this.roomInfoContainer.appendChild(cancelBtn);

    // Show the room info container
    this.roomInfoContainer.style.display = 'block';
  }

  showJoiningError(errorMessage) {
    // Find or create error message element
    let errorElement = this.roomInfoContainer.querySelector('.error-message');
    if (!errorElement) {
      errorElement = document.createElement('div');
      errorElement.className = 'error-message';
      errorElement.style.color = 'red';
      errorElement.style.textAlign = 'center';
      errorElement.style.marginBottom = '20px';
      errorElement.style.padding = '10px';
      errorElement.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
      errorElement.style.borderRadius = '5px';

      // Insert after loading indicator or at the beginning
      const loadingContainer = this.roomInfoContainer.querySelector(
        'div[style*="justify-content: center"]'
      );
      if (loadingContainer) {
        loadingContainer.style.display = 'none'; // Hide loading indicator
        loadingContainer.parentNode.insertBefore(errorElement, loadingContainer.nextSibling);
      } else {
        this.roomInfoContainer.insertBefore(errorElement, this.roomInfoContainer.firstChild);
      }
    }

    errorElement.textContent = errorMessage;
  }

  showRoomInfoLoading() {
    // Clear previous content
    this.roomInfoContainer.innerHTML = '';

    // Create room ID display with loading state
    const roomIdTitle = document.createElement('h2');
    roomIdTitle.textContent = 'Mã phòng:';
    this.roomInfoContainer.appendChild(roomIdTitle);

    const roomIdDisplay = document.createElement('div');
    roomIdDisplay.id = 'room-id-display';
    roomIdDisplay.textContent = 'Đang kết nối...';
    roomIdDisplay.style.padding = '10px';
    roomIdDisplay.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    roomIdDisplay.style.borderRadius = '5px';
    roomIdDisplay.style.marginBottom = '20px';
    roomIdDisplay.style.textAlign = 'center';
    roomIdDisplay.style.fontWeight = 'bold';
    this.roomInfoContainer.appendChild(roomIdDisplay);

    // Create players list
    const playersTitle = document.createElement('h3');
    playersTitle.textContent = 'Người chơi:';
    this.roomInfoContainer.appendChild(playersTitle);

    this.playersList = document.createElement('ul');
    this.playersList.style.listStyle = 'none';
    this.playersList.style.padding = '0';
    this.playersList.style.margin = '0';

    // Add host (self) to the list
    const hostItem = document.createElement('li');
    hostItem.textContent = 'Bạn (Chủ phòng)';
    hostItem.style.padding = '5px 0';
    this.playersList.appendChild(hostItem);

    this.roomInfoContainer.appendChild(this.playersList);

    // Create start game button (disabled while loading)
    const startGameBtn = document.createElement('button');
    startGameBtn.id = 'start-game-btn';
    startGameBtn.className = 'hextech-btn';
    startGameBtn.textContent = 'Bắt đầu';
    startGameBtn.style.marginTop = '20px';
    startGameBtn.style.width = '100%';
    startGameBtn.style.opacity = '0.5';
    startGameBtn.style.cursor = 'not-allowed';
    startGameBtn.disabled = true;
    startGameBtn.addEventListener('click', () => this.startMultiplayerGame());
    this.roomInfoContainer.appendChild(startGameBtn);

    // Create cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'hextech-btn';
    cancelBtn.textContent = 'Hủy';
    cancelBtn.style.marginTop = '10px';
    cancelBtn.style.width = '100%';
    cancelBtn.addEventListener('click', () => {
      this.roomInfoContainer.style.display = 'none';
      if (this.peerManager) {
        this.peerManager.disconnectAll();
      }
    });
    this.roomInfoContainer.appendChild(cancelBtn);

    // Show the room info container
    this.roomInfoContainer.style.display = 'block';
  }

  updateRoomInfoWithId(roomId) {
    // Update room ID display
    const roomIdDisplay = document.getElementById('room-id-display');
    if (roomIdDisplay) {
      // Make room ID selectable
      roomIdDisplay.style.userSelect = 'text';
      roomIdDisplay.style.cursor = 'text';
      roomIdDisplay.textContent = roomId;

      // Create copy button container
      const copyBtnContainer = document.createElement('div');
      copyBtnContainer.style.marginTop = '10px';
      copyBtnContainer.style.display = 'flex';
      copyBtnContainer.style.justifyContent = 'center';

      // Create copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'hextech-btn';
      copyBtn.textContent = 'Sao chép';
      copyBtn.style.padding = '5px 10px';
      copyBtn.style.fontSize = '12px';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(roomId).then(() => {
          // Show copied feedback
          const originalText = copyBtn.textContent;
          copyBtn.textContent = 'Đã sao chép!';
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 2000);
        });
      });

      copyBtnContainer.appendChild(copyBtn);
      roomIdDisplay.parentNode.insertBefore(copyBtnContainer, roomIdDisplay.nextSibling);

      // Enable start game button
      const startGameBtn = document.getElementById('start-game-btn');
      if (startGameBtn) {
        startGameBtn.style.opacity = '1';
        startGameBtn.style.cursor = 'pointer';
        startGameBtn.disabled = false;
      }
    }
  }

  showRoomInfo(roomId) {
    // Clear previous content
    this.roomInfoContainer.innerHTML = '';

    // Create room ID display
    const roomIdTitle = document.createElement('h2');
    roomIdTitle.textContent = 'Mã phòng:';
    this.roomInfoContainer.appendChild(roomIdTitle);

    const roomIdDisplay = document.createElement('div');
    roomIdDisplay.textContent = roomId;
    roomIdDisplay.style.padding = '10px';
    roomIdDisplay.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    roomIdDisplay.style.borderRadius = '5px';
    roomIdDisplay.style.marginBottom = '20px';
    roomIdDisplay.style.textAlign = 'center';
    roomIdDisplay.style.fontWeight = 'bold';
    // Make room ID selectable
    roomIdDisplay.style.userSelect = 'text';
    roomIdDisplay.style.cursor = 'text';
    this.roomInfoContainer.appendChild(roomIdDisplay);

    // Create copy button container
    const copyBtnContainer = document.createElement('div');
    copyBtnContainer.style.marginTop = '10px';
    copyBtnContainer.style.display = 'flex';
    copyBtnContainer.style.justifyContent = 'center';

    // Create copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'hextech-btn';
    copyBtn.textContent = 'Sao chép';
    copyBtn.style.padding = '5px 10px';
    copyBtn.style.fontSize = '12px';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(roomId).then(() => {
        // Show copied feedback
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Đã sao chép!';
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 2000);
      });
    });

    copyBtnContainer.appendChild(copyBtn);
    this.roomInfoContainer.appendChild(copyBtnContainer);

    // Create players list
    const playersTitle = document.createElement('h3');
    playersTitle.textContent = 'Người chơi:';
    this.roomInfoContainer.appendChild(playersTitle);

    this.playersList = document.createElement('ul');
    this.playersList.style.listStyle = 'none';
    this.playersList.style.padding = '0';
    this.playersList.style.margin = '0';

    // Add host (self) to the list
    const hostItem = document.createElement('li');
    hostItem.textContent = 'Bạn (Chủ phòng)';
    hostItem.style.padding = '5px 0';
    this.playersList.appendChild(hostItem);

    this.roomInfoContainer.appendChild(this.playersList);

    // Create start game button
    const startGameBtn = document.createElement('button');
    startGameBtn.className = 'hextech-btn';
    startGameBtn.textContent = 'Bắt đầu';
    startGameBtn.style.marginTop = '20px';
    startGameBtn.style.width = '100%';
    startGameBtn.addEventListener('click', () => this.startMultiplayerGame());
    this.roomInfoContainer.appendChild(startGameBtn);

    // Create cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'hextech-btn';
    cancelBtn.textContent = 'Hủy';
    cancelBtn.style.marginTop = '10px';
    cancelBtn.style.width = '100%';
    cancelBtn.addEventListener('click', () => {
      this.roomInfoContainer.style.display = 'none';
      if (this.peerManager) {
        this.peerManager.disconnectAll();
      }
    });
    this.roomInfoContainer.appendChild(cancelBtn);

    // Show the room info container
    this.roomInfoContainer.style.display = 'block';
  }

  addPlayerToRoomInfo(peerId) {
    if (!this.playersList) return;

    const playerItem = document.createElement('li');
    playerItem.textContent = `Người chơi: ${peerId.substring(0, 6)}...`;
    playerItem.style.padding = '5px 0';
    this.playersList.appendChild(playerItem);
  }

  startMultiplayerGame() {
    if (!this.peerManager) return;

    // Hide room info
    this.roomInfoContainer.style.display = 'none';

    // Start multiplayer game
    this.sceneManager.gameData.peerManager = this.peerManager;
    this.sceneManager.showScene(MultiplayerGameScene);
  }

  nextBackground() {
    let maxIndex = 6;
    if (this.currentBgIndex === undefined) {
      this.currentBgIndex = Math.floor(Math.random() * maxIndex) + 1;
    } else {
      this.currentBgIndex = this.currentBgIndex + 1;
      if (this.currentBgIndex > maxIndex) {
        this.currentBgIndex = 1;
      }
    }
    this.background.style.backgroundImage = `url(./assets/images/others/menu-bg-${this.currentBgIndex}.jpg)`;
  }

  enter() {
    // reset dom
    this.menuSceneDiv.style.display = 'flex';

    this.nextBackground();
    this.interval = setInterval(() => {
      this.nextBackground();
    }, 5000);

    // this.sceneManager.showScene(GameScene);
  }

  exit() {
    // hide dom
    this.menuSceneDiv.style.display = 'none';

    clearInterval(this.interval);
  }

  handleConnectionStatusChange(status, error) {
    console.log(`Connection status changed: ${status}`, error);

    // Update UI based on connection status
    switch (status) {
      case 'connecting':
        this.updateConnectionStatusUI('Đang kết nối...', 'connecting');
        break;

      case 'connected':
        this.updateConnectionStatusUI('Đã kết nối', 'connected');
        break;

      case 'disconnected':
        this.updateConnectionStatusUI('Mất kết nối. Đang thử kết nối lại...', 'disconnected');
        break;

      case 'error':
        this.updateConnectionStatusUI(`Lỗi kết nối: ${error || 'Không xác định'}`, 'error');
        break;
    }
  }

  updateConnectionStatusUI(message, status) {
    // Find or create status message element
    let statusElement = this.roomInfoContainer.querySelector('.connection-status');
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.className = 'connection-status';
      statusElement.style.textAlign = 'center';
      statusElement.style.marginBottom = '20px';
      statusElement.style.padding = '10px';
      statusElement.style.borderRadius = '5px';

      // Insert at appropriate position
      const roomIdDisplay = this.roomInfoContainer.querySelector('#room-id-display');
      if (roomIdDisplay) {
        roomIdDisplay.parentNode.insertBefore(statusElement, roomIdDisplay.nextSibling);
      } else {
        // If joining room, insert after loading indicator
        const loadingContainer = this.roomInfoContainer.querySelector(
          'div[style*="justify-content: center"]'
        );
        if (loadingContainer) {
          loadingContainer.style.display = 'none'; // Hide loading indicator
          loadingContainer.parentNode.insertBefore(statusElement, loadingContainer.nextSibling);
        } else {
          // Fallback: insert at the beginning
          this.roomInfoContainer.insertBefore(
            statusElement,
            this.roomInfoContainer.firstChild.nextSibling
          );
        }
      }
    }

    // Update status element style based on status
    statusElement.textContent = message;

    // Set color based on status
    switch (status) {
      case 'connecting':
        statusElement.style.backgroundColor = 'rgba(255, 165, 0, 0.1)';
        statusElement.style.color = 'orange';
        break;

      case 'connected':
        statusElement.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
        statusElement.style.color = 'green';
        // Hide after a short delay
        setTimeout(() => {
          statusElement.style.display = 'none';
        }, 3000);
        break;

      case 'disconnected':
        statusElement.style.backgroundColor = 'rgba(255, 165, 0, 0.1)';
        statusElement.style.color = 'orange';
        break;

      case 'error':
        statusElement.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
        statusElement.style.color = 'red';
        break;
    }
  }
}
