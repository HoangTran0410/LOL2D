import ColorUtils from '../../../utils/color.utils';
import SpellObject from '../SpellObject';

export default class CombatText extends SpellObject {
  velocity: p5.Vector;
  gravity: p5.Vector;
  movedVector: p5.Vector;
  lifeTime: number;
  age: number;
  textSize: number;
  textColor: string | number[];
  text: string;

  constructor(owner: any) {
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
    textSize(this.textSize);
    text(this.text, x, y);
    pop();
  }
}
