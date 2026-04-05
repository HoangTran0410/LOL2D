const StatusFlags = {
  None: 0,
  CanCast: 1 << 2,
  CanMove: 1 << 3,
  Charmed: 1 << 5,
  Feared: 1 << 8,
  Ghosted: 1 << 11,
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
