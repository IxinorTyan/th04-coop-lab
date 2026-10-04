# WebSocket 公网中继首版

后续状态（2026-10-04）：用户已经实测临时中继异网双人开局成功，性能仍未达标。现已取得正式 eagler-touhou 中继，确认 E8 被它用于旁观者数据，不能直接兼容本适配；下文“未附配套生产中继”及“待异网开局”为首版历史记录。最新接口对照和接入计划见 `eagler-host-relay-integration.md`。

2026-10-04。目标：电脑宽带与手机移动数据通过现有免费 Tunnel 实际游戏，不要求 TURN 账号或国际卡。本版只提供明确的强制中继入口，不在游戏中途切换传输。

## 用户操作

1. 关闭旧的 start-lan.bat 服务窗口，然后重新启动。当前 Python 环境已检测到 websockets 16.0；其他电脑需要 `python -m pip install -r requirements-relay.txt`。服务端缺包会拒绝中继，原 LAN 仍可使用。
2. 保持现有 Tunnel 运行。双方使用同一完整链接：`https://你的域名.trycloudflare.com/lan.html?network=public-ws`。不是 public-relay（那是 TURN）或 public-test（STUN）。电脑宽带，手机关闭 Wi-Fi 使用移动数据。
3. 正常建房、选座、准备、开始。不需要控制台配置、不需要 TURN 密钥。两端模式不同会在加入阶段直接报错。
4. 诊断应显示“强制 WebSocket 中继”“数据通道 open”，然后出现 DOS / 游戏。先验证两人，持续玩 10–15 分钟，状态校验持续推进且一致，记录往返延迟和等待。
5. 再验证三人、房主选 P2/P3、客机离线其余玩家继续、房主退出。最后用普通 lan.html 回归局域网，同屏入口保持不变。

## 与 eagler-common 的对齐和差异

- 参考 BrowserPeerTransport.cpp 的 `SendTo` relay 分支，使用二进制 `0xe7 + 目标玩家编号 + payload`；玩家编号按身份固定为 host=0、guest=1、guest2=2，与 P1/P2/P3 座位独立。
- 使用 `{"type":"route","mode":"relay"}` 开局路由通知，服务器全员 WebSocket 到齐后先向各端发送 route，再允许转发游戏包。包含 TH04 generation 防串局。本版不竞速 RTC 和 relay，不在开局后切换。
- TH04 接收侧需要可靠的发送者身份，服务端将来源从已认证连接生成，使用 `0xe8 + 来源编号 + payload`。这是本适配器的扩展，参考库 Poll 本身没有单独来源字段，不能声称双方 wire-compatible。
- payload 仍是已有 UTF-8 JSON，包含 TH04 protocol/generation；不引入 eagler NetplaySession，不改变 NP21 回滚和游戏输入格式。服务器不接收客户端自行声称的来源编号。
- `relay.js` 为每位同伴提供通道生命周期和可靠有序 send/message，复用现有 hello/ready/run、版本校验、状态摘要和离线协商。轻量 pc 生命周期视图仅供现有退出逻辑使用，不实例化 RTC，也不伪装 ICE 统计。
- 参考项目未附配套生产中继，所以本次最小服务为独立实现，使用 websockets 16.0 的 RFC6455 Sans-I/O 引擎处理握手、掩码、分片、Ping/Pong 和关闭；应用层只做身份验证、路由屏障、封包转发。

## 服务边界

WebSocket 在现有 9866 端口的 /relay 升级，免费 Tunnel 通过 HTTPS/WSS 提供同源访问。握手校验 Origin/Host、现有房间 token、loading 阶段、房间 transport；不接受重连替换已经加入的同一角色。房间令牌在 WebSocket 查询参数传送，不输出到日志，分享链接不得带 token。服务器生成来源编号，限制消息大小，按连接顺序转发。连接采用 TCP_NODELAY，发送超时有界，线程间串行访问每个协议对象。

房间服务退出、Tunnel 断开会影响所有玩家；这不是完全点对点模式。慢连接在小规模测试中仍可能拖慢共享中继处理，尚未做生产级多房间性能隔离。服务器有既有 64 房间上限，本方案仅作为邀请式测试，不代替正式大项目认证、配额与部署。全员握手、断线处理、运行表现都须实测；静态检查不能证明公网可玩。

发送缓冲超过现有 256 KiB 阈值按原连接异常处理，不无限堆积。每条消息最长 256 KiB（覆盖最多 65536 个 JS 字符的 UTF-8 编码），接收 JSON 仍受现有游戏验证限制。断线通过服务器 peer-left 通知及现有心跳处理，客机移除后不再转发给该连接；不支持中途加入/恢复和房主迁移。

## 验证状态

本轮遵守 DEVELOPMENT.md 的人工试玩约定：仅静态语法检查、源码核对与构建，不启动浏览器、模拟器或测试服务。正式验收待用户异网开局；已有成功 LAN 结果不等于本中继版本已经通过。
