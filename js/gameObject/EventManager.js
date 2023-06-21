export default class EventManager {
  constructor(game) {
    this.game = game;

    this.listeners = {};
  }

  addListener(eventType, listener) {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType].push(listener);
  }

  removeListener(eventType, listener) {
    if (!this.listeners[eventType]) {
      return;
    }
    this.listeners[eventType] = this.listeners[eventType].filter(l => l !== listener);
  }

  dispatchEvent(eventType, event) {
    if (!this.listeners[eventType]) {
      return;
    }
    this.listeners[eventType].forEach(listener => listener(event));
  }
}
