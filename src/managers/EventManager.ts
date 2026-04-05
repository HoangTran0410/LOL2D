// source: https://github.com/behnammodi/jetemit/blob/master/src/index.js

export default class EventManager {
  subscribers = new Map<string, Function[]>();

  on(eventType: string, callback: Function): () => void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, []);
    }
    this.subscribers.get(eventType)!.push(callback);
    return () => this.unsub(eventType, callback);
  }

  once(eventType: string, callback: Function): () => void {
    const unsub = this.on(eventType, (...args: any[]) => {
      callback.apply(undefined, args);
      unsub();
    });
    return unsub;
  }

  emit(eventType: string, arg?: any): any[] {
    const refunds: any[] = [];
    if (this.subscribers.has(eventType)) {
      this.subscribers.get(eventType)!.forEach(func => {
        if (func) refunds.push(func(arg));
      });
    }
    return refunds;
  }

  unsub(eventType: string, callback?: Function): boolean {
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
