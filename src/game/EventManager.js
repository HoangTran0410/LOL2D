export default class EventManager {
  constructor(game) {
    this.game = game;
    this.subscribers = new Map();
  }

  on(eventType, callback) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, []);
    }
    this.subscribers.get(eventType).push(callback);
    return () => this.unsubscribeOf(eventType, callback);
  }

  once(eventType, callback) {
    const unsubscribe = this.on(eventType, () => {
      callback.apply(undefined, arguments);
      unsubscribe();
    });
    return unsubscribe;
  }

  emit(eventType, arg) {
    const refunds = [];
    if (this.subscribers.has(eventType)) {
      this.subscribers.get(eventType).forEach(func => {
        if (func) refunds.push(func(arg));
      });
    }
    return refunds;
  }

  unsubscribeOf(eventType, callback) {
    if (callback) {
      const subscribers = this.subscribers.get(eventType);
      const index = subscribers.indexOf(callback);
      if (index > -1) {
        subscribers.splice(index, 1);
      }
    } else {
      this.subscribers.delete(eventType);
    }
  }
}
