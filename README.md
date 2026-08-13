# Liên Minh Huyền Thoại - 2D (Fan-made)

[![Build](https://github.com/HoangTran0410/LOL2D/actions/workflows/build.yml/badge.svg)](https://github.com/HoangTran0410/LOL2D/actions/workflows/build.yml)
[![Hits](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2FHoangTran0410%2FLOL2D&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=views&edge_flat=true)](https://hits.seeyoufarm.com)

Test tướng Liên Minh Huyền Thoại ngay trên trình duyệt — bản đồ Summoner's Rift 2D, hơn 30 tướng, đánh nhau với bot, đổi chiêu tuỳ ý giữa trận.

**[▶ Chơi Ngay](https://hoangtran0410.github.io/LOL2D)**

![Screenshot](/assets/images/screenshots/Screenshot_1.jpg)

![Screenshot](/assets/images/screenshots/Screenshot_4.jpg)

![Screenshot](/assets/images/screenshots/Screenshot_3.jpg)

## Mục lục

- [Giới thiệu](#giới-thiệu)
- [Cách chơi](#cách-chơi)
- [Bắt đầu](#bắt-đầu)
- [Các lệnh npm](#các-lệnh-npm)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Kiến trúc](#kiến-trúc)
- [Tài nguyên và dữ liệu chiêu thức](#tài-nguyên-và-dữ-liệu-chiêu-thức)
- [Kiểm thử](#kiểm-thử)
- [Đóng góp](#đóng-góp)
- [Miễn trừ trách nhiệm](#miễn-trừ-trách-nhiệm)

## Giới thiệu

Đây là một trò chơi fan-made, indie dựa trên [Liên Minh Huyền Thoại](https://www.leagueoflegends.com/) của [Riot Games](https://www.riotgames.com/en). Dự án chạy hoàn toàn trong trình duyệt: [p5.js](https://p5js.org/) lo phần vẽ canvas, [Vue 3](https://vuejs.org/) lo phần HUD, tất cả viết bằng TypeScript và đóng gói bằng [Vite](https://vitejs.dev/).

Có gì trong game:

- **30+ bộ chiêu thức** dựng lại từ tướng LMHT thật — kỹ năng định hướng, kỹ năng tích lực, kỹ năng kênh, kỹ năng tái kích hoạt, khiên, hồi máu, và đủ loại hiệu ứng khống chế.
- **Đổi chiêu ngay giữa trận**, kể cả chế độ *One For All* để cả bàn cùng dùng một chiêu.
- **Bot đối kháng**, quái rừng, bệ đá cổ hồi máu, và trụ.
- **Sương mù trận địa** dựng bằng thuật toán đa giác tầm nhìn, có bụi cây và tường chắn tầm nhìn thật sự.

## Cách chơi

| Thao tác | Phím |
| --- | --- |
| Di chuyển | Chuột phải |
| Chiêu thức | `A` `Q` `W` `E` `R` |
| Phép bổ trợ | `D` `F` |
| Bật/tắt camera bám nhân vật | `Space` |
| Về menu | `Esc` |

Giữ chuột với các chiêu tích lực (Varus Q, Pantheon Q) — thả ra để bắn.

## Bắt đầu

Cần [Node.js](https://nodejs.org/) 20 trở lên.

```bash
git clone https://github.com/HoangTran0410/LOL2D.git
cd LOL2D
npm install
npm run dev
```

Mở đường dẫn Vite in ra (mặc định http://localhost:5173).

> `npm run dev` tự chạy `assets:generate` trước, nên danh sách tài nguyên luôn khớp với thư mục `assets/` mà không cần làm gì thêm.

Build bản phát hành:

```bash
npm run build     # xuất ra dist/
npm run preview   # chạy thử bản đã build
```

## Các lệnh npm

| Lệnh | Công dụng |
| --- | --- |
| `npm run dev` | Chạy dev server (kèm hot reload) |
| `npm run build` | Build bản phát hành vào `dist/` |
| `npm run preview` | Chạy thử bản đã build |
| `npm test` | Chạy toàn bộ unit test một lần |
| `npm run test:watch` | Chạy test ở chế độ theo dõi |
| `npm run typecheck` | Kiểm tra kiểu toàn dự án |
| `npm run typecheck:core` | Kiểm tra kiểu nghiêm ngặt cho phần lõi |
| `npm run verify` | **Chạy tất cả những thứ trên** — bắt buộc trước khi gửi PR |
| `npm run assets:generate` | Sinh lại danh sách tài nguyên từ thư mục `assets/` |
| `npm run assets:check` | Báo lỗi nếu danh sách tài nguyên đã lỗi thời |
| `npm run ability:import` | Tải dữ liệu chiêu thức mới từ LoL Wiki |
| `npm run ability:check` | Kiểm tra tính hợp lệ của dữ liệu chiêu thức |
| `npm run e2e` | Mở game thật trong Chrome bằng Playwright và chụp màn hình |

## Cấu trúc dự án

```
src/
├── main.ts               # điểm vào, khởi tạo p5 và SceneManager
├── scenes/               # LoadingScene → MenuScene → GameScene
├── game/
│   ├── Game.ts           # vòng lặp chính, sở hữu camera/objectManager/bản đồ
│   ├── preset.ts         # bộ chiêu từng tướng, vị trí quái rừng, trụ, bệ đá
│   ├── gameObject/
│   │   ├── attackableUnits/  # Champion, AIChampion, Monster
│   │   ├── spells/           # mỗi chiêu một file: Ahri_Q.ts, Yasuo_R.ts, ...
│   │   ├── spellObjects/     # lớp cơ sở: Missile, Area, Beam, HomingMissile
│   │   ├── buffs/            # Stun, Slow, Shield, Invisible, ...
│   │   ├── structures/       # Turret, Fountain
│   │   └── map/              # TerrainMap, FogOfWar, Camera, Obstacle
│   ├── spell/runtime/    # máy trạng thái vòng đời chiêu thức
│   ├── hud/              # HUD viết bằng Vue
│   └── managers/         # ObjectManager (quadtree), EventManager
├── managers/             # AssetManager, SceneManager
└── generated/            # danh sách tài nguyên do script sinh ra — đừng sửa tay
```

## Kiến trúc

**Vòng đời chiêu thức.** Mỗi chiêu khai báo một `castSpec` mô tả nó hoạt động thế nào — bấm phát ăn ngay, giữ rồi thả, kênh, hay tái kích hoạt — rồi `SpellRuntime` chạy máy trạng thái `READY → CASTING/CHARGING → ACTIVE → COOLDOWN`, lo luôn phần trừ mana, hoàn mana khi bị ngắt, và các sự kiện ngắt (chết, choáng, câm lặng, bị đẩy). Chiêu chỉ cần cài các hook `onCastStart` / `onRelease` / `onSpellCast`.

**Đối tượng chiêu thức.** Đạn bay kế thừa `MissileSpellObject`, hiệu ứng vùng kế thừa `AreaSpellObject`, đường thẳng dùng `BeamSpellObject` (chỉ dò va chạm, **không tự vẽ** — phải tự kế thừa và viết `draw()`).

**Va chạm và truy vấn.** `ObjectManager` giữ một quadtree dựng lại mỗi frame; mọi tìm kiếm mục tiêu đều đi qua `queryObjects({ area, filters })` với các bộ lọc dựng sẵn trong `PredefinedFilters`.

**Hiệu ứng khống chế.** Buff bật/tắt cờ trong `StatusFlags`, rồi hệ thống quy ra `ActionState` (đi được / đánh được / bị nhắm được).

Chi tiết đầy đủ nằm trong [`docs/ADDING_SPELLS.md`](./docs/ADDING_SPELLS.md) — **đọc file này trước khi viết chiêu mới**. Nó nói rõ ba chỗ phải đăng ký chiêu, quy tắc bắt buộc về `stackId` của buff, và những cái bẫy mà `tsc` không bắt được.

## Tài nguyên và dữ liệu chiêu thức

Ảnh và JSON nằm trong `assets/`. `npm run assets:generate` quét thư mục đó rồi sinh ra `src/generated/assetManifest.ts` với kiểu `AssetKey` — nhờ vậy gõ sai tên tài nguyên là lỗi biên dịch chứ không phải ảnh vỡ lúc chạy. Thêm ảnh mới thì chỉ cần bỏ file vào đúng thư mục rồi chạy lại lệnh đó.

Dữ liệu chiêu thức (sát thương, thời gian hồi, tầm, icon) được nhập từ [LoL Wiki](https://wiki.leagueoflegends.com/) bằng `scripts/wiki/import-abilities.mjs`, lưu vào `docs/abilities/<tướng>/<chiêu>.json`, kèm nguồn gốc trong `assets/source-manifest.json`.

```bash
npm run ability:import -- --champions Ahri,Zed --slots Q,W,E,R
npm run ability:check
```

Ngoài ra trong `tools/` có [shape-maker](./tools/shape-maker/) — công cụ p5 độc lập để vẽ dữ liệu đa giác cho bản đồ.

## Kiểm thử

**Unit test** chạy bằng Vitest, không cần trình duyệt: mọi hàm vẽ của p5 đều được thay bằng spy, nên test chứng minh được một chiêu *yêu cầu* vẽ những hình gì và logic của nó ra sao.

```bash
npm test
npx vitest run tests/game/spells/Varus_Q.test.ts   # chạy một file
```

Quy ước ở đây: **giá trị cân bằng được export thành hằng số từ chính file chiêu, test import vào dùng.** Test kiểm tra dây nối, không chép lại con số — đổi sát thương thì không phải sửa test.

**E2E** dùng Playwright điều khiển Chrome thật, vì unit test không chứng minh được game có chạy và vẽ ra hình hay không:

```bash
npx vite --port 5199 --strictPort   # ở một cửa sổ terminal khác
npm run e2e
```

Các script trong `tests/e2e/` chạm được vào game đang chạy qua `window.__lol2d` (chỉ tồn tại ở bản dev).

## Đóng góp

Rất hoan nghênh — dưới đây là những gì cần biết:

1. **Fork rồi tạo nhánh** từ `main`.
2. **Chạy `npm run verify` trước khi gửi PR.** Lệnh này chạy đúng những gì CI chạy: kiểm tra tài nguyên, kiểm tra dữ liệu chiêu, kiểm tra kiểu (cả hai mức), toàn bộ test, và build. Đây là toàn bộ phần kiểm tra offline của repo.
3. **Thêm chiêu mới** thì đọc [`docs/ADDING_SPELLS.md`](./docs/ADDING_SPELLS.md) trước. Có ba chỗ phải đăng ký, quên một chỗ là chiêu không xuất hiện.
4. **Kèm test.** Mỗi chiêu nên có một file trong `tests/game/spells/`. Export hằng số ra khỏi file chiêu rồi import vào test thay vì chép số.
5. **Xem bằng mắt.** Nếu thay đổi có phần hiển thị, mở game thật lên nhìn — hoặc viết một script trong `tests/e2e/`. Test khẳng định `draw()` được gọi không chứng minh được nó *trông* ra sao.
6. **Định dạng code** theo Prettier (`.prettierrc`: 2 dấu cách, nháy đơn, dấu phẩy cuối, dòng dài tối đa 100).
7. **Comment giải thích *tại sao*, không phải *cái gì*.** Ưu tiên ghi lại lý do một cách làm được chọn, hoặc cái bẫy nào đã khiến nó phải viết như vậy.

## Miễn trừ trách nhiệm

Đây là dự án phi thương mại do fan làm, **không liên quan và không được [Riot Games](https://www.riotgames.com/en) tài trợ**. Game miễn phí hoàn toàn và không tạo ra doanh thu, chỉ nhằm mục đích giải trí.

[Liên Minh Huyền Thoại](https://www.leagueoflegends.com/) cùng toàn bộ nhãn hiệu, nhân vật, hình ảnh và tài sản liên quan là tài sản của [Riot Games](https://www.riotgames.com/en). Dự án này không khẳng định sở hữu bất kỳ quyền nào đối với các tài sản trí tuệ đó.

## Hỗ trợ ngôn ngữ

README có sẵn bằng [Tiếng Anh](./README-en.md) và [Tiếng Việt](./README.md).
