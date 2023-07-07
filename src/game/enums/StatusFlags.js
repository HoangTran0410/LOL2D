const StatusFlags = {
  None: 0,
  // CallForHelpSuppressor: 1 << 0, // Gọi sự trợ giúp của đồng minh
  // CanAttack: 1 << 1, // Có thể đánh thường
  CanCast: 1 << 2, // Có thể dùng skill
  CanMove: 1 << 3, // Có thể di chuyển
  // CanMoveEver: 1 << 4, // Có thể di chuyển mãi mãi
  Charmed: 1 << 5, // Bị mê hoặc
  // DisableAmbientGold: 1 << 6, // Không nhận vàng
  // Disarmed: 1 << 7, // Không thể đánh thường
  Feared: 1 << 8, // Bị sợ hãi
  // ForceRenderParticles: 1 << 9, // Hiển thị hiệu ứng
  // GhostProof: 1 << 10, // Không thể đi xuyên địa hình
  Ghosted: 1 << 11, // Có thể đi xuyên địa hình
  // IgnoreCallForHelp: 1 << 12, // Bỏ qua sự trợ giúp của đồng minh
  Immovable: 1 << 13, // Không thể di chuyển
  Invulnerable: 1 << 14, // Bất khả xâm phạm
  // MagicImmune: 1 << 15, // Miễn nhiễm phép thuật
  NearSighted: 1 << 16, // Bị mờ mắt
  // Netted: 1 << 17, // Bị bắt bằng lưới
  NoRender: 1 << 18, // Không hiển thị
  // Pacified: 1 << 19, // Bị đánh mất khả năng tấn công
  // PhysicalImmune: 1 << 20, // Miễn nhiễm vật lý
  // RevealSpecificUnit: 1 << 21, // Hiện thị đối tượng cụ thể
  Rooted: 1 << 22, // Bị cầm chân
  Silenced: 1 << 23, // Bị câm lặng
  // Sleep: 1 << 24, // Bị ngủ
  Stealthed: 1 << 25, // Bị tàng hình
  Stunned: 1 << 26, // Bị choáng
  // SuppressCallForHelp: 1 << 27, // Không gọi sự trợ giúp
  Suppressed: 1 << 28, // Bị khống chế
  Targetable: 1 << 29, // Có thể bị nhắm mục tiêu
  // Taunted: 1 << 30, // Bị dụ dỗ

  // Các trạng thái khác
  InBush: 1 << 12, // Trong bụi cỏ
};

Object.freeze(StatusFlags);

export default StatusFlags;
