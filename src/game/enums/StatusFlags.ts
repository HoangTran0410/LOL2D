const StatusFlags = {
  None: 0,
  // Bit 1 is the slot League reserves for the attack permission, so the disarm
  // concept keeps living on the attack bit even though this list states crowd
  // control positively (Stunned, Rooted, Silenced) rather than as permissions.
  Disarmed: 1 << 1,
  CanCast: 1 << 2,
  CanMove: 1 << 3,
  Charmed: 1 << 5,
  Feared: 1 << 8,
  Ghosted: 1 << 11,
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
