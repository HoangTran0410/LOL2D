# Bộ não bot — FSM tư thế, chấm điểm chiêu, đoán đường đạn

Trạng thái: **design đã duyệt, chờ plan**. Phạm vi pass này là **logic**; UI
và persistence để sau (xem §10).

## Vấn đề

`AIChampion` hôm nay ra quyết định ở đúng ba chỗ, và cả ba đều sai:

1. **`aimPoint()` (AIChampion.ts:224-227)** trả về `this.game.worldMouse` —
   con trỏ của *người chơi*. Trên mobile `worldMouse` là điểm ngón tay đang
   chạm, tức cụm nút điều khiển, nên mọi bot bắn vào nút bấm ở góc màn hình.
2. **`update()` (AIChampion.ts:126)** — `if (random() < 0.1)` mỗi frame, chọn
   `spells[floor(random(length))]`. Khoảng 6 lần thử cast mỗi giây, chiêu chọn
   hoàn toàn ngẫu nhiên, không đọc `isCastableNow`, không biết mana còn bao
   nhiêu. Đây là nguyên nhân "cụt tay": bot tiêu sạch mana vào chiêu vặt trong
   mười giây đầu rồi đứng nhìn.
3. **Không có tầng team.** `teamId` chỉ dùng để lọc mục tiêu. Bot không biết
   đồng đội đang đánh ai, không biết mình đang bị áp đảo, và
   `moveToRandomLocation()` rải chúng khắp bản đồ nên giao tranh luôn là 1v1
   rời rạc.

Một điểm phải giữ, và nó tinh tế: con trỏ chuột **vô tình** là cơ chế *lead
the target*. Người chơi right-click để di chuyển, nên con trỏ gần như luôn nằm
phía trước hướng đi. Bot bắn vào con trỏ = bot bắn đón đầu. Thay nó bằng "ngắm
thẳng vào người" sẽ làm bot **yếu đi**. Thứ thay thế phải là đoán điểm chạm
thật sự (§3).

## Điều đang xây

Một bộ não có tư thế, biết đồng đội, biết ngân sách mana, và có ba mức độ khó.
Cụ thể là bốn hành vi team:

- **Đánh hội đồng** — ưu tiên mục tiêu đồng đội đang đánh.
- **Đi cụm** — roam quanh đồng đội / nửa sân mình, bỏ rải ngẫu nhiên toàn map.
- **Lùi khi bị áp đảo** — đếm hai bên, ít hơn thì rút về trụ/fountain.
- **Kết liễu địch máu thấp** — tái dùng `combat/ExecuteTargeting.ts`.
- **Nhớ vị trí cuối** — mất dấu thì đuổi tới chỗ vừa thấy chứ không đứng ngơ,
  và trí nhớ đó dùng chung cả team (§3).

**Không** làm trong pass này: lane assignment, ăn trụ, dọn quái rừng,
engage/disengage cấp team, và toàn bộ UI/persistence.

## Kiến trúc

Năm module mới dưới `src/game/ai/`, mỗi module một việc:

| File | Việc duy nhất | Phụ thuộc |
|---|---|---|
| `SpellRole.ts` | bitmask vai trò + suy luận fallback + cache theo class | `Spell` (type) |
| `AimPredictor.ts` | đoán điểm chạm | `Reach.ts` |
| `TeamBlackboard.ts` | ảnh chụp dùng chung của hai team | `ObjectManager`, `ExecuteTargeting` |
| `Difficulty.ts` | ba profile, thuần data, không import gì | — |
| `BotBrain.ts` | FSM tư thế + chấm điểm chiêu | cả bốn cái trên |

`AIChampion.ts` teo thành vỏ: giữ các cờ `_autoMove`/`_autoAttack`/`_autoCast`,
respawn, phản xạ va chạm; **xoá `aimPoint()` và `cursorForSpell()`**; uỷ quyền
quyết định cho `BotBrain`.

---

## 1. `SpellRole.ts` — vai trò dạng bitmask

```ts
export const SpellRole = Object.freeze({
  None:     0,
  Damage:   1 << 0,   Poke:     1 << 1,   Burst:  1 << 2,
  Dash:     1 << 3,   Escape:   1 << 4,   Cc:     1 << 5,
  Heal:     1 << 6,   Shield:   1 << 7,   Buff:   1 << 8,
  Zone:     1 << 9,   Summon:   1 << 10,  Ultimate: 1 << 11,
} as const);

export type SpellRoleMask = number;

/** Helper dùng chung để gắn tag. */
export const roles = (...flags: SpellRoleMask[]): SpellRoleMask =>
  flags.reduce((acc, flag) => acc | flag, 0);
```

Gắn ở file spell dưới dạng **static**, nên cache được vĩnh viễn theo class:

```ts
// src/game/gameObject/spells/Camille_E.ts
static aiRoles = roles(SpellRole.Damage, SpellRole.Dash, SpellRole.Cc);
```

`Spell` base khai `static aiRoles?: SpellRoleMask` và
`static aiProjectileSpeed?: number` để `tsc` chấp nhận, cả hai optional. Không
file spell nào **bắt buộc** phải gắn — chưa gắn thì suy luận.

### Suy luận fallback từ `castSpec`

Theo thứ tự, dừng ở luật đầu tiên khớp:

| Điều kiện | Mask suy ra |
|---|---|
| `targeting === 'SELF'` và `manaCost === 0` | `Buff` |
| `targeting === 'SELF'` | `Buff \| Shield` |
| `targeting === 'UNIT'` và `targetTeam === 'ALLY'` | `Heal \| Shield` |
| `targeting === 'UNIT'` | `Damage \| Cc` |
| `targeting === 'POINT'` và `range >= 400` | `Damage \| Poke` |
| `targeting === 'POINT'` | `Damage \| Zone` |
| `targeting === 'DIRECTION'` và `range >= 400` | `Damage \| Poke` |
| còn lại | `Damage` |

Cộng thêm `Burst` khi `manaCost >= 40`. Suy luận **không** đoán được `Dash`,
`Escape`, `Summon` — đó là giá trị của việc gắn tay, và ta gắn dần.

**Chiêu không khai tầm không có nghĩa là tầm vô hạn.** Bảng trên viết cho chiêu
tướng và chưa từng đối chiếu với hai thứ mọi bot đều mang: **27 chiêu
`POINT`/`DIRECTION` trong repo không khai `range`/`castRange`/`targetingRequest.range`
nào**, cộng bốn phù phép. `Flash` là ví dụ đắt nhất — `targetingMode = 'POINT'`,
không tầm, `manaCost = 100` — nên nó bị suy ra là `Damage | Zone | Burst`, chấm
**18 điểm** khi có mục tiêu và **32** khi địch sắp chết, vượt xa một chiêu Q
thường (10-16). Bot sẽ coi Flash là chiêu đánh chính.

Nên: khi `declaredRange` là `undefined`, tầm dùng để lọc và để kẹp điểm ngắm là
**`profile.aggroRange`**, không phải `Infinity`, và **không** cộng điểm `Zone`
cho một tầm không biết. Luật chấm điểm nào thêm sau mà khoá theo tầm đều phải
trả lời câu hỏi này trước.

### Cache và cờ `Ultimate`

`Spell` **không** biết ô của chính nó — không có field `slot`/`index` nào trên
instance (kiểm chứng: `Champion.applyPreset` chỉ `map((SpellClass, index) =>
new SpellClass(this))`, index không được truyền vào). Và bộ kit tự chế
(`config/savedKits.ts`, "clone my spells") có thể nhét một chiêu vào ô khác.

Nên mask cache phải **thuần theo class**, còn `Ultimate` OR vào lúc đọc:

```ts
const classMask = new WeakMap<Function, SpellRoleMask>();

export function rolesOf(spell: Spell, slotIndex: number): SpellRoleMask {
  const ctor = spell.constructor as typeof Spell & { aiRoles?: SpellRoleMask };
  let mask = classMask.get(ctor);
  if (mask === undefined) {
    mask = ctor.aiRoles ?? inferRoles(spell.castSpec);
    classMask.set(ctor, mask);
  }
  return slotIndex === ULTIMATE_SLOT ? mask | SpellRole.Ultimate : mask;
}
```

`ULTIMATE_SLOT = 4` (`SpellHotKeys` = `[A, Q, W, E, R, D, F]`, R ở index 4).
Chi phí sau lần đầu: một `WeakMap.get` và một phép rẽ nhánh.

---

## 2. `AimPredictor.ts` — thứ thay `worldMouse`

```
vận tốc  = normalize(target.destination − target.position) × target.moveSpeed
tBay     = dist(caster, target) / projectileSpeed
điểm     = target.position + vận tốc × tBay × leadFactor + nhiễu
```

Ba quyết định, mỗi cái có lý do:

- **Dùng `destination` chứ không phải vận tốc frame trước.** `destination` là
  *ý định* đã qua pathing (`AttackableUnit.destination`, cập nhật bởi
  `navigateTo`), nên mượt và không giật khi unit bị đẩy/khựng. Vận tốc
  frame-trước dao động mạnh và cần thêm state để lưu.
- **Địch đứng yên tự thoái hoá.** `dist(destination, position) < moveSpeed` →
  vận tốc 0 → điểm ngắm = vị trí địch. Không cần case riêng.
- **Đơn vị là *frame*, không phải giây.** `AttackableUnit.moveSpeed` trả
  `stats.speed.value` = pixel **mỗi frame** (xem `AttackableUnit.ts:634-651`),
  và `MissileSpellObject.speed = 7` cũng là pixel mỗi frame
  (`MissileSpellObject.ts:66`). Hai đại lượng cùng đơn vị nên `tBay` ra số
  frame và phép nhân là đúng. **Không được** quy đổi sang giây ở một vế.

`projectileSpeed` lấy từ `static aiProjectileSpeed` nếu spell có gắn, không thì
`DEFAULT_PROJECTILE_SPEED = 7`. Chiêu không phải skillshot (`UNIT`, `SELF`)
không gọi predictor.

Nhiễu: lệch một vector ngẫu nhiên có độ dài tới `aimErrorPx`, hướng đều. Điểm
cuối được kẹp vào `effectiveRange(spell.castSpec.range, caster, target)` —
`Reach.ts` là chủ sở hữu duy nhất của tầm, predictor không tự tính.

---

## 3. `TeamBlackboard.ts` — bảng tin dùng chung

Dựng **một lần cho cả hai team mỗi `BLACKBOARD_TTL_MS = 250`**, không phải mỗi
bot. Một lượt duyệt `objectManager.objects` cho toàn bộ, kết quả nhớ trên
`Game` và hết hạn theo `millis()`.

```ts
export interface TeamView {
  allies: readonly Champion[];      // còn sống, không toRemove
  enemies: readonly Champion[];
  focusTarget: Champion | null;
  rally: Vec2;                      // trọng tâm đồng đội còn sống
}
```

- **`focusTarget`** = địch bị nhiều đồng đội `basicAttack.target` trỏ vào nhất;
  hoà thì lấy `effectiveHealth` thấp nhất (`ExecuteTargeting.effectiveHealth`,
  đã tính cả khiên). Đây là nguồn của cả "đánh hội đồng" lẫn "kết liễu máu thấp".
- **`rally`** nuôi ROAM.
- **`allies.length` / `enemies.length`** nuôi luật áp đảo.

Bảng tin **không** lọc theo tầm nhìn — nó là tri thức của team, và bot đọc nó
rồi mới tự kiểm tra nhìn thấy hay không khi thật sự chọn mục tiêu (§5).

### Trí nhớ vị trí cuối — dùng chung cả team

Sống trên bảng tin chứ không phải trên từng bot, vì hai lý do đều đúng: nó rẻ
hơn (một map cho cả team thay vì một map cho mỗi bot), và **tri thức dùng chung
chính là chơi theo team** — một bot thấy bro chui vào bụi thì cả team biết chỗ,
đúng như tầm nhìn chia sẻ trong LoL thật.

```ts
export interface SeenEnemy {
  unit: Champion;
  atMs: number;   // millis() lúc thấy lần cuối
  pos: Vec2;      // vị trí lúc đó
  vel: Vec2;      // vận tốc lúc đó, để đoán tiếp chỗ nó chạy tới
}
```

Cập nhật trong đúng lượt duyệt 250ms đã có: với mỗi địch, nếu **bất kỳ** đồng
đội nào thấy nó thì ghi đè entry. Thoát vòng ngay khi có một người thấy. Entry
hết hạn theo `memoryTtlMs` của bot đang đọc — nên cùng một bảng tin phục vụ ba
mức độ khó với ba độ dài trí nhớ khác nhau, không cần ba bản sao.

Entry bị xoá khi `unit.isDead || unit.toRemove`. Map tối đa bằng số địch (~4),
không có đường nào để nó phình.

---

## 4. `Difficulty.ts` — ba profile

```ts
export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyProfile {
  castIntervalMs: number;    // nhịp tối thiểu giữa hai lần cast
  leadFactor: number;        // 0 = ngắm thẳng, 1 = đón đầu đầy đủ
  aimErrorPx: number;
  noise: number;             // biên độ ngẫu nhiên khi chấm điểm
  retreatHealthPct: number;
  manaReservePct: number;    // phần mana giữ cho ultimate
  focusBonus: number;        // điểm cộng khi mục tiêu là focusTarget
  playerBias: number;        // điểm cộng khi mục tiêu là người chơi
  aggroRange: number;
  /** Bỏ qua tường/bụi khi ĐI TÌM mục tiêu. Tầm nhìn xa vẫn giới hạn — xem §6. */
  seesThroughTerrain: boolean;
  memoryTtlMs: number;       // nhớ vị trí cuối trong bao lâu
  ghostCastWindowMs: number; // 0 = không bao giờ ném chiêu vào vị trí đã mất dấu
}
```

| Núm | easy | normal | hard |
|---|---|---|---|
| `castIntervalMs` | 1400 | 900 | 550 |
| `leadFactor` | 0.15 | 0.6 | 0.95 |
| `aimErrorPx` | 70 | 30 | 8 |
| `noise` | 0.9 | 0.45 | 0.2 |
| `retreatHealthPct` | 0.2 | 0.3 | 0.4 |
| `manaReservePct` | 0 | 0.25 | 0.4 |
| `focusBonus` | 2 | 8 | 14 |
| `playerBias` | 0 | 6 | 12 |
| `aggroRange` | 360 | 420 | 480 |
| `seesThroughTerrain` | `false` | `true` | `true` |
| `memoryTtlMs` | 1200 | 2500 | 4000 |
| `ghostCastWindowMs` | 0 | 500 | 900 |

`normal` là mặc định của mọi bot trong pass này. `aggroRange` thay hằng
`AI_ATTACK_AGGRO_RANGE` hiện tại (420 = giá trị `normal`, nên bot mặc định giữ
nguyên tầm aggro cũ). Hằng cũ vẫn export để test hiện có không gãy.

`playerBias` là hiện thân của "ưu tiên nhẹ người chơi": bot vẫn chọn theo logic
riêng, người chơi chỉ được cộng điểm vừa phải nên không thành 4v1.

---

## 5. `BotBrain.ts` — FSM tư thế + chấm điểm

Một instance cho mỗi `AIChampion`, sống cùng vòng đời bot.

### Nhịp

Một **think tick** duy nhất, `THINK_INTERVAL_MS = 250`, jitter khi khởi tạo —
tái dùng đúng khuôn `_attackScanCooldown` đang có, không thêm timer thứ hai.
Mỗi tick: đọc bảng tin → chọn mục tiêu đánh thường → xét tư thế → có thể cast.
Cast còn bị chặn thêm bởi `castIntervalMs` riêng của profile.

Giữa hai tick, `update()` **không làm gì** ngoài việc chạy `pendingCharge` (chiêu
sạc) — thứ bắt buộc phải cập nhật mỗi frame.

### Tư thế — chuỗi if/else, xét theo đúng thứ tự này

1. **`RETREAT`** — `healthPct < profile.retreatHealthPct`, **hoặc**
   `enemies.length − allies.length >= 2` và `healthPct < 0.6`.
   Đích: trụ đồng minh còn sống gần nhất, không có thì fountain của team
   (`game.fountains.find(f => f.teamId === this.teamId)`).
2. **`RECOVER`** — đang RETREAT và đã tới nơi. Ngồi tới khi
   `healthPct > 0.7` **và** `manaPct > 0.5`. Đây là nửa còn lại của việc chữa
   "cụt tay": bot chờ hồi mana chứ không lao ra tay không.
3. **`FIGHT`** — có địch **nhìn thấy được** trong `aggroRange`, **hoặc**
   `basicAttack.target` vẫn còn (lệnh đánh đang chạy đã tự sống sót qua bụi —
   xem §6), **hoặc** trí nhớ về một địch còn tươi **và** địch đó trong
   `aggroRange`.
4. **`SEARCH`** — không thấy ai, nhưng trí nhớ còn tươi
   (`millis() − atMs < memoryTtlMs`). Chạy tới `pos + vel × (thời gian đã trôi)`
   — đuổi theo *chỗ nó đang chạy tới*, không phải chỗ nó đã đứng. SEARCH tự kết
   thúc khi entry vượt `memoryTtlMs`; không cần bộ đếm nán riêng, vì `memoryTtlMs`
   **đã chính là** thời gian bot còn tin vào chỗ đó.
   Trong cửa sổ `ghostCastWindowMs`, bot được phép ném chiêu có `Zone` hoặc
   `Poke` vào điểm đoán đó, vẫn chịu nhịp `castIntervalMs` như mọi lần cast khác. Đây là khoảnh khắc "ơ nó đoán được" —
   và cũng là lý do `ghostCastWindowMs` của `easy` bằng 0.
5. **`ENGAGE`** — `focusTarget` tồn tại và nằm trong `ASSIST_RANGE = 700` của
   một đồng đội → chạy tới. Đây là "đi cụm" lúc đang có giao tranh.
6. **`ROAM`** — lảng vảng quanh `rally` trong bán kính `ROAM_RADIUS = 500`.
   Không còn đồng đội sống (`allies` rỗng) thì lảng vảng quanh fountain của
   team mình. Điểm roll được `navigation.nearestWalkable(...)` kéo về nền đi
   được y như `moveToRandomLocation()` đang làm — giữ nguyên `ROAM_SNAP_DISTANCE`.
   Đây là thứ thay `moveToRandomLocation()`, và vì `rally` là trọng tâm đồng
   đội nên "đi cụm" xuất hiện mà không cần khái niệm nửa sân nào cả.

`_autoMove === false` khoá bot ở chỗ đứng: tư thế vẫn tính (để nó còn cast),
nhưng không lệnh di chuyển nào được phát. `_autoCast === false` bỏ qua §5 phần
chấm điểm. `_autoAttack === false` bỏ qua chọn mục tiêu đánh thường. Ba cờ giữ
nguyên ngữ nghĩa hiện tại.

### Chọn mục tiêu

Điểm mục tiêu = `−khoảng cách/100` + `focusBonus` nếu là `focusTarget` +
`playerBias` nếu là `game.player` + `12 × (1 − healthPct)` (kết liễu máu thấp).

"Nhìn thấy được" ở đây và ở luật FIGHT phía trên nghĩa là gì thì §6 định nghĩa,
và nó khác nhau theo mức độ khó.

### Chấm điểm chiêu — tư thế nào được cast, và cast được gì

| Tư thế | Được cast | Ứng viên |
|---|---|---|
| FIGHT, ENGAGE | có | mọi chiêu |
| SEARCH | có | chỉ `Zone`/`Poke`, trong `ghostCastWindowMs` |
| RETREAT, RECOVER | có | **chỉ `Escape`, `Heal`, `Shield`** |
| ROAM | không | — |

Bản đầu của mục này viết tiêu đề "chỉ trong FIGHT và ENGAGE" rồi ngay bên dưới
lại cho `Escape` dòng điểm `+25 khi RETREAT` và `Heal/Shield` dòng `+20 khi máu
thấp` — hai câu loại trừ nhau, và bản hiện thực đầu tiên đã theo tiêu đề. Hệ quả:
bot tụt máu chạy về trụ, ngồi ở RECOVER, và **không bao giờ bấm chiêu hồi máu hay
chiêu chạy trốn mà nó vừa được chấm điểm để bấm** — đúng thứ mục "cụt tay" của
spec này hứa chữa. Bot đang chạy vẫn không được bắn chiêu sát thương; đó là lý do
danh sách ứng viên bị thu hẹp chứ không mở toang.

Với mỗi `spell` ở index `i >= 1` (bỏ ô A = đánh thường):

1. Bỏ nếu `!spell.isCastableNow`. Một lần đọc phủ cả hồi chiêu, mana, câm lặng,
   chết — và **read-only**, không như `castCancelCheck` vốn gọi `resetCoolDown()`.
2. **Ngân sách mana.** Gọi `mask = rolesOf(spell, i)`. Nếu
   `!(mask & SpellRole.Ultimate)` **và** ô ultimate có chiêu đang dùng được
   (`spells[ULTIMATE_SLOT]?.isCastableNow === true`), bỏ chiêu này khi
   `spell.effectiveManaCost > mana − maxMana × manaReservePct`. Ultimate đang
   hồi chiêu thì không giữ mana cho nó — giữ sẽ thành liệt tay vô cớ.
   **Đọc `effectiveManaCost`, không đọc `stats.mana` trực tiếp** — CLAUDE.md:
   luật URF chỉ tồn tại qua seam đó, và `mana-spend-seam.test.ts` cấm tên kia.
3. Điểm gốc theo mask, cộng dồn (một chiêu nhiều vai trò được cộng nhiều lần —
   đó là lý do dùng bitmask):

   | Vai trò | Điểm | Điều kiện |
   |---|---|---|
   | `Damage` | +10 | có mục tiêu |
   | `Poke` | +6 | mục tiêu ngoài tầm đánh thường |
   | `Burst` | +14 | `effectiveHealth(target) < 40` |
   | `Cc` | +12 | mục tiêu là `focusTarget` |
   | `Heal`/`Shield` | +20 / −5 | `healthPct < 0.5` / còn lại |
   | `Escape` | +25 / −10 | tư thế RETREAT / còn lại |
   | `Dash` | +6 / −4 | mục tiêu ngoài tầm chiêu / còn lại |
   | `Buff` | +5 | luôn |
   | `Zone` | +8 | mục tiêu trong tầm |
   | `Ultimate` | +6 | luôn (giá trị cao, nhưng đã bị ngân sách bảo vệ) |

4. Bỏ nếu mục tiêu ngoài `effectiveRange(spell.castSpec.range, this, target)` và
   mask không có `Dash`.
5. Nhân `(1 + random() × profile.noise)`. **Đây là chỗ "vẫn random nhưng cân
   bằng"**: easy `noise = 0.9` chọn lung tung, hard `0.2` gần như tối ưu.
6. Lấy điểm cao nhất còn dương. Cast qua `spell.press(context)` với điểm ngắm
   từ `AimPredictor` (skillshot) hoặc qua `TargetResolver` (`UNIT`/`SELF`).

Logic `pendingCharge` cho chiêu sạc giữ nguyên như hiện tại.

---

## 6. Tầm nhìn: cái gì bị chặn, cái gì không

**Đã chốt.** `seesThroughTerrain` là một núm độ khó: `easy` bị chặn,
`normal`/`hard` nhìn xuyên tường và bụi. Mặc định của bot là `normal`, nên
**độ chaos hôm nay được giữ nguyên**, và bụi chỉ trở thành công cụ thật khi hạ
xuống `easy`. Đây đúng là thứ `ObjectManager.ts:237` để dành:

> *"a bot that can be broken line-of-sight with is a difficulty change, not a
> bug fix"*

Comment đó vẫn phải viết lại vì nó viện dẫn `AIChampion.aimPoint` — hàm pass
này xoá.

### Ba ranh giới, đừng lẫn

**1. Tầm nhìn chỉ chặn việc BẮT ĐẦU nhắm, không chặn việc ĐANG đuổi.**
`BasicAttackController.canKeep` (`BasicAttackController.ts:145-152`) chỉ kiểm
`canBeHit`, cờ `STEALTHED`, và khoảng cách leash — **không có kiểm tra tầm nhìn
nào**, cố ý, và trùng đúng luật CLAUDE.md đã ghi: *"vision gates acquisition,
never damage"*. Nên kể cả ở `easy`, bot đang đánh mà mục tiêu chui vào bụi thì
nó **vẫn đuổi**. Không cần sửa gì ở đó, và luật FIGHT ở §5 đọc thẳng
`basicAttack.target` để tư thế không rơi ra khỏi FIGHT trong lúc lệnh vẫn chạy.

**2. `seesThroughTerrain` bỏ qua tường và bụi. Tầm xa là việc của thứ khác.**
`canSee` **không** chặn khoảng cách — `Vision.ts:33` nói thẳng *"Distance is not
part of it"*, vì `Reach.ts` sở hữu tầm và mỗi caller tự giới hạn ứng viên của
mình. Nên cổng tầm xa của bot là **`profile.aggroRange`** (360/420/480), không
phải tầm nhìn. Hệ quả cố ý: ngay cả `hard` vẫn mất dấu một địch chạy quá 480px,
nên trí nhớ ở §3 có việc để làm ở **cả ba mức**, không chỉ `easy`.

**Tuyệt đối không dùng `AttackableUnit.visionRadius` làm cổng.** Nó đọc như một
hằng số gameplay và không phải: `AttackableUnit.ts:216-218` ghi nó mỗi frame
bằng `lerp(visionRadius, stats.visionRadius.value, 0.1)` trong đường cập nhật
giá trị animation — khởi từ 0 và bò dần lên 500. Một bot vừa hồi sinh sẽ mù,
và trong test (nơi vòng animation không chạy) nó đứng nguyên ở 0, tức là mù
vĩnh viễn. Đây cũng đúng cảnh báo CLAUDE.md đã ghi: chặn tầm nhìn theo bán kính
500 của camera từng cắt Warwick R từ 550 xuống 500.

**3. Bụi không phải tàng hình.** `isInsideBush` và `ActionState.STEALTHED` là
hai thứ khác nhau. Chiêu/hiệu ứng tàng hình vẫn nhả lock ở mọi mức (đó là
`canKeep` và `Monster.updateAttack:251` đang làm), và `seesThroughTerrain`
**không** cho bot thấy đơn vị tàng hình.

### Ghi chú: quái rừng không nằm trong pass này

Trong lúc kiểm tra có nghi vấn "quái rừng mất dấu khi vào bụi". Đọc code thì
không phải: `Monster.updateAttack:251` nhả lock khi `isStealthed`, chứ bụi
không đụng tới. Thứ thật sự làm quái quay về là **leash** —
`chaseLeashRange()` = `max(camp.r, aggroRange) + MONSTER_CHASE_MARGIN` (350),
đo **từ điểm camp**, với `MONSTER_GIVE_UP_DELAY_MS` = 2000ms ân hạn. Bụi gần
camp thường nằm ngoài vòng đó, nên bước vào bụi = bước ra khỏi leash. Triệu
chứng giống hệt, nguyên nhân là hình học leash.

Đó là việc riêng, không thuộc pass này, và sửa nó là chỉnh `MONSTER_CHASE_MARGIN`
hoặc cách đo leash — không phải thêm trí nhớ.

## 7. Ngân sách hiệu năng — ràng buộc cứng

Cam kết: bộ não mới **rẻ hơn** cái đang chạy, không đắt hơn. Các con số dưới
đây đo trên hành vi thật, không ước lượng thoáng:

Hôm nay, mỗi bot mỗi giây (60fps, `random() < 0.1`):

- **~6 lần thử cast.** Mỗi lần dựng một `CastContext`: một `uuidv4()`, ba
  `Object.freeze`, một `Math.sqrt`.
- **Trong số đó, lần nào rơi vào chiêu ngắm-đơn-vị thì quét ứng viên.**
  `cursorForSpell` early-return cho `DIRECTION`/`POINT`/`SELF`
  (AIChampion.ts:230), nên đây **không phải** mọi lần thử — với bộ kit điển
  hình (1-2 chiêu `UNIT` trên 6 ô) là khoảng 1-2 lượt/giây/bot. Nhưng khi nó
  chạy, `request.queryCandidates?.() ?? this.game.objectManager.objects` duyệt
  **toàn bộ** danh sách object — minion, particle, trail, tất cả — chứ không
  phải một truy vấn quadtree có vùng.
- **Cộng thêm một lượt quét quadtree 4 lần/giây** cho mục tiêu đánh thường.

Sau:

| Hạng mục | Hôm nay | Sau |
|---|---|---|
| Thử cast | ~6 lần/giây/bot | ≤2 lần/giây/bot (`castIntervalMs` 550-1400ms) |
| Duyệt toàn bộ `objects` để tìm điểm ngắm | ~1-2 lần/giây/bot, không giới hạn vùng | **0** |
| Quét quadtree tìm mục tiêu | 4 lần/giây/bot | 4 lần/giây/bot, dùng chung cho cả đánh thường lẫn chiêu |
| Xét quyết định | 60 lần/giây/bot (`random()` mỗi frame) | 4 lần/giây/bot |
| Bảng tin team | — | 1 lượt duyệt / 250ms **cho cả game**, không phải mỗi bot |
| Role mask | — | 1 lần / class / cả ván (`WeakMap`) |
| Chấm điểm | — | ≤6 chiêu × vài phép số, 4 lần/giây/bot |

Khoản thêm vào đắt nhất là bảng tin: một lượt duyệt `objects` mỗi 250ms **cho
toàn bộ trận**. So với hôm nay — nơi mỗi bot tự duyệt riêng 1-2 lần/giây — 5
bot đang trả 5-10 lượt/giây thì sau còn 4 lượt/giây bất kể bao nhiêu bot. Càng
đông bot, chênh lệch càng nghiêng về phía mới.

**Ghi chú trung thực về dòng "0 lượt duyệt".** Nó nói về lượt quét *tìm điểm ngắm*
mà `cursorForSpell` từng làm, và lượt đó đã bị xoá thật. Nhưng
`Game.createSpellContext` vẫn mặc định `queryCandidates` về toàn bộ danh sách
object, và `BotBrain.advanceCharge` dựng lại context đó mỗi frame khi đang giữ
chiêu sạc. Cả hai có trước nhánh này và giờ chạy ở ≤2 lần cast/giây thay vì ~6,
nên kết luận "rẻ hơn trước" vẫn đứng — nhưng đây không phải "không còn lượt duyệt
toàn danh sách nào trong game".

Ba luật hiệu năng phải giữ khi hiện thực:

- Không cấp phát mảng trong think tick nếu tránh được — tái dùng buffer trên
  instance `BotBrain`.
- **Không module nào trong `src/game/ai/` được đọc global p5.** Thời gian được
  truyền vào dưới dạng `nowMs: number`, tích luỹ từ `deltaTime` ở biên
  `AIChampion.update()`. Ba cái lợi cùng lúc: test không cần stub `millis()`
  (`stubGameGlobals` không stub nó), các module thành TS thuần nên chạy nhanh,
  và cả thư mục miễn nhiễm bẫy shadowing global (`random`, `map`, `text`) mà
  CLAUDE.md cảnh báo. Một ảnh chụp bảng tin phục vụ mọi bot của cả hai team
  trong cửa sổ đó.
- Không thêm `queryObjects` nào ngoài lượt quét mục tiêu đã có; predictor và
  chấm điểm chỉ đọc lại kết quả đó.

## 8. Kiểm thử

**Vitest** (mặc định — 2500 test chạy ~10 giây):

| Test | Khẳng định |
|---|---|
| `ai/SpellRole.test.ts` | bảng suy luận, `roles()` kết hợp cờ, cache trả cùng giá trị, `Ultimate` OR theo slot chứ không dính vào cache |
| `ai/AimPredictor.test.ts` | toán đón đầu **với số kỳ vọng tính tay**, địch đứng yên → ngắm thẳng, `leadFactor = 0` → ngắm thẳng, điểm bị kẹp trong tầm |
| `ai/TeamBlackboard.test.ts` | `focusTarget` chọn đúng khi hoà, bỏ unit `toRemove`/chết, dựng lại đúng một lần trong TTL |
| `ai/Difficulty.test.ts` | ba profile đơn điệu **theo chiều "giỏi hơn"**, không phải theo chiều số: `hard` phải có `castIntervalMs`, `aimErrorPx`, `noise` **thấp hơn** và `leadFactor`, `focusBonus`, `aggroRange` **cao hơn** `normal`, tương tự `normal` với `easy` |
| `ai/BotBrain.posture.test.ts` | năm chuyển trạng thái, theo đúng thứ tự ưu tiên |
| `ai/BotBrain.mana.test.ts` | bot giữ đủ mana cho ultimate; `manaReservePct = 0` thì không giữ |
| `ai/TeamBlackboard.memory.test.ts` | entry hết hạn đúng theo `memoryTtlMs` của bot đọc nó; một đồng đội thấy là cả team nhớ; entry bị xoá khi unit chết/`toRemove`; điểm đuổi được ngoại suy theo `vel`, **số kỳ vọng tính tay** |
| `ai/BotBrain.vision.test.ts` | `easy` không nhắm được địch sau tường; `normal`/`hard` nhắm được; **cả ba** đều mất dấu địch ngoài `visionRadius`; **cả ba** đều không thấy đơn vị `STEALTHED`; lệnh đánh đang chạy sống sót qua bụi ở mọi mức |
| `ai/bot-aim-seam.test.ts` | **source-scan**: cấm chuỗi `worldMouse` xuất hiện trong `src/game/ai/` và `AIChampion.ts` |

`bot-aim-seam.test.ts` là thứ đóng vĩnh viễn lỗi mobile — mô hình theo
`tests/game/spells/mana-spend-seam.test.ts`. **Nhớ strip comment trước khi
match**, không thì nó cờ chính tài liệu của nó (bẫy đã ghi trong CLAUDE.md).

**Mỗi test phải được chứng minh là fail trước.** Cụ thể cần tránh hai hình dạng
đã hỏng nhiều lần ở repo này: khẳng định trên state mà code vừa tạo ra một cách
đồng bộ, và test tự tính giá trị kỳ vọng bằng chính hàm đang kiểm tra —
`AimPredictor` là ứng viên số một của lỗi thứ hai, nên số kỳ vọng **viết tay**.

**Playwright**: không viết script mới. Chạy lại `drive-basic-attacks.mjs` và
`drive-touch-controls.mjs` vì cả hai chạm hành vi bot. (Flake đã biết:
`drive-new-spells.mjs` ~1/4, `drive-touch-controls.mjs` hiếm khi treo.)

**Cổng**: `npm run verify`.

---

## 9. File

**Mới**

```
src/game/ai/SpellRole.ts
src/game/ai/AimPredictor.ts
src/game/ai/TeamBlackboard.ts
src/game/ai/Difficulty.ts
src/game/ai/BotBrain.ts
tests/game/ai/*.test.ts
```

**Sửa**

| File | Sửa gì |
|---|---|
| `src/game/gameObject/attackableUnits/AIChampion.ts` | xoá `aimPoint`, `cursorForSpell`, khối `random() < 0.1`, `moveToRandomLocation` (chuyển vào brain); thêm `_difficulty` + `setDifficulty()`; uỷ quyền `update()` |
| `src/game/gameObject/Spell.ts` | thêm `static aiRoles?` và `static aiProjectileSpeed?` (chỉ khai báo type) |
| `src/game/combat/Vision.ts` | **chỉ sửa comment** ở dòng 40-45: nó tuyên bố `canSee` cố ý không áp cho aggro scan và aim point của `AIChampion`. Sau pass này `easy` có áp, và `aimPoint` không còn tồn tại |
| `src/game/managers/ObjectManager.ts` | **chỉ sửa comment** ở dòng 225-241: nó viện dẫn `AIChampion.aimPoint` (đã xoá) và tuyên bố scan của bot không bị gate (giờ là núm độ khó). Bộ lọc `visibleTo` **không đổi** — `BotBrain` tự quyết theo `seesThroughTerrain` thay vì đi qua nó |

**Cố ý không đụng** (AI khác đang gộp config UI — xem
`2026-08-19-unified-match-config-design.md`): `PregameConfig.ts`,
`MatchDirector.ts`, `AiConfigPanel.vue`, `RosterTab.vue`.

Việc sẽ chạy trong `git worktree` riêng, commit bằng đường dẫn tường minh —
không `git add -A`, không `git stash` (CLAUDE.md: stash cuốn theo việc chưa
commit của agent kia).

---

## 10. Bàn giao cho pass UI

`difficulty` trong pass này sống như **field thường trên `AIChampion`**, đúng
khuôn `_autoMove`/`_autoAttack`/`_autoCast` đang có:

```ts
// AIChampionOptions
difficulty?: BotDifficulty;

// AIChampion
_difficulty: BotDifficulty = 'normal';
setDifficulty(value: BotDifficulty): void;
```

Khi UI sẵn sàng, nối đúng ba chỗ, mỗi chỗ một dòng:

1. `BotBehaviour` (`PregameConfig.ts`) thêm `difficulty: BotDifficulty`, mặc
   định `'normal'`; `sanitizeBotBehaviour` migrate config cũ thiếu field.
2. `MatchConfigSource.setBotBehaviour(id, flags)`
   (`src/game/hud/config/MatchConfigSource.ts:150`) — seam đã ship trong commit
   `e0668c0`. Có **hai** implementation, phải sửa cả hai:
   `MatchDirectorSource.ts:244` (trận đang chạy → `bot.setDifficulty(...)`) và
   `PregameConfigSource.ts:225` (màn setup → ghi vào config).
3. `Game.ts` truyền `difficulty: pregameConfig.ai.botBehaviours[i].difficulty`
   vào constructor `AIChampion`.

Control 3 nấc đặt ở `AiConfigPanel.vue` (chung) và hàng bot trong tab Đội.
⚠️ CLAUDE.md: **mọi control HUD phải có touch handler cạnh click handler** —
`GameScene` gọi `preventDefault()` trên mọi touch nên `@click` chết dưới ngón tay.

---

## 11. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Bot yếu hẳn đi vì mất "đón đầu tình cờ" của con trỏ | `leadFactor` ở `normal` là 0.6; chỉnh bằng số, và e2e cho thấy ngay |
| Suy luận role đoán sai nặng ở vài champion | Chấp nhận: gắn `static aiRoles` cho champion đó, không phải sửa engine |
| `easy` mất aggro qua bụi, cảm giác "ngu đi" | Chỉ ở `easy`, và trí nhớ + SEARCH ở §5 làm nó đuổi theo chứ không đứng ngơ; `normal` mặc định giữ nguyên hành vi hôm nay |
| Trí nhớ dùng chung làm cả team đổ dồn một lúc, thành 4v1 | `memoryTtlMs` và `playerBias` đều là núm độ khó; SEARCH chỉ kích hoạt cho bot trong `aggroRange` của điểm nhớ |
| `ghostCastWindowMs` làm bot phí mana ném vào chỗ trống | Chỉ một chiêu mỗi cửa sổ, chỉ chiêu có `Zone`/`Poke`, và vẫn phải qua ngân sách mana ở §5 |
| Test FSM bám quá chặt vào số | Test khẳng định *thứ tự ưu tiên* và *chiều* thay đổi, không khẳng định hằng số cụ thể |
| Xung đột với AI đang gộp config | Worktree riêng + danh sách file cấm đụng ở §9 |
