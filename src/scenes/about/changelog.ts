/**
 * "Có gì mới" — the player-facing changelog shown on the About screen
 * (`AboutScene.vue`). This is the one file meant to be edited by hand,
 * including by someone who does not otherwise read this codebase.
 *
 * **To add a release**: insert a new object at the *top* of `CHANGELOG`
 * below (newest first) with a `date`, a short `title`, and a few
 * `highlights` — one sentence each, describing what a player would actually
 * notice. Nothing else in the app needs to change; `AboutScene.vue` just
 * renders the array in order.
 *
 * **Write for a player, not for a developer.** "bot biết đi lane và đẩy trụ"
 * is a highlight; "refactored TeamBlackboard" is not — the reader has never
 * opened `src/game/ai/` and never should need to.
 * `tests/scenes/aboutContent.test.ts` scans every entry for the internal
 * class and module names that tend to leak in here, and fails the build if
 * one does.
 */
export interface ChangelogRelease {
  /** Vietnamese, `dd/mm/yyyy`, shown next to the title. */
  date: string;
  /** Short, player-facing name for this batch of changes. */
  title: string;
  /** One sentence each, no jargon — what a player would actually notice. */
  highlights: string[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    date: '19/08/2026',
    title: 'Đấu theo đội, bot biết chơi lane, gộp bảng cấu hình trận đấu',
    highlights: [
      'Trận đấu giờ chia phe Xanh và Đỏ, mỗi bên đi theo 3 đường (trên/giữa/dưới) với lính đẩy theo từng đợt, quái rừng trung lập để farm, và trụ tự động bảo vệ lính đồng minh.',
      'Bot đối thủ được viết lại gần như từ đầu: biết đi đúng đường, cày lính, đẩy trụ, né đòn hợp lý hơn và chơi ở nhiều mức độ khó khác nhau.',
      'Gộp hai bảng cài đặt trận đấu thành một: chỉnh đội hình, luật chơi và mọi cheat từ cùng một chỗ — mở được cả ở menu lẫn giữa trận (phím Esc).',
      'Sửa lỗi tường phép thuật (tường băng, hố sụt...) khiến người chơi bị kẹt ở góc tường; đồng minh giờ hiện đúng vị trí trên minimap kể cả khi bạn không đứng cạnh họ.',
      'Camera mượt hơn khi đi theo tướng và khi zoom; thêm đồng hồ đo FPS trong tab Cài đặt cho ai muốn theo dõi hiệu năng.',
      'Cân bằng lại chi phí mana trên toàn bộ tướng, và làm lại kỹ năng W của Shaco.',
    ],
  },
  {
    date: '17–18/08/2026',
    title: 'Cài đặt được như một ứng dụng, vào trận nhanh hơn',
    highlights: [
      'LOL2D giờ cài được lên máy như một ứng dụng thật (PWA) và chơi được cả khi mất mạng, sau lần cài đặt đầu tiên.',
      'Vào trận chỉ tải kỹ năng và hình ảnh của những tướng có mặt trong trận đó, thay vì toàn bộ kỹ năng của mọi tướng cùng lúc — vào trận nhanh hơn hẳn, có màn hình chờ riêng.',
      'Thêm 10 tướng mới vào danh sách lựa chọn.',
    ],
  },
  {
    date: '13/08/2026',
    title: 'Lính đánh theo 3 đường',
    highlights: [
      'Thêm 3 đường lính (trên/giữa/dưới) đi theo bản đồ và tự giao tranh với lính địch.',
      'Lính xuất hiện theo từng đợt, 30 giây một đợt; trụ tự động phòng thủ lính trên đường của chính mình.',
    ],
  },
];
