import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Charm from '../buffs/Charm.js';
import TrailSystem from '../helpers/TrailSystem.js';

export default class Ahri_E extends Spell {
  image = AssetManager.getAsset('spell_ahri_e');
  name = 'Hôn Gió (Ahri_E)';
  description =
    'Hôn gió theo hướng chỉ định, gây 15 sát thương và mê hoặc kẻ địch, khiến chúng câm lặng và đi về phía bạn trong 1.5s';
  coolDown = 5000;

  onSpellCast() {
    let range = 350,
      charmTime = 1500;

    let { from, to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      range
    );

    let obj = new Ahri_E_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    obj.range = range;
    obj.charmTime = charmTime;
    this.game.addObject(obj);
  }
}

export class Ahri_E_Object extends SpellObject {
  isMissile = true;
  position = createVector();
  destination = createVector();
  speed = 9;
  size = 25;
  range = 350;
  charmTime = 1500;

  trailSystem = new TrailSystem({
    trailColor: '#F738DE33',
    trailSize: this.size,
  });

  update() {
    VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);
    this.trailSystem.addTrail(this.position);

    if (this.position.dist(this.destination) < this.speed) {
      this.toRemove = true;
    }

    let enemy = this.game.queryPlayersInRange({
      position: this.position,
      range: 0,
      includePlayerSize: true,
      excludeTeamIds: [this.owner.teamId],
      getOnlyOne: true,
    });

    if (enemy) {
      let charmBuff = new Charm(this.charmTime, this.owner, enemy);
      charmBuff.image = AssetManager.getAsset('spell_ahri_e');
      charmBuff.speed = 1;
      enemy.addBuff(charmBuff);

      this.toRemove = true;
    }
  }

  draw() {
    this.trailSystem.draw();

    push();
    let alpha = map(this.position.dist(this.destination), this.range, 0, 255, 50);
    noStroke();
    fill(247, 56, 222, alpha);
    circle(
      this.position.x + random(-3, 3),
      this.position.y + random(-3, 3),
      this.size + random(-3, 3)
    );
    pop();
  }
}
