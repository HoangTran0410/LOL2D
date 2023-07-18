import { uuidv4 } from '../../utils/index.js';
import EventType from '../enums/EventType.js';
import SpellState from '../enums/SpellState.js';

export default class Spell {
  // for display in HUD
  name = this.constructor.name;
  image = null;
  description = null;
  disabled = false;
  willDrawPreview = false;

  // for spell logic
  level = 0;
  coolDown = 0;
  currentCooldown = 0;
  manaCost = 0;
  healthCost = 0;

  id = uuidv4();

  constructor(owner) {
    this.owner = owner;
    this.game = owner?.game;
    this.state = SpellState.READY;
  }

  update() {
    this.onUpdate();

    this.willDrawPreview = false;
    switch (this.state) {
      case SpellState.READY:
        if (this.currentCooldown > 0) {
          this.state = SpellState.COOLDOWN;
        }
        break;

      case SpellState.COOLDOWN:
        this.currentCooldown -= deltaTime;
        if (this.currentCooldown <= 0) {
          this.currentCooldown = 0;
          this.state = SpellState.READY;
        }
        break;

      default:
    }
  }

  cast() {
    this.game.eventManager.emit(EventType.ON_PRE_CAST_SPELL, this);
    // this.willDrawPreview = true;
    if (this.state !== SpellState.READY) return;
    if (this.castCancelCheck()) return;

    this.state = SpellState.COOLDOWN;
    this.currentCooldown = this.coolDown;
    this.onSpellCast();
    this.game.eventManager.emit(EventType.ON_POST_CAST_SPELL, this);

    // if (this.manaCost) this.owner.stats.mana.baseValue -= this.manaCost;
    // if (this.healthCost) this.owner.stats.health.baseValue -= this.healthCost;
  }
  castCancelCheck() {
    if (
      this.disabled ||
      this.owner.isDead || // TODO: verify this
      !this.owner.canCast ||
      this.owner.stats.mana.value < this.manaCost ||
      this.owner.stats.health.value < this.healthCost ||
      !this.checkCastCondition()
    ) {
      this.resetCoolDown();
      return true;
    }

    return false;
  }

  // Notes: Deactivate is never called as spell removal hasn't been added yet.
  deactivate() {
    this.resetCoolDown();
  }

  resetCoolDown() {
    this.currentCooldown = 0;
    // this.currentCastTime = 0;
    // this.currentChannelDuration = 0;
  }

  // for override
  checkCastCondition() {
    return true;
  }
  onSpellCast() {}
  onUpdate() {}
  drawPreview(radius) {
    if (radius) {
      push();
      stroke(200, 100);
      noFill();
      circle(this.owner.position.x, this.owner.position.y, radius * 2);
      pop();
    }
  }
}
