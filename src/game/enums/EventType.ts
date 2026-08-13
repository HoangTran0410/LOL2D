const EventType = {
  ON_DIE: 'onUnitDie',
  /** A basic attack has just been launched. Payload: the attacking unit. */
  ON_ATTACK: 'onUnitAttack',
  /** A basic attack has just landed. Payload: BasicAttackHit. */
  ON_ATTACK_HIT: 'onUnitAttackHit',
  ON_TAKE_DAMAGE: 'onUnitTakeDamage',
  ON_HEAL: 'onUnitHeal',
  ON_BUFF_ADD: 'onUnitBuffAdd',
  ON_BUFF_REMOVE: 'onUnitBuffRemove',
  ON_PRE_CAST_SPELL: 'onUnitPreCastSpell',
  ON_POST_CAST_SPELL: 'onUnitCastSpell',
};
Object.freeze(EventType);
export default EventType as typeof EventType;
