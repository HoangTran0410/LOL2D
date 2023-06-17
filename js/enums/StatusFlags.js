const StatusFlags = {
  None: 0,
  CanMove: 1 << 0, // có thể di chuyển?
  CanCast: 1 << 1, // có thể dùng chiêu?
  NoRender: 1 << 2, // không hiển thị?
  Stealthed: 1 << 3, // tàng hình
  Stunned: 1 << 4, // bị choáng
  Targetable: 1 << 5, // có thể bị nhắm mục tiêu
  NearSighted: 1 << 6, // bị mờ mắt (chỉ có thể nhìn thấy phạm vi gần)
  Invulnerable: 1 << 7, // bất khả xâm phạm (không nhận sát thương)
};

Object.freeze(StatusFlags);

export default StatusFlags;
