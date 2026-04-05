const ActionState = {
  CAN_CAST: 1 << 1,
  CAN_MOVE: 1 << 2,
  STEALTHED: 1 << 4,
  FEARED: 1 << 7,
  IS_NEAR_SIGHTED: 1 << 11,
  IS_GHOSTED: 1 << 12,
  CHARMED: 1 << 15,
  NO_RENDER: 1 << 16,
  TARGETABLE: 1 << 23,
};
Object.freeze(ActionState);
export default ActionState as typeof ActionState;
