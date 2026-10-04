# TH06 与 NP21 联机实现对照

2026-10-04，源码只读分析；未改游戏实现、未运行测试。分析目录：th06-eagler/th06-eagler 与 eagler-common-main/eagler-common-main。TH06 的 .gitmodules 指向 eagler-common，但本地 third_party/eagler-common 没有可读取源码；当前独立 common 目录不保证等同 TH06 当时锁定的提交。涉及公共库行为的结论需在最终接入时核对版本。

## 明确发现

1. TH06 的 src/netplay/Th06LanStageProbe.cpp 虽然名字含 Probe，其 ProductionLanMode 分支实际调用 BrowserPeerTransport。不能把文件名当作“只有测试实现”。它接收宿主 netplayUrl/player/playerCount/seed/difficulty/loadouts/iceServers 配置。
2. TH06 初始化 inputDelay=0、maxRollbackFrames=12、maxDirectionPredictionFrames=3；没有发现依靠极大回滚窗口或默认数十帧输入缓冲解决高 RTT 的实现。
3. 输入按模拟帧捕获一次并立即发送；卡住时每 3 个 driver tick 重发已保存的输入，不重新采样。每个同伴有 ACK 确认位置，从最早未确认输入组包，最多 32 帧。不能把“每 3 tick 重发”误写成在所有设备上固定每 50 ms。
4. 公共 BrowserPeerTransport 分离可靠有序控制通道和无序 maxRetransmits=0 输入通道，配合冗余、ACK 和可选可靠修复。中继仍为可靠 WebSocket。TH04 的 WebSocket 已可靠有序；不能期待仅搬运不可靠通道补包策略就消除中继 500 ms RTT。
5. TH06 用 g_Core.PrepareFrame 决定是否推进，并给出 canAdvance/predictedMask。第 0 帧等真实输入；SharedUiNeedsConfirmedInputs 在暂停、重试、阶段结束、Supervisor 切换时要求全部真实输入。代码注释明确这些 UI 状态可能每步等一个往返。因此此前 TH04 的低帧率/预测领先 0 不能仅凭数字证明回滚失效，也不能未经场景证据断言必定在菜单。
6. TH06 每玩家维护 frameAdvantage 窗口，以最领先链路决定轻微节奏调整。FramePacingPolicy 将 interval scale 限制在 0.98–1.02，并平滑变化；这是调节两端节奏，不是从 4 fps 提升至 60 fps 的万能补丁，不改变逻辑输入帧。
7. TH06 使用按游戏对象拥有者组织的 RollbackJournal、SparsePoolCapture/LiveBulletJournal 和可选快照策略；初始化有 16 个状态帧、8 MiB/帧上限配置，这些是上限不是实测内存。TH04 NP21 保存 CPU/设备/VRAM 等完整机器状态，固定线性内存 328*65536=20.5 MiB，加宿主状态/文件日志。不可只复制 TH06 的对象列表或内存上限。
8. TH06 ReconcileRollback 在当前调用内从恢复帧重演到原最新帧；TH04 在 pump 中把重演拆成每次最多 4 步且受 6 ms 预算限制（至少允许一步）。手机单步约 28 ms 时，复制 TH06 的同步重演循环可能长时间占用主线程，反而影响收包和操作。
9. tests/integration_support.py 的 require_host_relay 明确要求 TH_EAGLER_HOST_ROOT 指向另一份 eagler-touhou，使用 server/netplay-relay.mjs。现有两个仓库不是完整生产服务端，不能凭客户端推断实际地区、RTT、部署成本或路由屏障协议细节。

## 对当前 4 步/秒问题的优先级

- 先让 TH04 诊断区明确输出每次拒绝推进的原因：引擎当前不允许预测、缺本机输入、预测窗口耗尽、正在补算/退出同步，以及游戏帧/暂停状态。不要仅用统一“等待其他玩家操作”。原始两端截图并非同一时刻，不能拿同步步差直接判断帧漂移。
- 以公共库的 predictedMask、confirmed remote frontier、frameAdvantage 为参考补齐指标；NP21 的快照和允许预测条件保持原语义。
- 对正常战斗中仍严重慢速，再分别评估手机模拟/重演成本与中继路径；每次只调整有证据的瓶颈。500 ms RTT 大约是 30 个 60Hz tick，但不能直接等同于需要 30 帧快照：单程延迟、设备速度差、抖动都会影响实际未确认深度。
- 接入正式宿主需要 eagler-touhou 的中继与房间入口。当前 E7 目标封包可对齐，但 TH04 E8 来源扩展、JSON payload 和会话认证须适配，不能声称已经兼容生产中继。
- 不直接扩大快照、不替换 NP21 回滚、不改可靠性来迁就 API、不把 TH06 的特定跨阶段恢复失败策略照搬到 NP21。

## 关键源码位置

- TH06 Th06LanStageProbe.cpp:295（传输），:353（RecordTimeSyncSample），:709（SharedUiNeedsConfirmedInputs），:1329（参数），:1607（采样），:1622（发送），:2096（重演），:2414（采样/重发/推进）。
- TH06 Th06RollbackState.cpp:242（固定/稀疏状态采集），resources/shell.html:364（宿主配置），tests/integration_support.py:17（真正中继路径）。
- common BrowserPeerTransport.cpp:307（双通道），:432（中继），:575（SendTo）；NetplayCore.cpp 的 PrepareFrame/BuildInputPacket；FramePacingPolicy.hpp。
- TH04 room.js 的 pump/simulate/armRollback；rollback-queue.js 的 capture/peek；runtime.js 的 canPredict；native-snapshots.js。
