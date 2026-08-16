const ActionState = {
  CAN_CAST: 1 << 1,
  CAN_MOVE: 1 << 2,
  CAN_ATTACK: 1 << 3,
  STEALTHED: 1 << 4,
  GROUNDED: 1 << 5,
  FEARED: 1 << 7,
  IS_NEAR_SIGHTED: 1 << 11,
  IS_GHOSTED: 1 << 12,
  /** Walks through bodies; terrain still applies. See StatusFlags.PhasesUnits. */
  PHASES_UNITS: 1 << 24,
  CHARMED: 1 << 15,
  TAUNTED: 1 << 6,
  NO_RENDER: 1 << 16,
  TARGETABLE: 1 << 23,
};
Object.freeze(ActionState);
export default ActionState as typeof ActionState;
