# 触屏布局与操作修复（2026-10-07）

参考实现：
- `th06-eagler/th06-eagler/src/Touch.cpp`：双击 Bomb 的 220 ms 点按上限、320 ms 间隔、窗口高度 5% 拖动阈值、短边 8% 双击半径与独立手势归属。
- `eagler-touhou-main/eagler-touhou-main/public/styles.css`：TH06 公共启动器的默认直接触摸按键位置、尺寸、透明度与 Unified touch workbench 样式。
- 公共启动器 `touch-layout-model.mts` / `touch-layout-editor-state.mts`：横竖屏配置、0.6–1.8 缩放、安全区、层级、窗口位置与布局草稿。

修复样式表被 host.innerHTML 删除的问题，并给本地模式补齐共享 player-ui 样式；样式 URL 从模块解析，本地与联机统一使用。移除旧的多轮 immersive CSS 覆盖，避免全屏隐藏设置。修复无有效位置时 classList.toggle 的 undefined 参数导致自定义位置类反复切换的问题。

默认低速、开火、Bomb 位于左下角，ESC 左上角；保留 TH04 的救援及菜单按钮。编辑器支持拖动/收起、选择按键、位置/大小/层级、画面水平位置、恢复当前方向默认、保存及退出放弃布局草稿。旧 v1 按键布局继续读取；触控选项自动保存。

双击 Bomb、触摸模式判定点常显、不限速移动均可在“按键与触控”分别开关。不启用不限速时沿用原生限速。双击命中后不会抢占移动或低速手指，移动中也可以用第二指双击。非游戏状态和取消操作清除双击候选。

验证：
- `node tools/test_touch_browser.cjs`（需 localhost:9886 服务）：844×390、390×844，浏览器真实触摸事件、双击/多指/拖动排除、开关输出与保存、布局保存/取消、横竖屏独立、按键边界，以及实际启动本地游戏到进入关卡。
- `node tools/test_touch_input.mjs`：JSON/回滚队列/原生邮箱中的带符号位移和开关标记。
- `node tools/test_input_wire.mjs`、`node tools/test_rollback_queue.mjs`：均通过。旧输入协议测试的非法值从已合法的 2048 更新为 VALID_INPUT+1，未修改旧协议实现。
- player-ui.js / touch-layout.js 语法检查通过。

截图：touch-landscape.png、touch-portrait-editor.png、touch-local-game.png。浏览器测试使用桌面 Edge 的移动触屏模拟；尚未在实体手机或多人在线房间进行实机操作验证。
