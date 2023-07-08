import ColorUtils from '../../../utils/color.utils.js';
import SpellObject from '../SpellObject.js';

export default class CombatText extends SpellObject {
  velocity = createVector(random(-1, 1), -2);
  gravity = createVector(0.01, 0.05);
  movedVector = createVector();
  lifeTime = 1000;
  age = 0;
  textSize = 17;
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
    // let _textSize = map(this.age, 0, this.lifeTime, this.textSize, 10);
    // let alpha = map(this.age, 0, this.lifeTime, 255, 50);
    // let colour = [...this.textColor, alpha];

    // noStroke();
    // fill(colour);
    // textStyle(BOLD);
    // textSize(_textSize);
    // textAlign(CENTER, CENTER);
    // text(this.text, this.position.x, this.position.y);

    let alpha = map(this.age, 0, this.lifeTime, 255, 10);
    let colorAlpha = ColorUtils.applyColorAlpha(this.textColor, alpha);
    let size = this.owner.stats.size.value;
    let x = this.owner.position.x + this.movedVector.x;
    let y = this.owner.position.y + this.movedVector.y - size / 2;

    strokeWeight(1);
    stroke(colorAlpha);
    fill(colorAlpha);
    textSize(this.textSize);
    text(this.text, x, y);
    pop();
  }
}
