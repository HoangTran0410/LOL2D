import { uuidv4 } from '../../utils/index';
import EventType from '../enums/EventType';
import SpellState from '../enums/SpellState';

export default class Spell {
  // for display in HUD
  name = this.constructor.name;
  image: any = null;
  description: any = null;
  disabled = false;
  willDrawPreview = false;

  // for spell logic
  level = 0;
  coolDown = 0;
  currentCooldown = 0;
  manaCost = 0;
  healthCost = 0;

  id: string = uuidv4();
  owner: any;
  game: any;
  state: string = SpellState.READY;

  constructor(owner: any) {
    this.owner = owner;
    this.game = owner?.game;
    this.state = SpellState.READY;
  }

  update(): void {
    this.onUpdate();

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

  cast(): void {
    this.game.eventManager.emit(EventType.ON_PRE_CAST_SPELL, this);
    if (this.state !== SpellState.READY) return;
    if (this.castCancelCheck()) return;

    this.state = SpellState.COOLDOWN;
    this.currentCooldown = this.coolDown;
    this.onSpellCast();
    this.game.eventManager.emit(EventType.ON_POST_CAST_SPELL, this);
  }

  castCancelCheck(): boolean {
    if (
      this.disabled ||
      this.owner.isDead ||
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
  deactivate(): void {
    this.resetCoolDown();
  }

  resetCoolDown(): void {
    this.currentCooldown = 0;
  }

  // for override
  checkCastCondition(): boolean {
    return true;
  }

  onSpellCast(): void {}
  onUpdate(): void {}

  drawPreview(radius?: number): void {
    if (radius) {
      push();
      strokeWeight(2);
      stroke(200, 100);
      noFill();
      circle(this.owner.position.x, this.owner.position.y, radius * 2);
      pop();
    }
  }
}
