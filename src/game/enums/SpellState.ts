const SpellState = {
  READY: 'READY',
  CASTING: 'CASTING',
  CHARGING: 'CHARGING',
  COOLDOWN: 'COOLDOWN',
  CHANNELING: 'CHANNELING',
  ACTIVE: 'ACTIVE',
} as const;
Object.freeze(SpellState);
export default SpellState as typeof SpellState;
