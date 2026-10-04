# 公网与大项目接入：第一阶段

日期：2026-10-04。状态：实现连接配置入口和路径诊断；尚未完成公网或大项目集成验收。以源码为依据，不把历史 README 的待办当成当前缺失功能。

第一阶段最初验证：`node --check` 检查 connection.js、room.js 均通过；`tools/build_lockstep_runtime.py` 静态构建通过；`git diff --check` 通过。该次构建清单仅 room_sha256 变化，引擎、WASM 和回滚相关指纹保持一致。没有运行自动测试、浏览器或模拟器；人工验收均未标记通过。随后针对用户局域网失败增加的诊断及人工对照步骤见 `lan-ice-and-injected-script.md`，该后续改动也更新 startup_sha256。

## 本次边界

TH04 使用 NP21 的状态捕获、恢复、重演和帧推进，自有输入确认与成员退出协议。继续使用这些实现；不接入 eagler-common 的 NetplaySession，也不替换 rollback-queue、native-snapshots、np2-clock、runtime 或 membership。

本次只做以下准备：

- `web/netplay/connection.js` 接受宿主提供的 ICE 配置或异步凭据提供函数。不配置时仍为 `iceServers: []` 和 `iceTransportPolicy: 'all'`，不主动访问第三方 STUN/TURN。
- room 在建立连接前读取一次配置，全局上限 10 秒；失败明确结束本次启动，不静默退回局域网配置。等待期间继续轮询并暂存信令，避免较快同伴的 offer 因本端尚未建立 peer 而被误判。
- 从 `getStats()` 的已选候选对显示直连/TURN/未知；不以“收到了 relay 候选”宣称已经使用 TURN。浏览器不提供所需统计时明确未知，不影响游戏。
- 原 JSON 消息、可靠有序 DataChannel、HTTP 房间 API、30 秒连接期限、180 秒资源期限和游戏中掉线规则保留。没有实现 ICE restart、WebSocket 游戏中继或新房间后端。
- 构建清单的 `room_sha256` 现在覆盖 `room.js` 与 `connection.js`，保持原有全员版本比较。部署环境的 ICE 地址/短期凭据不参与指纹，允许不同玩家使用不同凭据。

## 宿主如何提供连接配置

在开始游戏前设置当前房间页面的 `window.th04NetplayConnection`。它是本项目新增的接入点，不是 eagler-common 已有 API。不读取父窗口或 URL 查询参数，也不持久化到 localStorage。重新加载页面后需要由宿主重新注入。

无配置：保留当前局域网入口及行为。

STUN 首测示例（双方都配置；服务可达性仍需实测）：

```js
window.th04NetplayConnection = {
  iceServers: [{urls: 'stun:stun.cloudflare.com:3478'}],
  iceTransportPolicy: 'all'
};
```

可以由部署方在页面加载脚本中设置，也可以首测时在每一端浏览器控制台、点击“房主开始游戏”之前设置。生产接入应由宿主自动配置，不要求玩家使用控制台。

短期 TURN 凭据示例：

```js
window.th04NetplayConnection = async (session, signal) => {
  const response = await fetch('/integration/ice', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({room: session.room, token: session.token}),
    signal
  });
  if (!response.ok) throw new Error('无法取得短期连接凭据');
  return response.json();
};
```

`/integration/ice` 仅为对接示例，本次没有创建这个端点。宿主提供的函数接收 `{room, token, role}` 副本及 AbortSignal，返回 `{iceServers, iceTransportPolicy}`。配置 10 秒超时会中止 signal；提供方必须遵守 signal，不在已取消调用中自行改动游戏状态。只向可信服务发送房间身份。

返回值使用浏览器标准的 `urls`（字符串或数组）、`username`、字符串 `credential`；支持 STUN/STUNS/TURN/TURNS 地址。顶层仅接受 `iceServers` 和 `iceTransportPolicy`，策略为 `all` 或 `relay`。实际 URL、认证与服务是否有效最终由浏览器建连验证。长期 TURN API 密钥留在后端；浏览器接收有期限的用户名和凭据，勿把长期密钥写进页面。凭据有效期应覆盖计划中的会话/分配刷新需求，本阶段没有自动续签或重新建连。

强制中继验收：取得有效 TURN 配置后，把策略改为 `relay`，两端重新建房开局。配置中没有 TURN 时会直接报错。默认 `all` 允许浏览器选择直连或中继，不会强迫所有流量走 TURN。

## 与 eagler-common 的具体差异

参考文件：`include/eagler/netplay/PeerTransport.hpp`、`BrowserPeerTransport.hpp` 及 `src/netplay/BrowserPeerTransport.cpp`。

| 接口/行为 | 参考项目 | TH04 对接要求 |
|---|---|---|
| ICE 配置 | Module.eaglerOptions.netplayIceServers；也接收信令 peers 消息中的 iceServers | 本次开放标准 RTCConfiguration 子集；宿主可映射配置，无需替换回滚 |
| SendTo(peer, bytes) | RTC 路由使用无序、零重传输入通道 | 当前所有消息依赖可靠有序通道，不能直接绑定 |
| SendControl(bytes) | 可靠控制广播 | 当前需要逐同伴可靠发送；直接广播并不等价 |
| SendRepairTo(peer, bytes) | RTC-only，限制大小和背压，relay 路由不接受 | 是补包专用接口，不能充当通用可靠发送 |
| Poll(bytes) | 返回字节包，无独立发送者参数 | TH04 从所属 peer 识别身份；需约定可信来源编号/消息封装 |
| 路由 | 开局前选择 RTC 或 WebSocket relay | 现为 RTC mesh；路由屏障和中继协议需与服务端共同适配 |
| 失败状态 | 传输整体 IsOpen/Failed 等接口 | 需要保留每个玩家的连接状态，才能沿用客机退出协商 |
| 信令 | WebSocket，含 peers/peer-join/signal/route 等消息 | 当前 HTTP API，offer/answer/ice 外层格式不同 |

三人局是全互联：三对连接都必须成功。TH04 的 `host/guest/guest2` 是会话身份，座位 `P1/P2/P3` 可另选；不能把 host 永远映射为 P1。若映射数值 peer ID，建议固定 host=0、guest=1、guest2=2，并独立传递原 slots，最终由双方确认。

当前房间服务会持续参与在线状态与退出同步。不得假定开局后可关闭信令服务。现有事件轮询、房间 generation、启动握手、全员资源一致性检查也不能因接入统一大厅而直接跳过。

参考目录未发现配套生产信令/中继后端。本次没有复制参考项目代码，也没有宣称 wire-compatible。后续复制 MIT 代码时保留其许可与版权声明。

## 需要对接方提供的最少信息

1. 一个已接入游戏的入口例子，以及实际配套的信令/中继接口。
2. 宿主交给游戏的是房间信息、PeerTransport，还是已建立的通道？是否必须复用 BrowserPeerTransport？
3. 是否支持逐玩家可靠有序发送、带来源的接收、逐玩家断线事件？若没有，应协商扩展传输层，不能改变 TH04 输入可靠性来迁就接口。
4. 玩家编号与座位的映射、房主权限、重开局 generation 如何传递。
5. STUN/TURN 获取方式、短期凭据有效期、是否强制 WebSocket relay 回退。

在这些信息明确前，不编写假设性的 Eagler 桥接，不另建正式大厅、账号系统或长期部署后端。

## 分阶段人工验收

遵守 DEVELOPMENT.md：本轮仅构建与静态检查，不由 AI 启动浏览器、游戏、模拟器或执行测试。以下均待用户操作验证。

| 阶段 | 操作 | 通过标准 |
|---|---|---|
| A：默认回归 | 不注入配置；原局域网两人/三人、原同屏入口 | 原开局、操作与退出正常；主机可选非 P1 座位 |
| B：异步配置 | 提供方延迟几秒返回有效配置；另测报错/超过 10 秒 | 快端的信令不会报未知来源；失败显示配置错误且不启动游戏 |
| C：公网直连 | 现有房间服务经临时 HTTPS tunnel；双方同一地址，家庭宽带对手机热点，设置 STUN | 能建房、开局、持续玩 15–30 分钟；记录路径、RTT、相同状态步与卡顿；打不开数据通道则定位到 ICE，不冒充通过 |
| D：TURN | 有效短期 TURN，强制 relay，重新建房 | 选中路径显示 TURN，持续游戏；再以 all 测自动选择 |
| E：三人与断线 | 三种网络；客机断线、房主断线 | 三对链路成功；客机按既有规则变离线幽灵，房主断线结束全局 |
| F：大项目联合验收 | 实际宿主和后端 | 身份/座位/版本/路由/退出一致，原独立入口回归通过 |

公网入口、TURN 账户/凭据和正式宿主适配尚未提供；不能仅凭本次配置入口宣称公网能力已交付。临时 Tunnel 只代理网页和 HTTP 信令，不代理 WebRTC 数据，不能代替 TURN。代理后的 Origin/Host 校验、远程资源下载速度及具体网络的服务可达性需要在 C 阶段确认。
