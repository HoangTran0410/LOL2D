import AssetManager from '../../../managers/AssetManager';
import { getChampionPresetRandom } from '../../preset';
import Champion, { type ChampionPresetData } from './Champion';
import { uuidv4 } from '../../../utils';
import TargetResolver from '../../spell/targeting/TargetResolver';
import type Spell from '../Spell';
import type { CastContext } from '../../spell/runtime/types';
import type { Vec2 } from '../../spell/runtime/types';

export default class AIChampion extends Champion {
  _autoMove = true;
  _autoCast = true;
  _autoMoveOnTakeDamage = true;
  _autoMoveOnCollideWall = true;
  _autoMoveOnCollideMapEdge = true;
  _respawnWithNewPreset = true;
  private pendingCharge?: {
    spell: Spell;
    context: CastContext;
    elapsedMs: number;
    releaseAtMs: number;
  };

  constructor({
    game,
    position,
    collisionRadius,
    visionRadius,
    teamId,
    stats,
    avatar,
    preset,
  }: {
    game?: any;
    position?: p5.Vector;
    collisionRadius?: number;
    visionRadius?: number;
    teamId?: string;
    stats?: any;
    avatar?: any;
    preset?: ChampionPresetData;
  }) {
    super({ game, position, collisionRadius, visionRadius, teamId, stats, avatar, preset });
  }

  update() {
    super.update();

    if (this._autoMove) {
      let distToDest = this.position.dist(this.destination);
      if (distToDest < this.stats.speed.value) {
        this.moveToRandomLocation();
      }
    }

    if (this.pendingCharge) {
      const pending = this.pendingCharge;
      pending.elapsedMs += Math.max(0, deltaTime);
      const context = this.createSpellContext(pending.spell);
      if (context) {
        pending.context = context;
        pending.spell.hold(context);
      }
      if (pending.elapsedMs >= pending.releaseAtMs) {
        pending.spell.release(pending.context);
        this.pendingCharge = undefined;
      }
    } else if (this._autoCast) {
      if (random() < 0.1) {
        let spellIndex = floor(random(this.spells.length));
        const spell = this.spells[spellIndex];
        const context = this.createSpellContext(spell);
        if (context && spell.press(context) &&
            (spell.castSpec.activation === 'HOLD_RELEASE' ||
              spell.castSpec.activation === 'TAP_OR_HOLD')) {
          this.pendingCharge = {
            spell,
            context,
            elapsedMs: 0,
            releaseAtMs: spell.castSpec.charge!.maxDurationMs / 2,
          };
        }
      }
    }
  }

  private createSpellContext(spell: Spell): CastContext | undefined {
    const cursorWorld = this.cursorForSpell(spell);
    if (typeof this.game.createSpellContext === 'function') {
      return cursorWorld ? this.game.createSpellContext(spell, this, cursorWorld) : undefined;
    }
    const result = TargetResolver.resolve(spell.castSpec.targeting, {
      spellId: spell.id,
      activationId: uuidv4(),
      startedAtMs: Date.now(),
      caster: this,
      casterTeamId: this.teamId,
      origin: this.position,
      cursorWorld: cursorWorld ?? this.destination,
      ...spell.targetingRequest,
    });
    return result.ok ? result.context : undefined;
  }

  private cursorForSpell(spell: Spell): Vec2 | undefined {
    if (spell.castSpec.targeting !== 'UNIT') return this.destination;
    const request = spell.targetingRequest;
    const candidates = request.queryCandidates?.() ?? this.game.objectManager?.objects ?? [];
    let nearest: { point: Vec2; distance: number } | undefined;

    for (const candidate of candidates) {
      const info = request.getTargetInfo?.(candidate);
      if (!info || request.isTargetable?.(candidate) === false) continue;
      if (request.targetTeam === 'ENEMY' && info.teamId === this.teamId) continue;
      if (request.targetTeam === 'ALLY' && info.teamId !== this.teamId) continue;
      const distance = Math.hypot(info.position.x - this.position.x, info.position.y - this.position.y);
      if (request.range !== undefined && distance > request.range) continue;
      if (!nearest || distance < nearest.distance) nearest = { point: info.position, distance };
    }
    return nearest?.point;
  }

  moveToRandomLocation() {
    let x = random(this.game.mapSize);
    let y = random(this.game.mapSize);
    this.moveTo(x, y);
  }

  onCollideMapEdge() {
    super.onCollideMapEdge();
    if (this._autoMoveOnCollideMapEdge) this.moveToRandomLocation();
  }

  onCollideWall() {
    super.onCollideWall();
    if (this._autoMoveOnCollideWall) this.moveToRandomLocation();
  }

  takeDamage(damage: number, attacker: any) {
    super.takeDamage(damage, attacker);
    if (this._autoMoveOnTakeDamage) this.moveToRandomLocation();
  }

  respawn() {
    super.respawn();

    if (this._respawnWithNewPreset) {
      let newPreset = getChampionPresetRandom();
      this.avatar = AssetManager.getAsset(newPreset.avatar);
      this.replaceSpells(newPreset.spells.map((Spell: any) => new Spell(this)));
    }
  }
}
