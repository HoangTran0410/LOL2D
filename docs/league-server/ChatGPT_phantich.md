Ừ bro, mình bóc khá sâu repo `LeagueSandbox/GameServer` rồi. Kiến trúc của nó **không phải kiểu “mỗi champion là một class tự chạy hết mọi thứ”**. Nó giống một **mini game engine/server framework**: core engine xử lý tick, object, movement, collision, network, replication; còn champion/spell/item/buff/map được cắm vào bằng script C#. Repo hiện đã archive từ ngày 3/9/2022. ([GitHub][1])

## 1. Nhìn toàn bộ kiến trúc trước

Có thể hình dung repo như này:

```text
                       CLIENT
                         │
                 movement / cast / buy...
                         │
                         ▼
                  ┌─────────────┐
                  │ PacketServer│
                  └──────┬──────┘
                         │ decode packet
                         ▼
                ┌──────────────────┐
                │ RequestHandler<T>│
                └────────┬─────────┘
                         │
              ┌──────────┴───────────┐
              │                      │
        HandleMove             HandleCastSpell
              │                      │
              ▼                      ▼
      Champion.SetWaypoints()   Spell.Cast()
              │                      │
              │                Script callback
              │                      │
              └──────────┬───────────┘
                         ▼
                 ┌──────────────┐
                 │ GAME STATE   │
                 │ GameObjects  │
                 └──────┬───────┘
                        │
                  60 ticks/sec
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
        Map         Objects       Timers/Buffs
      collision      Update         Events
                        │
                        ▼
                vision + replication
                        │
                        ▼
                     CLIENT
```

Đây là **server-authoritative simulation** khá rõ. Client chủ yếu gửi **intention/order** như “đi tới đây”, “cast spell slot Q về hướng này”; server mới quyết định path, spell có cast được không, projectile có hit không, damage bao nhiêu, object chết/chưa chết... rồi replicate kết quả ngược lại client. ([GitHub][2])

---

# 2. Các project chính để khỏi lạc

Root của repo có `GameServerCore`, `GameServerLib`, `GameServerConsole`, `Content`, `GameMaths`, `QuadTree`, `LeaguePackets`... ([GitHub][1])

| Phần                            | Vai trò                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `GameServerCore`                | Contract/type chung: domain, enums, packet definitions, interfaces |
| `GameServerLib`                 | **Engine/runtime chính**                                           |
| `GameServerConsole`             | bootstrap/chạy server                                              |
| `Content/LeagueSandbox-Scripts` | **logic champion, spell, buff, item, map, AI**                     |
| `GameMaths`                     | toán/game geometry                                                 |
| `QuadTree`                      | spatial structure                                                  |
| `LeaguePackets`                 | protocol/packet definitions                                        |

`GameServerCore` thực tế khá mỏng: `Content`, `Domain`, `Enums`, `Packets`... Trong khi `GameServerLib` chứa `Game.cs`, `ObjectManager.cs`, `Server.cs`, `GameObjects`, `Packets`, `Handlers`, `Inventory`, `Players`, `Scripting/CSharp`..., nên **nếu muốn hiểu engine thì bắt đầu từ `GameServerLib`, đừng bắt đầu từ `GameServerCore`**. ([GitHub][3])

---

# 3. Entry point thực tế: `Server → Game`

`Server.Start()` làm khá ít:

```text
Server.Start()
   │
   ├─ new PacketServer()
   │
   ├─ packetServer.InitServer(...)
   │
   └─ game.Initialize(config, packetServer)

Server.StartNetworkLoop()
   │
   └─ game.GameLoop()
```

Tức là `Server` gần như wrapper bootstrap networking + game. **Trái tim thật sự là `Game.cs`.** ([GitHub][4])

Trong `Game()` nó tạo các manager:

```text
ItemManager
ChatCommandManager
NetworkIdManager
PlayerManager
CSharpScriptEngine
RequestHandler
ResponseHandler
```

Rồi `Game.Initialize()` load content, tạo `MapScriptHandler`, `PacketNotifier`, `ObjectManager`, `ProtectionManager`, setup các API event/function manager, init map, register packet handlers và add player. ([GitHub][5])

Nói ngắn gọn:

```text
Game = "world context / game runtime"

Game
 ├── ObjectManager
 ├── PlayerManager
 ├── Map
 ├── ItemManager
 ├── ScriptEngine
 ├── PacketNotifier
 ├── RequestHandler
 └── ProtectionManager
```

Nó hơi có mùi **God Object**, nhưng với một game server nhỏ thì cách này rất dễ follow.

---

# 4. Game loop — phần core nhất repo

Đây mới là nơi đáng đọc nhất.

`GameLoop()` chạy target khoảng **60 tick/s**. Mỗi vòng tính `deltaTime`, update simulation nếu game đang running, sau đó gọi network loop với timeout còn lại. ([GitHub][5])

Logic một tick gần như:

```csharp
GameTime += diff;

Map.Update(diff);

ObjectManager.Update(diff);

ProtectionManager.Update(diff);

ChatCommands.Update(diff);

GameScriptTimers.Update(diff);

if (10_seconds_passed)
    SyncGameTime();
```

Đây chính xác là thứ tự trong `Game.Update()`. ([GitHub][5])

Có nghĩa:

```text
Tick N
 │
 ├─ update collision/map
 │
 ├─ update toàn bộ entity
 │
 ├─ update targetability/protection
 │
 ├─ commands
 │
 ├─ timers
 │
 └─ replication/time sync
```

Không có Unreal/Unity style scene graph, cũng không phải ECS. Đây là **classic OOP game loop + manager pattern**.

---

# 5. `ObjectManager` mới thực sự là engine simulation

`ObjectManager.Update()` rất đáng học.

Flow của nó:

```text
for each GameObject:
    obj.Update(diff)

        ↓

tìm object IsToRemove()

        ↓

apply deferred removals

        ↓

apply deferred additions

        ↓

for each GameObject:
    update team vision

    obj.LateUpdate(diff)

    for each Player:
        UpdateVisionSpawnAndSync(obj, player)

    obj.OnAfterSync()

        ↓

send replication
send waypoint group
```

Code của repo đúng gần như y chang flow trên. ([GitHub][6])

### Có 2 design rất ổn ở đây

Thứ nhất là **deferred add/remove**.

Trong lúc:

```csharp
foreach (_objects)
```

không remove/add trực tiếp collection. Nó queue vào:

```text
_objectsToAdd
_objectsToRemove
```

sau `Update()` mới commit. Nhờ vậy tránh invalidating iterator và tránh state giữa tick bị nửa cũ nửa mới. ([GitHub][6])

Thứ hai là **update gameplay trước, sync network sau**:

```text
Update()
   ↓
LateUpdate()
   ↓
Vision
   ↓
Replication
```

Thế nên client nhận **state sau khi simulation của tick đã hoàn thành**, khá đúng kiểu authoritative server.

---

# 6. Entity hierarchy rất cổ điển

Hierarchy chính là:

```text
GameObject
   │
   ▼
AttackableUnit
   │
   ▼
ObjAIBase
   │
   ├── Champion
   ├── Minion
   ├── Monster
   ├── Pet
   └── ...
```

`AttackableUnit : GameObject` bổ sung những thứ như death state, forced movement, CC, stats, buffs, damage. ([GitHub][7])

`ObjAIBase : AttackableUnit` thêm movement, inventory, targeting, attacking và spells. ([GitHub][8])

`Champion : ObjAIBase` thêm player-specific state như gold, rune/talent, skill points, shop, respawn, summoner spells... ([GitHub][9])

Đây là điểm rất quan trọng:

```text
Champion KHÔNG tự implement toàn bộ game logic.

Champion
    ↓
ObjAIBase
    ↓
AttackableUnit
    ↓
GameObject
```

Phần chung được reuse hết.

Ví dụ:

```text
TakeDamage()
Buff
Stats
Movement
AutoAttack
Inventory
Spell slots
Waypoints
Vision
Replication
```

đều nằm ở các lớp engine chung.

Champion script chỉ tập trung vào **“chiêu này làm gì”**.

---

# 7. Network request đi vào gameplay như thế nào?

Trong `Game.InitializePacketHandlers()` nó register type → handler:

```csharp
CastSpellRequest → HandleCastSpell
MovementRequest  → HandleMove
BuyItemRequest   → HandleBuyItem
UpgradeSpellReq  → HandleUpgradeSpell
SpawnRequest     → HandleSpawn
...
```

([GitHub][5])

Đây là architecture khá clean:

```text
network protocol
      ↓
packet DTO
      ↓
packet handler
      ↓
domain/game API
```

Packet code không cần biết Ezreal Q damage bao nhiêu.

---

# 8. Ví dụ movement: client không tự quyết vị trí

`HandleMove` là ví dụ rất rõ.

Client gửi:

```text
MovementRequest
 ├─ OrderType
 ├─ Waypoints
 ├─ Position
 └─ TargetNetID
```

Server lấy champion, lấy `NavigationGrid`, translate coordinates rồi kiểm tra đường đi. Nếu segment bị map chắn nó gọi:

```csharp
nav.GetPath(...)
```

sau đó mới:

```csharp
champion.UpdateMoveOrder(...)
champion.SetWaypoints(...)
champion.SetTargetUnit(...)
```

([GitHub][10])

Tức client nói:

> “Tôi muốn đi tới X.”

chứ không phải:

> “Tôi hiện đang ở X, server tin tôi đi.”

Đây là điểm cốt lõi của authoritative multiplayer server.

---

# 9. Spell flow mới là phần thú vị nhất

Ví dụ user bấm Q:

```text
Client
 │
 │ CastSpellRequest(slot = Q)
 ▼
HandleCastSpell
 │
 ├─ resolve Champion
 ├─ resolve target
 ├─ owner.Spells[slot]
 ├─ owner.CanCast(spell)
 │
 ▼
Spell.Cast(...)
 │
 ▼
Spell engine
 │
 ├─ windup
 ├─ cast info
 ├─ cooldown
 ├─ missile
 └─ events
       │
       ▼
Champion C# script
```

`HandleCastSpell` thực sự chỉ lấy `owner.Spells[req.Slot]`, check `owner.CanCast(s)` và gọi:

```csharp
s.Cast(req.Position, req.EndPosition, targetUnit)
```

([GitHub][2])

**Không có đoạn kiểu:**

```csharp
if champion == EZREAL:
   DealDamage(...)
```

ở packet layer.

Đây là design đúng.

---

# 10. Vậy logic từng tướng nằm đâu?

Ở:

```text
Content/
└─ LeagueSandbox-Scripts/
   ├─ AIScripts/
   ├─ Buffs/
   ├─ Characters/
   ├─ Items/
   ├─ Maps/
   └─ Talents/
```

([GitHub][11])

Ví dụ:

```text
Characters/
└─ Ezreal/
   ├─ CharScriptEzreal.cs
   ├─ Q.cs
   ├─ W.cs
   ├─ E.cs
   └─ R.cs
```

Tức **data/engine và ability implementation được tách ra**.

---

# 11. Ezreal Q cho thấy triết lý của cả repo

Trong `Ezreal/Q.cs`:

```csharp
public class EzrealMysticShot : ISpellScript
```

Script có callback kiểu:

```csharp
OnActivate(...)
OnSpellCast(...)
OnSpellPostCast(...)
```

Sau cast nó tạo spell/projectile phụ theo target position. ([GitHub][12])

Phần missile lại là script riêng:

```csharp
public class EzrealMysticShotMissile : ISpellScript
```

Trong `OnActivate()` nó subscribe:

```csharp
ApiEventManager.OnSpellHit.AddListener(...)
```

Khi missile hit:

```text
OnSpellHit
   ↓
TargetExecute()
   ↓
calculate AD
calculate AP
   ↓
target.TakeDamage(...)
   ↓
lower Q/W/E/R cooldown
   ↓
particle
   ↓
missile.SetToRemove()
```

Đúng logic trong source. ([GitHub][12])

Đây chính là **event-driven ability system**.

Engine chỉ biết:

```text
spell
missile
collision
hit
damage
buff
event
```

Còn script định nghĩa:

```text
khi hit thì làm gì?
damage formula gì?
buff gì?
cooldown interaction gì?
particle gì?
```

---

# 12. Script không phải DLL build sẵn bình thường

Repo có `CSharpScriptEngine`.

Cái này khá hay: nó scan toàn bộ:

```text
*.cs
```

trong content folder, dùng **Roslyn (`Microsoft.CodeAnalysis.CSharp`)** parse source và compile thành dynamic assembly lúc runtime. ([GitHub][13])

Nôm na:

```text
Characters/Ezreal/Q.cs
Characters/Lux/Q.cs
Items/...
Buffs/...
       │
       ▼
CSharpSyntaxTree.ParseText()
       │
       ▼
Roslyn compilation
       │
       ▼
runtime Assembly
       │
       ▼
find ISpellScript / IBuffScript / ...
       │
       ▼
instantiate
```

Điều này cho phép engine không phải rebuild mỗi lần sửa một spell.

Nó thậm chí có **hot reload** bằng `FileSystemWatcher`: content thay đổi → gọi lại `LoadScripts()` → reload char scripts, buffs và spells của các object đang tồn tại. ([GitHub][5])

Khá xịn đối với project thời đó.

---

# 13. Event system là keo nối giữa engine với gameplay

Có thể thấy Ezreal Q làm:

```csharp
ApiEventManager.OnUpdateStats.AddListener(...)
ApiEventManager.OnSpellHit.AddListener(...)
```

([GitHub][12])

Đây là lý do spell script không cần sửa engine.

Ví dụ engine phát:

```text
OnSpellHit
OnUpdateStats
OnPreTakeDamage
...
```

Script chỉ subscribe.

Có thể hình dung:

```text
                         ┌── Yasuo Q script
                         │
Engine event ────────────┼── Ezreal Q script
                         │
                         ├── Buff script
                         │
                         └── Item script
```

Đây là pattern mà mình thấy **đáng lấy nhất từ repo này**.

---

# 14. Damage cũng chia core / ability rất rõ

Ability tính **raw/intended damage**:

```csharp
damage =
    baseDamage
    + AD scaling
    + AP scaling;
```

rồi:

```csharp
target.TakeDamage(...)
```

Ví dụ Ezreal Q thực hiện chính xác kiểu đó. ([GitHub][12])

Sau đó `AttackableUnit.TakeDamage()` mới là pipeline chung của engine — nhận attacker, damage type/source, stats, mitigation, events... `AttackableUnit` cũng sở hữu death state, stats, buffs và replication liên quan. ([GitHub][7])

Thành ra:

```text
Champion Script
"Q gây 100 + 1.0 AD"
        │
        ▼
AttackableUnit.TakeDamage()
        │
        ├─ armor/MR
        ├─ shields/buffs/events
        ├─ health
        ├─ death
        └─ replication
```

Đây là separation rất đúng.

---

# 15. Core design của LeagueSandbox thực ra có thể tóm trong 5 khối

```text
                     GAME
                      │
         ┌────────────┼─────────────┐
         │            │             │
         ▼            ▼             ▼
      Network     Simulation      Content
         │            │             │
         ▼            ▼             ▼
    PacketHandler ObjectManager   C# Scripts
         │            │             │
         │        GameObjects       │
         │            │             │
         └────────────┼─────────────┘
                      ▼
                 Event / API
                      │
                      ▼
               PacketNotifier
                      │
                      ▼
                    Client
```

Nếu phải gọi tên architecture thì mình sẽ gọi nó là:

**Authoritative tick-based OOP game server + event-driven runtime scripting + state replication.**

Không phải ECS.

Không phải deterministic lockstep.

Không phải client-authoritative.

---

# 16. Điểm mình thấy hay và điểm hơi cũ

**Hay nhất:** engine/gameplay separation rất rõ. Projectile, movement, damage pipeline, stats, buffs, replication đều reusable; mỗi champion chỉ cần script behavior. Hệ thống dynamic C# script + hot reload cũng làm development spell rất tiện. ([GitHub][13])

**Hơi cũ:** inheritance khá sâu:

```text
GameObject
 → AttackableUnit
 → ObjAIBase
 → Champion
```

và rất nhiều manager cùng hội tụ vào `Game`. `Game.cs` vừa lifecycle, network handler registration, managers, scripting, timers, map, start/stop..., nên dependency khá chặt. ([GitHub][5])

Ngoài ra đoạn vision sync:

```text
for each object
    for each player
        UpdateVisionSpawnAndSync()
```

cho thấy approach thiên về server nhỏ/match nhỏ hơn là architecture MMO scale lớn. ([GitHub][6])

Nhưng với MOBA 10 player thì **architecture kiểu này hoàn toàn hợp lý**.

---

# 17. Nếu chỉ muốn hiểu repo, đọc đúng 8 file này

Đừng đọc cả repo từ đầu đến cuối. Thứ tự mình khuyên:

1. `GameServerLib/Server.cs` — server bootstrap. ([GitHub][4])
2. `GameServerLib/Game.cs` — lifecycle + game loop + manager wiring. ([GitHub][5])
3. `GameServerLib/ObjectManager.cs` — entity tick + replication. ([GitHub][6])
4. `GameServerLib/GameObjects/GameObject.cs` — base entity.
5. `GameObjects/AttackableUnits/AttackableUnit.cs` — damage/buff/stats/death. ([GitHub][7])
6. `GameObjects/AttackableUnits/AI/ObjAIBase.cs` — movement/attack/spells. ([GitHub][8])
7. `Packets/PacketHandlers/HandleCastSpell.cs` — network → gameplay. ([GitHub][2])
8. `Content/LeagueSandbox-Scripts/Characters/Ezreal/Q.cs` — gameplay → script/event/damage. ([GitHub][12])

Đọc hết 8 file đó là hiểu khoảng **70–80% triết lý của cả server**, không cần mò hàng nghìn file.

### Flow quan trọng nhất cần nhớ

```text
INPUT
Client packet
   ↓
PacketHandler
   ↓
Champion / Spell / Movement command

SIMULATION
   ↓
GameLoop 60Hz
   ↓
ObjectManager.Update()
   ↓
GameObject.Update()
   ↓
Spell / Buff / Movement / Combat
   ↓
Events
   ↓
C# gameplay scripts

OUTPUT
   ↓
LateUpdate
   ↓
Vision
   ↓
Replication
   ↓
PacketNotifier
   ↓
Client
```

**Nếu nhìn ở góc game-engine thì đây mới chính là “core” của LeagueSandbox.** Champion Yasuo/Ezreal/Lux thực ra chỉ là content plugin chạy trên bộ engine này.

Nếu muốn đào tiếp, phần đáng bóc nhất tiếp theo là **một flow hoàn chỉnh của `Spell.Cast()` → tạo `SpellMissile` → missile movement/collision → `OnSpellHit` → `TakeDamage()` → death/replication**. Cái đó sẽ cho thấy gần như toàn bộ combat engine hoạt động end-to-end.

[1]: https://github.com/LeagueSandbox/GameServer "GitHub - LeagueSandbox/GameServer: League Sandbox's Game Server · GitHub"
[2]: https://github.com/LeagueSandbox/GameServer/blob/indev/GameServerLib/Packets/PacketHandlers/HandleCastSpell.cs "GameServer/GameServerLib/Packets/PacketHandlers/HandleCastSpell.cs at indev · LeagueSandbox/GameServer · GitHub"
[3]: https://github.com/LeagueSandbox/GameServer/tree/indev/GameServerCore "GameServer/GameServerCore at indev · LeagueSandbox/GameServer · GitHub"
[4]: https://github.com/LeagueSandbox/GameServer/blob/indev/GameServerLib/Server.cs "GameServer/GameServerLib/Server.cs at indev · LeagueSandbox/GameServer · GitHub"
[5]: https://github.com/LeagueSandbox/GameServer/blob/indev/GameServerLib/Game.cs "GameServer/GameServerLib/Game.cs at indev · LeagueSandbox/GameServer · GitHub"
[6]: https://github.com/LeagueSandbox/GameServer/blob/indev/GameServerLib/ObjectManager.cs "GameServer/GameServerLib/ObjectManager.cs at indev · LeagueSandbox/GameServer · GitHub"
[7]: https://github.com/LeagueSandbox/GameServer/blob/indev/GameServerLib/GameObjects/AttackableUnits/AttackableUnit.cs "GameServer/GameServerLib/GameObjects/AttackableUnits/AttackableUnit.cs at indev · LeagueSandbox/GameServer · GitHub"
[8]: https://github.com/LeagueSandbox/GameServer/blob/indev/GameServerLib/GameObjects/AttackableUnits/AI/ObjAIBase.cs "GameServer/GameServerLib/GameObjects/AttackableUnits/AI/ObjAIBase.cs at indev · LeagueSandbox/GameServer · GitHub"
[9]: https://github.com/LeagueSandbox/GameServer/blob/indev/GameServerLib/GameObjects/AttackableUnits/AI/Champion.cs "GameServer/GameServerLib/GameObjects/AttackableUnits/AI/Champion.cs at indev · LeagueSandbox/GameServer · GitHub"
[10]: https://github.com/LeagueSandbox/GameServer/blob/indev/GameServerLib/Packets/PacketHandlers/HandleMove.cs "GameServer/GameServerLib/Packets/PacketHandlers/HandleMove.cs at indev · LeagueSandbox/GameServer · GitHub"
[11]: https://github.com/LeagueSandbox/GameServer/tree/indev/Content/LeagueSandbox-Scripts "GameServer/Content/LeagueSandbox-Scripts at indev · LeagueSandbox/GameServer · GitHub"
[12]: https://github.com/LeagueSandbox/GameServer/blob/indev/Content/LeagueSandbox-Scripts/Characters/Ezreal/Q.cs "GameServer/Content/LeagueSandbox-Scripts/Characters/Ezreal/Q.cs at indev · LeagueSandbox/GameServer · GitHub"
[13]: https://github.com/LeagueSandbox/GameServer/blob/indev/GameServerLib/Scripting/CSharp/CSharpScriptEngine.cs "GameServer/GameServerLib/Scripting/CSharp/CSharpScriptEngine.cs at indev · LeagueSandbox/GameServer · GitHub"
