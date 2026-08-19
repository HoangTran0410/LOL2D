/**
 * "Có gì mới" — the player-facing changelog shown on the About screen
 * (`AboutScene.vue`). This is the one file meant to be edited by hand,
 * including by someone who does not otherwise read this codebase.
 *
 * **To add a release**: insert a new object at the *top* of `CHANGELOG`
 * below (newest first) with a `date`, a short `title`, and a few
 * `highlights` — one short sentence each, one idea each, describing what a
 * player would actually notice. Two unrelated changes are two highlights,
 * never one sentence joined by a dash or a semicolon. Nothing else in the
 * app needs to change; `AboutScene.vue` just renders the array in order.
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
  /** One short sentence each, one idea each, no jargon. */
  highlights: string[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    date: '19/08/2026',
    title: 'Đấu theo đội, bot biết chơi lane',
    highlights: [
      'Trận đấu chia phe Xanh và Đỏ, đánh theo 3 đường trên/giữa/dưới.',
      'Lính ra từng đợt, trụ bảo vệ lính phe mình.',
      'Rừng có quái trung lập để farm.',
      'Bot viết lại: đi đúng đường, cày lính, đẩy trụ, né đòn tốt hơn.',
      'Chọn được độ khó của bot.',
      'Đội hình, luật chơi và cheat gộp vào một bảng.',
      'Mở bảng đó ở menu hoặc giữa trận bằng Esc.',
      'Hết kẹt ở góc tường phép (tường băng, hố sụt).',
      'Đồng minh hiện đúng chỗ trên minimap dù ở xa.',
      'Camera bám tướng và zoom mượt hơn.',
      'Thêm đồng hồ FPS trong tab Cài đặt.',
      'Cân bằng lại mana toàn bộ tướng.',
      'Làm lại kỹ năng W của Shaco.',
    ],
  },
  {
    date: '17–18/08/2026',
    title: 'Cài được như ứng dụng, vào trận nhanh hơn',
    highlights: [
      'Cài được lên máy như ứng dụng thật (PWA).',
      'Sau lần chơi đầu, chơi được cả khi mất mạng.',
      'Vào trận nhanh hơn: chỉ tải những tướng có trong trận.',
      'Có màn hình chờ riêng lúc tải.',
      'Thêm 10 tướng mới.',
    ],
  },
  {
    date: '13/08/2026',
    title: 'Lính đánh theo 3 đường',
    highlights: [
      'Thêm 3 đường lính trên/giữa/dưới, tự đánh lính địch.',
      'Lính ra từng đợt, 30 giây một đợt.',
      'Trụ phòng thủ lính trên đường của mình.',
    ],
  },
];
