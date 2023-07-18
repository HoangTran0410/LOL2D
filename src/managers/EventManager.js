// source: https://github.com/behnammodi/jetemit/blob/master/src/index.js

export default class EventManager {
  constructor() {
    this.subscribers = new Map();
  }

  on(eventType, callback) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, []);
    }
    this.subscribers.get(eventType).push(callback);
    return () => this.unsub(eventType, callback);
  }

  once(eventType, callback) {
    const unsub = this.on(eventType, () => {
      callback.apply(undefined, arguments);
      unsub();
    });
    return unsub;
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

  unsub(eventType, callback) {
    if (callback) {
      const subscribers = this.subscribers.get(eventType);
      if (subscribers) {
        const index = subscribers.indexOf(callback);
        if (index > -1) {
          subscribers.splice(index, 1);
          return true;
        }
      }
    } else if (this.subscribers.has(eventType)) {
      this.subscribers.delete(eventType);
      return true;
    }
    return false;
  }
}
