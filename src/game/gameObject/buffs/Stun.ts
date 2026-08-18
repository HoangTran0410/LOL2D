// TODO https://leagueoflegends.fandom.com/wiki/Stun
// https://leagueoflegends.fandom.com/wiki/Root
import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';

// Làm choáng
export default class Stun extends Buff {
  image: Buff['image'] = AssetManager.get('buff_stun');
  name = 'Choáng';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;
  statusFlagsToEnable = StatusFlags.Stunned | StatusFlags.Immovable;

  draw(): void {
    // draw buff on target unit
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    translate(pos.x, pos.y);
    rotate(-frameCount / 15);
    image(AssetManager.renderable(this.image ?? undefined), 0, 0, size, size);
    pop();
  }
}
