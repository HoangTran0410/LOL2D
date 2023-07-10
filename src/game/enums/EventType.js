const EventType = {
  ON_UNIT_DIE: 'onUnitDie',
  ON_UNIT_ATTACK: 'onUnitAttack',
  ON_UNIT_TAKE_DAMAGE: 'onUnitTakeDamage',
  ON_UNIT_HEAL: 'onUnitHeal',
  ON_UNIT_BUFF_ADD: 'onUnitBuffAdd',
  ON_UNIT_BUFF_REMOVE: 'onUnitBuffRemove',
  ON_UNIT_CAST_SPELL: 'onUnitCastSpell',
};

Object.freeze(EventType);
export default EventType;
