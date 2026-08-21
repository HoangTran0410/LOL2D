# Tách content thành pack — core engine sạch IP

Trạng thái: **design đã duyệt, chờ plan**. Phạm vi tài liệu này là **Giai đoạn
1** (pack tiêu thụ ở build-time). Giai đoạn 2 (nạp runtime) chỉ được nhắc tới ở
§9, và mọi quyết định dưới đây đều chọn theo tiêu chí "không bịt cửa GĐ2".

## 1. Vấn đề

Repo này chở 57 tướng, 241 file spell và 396/407 asset là tài sản của Riot.
Mục tiêu là biến nó thành **core engine không chứa content**, và người chơi
muốn tướng nào thì import pack từ nơi khác vào — mô hình Stremio, nơi trình
phát không mang nội dung nào.

Đây cũng là quyết định kỹ thuật đúng độc lập với lý do pháp lý: hôm nay
`spellCatalog.ts` là 295 literal tên tướng nằm giữa engine, và bốn script
trong `scripts/` duyệt thẳng thư mục `spells/`.

**Không phải mục tiêu**: thêm điều kiện thắng cho chế độ hiện có. Trận đấu
không có hồi kết là *thiết kế* của game này (đấu tập, thử chiêu), không phải
thiếu sót. Win condition chỉ xuất hiện ở §7 dưới dạng luật **do pack khai**.

### Sự thật cần biết trước

Chuyển file đi **không** xoá nó khỏi git history. 396 asset Riot nằm trong mọi
commit từ trước tới nay. Core sạch thật sự đòi `git filter-repo` viết lại lịch
sử — quyết định riêng, ngoài phạm vi tài liệu này, nhưng phải biết từ bây giờ.

## 2. Đo đạc

Bốn audit độc lập chạy trên cây nguồn, không phải phỏng đoán.

### 2.1 Content rò rỉ vào core — ít hơn dự đoán rất nhiều

Chỉ **3 file** trong core mang tên Riot: `vfx/LuxBeamEffect.ts`,
`vfx/DariusAxe.ts`, `gameObject/monsters/Baron.ts`. Cả ba đều **không có
importer nào ngoài `spells/`**.

~100 lần tên tướng xuất hiện trong core đều là **doc comment**, không phải
code.

**Không phải coupling, trái với dự đoán**: `Z_INDEX_MAP` chỉ keyed theo base
class (content tự khai qua `static displayZIndex`); cache constructor của
`SpellRole` điền lúc runtime từ `static aiRoles`; không `instanceof` nào nhắm
vào content ngoài `spells/`; toàn bộ 24 file `buffs/` là cơ chế thuần;
`spells/index.ts` đã chết, không ai import.

### 2.2 Ba coupling thật sự chặn đường

| Chỗ | Vấn đề |
|---|---|
| `Champion.ts:21,137` → `spells/Recall` | Core `Champion` giữ `readonly recall`; **core không compile nổi** nếu thiếu |
| `preset.ts:28,59` → `spells/BasicAttack` | Fallback phổ quát cho slot chưa phân giải |
| `preset.ts:4,413` → `monsters/Baron` | `BARON_ABILITIES`; `Monster.ts:85` lấy Baron làm camp mặc định |

Cả ba còn là ngoại lệ chống chu trình chunk ở `vite.config.ts:297`.

**Hai coupling đầu không được gỡ theo cùng một cách.** `BasicAttack` là cơ chế
phổ quát — không tướng nào, không map nào thiếu nó — nên nó chuyển hẳn vào
core. `Recall` thì không: recall giả định một fountain, và fountain là
content của map (§7.1 đã liệt map battle-royale không lane, không fountain,
trong phạm vi). Recall ở lại làm content; chu trình tĩnh `Champion → Recall`
được phá bằng cách khác — `Champion.recall` trở thành field **nullable** mà
`preset.ts` điền, và `ChampionEntry.recall` là chỗ một pack khai nó về sau.
Đây là điều chỉnh của người dùng lên phân loại ban đầu trong đo đạc này, không
phải trôi dạt lúc code — xem §10 bước 1.

### 2.3 Bề mặt API — closure có biên, không kéo theo engine

**72 module / 110 symbol** trực tiếp (không phải ~40 như ước lượng ban đầu từ
top của bảng đếm). Transitive closure = **87 module**, và số lần nó chạm tới:

```
src/game/Game.ts          0
managers/SceneManager.ts  0
bất kỳ file .vue          0
src/generated/            1   (chỉ assetManifest.ts)
```

Lý do có chủ ý: `GameObject.game` khai kiểu `GameObjectGameContext` — interface
cấu trúc `Pick<ObjectManager,'queryObjects'> & …` ngay trong `GameObject.ts`,
**không phải** class `Game`. Seam tiêm đã được xây một nửa từ trước.

Bỏ bất kỳ dependency đơn lẻ nào chỉ làm closure nhỏ đi đúng 1 — đây là cụm dày
đặc, không có "cắt một import là cây sụp".

**Chu trình cắt ngang đường biên**: `Champion.ts → spells/Recall`. Nó cũng giải
thích hai closure lớn nhất — `GlobalShot` (57 module, 2 file dùng) và `Pet`
(56) đều đi qua `Pet → Champion → Recall`.

**Web spell-to-spell gần như champion-local**: 47 cạnh thật (238 cạnh còn lại
là barrel đã chết), hầu hết là helper passive/mark ở một slot được ba slot còn
lại của *cùng tướng* dùng. Chỉ 2 ngoại lệ (`Lux_R`, `Janna_R` chạm chiêu bổ
trợ). ⇒ Pack chia theo từng tướng là khả thi về sau.

### 2.4 Map bám Summoner's Rift tới đâu

Giả định cấu trúc lớn nhất:

> Một lane là **một polyline từ nhà xanh sang nhà đỏ**, phía bên kia là **chính
> mảng đó đảo ngược** (`lanes.ts:117-131`, `LaneObjectives.ts:176-177`).

Toàn bộ macro của bot dựng trên trục đó.

Geometry bị **nướng lúc load module** — chặn đường đổi map:

| Chỗ | Nướng cái gì |
|---|---|
| `lanes.ts:117-121` | `RED_LANE_WAYPOINTS` tính lúc import |
| `LaneObjectives.ts:122-148` | `GEOMETRY` (độ dài cung mỗi lane) tính lúc import |
| `Game.ts:106` | `readonly mapSize = 6400` — literal trên class |
| `NavGrid.ts:296-297` | `rows = cols` — map vuông đóng cứng |

Ba chỗ hardcode `json_summoner_map`: `TerrainMap.ts:40`, `preset.ts:670`,
`LoadingScene.ts:40`. **Cái cuối là boot blocker** — map nạp trước khi menu
hiện ra, nên chọn map ở pregame hiện không khả thi.

`TerrainType` chỉ có 3 loại và `TerrainMap.ts:44` **im lặng bỏ qua** layer lạ.

**Không có giả định map nào**: `FogOfWar` (theo viewport), `TerrainField` (dẫn
xuất hết từ `NavGrid`). Fountain, turret row, camp đều là data thuần với 1-2
consumer.

**Engine đã gần N-phe**: ally/enemy là `===`/`!==` trên `teamId`; tra fountain
theo `teamId` chứ không theo index; `TeamBlackboard` dựng một view cho mỗi
`teamId` gặp được. Chỗ đóng cứng chỉ có 4 — `MatchTeams.ts` (union 2 giá trị),
gate BLUE/RED ở `MinionSpawner:191`, `RosterTab` là toggle chứ không phải
picker, và trục lane.

### 2.5 Test — cái giá thật của việc tách

```
CORE 111  ·  CONTENT 67  ·  STRADDLES 59      (237 file .test.ts)
```

**Test rẻ nhất và có đòn bẩy cao nhất của engine là quét quần thể, không phải
test hành vi.** 15 test khẳng định "không file nào dưới `spells/` được làm X",
và vài cái *còn khẳng định quần thể không rỗng* vì pass rỗng là kiểu hỏng đã
biết. Chuyển đi thì thôi canh engine; giữ lại thì quét thư mục rỗng.

Mỗi seam đó tồn tại vì một lỗi hàng loạt có thật: **13** spell từng gate
targeting sai bằng `visibleToPlayerTeam`, **6** thiếu display bounds, **3**
viết `dashBuff.onUpdate` thay vì `onDashUpdate`.

Lỗi clearance của `NavGrid` chỉ lộ ra vì rừng SR có khe **60-90px**.

`tests/game/fixtures.ts` và `tests/game/spell/fixtures.ts` **không import
content nào** — đó là lý do CORE lên tới 111.

## 3. Nguyên tắc

1. **Core sở hữu những cơ chế mà mọi pack đều giả định sẵn.** Đánh thường, 24
   buff, icon buff generic. Pack *dựa vào* chúng, không cung cấp chúng.
   **Hồi thành không nằm trong danh sách này** — nó giả định một fountain, mà
   fountain là content của map (§2.2). Cái test cho nguyên tắc này là: có map
   nào hợp lệ mà cơ chế đó vô nghĩa không? Đánh thường thì không có map nào;
   hồi thành thì có, và §7.1 liệt nó trong phạm vi.
2. **Data khai "ở đâu", code khai "là gì".** Áp dụng đồng nhất cho tướng/chiêu
   và cho slot/monster.
3. **Ranh giới được ép bằng test, không bằng kỷ luật.** Đúng idiom
   `matchConfigChunk.test.ts` + `check-chunks.mjs` đã dùng.
4. **Không bịt cửa GĐ2.** Mọi hợp đồng phải chạy giống hệt ở build-time và
   runtime.

## 4. Hợp đồng pack

Pack là **một factory nhận API object**, không phải module xuất trực tiếp:

```ts
export type ContentPackFactory = (api: ContentApi) => ContentPack;

export interface ContentPack {
  manifest:   PackManifest;                 // id, version, coreRange, assets
  spells?:    Record<string, SpellClass>;   // CODE
  champions?: ChampionEntry[];              // DATA
  monsters?:  Record<string, MonsterDef>;   // DATA + code, khai `fills[]`
  maps?:      MapDefinition[];              // DATA
}
```

**Vì sao factory, không phải export trực tiếp.** Pack bundle bản sao core của
riêng nó thì có hai class cùng tên: `instanceof` gãy, tra `Z_INDEX_MAP` theo
base class trượt (spell của pack rơi xuống z-index 99, đè lên champion), buff
registry thành hai bản. Factory đảm bảo **đúng một bản core**, và nó chạy y hệt
ở cả hai giai đoạn:

```
GĐ1  import factory from '@lol2d/content-riot'    → factory(api)
GĐ2  const { default: factory } = await import(url) → factory(api)
```

### 4.1 Vì sao spell ở lại TypeScript

241 spell = **63,875 dòng**, median 249, p90 406, max 835 (`Irelia_Q`). Format
JSON đủ sức diễn đạt chúng thì đã là một ngôn ngữ lập trình cộng VM, và sẽ vứt
bỏ `docs/VFX_STANDARD.md` — VFX ở đây là code p5 vẽ tay.

Type của TypeScript **không tồn tại lúc runtime**. Pack `devDependencies` vào
`@lol2d/core` để có type + autocomplete lúc viết; lúc build core là `external`;
lúc chạy không còn type nào. An toàn ở đường biên đến từ **validate runtime**
(§6), không từ type.

### 4.2 Namespace id

Mọi id là `<packId>:<localId>`. Tác giả viết `Fizz_E`, registry gắn thành
`riot:Fizz_E`.

**Hệ quả cần migration**: `lol2d:pregameConfig:v1` hiện lưu id trần. Id không
tiền tố ⇒ hiểu là pack mặc định. Đây là thay đổi dữ liệu người dùng, phải làm
có chủ đích.

### 4.3 Gộp nhiều pack

| section | gộp thế nào |
|---|---|
| `spells` | theo id đầy đủ (không thể đụng) |
| `champions` | nối |
| `monsters` | theo id đầy đủ |
| `maps` | **liệt kê, chọn một mỗi trận** |

`maps` là **lựa chọn chứ không phải gộp** — một trận có nhiều tướng nhưng chỉ
một thế giới.

## 5. `ContentApi`

110 symbol chia 8 namespace:

```ts
interface ContentApi {
  // base class để extend
  Spell; SpellObject; MissileSpellObject; HomingMissileSpellObject;
  AreaSpellObject; BeamSpellObject; AoePulse;

  units:   { AttackableUnit, Champion, Pet, Monster }   // 92/126 chỉ là type
  buffs:   { Slow, Dash, Stun, Root, Airborne, Shield, … }   // 24 constructor
  combat:  { Reach, Vision, TargetResolver, ExecuteTargeting, BasicAttack, … }
  vfx:     { CastBar, CastTelegraph, ChargeRangeTelegraph, VfxGroup, … }
  helpers: { ParticleSystem, TrailSystem, CombatText }
  enums:   { BuffAddType, EventType, StatusFlags, ActionState, … }
  terrain: { wallOutlinesInArea, TerrainField, DynamicWall }
  utils:   { vector, collide, quadtree, SAT }
  asset:   (key: string) => AssetHandle
}
```

24 buff là **class được `new` trực tiếp** (`Slow` 64 lần, `Dash` 51, `StatAmp`
33), không phải API. Chúng là cơ chế (làm chậm, choáng, trói, hất tung, khiên)
chứ không phải IP, nên ở lại core và được tiêm dưới dạng constructor.

`AssetKey`: core giữ union typed cho asset của nó; asset pack là `string` khai
trong manifest, resolve theo base của pack; **pack tự chạy `assets:generate`
nên có union typed riêng bên trong**. Type safety không mất, nó dừng ở đúng
đường biên nơi validate runtime tiếp quản.

## 6. `MapDefinition`

```jsonc
{
  "id": "summoners-rift",
  "size": 6400,
  "terrain": { "wall": [...], "bush": [...], "water": [...] },

  "factions": [ { "id": "blue" }, { "id": "red" } ],

  "slots": {
    "spawn":     [ { "faction": "blue", "x": …, "y": …, "r": … } ],
    "minion":    [ { "faction": "blue", "lane": "MID", "x": …, "y": … } ],
    "structure": [ { "faction": "blue", "kind": "turret", "x": …, "y": … } ],
    "neutral":   [ { "role": "epic", "x": …, "y": …, "r": 100 } ]
  },

  "lanes": [ { "id": "MID", "from": "blue", "to": "red", "waypoints": [...] } ]
}
```

Mọi thứ "đặt ở đâu" là `slots` — một cơ chế, bốn chỗ dùng.

**`role` và `kind` khác nhau, và sự khác nhau đó là cố ý.** `slots.neutral.role`
là **chuỗi tự do** vì thứ lấp vào nó đến từ pack — core chỉ so khớp chuỗi.
`slots.structure.kind` là **từ vựng của core** (`turret`, và về sau là loại
công trình khác core cung cấp), vì `Turret` và `Fountain` là class của core chứ
không phải content; `kind` lạ là lỗi validate.

`slots.spawn` **chính là chỗ đặt fountain** — nó thay `FountainPreset`, và `r`
là bán kính hồi phục.

**`minion` là slot, không phải tính toán.** `MinionSpawner.musterPointFor` lấy
trung điểm hai trụ gần fountain nhất; nó tồn tại chỉ vì không có chỗ nào khai.
Có slot thì **xoá** nó cùng `MUSTER_SCATTER_PX`.

**Slot trung lập khai vai trò, không khai con quái.** Map nói "chỗ này là camp
`epic`, bán kính 100"; monster nói `fills: ["epic"]`. `role` là **chuỗi tự
do** — core chỉ so khớp, không cần biết "epic" nghĩa là gì. Slot không ai lấp
thì để trống, map vẫn chơi được.

Gọn hơn dữ liệu hiện tại: `MonsterPreset` trộn vị trí với thân phận nên một bầy
sói phải viết ba dòng buộc bằng `campId`. Tách ra:

```
hiện tại:     21 entry (9 camp × trộn vị trí + thân phận)
sau khi tách:  9 slot + 6 định nghĩa monster
```

`campId` biến mất — nó tồn tại chỉ vì hai thứ bị nhốt chung.

**Hai pack cùng khai `fills: ["epic"]`**: mặc định theo thứ tự pack, đè được ở
tab Trận đấu. Cửa để ngỏ (chưa làm): bốc ngẫu nhiên mỗi trận — với game
sandbox thì "rừng khác nhau mỗi ván" là luật rất hợp, và thiết kế này cho phép
nó gần như miễn phí.

### 6.1 Validate phải bắt được bất biến

Hỏng âm thầm là kiểu hỏng của phần này. `musterPointFor` thiếu trụ thì trả
`null` và cả wave rơi ngược vào fountain — mãi tới wave đầu mới lộ.
`TerrainMap.ts:44` im lặng bỏ layer lạ.

`validate.ts` kiểm lúc **nạp pack**, báo lỗi có tên: faction được tham chiếu
phải tồn tại; lane `from`/`to` phải là faction đã khai; layer terrain ngoài
`TerrainType` là lỗi chứ không phải bỏ qua; mọi `role` trong `slots.neutral`
không ai `fills` là cảnh báo.

## 7. Phe, lane và luật

Battle royale (map rừng, mọi người farm và đánh nhau, ai còn lại thì thắng)
**không cần lane N-phe** — nó cần **lane là tuỳ chọn**. Đó là câu hỏi khác và
rẻ hơn nhiều:

- Map khai `lanes[]` → có thì có wave, không có thì không
- `BotBrain` chỉ có **PUSH** cần lane; không lane thì bot rơi xuống ROAM/FIGHT,
  vốn đã là đường rơi sẵn có
- Trục `1 - progress` sống bên trong lane, nên map không lane không chạm vào nó

`factions` là danh sách; một phần tử cũng hợp lệ.

**Win condition là luật do pack khai, không phải luật của engine.** Pack
sandbox không khai gì (trận không có hồi kết — thiết kế hiện tại giữ nguyên);
pack BR khai "còn một người". Engine chỉ hỏi.

`MapDefinition` khai *nó có gì*; `rules` khai *khi nào trận kết thúc, nếu có*.

### 7.1 Ranh giới phạm vi

| Vào GĐ1 | Ra ngoài GĐ1 |
|---|---|
| Map **không lane**, N người chơi | Map **có lane** với 3+ phe |
| `teamId` mở thành chuỗi tự do | Trục lane viết lại cho N phe |
| Win condition tuỳ chọn do pack khai | Map không vuông |
| `mapSize` thành giá trị per-match | |
| Gỡ geometry khỏi module-load | |

Map không vuông: `rows = cols` một dòng, quadtree hai dòng, minimap ba hàm —
không khó, chỉ **chưa ai cần**. Thêm `width`/`height` sau là thay đổi cộng
thêm.

## 8. Test

### 8.1 Seam thành luật xuất khẩu được

```
core xuất:   @lol2d/core/seams        — luật, dạng chạy được
pack chạy:   lol2d-check-seams ./src  — trên cây của chính nó
```

Luật sống cùng engine sở hữu nó nên tiến hoá theo engine; quần thể sống cùng
content; pack vi phạm thì **build của pack đỏ**, không phải build của engine.

15 seam phải trỏ lại: `mana-spend`, `dash-onupdate`, `target-vision`,
`unit-target-team`, `castspec-frozen`, `cooldowns`, `TargetingModeDeclared`,
`terrain-field`, `cc-buff-icons`, `buff-deactivate`, `stat-resource-modifier`,
`spell-object-display-box`, `attack-gate`, `spell-runtime-drive`, và nửa scan
của `SpellAimIntegration`.

**Giữ nguyên, không sửa**: `bot-aim-seam` và nửa scan của
`TeamBlackboard.lanes` — không phụ thuộc content chút nào.
`matchConfigChunk` giữ nguyên nhưng thêm specifier content package vào danh
sách cấm. `pregameBootPath` **phải trỏ lại** — module specifier nó grep sẽ
không còn tồn tại.

### 8.2 Reference pack phải cố tình khó chịu

Reference pack chữa được "quét rỗng" nhưng **không chữa được độ phủ**. Với map
thì tệ hơn: 12 test nav/lane/muster dùng polygon soup của SR làm fixture
stress, và lỗi clearance `NavGrid` chỉ lộ vì rừng SR có khe 60-90px.

**Yêu cầu, kèm lý do, để không bị dọn dẹp về sau**: reference map phải có khe
hẹp **60-90px** và một hàng trụ **bất đối xứng** — không chỉ hợp lệ, mà cố tình
thù địch. (`MinionSpawner` lấy trung điểm hai trụ gần fountain nhất, và fixture
hiện tại tự ghi chú rằng sự bất đối xứng hai hàng là load-bearing.)

Nội dung reference pack do người dùng sáng tác hoàn toàn: 2-3 tướng, tên/art/kit
riêng, không dính Riot. Nó vừa là smoke test, vừa là tài liệu sống của
`ContentApi`, vừa là template để người khác copy — và nó khiến core là một game
hoàn chỉnh độc lập.

## 9. Build pipeline

Repo pack cần 4 lệnh, vì hôm nay chúng nằm trong core và duyệt `spells/`:

| Lệnh | Sinh ra |
|---|---|
| `assets:generate` | `AssetKey` union **của pack** |
| `spell-catalog` | catalog của pack (dựng instance rồi đọc field) |
| `check-seams` | chạy `@lol2d/core/seams` lên cây của chính nó |
| `build` | ESM bundle, core `external` |

Core giữ `assets:generate` cho ~11 asset của nó + icon buff generic +
`BasicAttack`. Icon của `Recall` đi theo pack, vì `Recall` là content (§2.2).

Phải sửa trong core: `vite.config.ts:297-306` (chunk theo đường dẫn `spells/`),
`scripts/check-chunks.mjs`, và ba chỗ hardcode `json_summoner_map`.
`LoadingScene.ts:40` là boot blocker — map phải nạp **sau** menu để chọn map ở
pregame khả thi.

**Tiêu thụ**: dev dùng npm workspace / local path; release pin pack repo qua
git dependency. **Không** đẩy pack Riot lên npm registry công khai — một
package công khai mang tên tác giả chở 396 file art Riot là bề mặt lộ hơn hẳn
một GitHub repo mà không đổi lấy tiện ích đáng kể.

### 9.1 Chỗ duy nhất GĐ1 khác GĐ2

```
src/content/install.ts
  GĐ1  mảng tĩnh các factory đã import
  GĐ2  fetch → import(blobUrl) → cache
```

Mọi thứ phía dưới `install.ts` giống hệt nhau. Đó là toàn bộ mục đích của thiết
kế này.

GĐ2 sẽ đụng CSP/service worker: p5 đã phải vendor vào `public/vendor/` vì
service worker chỉ cache được script cross-origin mà nó đã thấy fetch. Pack tải
từ URL tuỳ ý gặp đúng bức tường đó — core sẽ phải tự fetch và cất vào Cache
API/IndexedDB.

## 10. Thứ tự thi hành

Làm toàn bộ **trong repo này**, mỗi bước `verify` xanh. Bước tách repo là cơ
học và đến cuối.

1. **Gỡ ba coupling chặn đường** — `BasicAttack` về core như cơ chế built-in.
   `Recall` ở lại làm content (recall giả định một fountain, và fountain là
   content của map — điều chỉnh của người dùng lên phân loại ban đầu ở §2.2,
   không phải trôi dạt lúc code): chu trình tĩnh `Champion → Recall` bị phá
   bằng field **nullable** `Champion.recall` mà `preset.ts` điền, thay vì bằng
   cách chuyển `Recall` vào core — kết quả vẫn là chu trình biến mất và
   `GlobalShot`/`Pet` nhỏ lại, chỉ khác đích. Bỏ Baron khỏi `Monster.ts:85`
   làm mặc định. Core cần icon riêng cho `Chilled.ts:17` (`spell_anivia_e`) và
   `Speedup.ts:16` (`spell_ghost`).
2. **`src/content/`** — `ContentApi`, `ContentPack`, `PackRegistry`,
   `validate`, `install`.
3. **Reference pack ở `packs/reference/`** — *trước* khi API phải gánh 241
   spell. API thiết kế từ một consumer luôn bị uốn theo consumer đó.
4. **Gỡ geometry khỏi module-load** — `lanes.ts:117`, `LaneObjectives.ts:122`,
   `Game.ts:106`, và ba chỗ hardcode asset key.
5. **`MapDefinition` + slots** — xoá `musterPointFor`; `MonsterPreset` tách
   thành slot + monster.
6. **Content Riot vào `packs/riot/`** — refactor bind qua API.
7. **Source-scan ép ranh giới** + `@lol2d/core/seams` + trỏ lại 15 seam.
8. **Tách `packs/riot/` ra repo riêng.**

**Tám bước này là hai plan, không phải một.** Bước 1-3 (gỡ coupling, dựng
`src/content/`, viết reference pack) tự nó là một đợt hoàn chỉnh và kết thúc ở
trạng thái chạy được: core có API, có một pack thật chứng minh API đủ dùng, và
content Riot vẫn nằm nguyên chỗ cũ. Bước 4-8 là đợt di cư. Viết plan riêng cho
từng đợt; đợt hai sẽ được định hình bởi những gì đợt một học được về
`ContentApi`, và cố định nó từ bây giờ là đoán mò.

## 11. Rủi ro

**`AssetManager` + `generated/assetManifest.ts` là coupling khó nhất** —
239/241 file, và `AssetKey` sinh từ cây `assets/`. Đây là **coupling build
xuyên repo**, không phải coupling import.

**Độ phủ seam sau khi tách.** Giảm nhẹ bằng §8.1, nhưng luật engine và cây
content vẫn phải giữ đồng bộ; luật đổi mà pack không chạy lại thì im lặng mất
tác dụng. `coreRange` trong manifest là chỗ móc để phát hiện lệch.

**Tên repo.** `package.json` đang là `"lol2d"` — "LOL" nằm ngay trong đó. Đổi
sớm thì rẻ.

**Thuật ngữ thì không đụng.** `Champion`, `Minion`, `Turret`, `Fountain` là từ
chung của thể loại. Rủi ro nằm ở tên riêng, art, chỉ số và bộ kỹ năng — không
nằm ở tên một class. Refactor chúng là công lớn đổi lấy gần như không gì.
