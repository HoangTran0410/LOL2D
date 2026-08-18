import type { Vec2 } from '@/game/spell/runtime/types';
import ParticleEmitter from './ParticleEmitter';

export default class ImpactEffect extends ParticleEmitter {
  constructor(position: Vec2) {
    super(position, 180);
  }
}
