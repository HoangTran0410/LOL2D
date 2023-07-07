const ActionState = {
  //   CAN_ATTACK: 1 << 0, // Có thể đánh thường
  CAN_CAST: 1 << 1, // Có thể dùng skill
  CAN_MOVE: 1 << 2, // Có thể di chuyển
  //   CAN_NOT_MOVE: 1 << 3, // Không thể di chuyển?
  STEALTHED: 1 << 4, // Tàng hình
  //   REVEAL_SPECIFIC_UNIT: 1 << 5, // Hiện thị đối tượng cụ thể
  //   TAUNTED: 1 << 6, // Bị dụ dỗ
  FEARED: 1 << 7, // Bị sợ hãi
  //   IS_FLEEING: 1 << 8, // Đang bỏ chạy?
  //   CAN_NOT_ATTACK: 1 << 9, // Không thể đánh thường
  //   IS_ASLEEP: 1 << 10, // Bị ngủ
  IS_NEAR_SIGHTED: 1 << 11, // Bị mờ mắt
  IS_GHOSTED: 1 << 12, // Có thể đi xuyên địa hình
  CHARMED: 1 << 15, // Bị mê hoặc
  NO_RENDER: 1 << 16, // Không hiển thị
  //   FORCE_RENDER_PARTICLES: 1 << 17, // Hiển thị hiệu ứng

  TARGETABLE: 1 << 23, // Có thể bị nhắm mục tiêu
};

Object.freeze(ActionState);

export default ActionState;
