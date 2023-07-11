const EventType = {
  ON_DIE: 'onUnitDie',
  ON_ATTACK: 'onUnitAttack',
  ON_TAKE_DAMAGE: 'onUnitTakeDamage',
  ON_HEAL: 'onUnitHeal',
  ON_BUFF_ADD: 'onUnitBuffAdd',
  ON_BUFF_REMOVE: 'onUnitBuffRemove',
  ON_CAST_SPELL: 'onUnitCastSpell',
};

Object.freeze(EventType);
export default EventType;

/*
[OnActivate] - buffs and spells (always performed)
[OnAddPAR]
[OnAllowAddBuff]
[OnAssist]
[OnAssistUnit]
[OnBeingDodged]
[OnBeingHit]
[OnBeingSpellHit]
[OnCanCast]
[OnCollision]
[OnCollisionTerrain]
[OnDeactivate] - buffs and spells (always performed)
[OnDealDamage]
[OnDeath]
[OnDisconnect]
[OnDodge]
[OnHeal]
[OnHitUnit]
[OnKill]
[OnKillUnit]
[OnLaunchAttack]
[OnLaunchMissile]
[OnLevelUp]
[OnLevelUpSpell]
[OnMiss]
[OnMissileEnd]
[OnMissileUpdate]
[OnMoveEnd]
[OnMoveFailure]
[OnMoveSuccess]
[OnNearbyDeath]
[OnPreAttack]
[OnPreDamage]
[OnPreDealDamage]
[OnPreMitigationDamage]
[OnPreTakeDamage]
[OnReconnect]
[OnResurrect]
[OnSpellCast] - start casting
[OnSpellChannel] - start channeling
[OnSpellChannelCancel] - abrupt stop channeling
[OnSpellPostCast] - finish casting
[OnSpellPostChannel] - finish channeling
[OnSpellPreCast] - setup cast info before casting (always performed)
[OnSpellHit] - "ApplyEffects" function in Spell.
[OnTakeDamage]
[OnUpdateActions] - move order probably
[OnUpdateAmmo]
[OnUpdateStats]
[OnZombie] */
