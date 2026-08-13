import GameObject from './GameObject';
import type GameObjectType from './GameObject';
import type { QueryOptions } from '../managers/ObjectManager';
import type AttackableUnit from './attackableUnits/AttackableUnit';
import type { GameObjectGameContext } from './GameObject';

export interface SpellObjectGameContext {
  objectManager: {
    addObject?: (object: GameObjectType) => void;
    queryObjects: (options: QueryOptions) => GameObjectType[];
  };
}

export interface SpellOwner {
  game: SpellObjectGameContext;
  position: p5.Vector;
  teamId: string;
}

type SpellGame<TOwner> = TOwner extends AttackableUnit
  ? GameObjectGameContext
  : TOwner extends SpellOwner
    ? SpellObjectGameContext
    : undefined;

export default class SpellObject<TOwner extends SpellOwner | undefined = AttackableUnit> extends GameObject {
  declare game: SpellGame<TOwner>;
  isMissile = false;
  owner: TOwner;
  destination!: p5.Vector;

  constructor(owner: TOwner) {
    super({
      game: owner?.game,
      position: owner?.position?.copy?.(),
      teamId: owner?.teamId,
    });
    this.owner = owner;
  }
}
