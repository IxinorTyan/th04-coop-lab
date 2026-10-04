# 托管 TURN 开通与验证

2026-10-04。适用于已经通过公网房间服务交换 SDP 和 srflx 候选，但异网直连超时的场景。没有修改 NP21 引擎、帧推进、回滚、输入通道或游戏消息。

## 用户只需要手动完成这些步骤

1. 注册/登录 https://dash.cloudflare.com/ 。无需买域名或 VPS。
2. 按官方 https://developers.cloudflare.com/realtime/turn/generate-credentials/ 的 Create a TURN key 步骤，在 Realtime / TURN 服务中创建 TURN Key（控制台栏目名称可能变化）。需要的是 TURN Key ID 和对应的 TURN API Token，不是 Global API Key，也不是 Tunnel ID。
3. 如控制台要求启用计费或支付验证，用户自行完成并查看当前价格。独立 TURN 是按流量计费的托管服务，不承诺永久免费；不要为了本功能开通无关 SFU。任何支付操作由用户决定。
4. 在电脑双击项目根目录的 `configure-turn.bat`。粘贴 Key ID；粘贴 API Token 时不显示字符，按回车即可。不要把密钥发给聊天，不要粘贴进浏览器/URL。
5. 关闭并重启 `start-lan.bat`，保持 Tunnel 窗口开启。原 Tunnel 不重启通常可以保留当前域名。
6. 双方打开同一个 `https://你的临时域名/lan.html?network=public-relay`。电脑宽带、手机移动数据。建房开始后服务端自动生成各玩家的短期凭据。
7. 必须看到配置含 TURN、策略 relay、选中路径显示 TURN 中继。继续游戏 10–15 分钟，状态校验持续推进且一致才算该网络组合验证通过。
8. 成功后换成 `/lan.html?network=public-turn`：策略 all，浏览器可选直连或中继。原 `public-test` 仍是 STUN-only 对照，不会偷偷改成中继。普通 lan.html 保留原 LAN 默认。

## 常见错误

- “尚未配置 TURN”：完成配置向导，重建房间，不必在手机上配置。
- “HTTP 401/403 / 拒绝凭据”：核对专用 Key ID 与配套 Token。
- “电脑无法访问 TURN 凭据服务”：本机访问 rtc.live.cloudflare.com 的 DNS/HTTPS 出错，先检查与 Tunnel 类似的代理/TUN 问题。
- “强制中继”仍收集不到 relay：记录双方 ICE 错误和候选类型，不根据 701 单独下结论；凭据有效不保证网络能访问全部 TURN 端口。
- 收集到 relay 但仍无法通道 open：继续定位 TURN 协议/可达性及浏览器错误；不宣称增加配置即已修复。

## 实现边界与维护

`turn-config.local.json` 位于项目根目录（不在静态服务的 web 根目录中），已加入 .gitignore，保存长期密钥。它是本机明文配置，请勿分享或加入发布包。`configure_turn.py` 不联网、不把 Token 打印出来。

服务端 `/api/ice` 只允许有效房间 token 在 loading 阶段请求。读取房间及身份时加房间锁，外部凭据请求在锁外完成，避免阻塞全员轮询。限制单角色请求间隔，最多 3 个并发生成请求，按房间 generation/角色缓存临时凭据，不返回长期密钥和上游错误正文。凭据只用 HTTPS POST 发向官方固定服务主机，不使用用户传入服务 URL。

临时凭据 TTL 为 4 小时，不自动续签；本轮 10–15 分钟验证足够，长局应提前重建房间，长期集成需交由大项目凭据服务负责生命周期。缓存最多 192 项。不保存短期凭据到网页文件或 localStorage。页面和 API 使用既有 no-store。

现有房间服务允许拿到入口的人建房，房间 token 不是账户认证；本轮仅供小范围邀请测试，不能把此服务直接当成无限公开生产服务。大项目正式接入需用其用户认证、配额及托管密钥服务；本次不另建账号体系。

官方接口（本轮已核对）：POST https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers ，Authorization Bearer，JSON ttl，返回 iceServers。原客户端配置入口支持异步加载，因此无需更改回滚。实际 TURN 接入必须在用户开通账号后实测，本轮没有凭据不能声称已修复穿透。
