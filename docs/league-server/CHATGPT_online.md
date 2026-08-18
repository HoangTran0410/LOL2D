Có, và có một chỗ rất dễ nhầm: **game render 60/144 FPS không có nghĩa server phải gửi state 60/144 lần mỗi giây cho mọi player**. LeagueSandbox chạy simulation khoảng 60 tick/s (`1000/60 ms` mỗi tick), nhưng thứ tạo cảm giác “realtime” là client tự render mượt giữa các update mạng, cộng với đồng bộ thời gian, prediction/anticipation và interpolation. ([GitHub][1])

Nếu xây game kiểu MOBA, mình thấy có khoảng **8 kỹ thuật đáng học nhất**.

### 1. Server simulation 60Hz, network không nhất thiết 60Hz

Ví dụ server:

```text
Simulation:
T0 ─ 16.6ms ─ T1 ─ 16.6ms ─ T2 ─ 16.6ms ─ T3
       60Hz

Network:
T0 ─────── 33ms ─────── T2 ─────── 33ms
               ~30Hz
```

Client vẫn render:

```text
frame 1
frame 2
frame 3
...
frame 144
```

và tự nội suy vị trí.

Ví dụ server mới gửi:

```text
t=1000ms: Yasuo x=100
t=1033ms: Yasuo x=110
```

client không làm:

```text
100
100
100
110
110
```

mà render:

```text
100
102
104
106
108
110
```

=> mắt thấy chuyển động liên tục.

Đây chính là **interpolation**. Client có thể render hàng trăm FPS dù snapshot từ server thưa hơn rất nhiều. Các netcode server-authoritative hiện đại cũng dùng interpolation/extrapolation/anticipation để che latency thay vì chờ RTT rồi mới vẽ mọi thứ.

---

## 2. Với chính player của mình: prediction/anticipation

Đây mới là thứ làm game có cảm giác nhạy.

Giả sử ping 80ms.

Cách ngây thơ:

```text
click
 ↓
40ms
server nhận
 ↓
server xử lý
 ↓
40ms
client nhận
 ↓
champion bắt đầu chạy
```

→ bạn click chuột mà **80ms sau mới thấy nhân vật phản ứng**.

Rất ì.

Thay vào đó:

```text
click
 ├────────► client animation/movement ngay
 │
 └────────► server
                 │
              simulate
                 │
                 ▼
            authoritative state
                 │
                 ▼
client kiểm tra prediction
```

Nếu prediction đúng:

```text
server: x = 105
client: x = 105

→ không cần làm gì
```

Nếu lệch:

```text
server: x = 104
client: x = 106

→ reconciliation
```

thường không snap cứng:

```text
106 → 104
```

mà correction dần:

```text
106
105.7
105.3
104.8
104
```

Unity mô tả đúng pattern này: client dự đoán kết quả input ngay lập tức nhưng server vẫn là authority; khi authoritative state về, client reconcile nếu prediction sai.

Với MOBA click-to-move còn có thể nhẹ hơn FPS vì đường đi tương đối deterministic.

Ví dụ server gửi:

```text
entity = Ahri
path = [
  (100,100),
  (300,150),
  (450,300)
]

moveSpeed = 350
startTime = 125481ms
```

Client **không cần server gửi position từng frame**.

Nó tự tính:

```text
position = evaluate(path, speed, serverTime)
```

Đây là optimization cực lớn.

---

# 3. Sync intent/path thay vì sync position liên tục

Đây là thứ mình rất khuyên nếu làm MOBA 2D.

Không nên:

```text
60 lần/s:

PLAYER_POSITION
x=125.241
y=436.672
```

mà nên:

```text
MOVE_COMMAND

unitId
startPosition
waypoints[]
moveSpeed
startServerTime
sequenceId
```

Sau đó client tự simulate.

Server chỉ gửi correction khi:

```text
dash
knockback
collision
teleport
speed changed
path changed
CC
desync lớn
```

Ví dụ:

```text
Player bắt đầu đi

server:
MOVE {
  id: 42,
  path: [...]
  speed: 340,
  time: 12000
}

              ↓

10 clients tự animate

              ↓

không cần spam position
```

Đó là khác biệt giữa:

> sync **state every frame**

và

> sync **state transition / intention**

Cái thứ hai rẻ hơn kinh khủng.

---

# 4. Delta replication — đừng gửi thứ không đổi

LeagueSandbox đã có hơi hướng này.

Mỗi tick nó iterate:

```text
Object
   ×
Players

→ UpdateVisionSpawnAndSync()
```

rồi cuối tick:

```text
NotifyOnReplication()
NotifyWaypointGroup()
```

([GitHub][2])

Và `GameObject.Sync()` phân biệt:

```text
not spawned
    → spawn

visibility changed
    → enter/leave vision

visible & existing
    → OnSync()
```

chứ không đơn giản recreate object cho client mỗi tick. ([GitHub][3])

Một implementation production nên đi xa hơn với **dirty flags**:

```csharp
[Flags]
enum Dirty
{
    Position = 1,
    Health   = 2,
    Mana     = 4,
    Buffs    = 8,
    Target   = 16
}
```

Ví dụ:

```text
Ahri:

HP      unchanged
mana    unchanged
level   unchanged
skin    unchanged
path    unchanged

buff added: Charm

DirtyMask = BUFF
```

Packet chỉ cần:

```text
id = 42
mask = BUFF
buff = Charm
```

Không gửi lại:

```text
x
y
hp
mana
level
attackDamage
armor
MR
...
```

---

# 5. Interest management / AoI cực kỳ quan trọng

Bạn hỏi:

> làm sao sync nhiều người cùng lúc?

Câu trả lời là:

**đừng sync mọi thứ cho mọi người.**

LeagueSandbox đã làm một phiên bản khá trực tiếp qua FoW/vision: mỗi object được kiểm tra xem player có nhìn thấy không rồi mới `Sync()`. ([GitHub][2])

Ví dụ map:

```text
              Baron

       player A



                         player B


player C
```

Player A không cần nhận:

```text
minion wave bot
enemy đang trong fog
particles ở base địch
monster không visible
```

Một hệ thống production thường chia world:

```text
┌────┬────┬────┬────┐
│    │    │ P1 │    │
├────┼────┼────┼────┤
│    │    │    │    │
├────┼────┼────┼────┤
│ P2 │    │    │    │
└────┴────┴────┴────┘
```

mỗi player subscribe các spatial cells liên quan.

Trong MOBA lại càng tiện vì còn có **Fog of War**.

Nhờ vậy server có thể có:

```text
200 game objects
```

nhưng mỗi client chỉ phải sync:

```text
40–80 relevant objects
```

---

# 6. Không để thằng mạng lag làm chậm cả match

Đây là phần trực tiếp trả lời câu:

> bất kể đường truyền mạng của từng người?

**Không thể làm nó realtime tuyệt đối bất kể mạng.** Player ping 3000ms / loss 80% thì không có thuật toán nào biến thành 20ms.

Nhưng quan trọng là:

> mạng tệ của A không được phép block B, C, D.

Server phải có state riêng theo client:

```text
Client A
ack = tick 900
ping = 20ms

Client B
ack = tick 896
ping = 90ms

Client C
ack = tick 870
ping = 500ms
```

Server vẫn simulation:

```text
tick 901
902
903
904
...
```

không bao giờ:

```text
wait Client C
```

Client C chỉ nhìn world trễ hơn.

### Đặc biệt với movement snapshot

Nếu queue có:

```text
x=100
x=105
x=110
x=115
x=120
```

và packet đầu chưa tới thì **đừng nhất thiết retransmit cả đống position cũ**.

Bởi khi:

```text
x=120
```

đã tới thì:

```text
100
105
110
115
```

gần như vô nghĩa.

Concept thường là:

```text
movement/state:
LATEST WINS
```

Trong khi:

```text
purchase item
level up
cast confirmed
death
```

thì cần semantics đáng tin cậy hơn.

Đây là lý do realtime protocol thường phân biệt **state có thể bỏ packet cũ** với **event bắt buộc phải tới**.

---

# 7. Đồng bộ clock quan trọng hơn nhiều người tưởng

Đây là một thứ Riot thực sự đã viết rất kỹ về League.

League từng có nhiều clock khác nhau khiến gameplay drift; Riot sau đó xây **Unified Clock**, hỗ trợ fixed timestep và network clock synchronization. Họ đặt mục tiêu đồng bộ clock client/server rất chính xác, lọc outlier theo network delay và điều chỉnh clock client từ từ thay vì snap thời gian để tránh artifact. ([Riot Games][4])

Tại sao clock quan trọng?

Giả sử packet:

```text
Lux Q launched
serverTime = 100000
origin = ...
direction = ...
speed = 1200
```

Client nhận lúc:

```text
100050
```

Nếu biết server clock thì nó có thể tính:

```text
elapsed = 50ms

projectilePosition =
    origin
    + direction
    * 1200
    * 0.05
```

và **vẽ projectile ngay ở chỗ nó đáng lẽ đang nằm**, thay vì spawn nó trễ 50ms tại origin.

Đây là trick cực mạnh.

Không phải:

```text
packet tới lúc nào
→ animation bắt đầu lúc đó
```

mà:

```text
event occurred @ serverTime T

packet arrives @ T + latency

client reconstruct state @ current T
```

Đó là một trong những lý do multiplayer tốt có cảm giác “mọi thứ đang ở cùng timeline”.

Riot thậm chí nói synchronized clocks mở đường cho latency compensation và dùng Aurelion Sol làm ví dụ gameplay phụ thuộc clock client/server chính xác. ([Riot Games][4])

---

# 8. Lag compensation / rewind

Cái này FPS cần nhiều hơn MOBA nhưng MOBA vẫn có trường hợp áp dụng được.

Server lưu history ngắn:

```text
tick 1000
Player B = (100, 200)

tick 1001
Player B = (104, 200)

tick 1002
Player B = (108, 200)
...
```

A có ping 100ms và cast skillshot.

Khi packet tới server:

```text
server current = 5100ms

client fired @ 5000ms
```

server có thể xét:

```text
world @ 5000ms
```

thay vì chỉ:

```text
world @ 5100ms
```

Valve/Unity gọi pattern này là **server-side rewind / lag compensation**: server dùng history để kiểm tra action trong world state mà player nhìn thấy khi input xảy ra, nhưng vẫn giữ server authority.

Tuy nhiên MOBA phải rất cẩn thận.

Ví dụ nếu rewind skillshot quá aggressively thì target sẽ thấy:

> “Tôi né rồi sao vẫn dính?”

nên phải chọn gameplay semantics phù hợp.

---

# Một kiến trúc mình sẽ dùng cho game MOBA

Nếu đang build mới, mình sẽ chia thế này:

```text
                 GAME SERVER
                     │
              fixed simulation
                   60Hz
                     │
       ┌─────────────┼──────────────┐
       │             │              │
    Combat         Movement         AI
       │             │              │
       └─────────────┼──────────────┘
                     │
                authoritative
                   state
                     │
            Replication system
                     │
       ┌─────────────┼──────────────┐
       │             │              │
      P1            P2             P3
       │             │              │
 Interest Set   Interest Set   Interest Set
       │             │              │
 Dirty state    Dirty state    Dirty state
       │             │              │
 bandwidth      bandwidth      bandwidth
 budget         budget         budget
```

Client:

```text
Network snapshots/events
          │
          ▼
     Local timeline
          │
     ┌────┴─────┐
     │          │
local player  remote player
     │          │
prediction  interpolation
     │          │
     └────┬─────┘
          ▼
       renderer
      60/144 FPS
```

---

## Và đây là điểm LeagueSandbox còn khá naive

Repo của LeagueSandbox làm:

```csharp
foreach (GameObject obj in _objects)
{
    UpdateTeamsVision(obj);

    foreach (var player in players)
    {
        UpdateVisionSpawnAndSync(obj, player);
    }
}
```

([GitHub][2])

Tức complexity gần:

```text
O(objects × players)
```

Ví dụ:

```text
300 objects
× 10 player
× 60 tick

= 180,000
```

sync/visibility considerations mỗi giây.

Với LoL-sized match thì vẫn chưa phải con số kinh dị, nhưng nếu làm mới mình sẽ không copy nguyên xi.

Dùng:

```text
spatial partition
+
team FoW cache
+
interest set cache
+
dirty replication
```

sẽ tốt hơn nhiều.

Ví dụ:

```text
FoW calculated once/team
          ↓
BLUE visibility set
          ↓
5 blue players reuse phần lớn result
```

thay vì tính ray/vision object × player từ đầu.

---

# Riot còn tối ưu một tầng mà code game không cứu được: network route

Đây cũng là nguyên nhân League có thể cảm giác ổn ngay cả khi Internet không lý tưởng.

Riot xây **Riot Direct**, đưa traffic từ ISP vào backbone của Riot càng sớm càng tốt để giảm số router trung gian, packet loss và route kém tối ưu. Riot từng mô tả việc trực tiếp peering với ISP tại nhiều điểm và chọn fiber route phù hợp; trong rollout Bắc Mỹ lúc đó, tỷ lệ player dưới 80ms tăng đáng kể. ([Riot Games][5])

Tức smoothness có hai phần:

```text
GAME NETCODE
prediction
interpolation
delta replication
clock sync
lag compensation

            +

INFRASTRUCTURE
server location
peering
routing
backbone
packet loss
jitter
```

Code tốt không thể chữa một route mạng vòng nửa thế giới.

---

## Nếu xếp theo độ đáng học cho project MOBA

Mình sẽ ưu tiên theo thứ tự:

**1. Server authoritative + fixed tick**

```text
60Hz simulation
```

**2. Event/path-based movement**

```text
send path
không spam x/y
```

**3. Network clock synchronization**

```text
serverTime
sequence/tick
```

**4. Client interpolation**

cho tất cả remote entities.

**5. Local anticipation/prediction**

đặc biệt movement/UI/VFX.

**6. Dirty/delta replication**

chỉ state thay đổi mới gửi.

**7. Interest management + FoW**

player không thấy thì không network.

**8. Per-client queues + bandwidth budget**

player lag không block match.

Sau này mới cần:

```text
server rewind
adaptive snapshot rate
packet prioritization
bit packing/quantization
spatial indexes
```

Riot cũng nhấn mạnh rằng khi đẩy tick rate cao, CPU budget mỗi frame trở thành vấn đề lớn. Ở VALORANT 128 tick, mỗi tick chỉ có 7.8125ms; họ phải profile riêng các nhóm như replication, FoW, network và tối ưu server frame từ khoảng 50ms xuống dưới 2ms. ([Riot Games][6])

**Điểm mình thấy đáng copy từ LoL nhất không phải “60 tick”. Là ý tưởng: *server mô phỏng truth, client mô phỏng perception*.** Server giữ đúng game; client dùng interpolation/prediction/time reconstruction để biến những gói packet rời rạc thành chuyển động 60/144 FPS liên tục.

Nếu bro muốn, mình có thể bóc tiếp thành một **network architecture cụ thể cho game 2D MOBA của bro**, ví dụ packet nào nên gửi reliable/unreliable, struct `Snapshot`, `MoveCommand`, `CastSpell`, ACK/sequence, dirty mask, interpolation buffer… luôn ở mức implement được bằng code.

[1]: https://raw.githubusercontent.com/LeagueSandbox/GameServer/indev/GameServerLib/Game.cs "raw.githubusercontent.com"
[2]: https://raw.githubusercontent.com/LeagueSandbox/GameServer/indev/GameServerLib/ObjectManager.cs "raw.githubusercontent.com"
[3]: https://raw.githubusercontent.com/LeagueSandbox/GameServer/indev/GameServerLib/GameObjects/GameObject.cs "raw.githubusercontent.com"
[4]: https://technology.riotgames.com/news/determinism-league-legends-unified-clock "Determinism in League of Legends: Unified Clock | Riot Games"
[5]: https://technology.riotgames.com/news/fixing-internet-real-time-applications-part-ii "Fixing the Internet for Real Time Applications: Part II | Riot Games"
[6]: https://technology.riotgames.com/news/valorants-128-tick-servers "VALORANT's 128-Tick Servers | Riot Games"
