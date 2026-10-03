# 独立本地 BGM（2026-10-03，未运行验收）

## 当前实现：原生 BGM OFF + 游戏开始后加载浏览器音乐

已查明前次 BGM=0 不生效的原因：MIKO.CFG 包含第 9 字节 opts_sum，ZUN -S（ReC98 th04/res_huma.cpp）将前六个选项求和后比较；之前只改 BGM/SE，没有更新校验和，触发默认配置重建并重新打开 BGM。现在 private disk 同时改 cfg[3]=0、cfg[4]=1、cfg[9]=sum(cfg[0:6])。

无需 TSR 的 MAIN 事件通知：对现有已补丁 MAIN 镜像的原地址 0x133DF（加既有 GAP=0x2000 和 MZ header）进行精确 23 字节替换。snd_kaja_interrupt 在原生 BGM OFF 下原本是 no-op；新代码保存并恢复 AX，将 AH=00/01/02/19 请求写入通知区，其余查询仍返回原 AX。SE 调用独立，不改。通知区复用 BGM OFF 永远不会访问的 SND_LOAD_EXT[0]（DS:08F8 序号、08FA 命令），不额外分配内存、不扩大补丁区、不更改中断向量。snd_load 在 OFF 返回前已写入 DS:3964 当前曲名；相关代码锚点逐字节校验。仅针对这个 MAIN 版本，不能移用于 OP/MAINE。

runtime 检测到原合作 mailbox 的真实游戏帧后，才异步 import local-bgm.js、加载清单和当前 Opus；先缓存在加载期间收到的通知。之后只读游戏内存：当前曲名 + 最新通知序号/命令，控制独立播放、停止、淡出；同一模拟步内连续多条指令以最后一条为准。实际 BGM/SE 值读取 DS:08F5/08F4 并显示；BGM 非零时不叠加浏览器音乐。原生状态/通知均随游戏步推进并参与校验，浏览器音频不写回模拟器。音乐不作为共同开局资源依赖。页面音量滑块仅控制浏览器音乐。

本次仅修改和生成运行文件，未执行测试/游戏/试听。用户检查重启后实际 BGM=0、SE=1、浏览器曲名、音量归零只剩 SE、Boss 切曲及淡出。

## 历史排查记录（下列旧状态已被上方实现取代）

最新覆盖：用户要求默认游戏 BGM=0、保留 SE。`tools/lan_sound_config.py` 从已校验 FAT12 磁盘定位 GENSO/MIKO.CFG，生成原字节、目标偏移及配置策略；runtime 在启动前对私有副本写入 cfg[3]=0、cfg[4]=1。依据 launch.asm 对 resident 的配置复制和 ReC98 snd_determine_modes：先确定 FM SE 可用性，再应用 BGM OFF。原启动器、磁盘文件和 INT 60h 不改，声音策略加入共同开局指纹。当前是原生 BGM 关闭、仅音效，不代表独立 Opus 播放已经恢复。仅重新生成运行文件，未运行测试。

**当前状态：暂未启用。** 用户反馈取消全曲库加载后仍黑屏，要求优先恢复可玩性。runtime 已恢复原 th04-coop.hdi.gz / disk.json / patch.json，移除 LocalBgm 导入与初始化；start-lan 不构建私有音乐磁盘，开局指纹不再依赖音乐文件。原音乐/音效混合输出恢复。下文保留独立音乐实现记录供排查，不能当作已启用功能或已通过验收。新增 TSR 的启动影响尚未排除，黑屏根因未确认。未来接入必须以游戏实际帧推进为前提，音频的下载、模块加载、解码都放到之后，且不再改变原 DOS 启动链。

用户反馈玩法已流畅，但逐步生成的音乐仍卡顿，明确要求本地独立播放；禁止开发者运行测试、浏览器和试听。本轮仅阅读源码、构建驻留程序/磁盘、编译离线转换器及生成音频资源。

## 运行路径

- 原 `web/th04-coop.hdi.gz` 和单机入口保持原有路径。`start-lan.bat` 用当前单机磁盘生成 `th04-local-music.hdi.gz`、`local-music-disk.json`、`local-music-patch.json`，不重编 MAIN，也不覆盖 NP21 wrapper。
- `launch.asm` 在 LOCAL_BGM 条件下装载一个小型 TSR，挂接 PMD INT 60h。入口保留 PMD 标识与版本，所有查询原样跳转到原驱动。AH=00/01/02/19/1A/1B 被记录到 64 项环形事件队列。
- 每次 AH=00 前通过 AH=06 取得歌曲缓冲，计算前 25 字节（标志 + 前 12 个声部偏移）的 FNV-1a。不得对循环计数所在的可变 MML 数据求指纹。转换器检查指纹冲突；M26/M86 的 logo 字节完全相同，合并为同一资产。
- AH=00 原调用完成后，AH=1E 屏蔽 0–14 声部，保留 15（FM 效果音）。原驱动仍正常推进小节、淡出和游戏等待条件，不把 BGM mode 设为 OFF，也不改变网络同步算法。依据 `reference/ReC98-master/libs/kaja/pmddata.doc` 的服务定义。
- 私有 GAME.BAT 在 PMD `/R` 之前调用 `coop /R`，恢复原 INT 60h 并释放 TSR，避免原驱动卸载时把包装段当成自身。
- runtime 用既有游戏 mailbox 推算 guest base，从 IVT 60h 段地址定位 TSR；校验签名/自身段/队列序号。只读事件，不从音频线程回写 guest RAM。队列、驱动状态仍参与原来的 640 KiB 校验。
- `local-bgm.js` 在后台读取清单、按需下载/解码当前曲目并预取可能的 Boss/下一关曲目，仅保留当前解码波形。最初版本在开局前等待整套约 135 MB 曲库及两首开场解码，会在引擎加载后阻塞开局；用户反馈黑屏后已移除此条件。音乐加载 Promise 不被 runtime boot 等待，下载设超时、退出可取消、清单就绪前音乐指令缓存；音乐事件处理失败不终止模拟步。曲目尚未就绪时允许音乐稍晚开始。循环由 AudioBufferSourceNode 的 loopStart/loopEnd 实现，不追赶网络时钟、不调整播放速率、不在网络等待时停音。
- BGM 和原音效共用本机 AudioContext，以一次按钮手势解锁。BGM 有独立音量。离开房间/页面释放播放资源；普通网络等待、隐藏页面及游戏暂停不主动暂停 BGM。实际严重掉线仍遵守房间超时退出。
- 原 PCM 输出队列现在仅负责音效。音乐曲目、脚本版本加入共同开局清单；新增 TSR 也包含在磁盘 SHA256 中。

## 音频资产构建

原始曲目来自本地 `extracted/GENSO/東方幻想.郷` 和 `幻想郷ED.DAT`，没有从网上获取其他录音。保留 M26、M86 两套以及结局/菜单曲，共 45 个去重后文件。

`tools/build_local_bgm_assets.py` 使用 `vendor-source/pmdmini-master` 的 PMDWin/FMGEN 从原始 PMD 直接渲染，再用 ffmpeg/libopus 编码为 Opus 64 kbps、受约束 VBR、立体声（Ogg 容器，.opus 扩展名）。没有从旧有损音频再次转码。现代 Chrome/Edge 可通过现有 decodeAudioData 路径解码；LAN 服务显式提供 audio/ogg 类型。Opus 编码使用 48 kHz，解码后由浏览器匹配现有 AudioContext，不修改模拟器的固定 44100 Hz 时钟。

曲目现在只存前奏和一轮循环：loopEnd 为 PMD 首次循环终点，loopStart 为首次终点减循环长度（下限为 0）；无循环曲保留 1.5 秒尾音。相比旧版保存两轮循环，可减少下载量与解码 PCM 内存。45 个曲目/音源版本仍完整保留。

生成文件体积：旧 Vorbis 合计 134,769,891 字节，新 Opus 合计 39,868,187 字节，约减少 70.4%；第一关 M86 为 932,721 字节。这里是文件体积统计，不是音质或浏览器运行验证。

转换器编译依赖项目内 `build/compiler/ziglang/zig.exe`（ziglang 0.13.0）。编译日志在 `build/pmd-compile.log`，转换缓存位于 `build/bgm-source`，缓存及 URL 带 `opus64-single-loop-v2` 配方标识。全部生成成功后才切换曲库清单。旧 Vorbis 文件移至 `build/bgm-vorbis-backup` 保留，已不在网页发布目录内；部署只需发布 web，不要发布 build。此轮只生成资源，未试听或进行浏览器验证，循环接缝和压缩听感由用户检查。

转换命令：`python tools/build_local_bgm_assets.py`（工作目录 th04-coop-lab）。只在修改曲目/转换器时使用，平时启动不转换。浏览器和客机不需要编译器、ffmpeg 或 Python。

第三方源码：https://github.com/mistydemeo/pmdmini 。源压缩包在 `build/pmdmini-source.zip`，仓库元数据在 `reports/pmdmini-repo.json`，源码与原许可保留于 vendor-source（包括 inherits/COPYING 及原文件版权声明）。上游源码不直接修改：构建时生成 `build/pmdwin-portable.cpp`，仅重命名与 MinGW 冲突的两个路径函数、修复旧式空指针比较。生成的音频仍来自用户已有游戏资源。

## 用户验收重点

重启 start-lan.bat，双端 Ctrl+F5、新建房间、启用本机声音。试听开场、Boss 切曲、换关、循环、音效和音乐音量归零后的表现。特别确认声部屏蔽没有影响 FM 效果音，以及游戏小节/淡出等待仍能正常结束。未运行任何游戏、自动化测试或试听，不把构建成功等同于验收通过。
