export default class Stackable {
  maxStacks = 0;
  stackCount = 0;

  increaseStackCount(delta = 1) {
    if (this.stackCount < this.maxStacks) {
      this.stackCount += delta;
      return true;
    }
    return false;
  }

  decreaseStackCount(delta = 1) {
    if (this.stackCount > 0) {
      this.stackCount -= delta;
      return true;
    }
    return false;
  }

  setStackCount(value) {
    if (value >= 0 && value <= this.maxStacks) {
      this.stackCount = value;
      return true;
    }
    return false;
  }
}
