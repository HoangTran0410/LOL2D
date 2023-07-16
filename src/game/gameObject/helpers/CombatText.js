import ColorUtils from '../../../utils/color.utils.js';
import SpellObject from '../SpellObject.js';

export default class CombatText extends SpellObject {
  velocity = createVector(0, -1);
  gravity = createVector(random(-0.03, 0.03), 0.05);
  movedVector = createVector();
  lifeTime = 1000;
  age = 0;
  textSize = 20;
  textColor = 'white';
  text = '';

  update() {
    this.movedVector.add(this.velocity);
    this.velocity.add(this.gravity);

    this.age += deltaTime;
    if (this.age > this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw() {
    push();
    let alpha = map(this.age, 0, this.lifeTime, 255, 10);
    let strokeColor = ColorUtils.applyColorAlpha('yellow', alpha);
    let colorAlpha = ColorUtils.applyColorAlpha(this.textColor, alpha);
    let size = this.owner.stats.size.value;
    let x = this.owner.position.x + this.movedVector.x;
    let y = this.owner.position.y + this.movedVector.y - size / 2;

    strokeWeight(2);
    stroke(strokeColor);
    fill(colorAlpha);
    textStyle(BOLD);
    textSize(this.textSize);
    text(this.text, x, y);
    pop();
  }
}
