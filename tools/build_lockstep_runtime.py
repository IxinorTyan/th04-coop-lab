"""Build a deterministic rollback adapter around the pinned NP21 WASM.

No emulator execution or browser tests. Exact anchors fail closed on upgrades.
The upstream main_loop reads SDL ticks, then executes its fixed pccore frames.
The native memory/global snapshot and host journal restore that virtual clock.
"""
from pathlib import Path
import hashlib
import json
from lan_sound_config import native_sound_config
from build_rollback_wasm import build as build_rollback_wasm

ROOT=Path(__file__).resolve().parents[1]
VENDOR=ROOT/'web/vendor/np2'
source=(VENDOR/'np21.js').read_text(encoding='utf-8')
rollback_wasm=build_rollback_wasm(VENDOR)

def replace(old,new):
    global source
    if source.count(old)!=1:
        raise RuntimeError(f'NP21 adapter anchor changed: {old[:90]}')
    source=source.replace(old,new,1)

replace('var Module=moduleArg;', '''var Module=moduleArg;
const netHost=createDeterministicHost(Module);
const Date=netHost.Date;
Module.netKey=(type,event)=>{const callback=netHost.keys[type];if(!callback)throw Error('SDL keyboard not ready');callback(event);};
Module.netStep=()=>{if(!MainLoop.func||ABORT)throw Error('NP21 loop unavailable');netHost.tick++;netHost.now=netHost.tick*1000/60;MainLoop.func();netHost.advanceAudio();};
Module.netInfo=()=>({tick:netHost.tick,audioBlocks:netHost.audio?.produced||0,...netHost.audio?.output.info()});
Module.netFlushAudio=()=>netHost.audio?.output.flush();
let netSnapshots;
Module.netCapture=frame=>{
  if(!Module.SDL2?.ctx||GL.currentContext)throw Error('NP21 回滚要求已初始化的 Canvas 软件渲染');
  if(!netSnapshots)netSnapshots=createNativeSnapshots({module:Module,fs:FS,memfs:MEMFS,tty:TTY,host:netHost,exports:()=>wasmExports,
    readBridge:()=>({events:{...JSEvents,deferredCalls:JSEvents.deferredCalls.slice()},syscalls:{...SYSCALLS},stdin:FS_stdin_getChar_buffer.slice()}),
    writeBridge:s=>{for(const k of Object.keys(JSEvents))if(!(k in s.events))delete JSEvents[k];Object.assign(JSEvents,s.events);for(const k of Object.keys(SYSCALLS))if(!(k in s.syscalls))delete SYSCALLS[k];Object.assign(SYSCALLS,s.syscalls);FS_stdin_getChar_buffer=s.stdin.slice();}});
  netSnapshots.capture(frame);
};
Module.netSeal=()=>netSnapshots?.seal();
Module.netRestore=frame=>{netSnapshots.restore(frame);netHost.discard(frame);};
Module.netBeginFrame=(frame,replaying)=>{netHost.replaying=!!replaying;netHost.beginFrame(frame);};
Module.netEndFrame=()=>{netSnapshots?.seal();netHost.endFrame();netHost.replaying=false;};
Module.netConfirm=prefix=>{netSnapshots?.confirm(prefix);netHost.confirm(prefix);};
Module.netSnapshotInfo=()=>netSnapshots?.info()||{snapshotBytes:0,snapshots:0};
''')
replace('var f="np21.wasm"','var f="np21-rollback.wasm"')
replace('new URL("np21.wasm",import.meta.url)', 'new URL("np21-rollback.wasm",import.meta.url)')
# Keep renderer state inside WASM. GPU texture/program caches are not part of
# a linear-memory snapshot; Canvas ImageData is presentation-only and redraws.
replace('function preRun(){', 'function preRun(){ENV["SDL_RENDER_DRIVER"]="software";')
replace('var _emscripten_get_now=()=>performance.now();',
        'var _emscripten_get_now=()=>netHost.now;')
replace('var randomFill=view=>(randomFill=initRandomFill())(view);',
        'var randomFill=view=>netHost.randomFill(view);')
replace('var iterFunc=getWasmTableEntry(func);setMainLoop(iterFunc,fps,simulateInfiniteLoop)',
        'var iterFunc=getWasmTableEntry(func);MainLoop.func=iterFunc')
# Physical browser keyboard events are collected by our UI, never by SDL.
replace('handlerFunc:keyEventHandlerFunc,useCapture};return JSEvents.registerOrRemoveHandler(eventHandler)',
        'handlerFunc:keyEventHandlerFunc,useCapture};netHost.keys[eventTypeString]=callbackfunc?keyEventHandlerFunc:null;return 0')
# SDL focus/visibility/resize/mouse events otherwise mutate state independently.
replace('registerOrRemoveHandler(eventHandler){',
        'registerOrRemoveHandler(eventHandler){return 0;')
replace('new AudioContext', 'new AudioContext({sampleRate:44100,latencyHint:"interactive"})')
replace('new webkitAudioContext', 'new webkitAudioContext({sampleRate:44100,latencyHint:"interactive"})')
start=source.index('181622:($0,$1,$2,$3)=>{')
end=source.index('182797:($0,$1)=>{',start)
source=source[:start]+'''181622:($0,$1,$2,$3)=>{netHost.openAudio(Module["SDL2"],$0,$1,()=>dynCall("vi",$2,[$3]))},'''+source[end:]
replace('184897:($0,$1,$2)=>{var w=$0;',
        '184897:($0,$1,$2)=>{if(netHost.replaying)return;var w=$0;')
source='import {createNativeSnapshots} from "../../netplay/native-snapshots.js";\nimport {createDeterministicHost} from "../../netplay/np2-clock.js";\n'+source
(VENDOR/'np21-lockstep.js').write_text(source,encoding='utf-8')
manifest={'protocol':'th04-rollback/2','adapter':'np21-rollback-v2',
          'tick_hz':60,'audio_hz':44100,'epoch':946684800000,
          'source_js_sha256':hashlib.sha256((VENDOR/'np21.js').read_bytes()).hexdigest(),
          'wasm_sha256':rollback_wasm['sha256'], 'rollback_wasm':rollback_wasm,
          'generated_js_sha256':hashlib.sha256(source.encode()).hexdigest()}
manifest['clock_sha256']=hashlib.sha256((ROOT/'web/netplay/np2-clock.js').read_bytes()).hexdigest()
manifest['audio_output_sha256']=hashlib.sha256((ROOT/'web/netplay/audio-output.js').read_bytes()).hexdigest()
manifest['rollback_queue_sha256']=hashlib.sha256((ROOT/'web/netplay/rollback-queue.js').read_bytes()).hexdigest()
manifest['native_snapshots_sha256']=hashlib.sha256((ROOT/'web/netplay/native-snapshots.js').read_bytes()).hexdigest()
manifest['game_adapter_sha256']=hashlib.sha256((ROOT/'web/netplay/runtime.js').read_bytes()).hexdigest()
manifest['room_sha256']=hashlib.sha256((ROOT/'web/netplay/room.js').read_bytes()).hexdigest()
manifest['membership_sha256']=hashlib.sha256((ROOT/'web/netplay/membership.js').read_bytes()).hexdigest()
manifest['controls_sha256']=hashlib.sha256((ROOT/'web/netplay/controls.js').read_bytes()).hexdigest()
manifest['pause_sha256']=hashlib.sha256((ROOT/'web/netplay/pause.js').read_bytes()).hexdigest()
manifest['native_sound']=native_sound_config(ROOT)
(ROOT/'web/netplay/runtime.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print('Built web/vendor/np2/np21-lockstep.js (no runtime tests executed)')
