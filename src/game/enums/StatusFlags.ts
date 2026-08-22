const StatusFlags = {
  None: 0,
  // Bit 1 is the slot League reserves for the attack permission, so the disarm
  // concept keeps living on the attack bit even though this list states crowd
  // control positively (Stunned, Rooted, Silenced) rather than as permissions.
  Disarmed: 1 << 1,
  CanCast: 1 << 2,
  CanMove: 1 << 3,
  Charmed: 1 << 5,
  /**
   * Forced to attack whoever applied it. Deliberately does NOT clear
   * `CAN_ATTACK` or `CAN_MOVE` the way every other control effect does — a
   * taunt *directs* the swings and the walking, it does not stop them. Casting
   * is the only thing it takes away. See `Stats.updateActionState`.
   */
  Taunted: 1 << 6,
  Feared: 1 << 8,
  /**
   * Passes through everything: bodies AND terrain. Right for a dash, which is
   * short and ends on a point already chosen; wrong for anything that lasts,
   * because a unit that can stand inside a wall can leave the map.
   */
  Ghosted: 1 << 11,
  /**
   * Passes through *bodies only* — terrain still stops it. The one a sustained
   * effect wants: a spin attack ploughing through a wave, a summoner spell's
   * phasing shouldering past, a rolling ultimate ploughing through. Split out
   * of `Ghosted` because that flag also disables the wall push-out, and a
   * three-second spin with it on lets the spinning champion
   * walk out of the world.
   */
  PhasesUnits: 1 << 30,
  Grounded: 1 << 9,
  Immovable: 1 << 13,
  Invulnerable: 1 << 14,
  NearSighted: 1 << 16,
  NoRender: 1 << 18,
  Rooted: 1 << 22,
  Silenced: 1 << 23,
  Stealthed: 1 << 25,
  Stunned: 1 << 26,
  Suppressed: 1 << 28,
  Targetable: 1 << 29,
  InBush: 1 << 12,
};
Object.freeze(StatusFlags);
export default StatusFlags as typeof StatusFlags;
