import ColorUtils from '@/utils/color.utils';
import SpellObject from '@/game/gameObject/SpellObject';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

export default class CombatText extends SpellObject {
  velocity: p5.Vector;
  gravity: p5.Vector;
  movedVector: p5.Vector;
  lifeTime: number;
  age: number;
  textSize: number;
  textColor: string | number[];
  text: string;

  constructor(owner: AttackableUnit) {
    super(owner);
    this.velocity = createVector(0, -1);
    this.gravity = createVector(random(-0.03, 0.03), 0.05);
    this.movedVector = createVector();
    this.lifeTime = 1000;
    this.age = 0;
    this.textSize = 20;
    this.textColor = 'white';
    this.text = '';
  }

  update(): void {
    this.movedVector.add(this.velocity);
    this.velocity.add(this.gravity);

    this.age += deltaTime;
    if (this.age > this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw(): void {
    push();
    const alpha = map(this.age, 0, this.lifeTime, 255, 10);
    const strokeColor = ColorUtils.applyColorAlpha('yellow', alpha);
    const colorAlpha = ColorUtils.applyColorAlpha(this.textColor, alpha);
    const size = this.owner.stats.size.value;
    const x = this.owner.position.x + this.movedVector.x;
    const y = this.owner.position.y + this.movedVector.y - size / 2;

    strokeWeight(2);
    stroke(strokeColor);
    fill(colorAlpha);
    textStyle(BOLD);
    // An overlay, not the world: a damage number is the same size on screen at
    // every zoom. See Camera.constantSize.
    textSize(this.textSize * (this.game?.camera?.constantSize?.(1) ?? 1));
    text(this.text, x, y);
    pop();
  }
}
