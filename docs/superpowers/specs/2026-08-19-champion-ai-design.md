# AI riêng từng tướng — lớp ý kiến chồng lên bộ não chung

Trạng thái: **design, chờ duyệt**. Nối tiếp
`2026-08-19-bot-brain-design.md`, giả định nhánh `feat/bot-brain` đã vào.

## Vấn đề

`BotBrain` chơi mọi tướng theo cùng một cách. Nó biết "chiêu này gây sát
thương, tầm 500, tốn 40 mana" và không biết Nasus cần farm Q lên lính, Anivia
đặt tường để **chặn đường** chứ không phải để trúng người, hay Ahri chỉ nên R
sau khi E đã trúng.

Nó cũng không có cách nào để *được bảo*. Mọi thứ nó biết về một chiêu đều đến
từ `inferRoles` đọc `castSpec` — và suy luận đó vừa gây ra một lỗi đắt trên
nhánh trước: `Zed_R` là `SELF` + tốn mana nên bị suy ra là `Buff | Shield`,
tức "chiêu tự vệ", trong khi thật ra nó khoá địch gần nhất và **nhảy ra sau
lưng**. Bot máu thấp đang chạy trốn đã ult thẳng vào mặt kẻ đuổi nó. Phải chữa
bằng hai guard chặn theo hình dạng (`ô ultimate`, `có khai tầm`) — chữa triệu
chứng, vì không có chỗ nào để nói sự thật.

## Điều đang xây, và điều KHÔNG xây

Một lớp **ý kiến**: `BotBrain` vẫn quyết định, nhưng ở mỗi điểm quyết định nó
hỏi tướng trước. Tướng trả lời, hoặc trả `undefined` nghĩa là "không có ý
kiến" và đáp án chung được dùng.

**Không xây: cơ chế khai báo vai trò chiêu.** Nó đã tồn tại. `Spell` có sẵn
`static aiRoles`, và `rolesOf` đọc `ctor.aiRoles ?? inferRoles(...)`
(`SpellRole.ts:92-107`). Bản nháp đầu của design này định cho `ChampionAI` một
bảng `roles` theo ô chiêu; **đó là sai**, vì bộ dựng kit tự chế
(`config/savedKits.ts`) cho phép nhét chiêu bất kỳ vào ô bất kỳ của tướng bất
kỳ, nên khoá theo ô sẽ áp override của Ahri lên R của Zed. Vai trò là thuộc
tính của **chiêu**, không phải của tướng:

```ts
// src/game/gameObject/spells/Zed_R.ts — làm được ngay hôm nay, không cần spec này
static aiRoles = roles(SpellRole.Damage, SpellRole.Dash, SpellRole.Cc);
```

Việc gắn tag cho roster là công việc riêng, làm dần, độc lập với tài liệu này.

## Kiến trúc

```
src/game/ai/champions/
  types.ts       ChampionAI, AIContext, SpellSituation
  registry.ts    registerChampionAI / championAIFor — đăng ký trùng tên NÉM LỖI
                 lúc nạp module, không im lặng ghi đè: hai file cùng khai
                 `champion: 'Nasus'` thì kết quả phụ thuộc thứ tự import, và đó
                 là loại lỗi không ai truy ra
  index.ts       import từng file tướng, để đăng ký chạy
  Nasus.ts       ví dụ đầu tiên
```

`BotBrain` mọc thêm đúng một field (`private ai?: ChampionAI`) và bốn lần gọi.

### `ChampionAI`

```ts
export interface ChampionAI {
  /** Khớp `Champion.name`, tức `preset.name`. Khoá của registry. */
  readonly champion: string;

  /** Chỉnh điểm một chiêu. `undefined` = giữ nguyên điểm chung. */
  scoreSpell?(context: AIContext, situation: SpellSituation): number | undefined;

  /** Ghi đè điểm ngắm. `undefined` = dùng `aimFor` chung. */
  aim?(context: AIContext, situation: SpellSituation): Vec2 | undefined;

  /** Ghi đè tư thế. `undefined` = giữ tư thế FSM vừa chọn. */
  posture?(context: AIContext, suggested: Posture): Posture | undefined;

  /** Gọi sau mỗi lần cast thành công. Chỗ ghi sổ combo. Không trả về gì. */
  onCast?(context: AIContext, situation: SpellSituation): void;
}

export interface AIContext {
  readonly brain: BotBrain;
  readonly owner: AIChampion;
  readonly view: TeamView;
  readonly nowMs: number;
  /** Bộ nhớ nháp của riêng bot này. Xoá khi hồi sinh. */
  readonly state: Record<string, unknown>;
}

export interface SpellSituation {
  readonly spell: Spell;
  readonly slotIndex: number;
  readonly mask: SpellRoleMask;
  readonly target: Champion | null;
  /** Điểm `BotBrain` vừa chấm, TRƯỚC khi nhân nhiễu. */
  readonly baseScore: number;
}
```

`baseScore` là điểm **trước** khi nhân `(1 + (rng*2-1) * noise)`. Tướng chỉnh
điểm gốc, còn nhiễu theo độ khó vẫn áp lên kết quả — nếu không, một tướng có
AI riêng sẽ vô tình miễn nhiễm với núm độ khó.

### Bốn điểm móc, ánh xạ vào code hiện có

| Móc | Gọi ở | Ngữ nghĩa |
|---|---|---|
| `scoreSpell` | `BotBrain.scoreSpell:537`, ngay TRƯỚC `return score * (1 + (rng*2-1) * noise)` | số trả về **thay thế** `score`, rồi nhiễu nhân lên kết quả đó |
| `aim` | đầu `BotBrain.aimFor` | trả điểm ngắm, hoặc `undefined` |
| `posture` | `BotBrain.evaluatePosture:304-306`, sau `decidePosture` và **trước** khi `this.posture` được gán | tư thế trả về là tư thế được gán; `undefined` giữ đáp án FSM |
| `onCast` | `BotBrain.cast`, sau khi `press()` trả `true` | chỉ ghi sổ |

Không móc nào được **thêm** một cast, một truy vấn, hay một lệnh di chuyển —
chúng chỉ trả lời câu hỏi `BotBrain` đang tự hỏi. Đó là thứ giữ cho mọi sửa
lỗi ở brain chung tiếp tục có lợi cho cả roster.

## Bốn kiểu chuyên biệt hoá, và cách viết chúng

| Kiểu | Móc | Ví dụ |
|---|---|---|
| Ưu tiên chiêu | `scoreSpell` | Nasus cộng điểm Q khi có lính máu thấp trong tầm |
| Cách ngắm | `aim` | Anivia đặt tường vuông góc đường chạy của địch |
| Combo | `onCast` ghi vào `state`, `scoreSpell` đọc ra | Ahri: `onCast` ghi `eHitAtMs`, `scoreSpell` cộng điểm R trong 2s sau đó |
| Thế trận | `posture` | Nasus ép `ROAM` khi stack < N và không bị đánh |

Combo **không** có máy trạng thái riêng. `state` là một `Record` phẳng, và
`onCast` + `scoreSpell` là đủ để diễn đạt "vừa làm X nên giờ ưu tiên Y". Một
máy trạng thái combo đầy đủ là thứ sẽ cần khi có bằng chứng rằng cách này
không đủ — chưa có.

## Cái bẫy: bot đổi tướng giữa trận

`AIChampion.respawn()` gọi `applyPreset(this.presetFactory())` khi
`_respawnWithNewPreset` bật — **mặc định bật** (`AIChampion.ts:218`), và
`applyPreset` ghi đè `this.name` (`Champion.ts:165`). Nên một bot có thể là
Nasus ở mạng này và Ahri ở mạng sau.

Hệ quả bắt buộc:

1. **Không được tra registry một lần lúc khởi tạo.** `BotBrain` nhớ tên đã tra
   lần cuối và tra lại khi `owner.name` khác nó. Một phép so chuỗi mỗi think
   tick, không phải mỗi frame.
2. **`state` phải bị xoá khi tướng đổi**, không chỉ khi chết. Cờ combo của
   Nasus mà còn sót khi đã thành Ahri là dữ liệu rác đọc được.

Đây là loại lỗi chỉ hiện ra sau lần chết đầu tiên, và repo này đã bị đúng hình
dạng đó một lần rồi — Nasus mất sạch stack khi người chơi đổi chiêu W, ghi
trong doc của `Champion.applyPreset`.

## Ràng buộc cứng

- **Không đăng ký tướng nào ⇒ hành vi giống hệt hôm nay.** Không phải "gần
  giống". Phải có test chứng minh, vì đó là thứ cho phép thêm dần từng tướng
  mà không sợ vỡ phần còn lại.
- **`src/game/ai/` vẫn không được gọi global p5.** Thời gian vào qua `nowMs`,
  ngẫu nhiên qua `rng`. File tướng nằm trong `src/game/ai/champions/` nên chịu
  chung luật. Đã kiểm, không đoán: `bot-aim-seam.test.ts` dựng danh sách bằng
  `filesUnder`, hàm này **có đệ quy vào thư mục con** (dòng 18), nên
  `champions/` bị quét tự động. **Nhưng** chốt chặn "đủ module" thêm ở vòng sửa
  cuối đọc `readdirSync(AI_DIRECTORY)` **một tầng** (dòng 37), nên nó thấy
  `champions` như một mục thư mục chứ không thấy các file bên trong. Plan phải
  mở rộng chốt chặn đó xuống thư mục con, kèm một test chứng minh: bỏ một file
  tướng ra khỏi danh sách quét thì chốt chặn phải đỏ.
- **Một `ChampionAI` không được ném lỗi làm chết vòng lặp game.** Mỗi lần gọi
  bọc trong `try/catch`, log một lần rồi vô hiệu hoá `ChampionAI` đó cho phần
  còn lại của trận. Một tướng viết hỏng làm hỏng chính nó, không làm treo trận.
- **Chi phí:** bốn phép gọi method mỗi think tick (4 lần/giây/bot) khi có đăng
  ký, và một phép so chuỗi khi không. Không truy vấn nào thêm.

## Kiểm thử

| Test | Khẳng định |
|---|---|
| `championAI.fallback.test.ts` | với registry rỗng, `scoreSpell`/`aimFor`/`evaluatePosture` trả **đúng** giá trị như trước khi có lớp này |
| `championAI.registry.test.ts` | tra theo `Champion.name`; tên lạ trả `undefined` |
| `championAI.respawn.test.ts` | bot đổi tướng giữa trận thì tra lại registry **và** `state` bị xoá — chứng minh fail khi cache theo constructor |
| `championAI.hooks.test.ts` | mỗi móc thật sự thay được đáp án, và `undefined` thật sự rơi về đáp án chung |
| `championAI.noise.test.ts` | điểm tướng trả về **vẫn** bị nhân nhiễu theo độ khó |
| `championAI.isolation.test.ts` | `ChampionAI` ném lỗi thì bot vẫn chạy, và AI đó bị tắt |
| `Nasus.test.ts` | ví dụ đầu tiên, hành vi thật |

**Mọi test phải chứng minh được là fail trước.** Nhánh trước sinh ra mười hai
lỗi và **mười một** nằm ở code test, nên với mỗi test hãy nói ra: sửa gì trong
implementation thì nó đỏ?

## Ví dụ đầu tiên: Nasus

Chọn Nasus vì nó dùng **ba** trong bốn móc, nên nó chứng minh interface đủ dùng
chứ không chỉ chạy được:

```ts
registerChampionAI({
  champion: 'Nasus',
  posture: (c, suggested) =>
    suggested === 'ROAM' || c.brain.stacksLow() ? 'ROAM' : undefined,
  scoreSpell: (c, s) =>
    s.slotIndex === 1 && c.brain.minionKillableWithQ(s.spell)
      ? s.baseScore + NASUS_FARM_BONUS
      : undefined,
  onCast: (c, s) => {
    if (s.slotIndex === 1) c.state.lastQAtMs = c.nowMs;
  },
});
```

`NASUS_FARM_BONUS` xuất từ chính file Nasus, khởi điểm 25 — đủ thắng một chiêu
Damage 10, không đủ thắng một Escape lúc rút lui.

**Hai helper `stacksLow`/`minionKillableWithQ` sống trong file Nasus, không phải
trên `BotBrain`.** Đây là ranh giới của cả thiết kế: brain chung không được mọc
kiến thức về từng tướng, nếu không thì lớp này vô nghĩa và ta chỉ đang dời cùng
một mớ if/else sang chỗ khác. Một helper cần dữ liệu brain chung chưa phơi ra
thì **`AIContext` mọc thêm field** — có kiểm soát, dùng chung cho mọi tướng —
chứ không phải `BotBrain` mọc thêm method mang tên một tướng.

## Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Móc trở thành cửa sau để viết lại brain | Bốn móc, cố định, không móc nào thêm được cast/truy vấn/lệnh đi |
| File tướng phình thành bản sao `BotBrain` | Ví dụ đầu tiên chỉ 12 dòng; nếu một tướng cần hơn 100 dòng, đó là tín hiệu brain chung thiếu thứ gì đó |
| Đổi tướng giữa trận | Mục riêng ở trên, cộng một test dành riêng |
| Một tướng viết hỏng làm treo trận | `try/catch` + tự vô hiệu hoá |
| Người viết tướng vô tình bỏ qua độ khó | `baseScore` là điểm trước nhiễu; nhiễu vẫn áp sau |
