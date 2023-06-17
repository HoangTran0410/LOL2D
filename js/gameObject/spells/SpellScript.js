export default class SpellScript {
  onActivate(owner, spell) {}

  onDeactivate(owner, spell) {}

  onSpellPreCast(owner, spell, target, start, end) {}

  onSpellCast(spell) {}

  onSpellPostCast(spell) {}

  onSpellChannel(spell) {}

  onSpellChannelCancel(spell, channelingStopReason) {}

  onSpellPostChannel(spell) {}

  onUpdate() {}
}
