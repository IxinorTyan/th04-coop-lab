import {WorkerNP21,workerAssistBridge,mountWorkerChoice} from './solo-worker-client.js';
import {mountSoloView} from './solo-view.js';
import {SoloMusic} from './solo-music.js';
import {startFrameLoop} from './frame-limit.js';
import {mountSoloPerformance} from './solo-performance.js';
import {gameVersion,rememberLanguage} from './game-version.js';
// Standalone original game. No cooperative runtime, launcher or netplay session.
import {NP21} from './vendor/np2/np2-wasm.js';
import {mountPlayer} from './player-ui.js';
import {mountFocusSettings} from './focus-settings.js';
import {mountControlSettings,keyboardBits,padBits,isBound,isFormTarget,controlsSummary,syntheticInputEvents} from './control-settings.js';
import {unpackTouch} from './touch-input.js';
import {sha256} from './netplay/sha256.js';
const $=id=>document.getElementById(id);
const audioMode=$('audio-mode');
const runtimeMode=mountWorkerChoice(audioMode.closest('label').parentElement);
let soloMusic;
window.addEventListener('pagehide',event=>{if(event.persisted)soloMusic?.suspend();else soloMusic?.dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted)soloMusic?.resume();});
try{const saved=localStorage.getItem('solo-audio-mode-v2');if(['independent','original','buffered'].includes(saved))audioMode.value=saved;}catch{}
audioMode.onchange=()=>{try{localStorage.setItem('solo-audio-mode-v2',audioMode.value);}catch{}};

rememberLanguage($('language'),'solo');
let emulator,patch,mailbox=-1,scanCursor=0,oldBits=0,focused=true,started=false,menuBits=0,menuUntil=0;
const keys=new Set(),seen=new Map();
const signature=new TextEncoder().encode('TH04SOLOINPUTv1!');
const player=mountPlayer($('game'),{solo:true,onGesture:async()=>{soloMusic?.resume();await emulator?.module.SDL2?.audioContext?.resume();}});
mountSoloView($('game'));
mountSoloPerformance({host:$('game'),game:'04',getEmulator:()=>emulator,readState:()=>{
  const s=readSoloState();return s?{playing:s.mode===1&&!s.flags,generation:s.generation,ticks:s.ticks}:null;
}});
const screen=document.createElement('div');screen.className='screen solo-screen';
const canvas=document.createElement('canvas');canvas.id='canvas';canvas.width=640;canvas.height=400;canvas.tabIndex=0;screen.append(canvas);player.stage.append(screen);
const focus=mountFocusSettings($('control-settings'),{alwaysPointControl:player.alwaysPointControl,profile:'solo'});
const editor=mountControlSettings($('control-settings'),{solo:true,onEditing:()=>release(),onChange:()=>{release();summary();}});
function summary(){$('controls-summary').textContent=controlsSummary('solo');}summary();
const nativeActions=[['ArrowUp',1],['ArrowDown',2],['ArrowLeft',4],['ArrowRight',8],['KeyX',16],['KeyZ',32],['ShiftLeft',64],['Escape',128],['Enter',256]];
function nativeKey(code,down){
  if(!emulator)return;
  const keyCodes={KeyZ:90,KeyX:88,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Escape:27,ShiftLeft:16,Enter:13};
  const event=new KeyboardEvent(down?'keydown':'keyup',{code,key:({KeyZ:'z',KeyX:'x',ShiftLeft:'Shift'})[code]||code,keyCode:keyCodes[code],which:keyCodes[code],bubbles:true});
  syntheticInputEvents.add(event);canvas.dispatchEvent(event);
}
function send(bits){for(const [code,bit] of nativeActions)if((bits&bit)!==(oldBits&bit))nativeKey(code,!!(bits&bit));oldBits=bits;}
function clearNative(at=mailbox){if(emulator?.isWorker){emulator.clearInput();return;}if(at>=0&&emulator){const h=emulator.module.HEAPU8;if(signature.every((v,i)=>h[at+i]===v))h.fill(0,at+28,at+36);}}
function release(){menuBits=0;menuUntil=0;keys.clear();player.reset();send(0);clearNative();}
function scan(now){
  if(emulator.isWorker){mailbox=emulator.snapshot.state?.at??-1;return emulator.snapshot.state;}
  const h=emulator.module.HEAPU8,view=new DataView(h.buffer);
  const previous=mailbox;mailbox=-1;
  for(const [at,state] of seen){
    if(!signature.every((v,i)=>h[at+i]===v)){seen.delete(at);continue;}
    const ticks=view.getUint32(at+16,true);
    if(ticks!==state.ticks){state.ticks=ticks;state.changed=now;}
    // State 0 is explicitly published on world exit; a stale DOS allocation
    // must not turn title/ending touches into writes to the departed game.
    if((now-state.changed<200||h[at+22]===2)&&h[at+22]!==0)mailbox=at;
  }
  // Reuse validated live addresses. Search only while no live mailbox exists,
  // and bound each slice to 1 MiB so discovery cannot scan the whole WASM heap
  // in one animation frame. Overlap the boundary to catch split signatures.
  if(mailbox<0){
    if(scanCursor>=h.length)scanCursor=0;
    const end=Math.min(scanCursor+1024*1024,h.length);
    const slice=h.subarray(scanCursor,Math.min(end+35,h.length));
    for(let offset=slice.indexOf(signature[0]);offset>=0&&scanCursor+offset<end;offset=slice.indexOf(signature[0],offset+1)){
      const at=scanCursor+offset;
      if(at+36>h.length||!signature.every((v,i)=>h[at+i]===v))continue;
      if(view.getUint32(at+16,true)&&view.getUint16(at+20,true)&&!seen.has(at))seen.set(at,{ticks:0,changed:-Infinity});
    }
    scanCursor=end;
  }
  if(previous!==mailbox)clearNative(previous);
  return mailbox<0?null:{mode:h[mailbox+22],flags:h[mailbox+23],generation:view.getUint16(mailbox+24,true)};
}
function tick(now){
  if(emulator?.state==='running'){
    if(!emulator.isWorker)soloMusic?.poll(emulator.module.HEAPU8,now);
    const state=scan(now),game=state?.mode===1;
    const enabled=focused&&!document.hidden&&!editor.isEditing();
    player.setContext({key:`${mailbox}:${state?.generation||0}:${game?'game':'menu'}`,play:enabled&&game&&!state.flags});
    let base=0;
    if(enabled){base=keyboardBits(keys,'solo');try{base|=padBits(Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected),'solo');}catch{}}
    let bits=enabled?player.sample(base):0;
    if((bits&3)===3)bits&=~3;if((bits&12)===12)bits&=~12;
    // The DOS title/options menus poll on their own cadence. Keep a touch
    // button edge down long enough to be sensed, without enabling gameplay fire.
    if(!game&&enabled){
      const touchButtons=bits&~base;
      if(touchButtons){menuBits=touchButtons;menuUntil=now+100;}
      if(now<menuUntil)bits|=menuBits;
      else menuBits=0;
    }else{menuBits=0;menuUntil=0;}
    send(bits);
    const touch=unpackTouch(player.pack(bits));
    if(emulator.isWorker){
      emulator.setInput({generation:state?.generation,points:(focus()?1:0)|(player.alwaysPoint()?8:0),touch:enabled&&game&&!state.flags?touch:null});
    }else if(mailbox>=0){
      const h=emulator.module.HEAPU8,v=new DataView(h.buffer),at=mailbox+28;
      h[mailbox+26]=(focus()?1:0)|(player.alwaysPoint()?8:0);
      if(enabled&&game&&!state.flags&&touch.active){
        const clamp=n=>Math.max(-8192,Math.min(8191,n));
        v.setUint16(at,touch.unlimited?3:1,true);
        v.setInt16(at+2,clamp(v.getInt16(at+2,true)+touch.x),true);
        v.setInt16(at+4,clamp(v.getInt16(at+4,true)+touch.y),true);
      }else clearNative();
    }
    player.consume();
  }
}
startFrameLoop(tick);
for(const type of ['keydown','keyup'])window.addEventListener(type,e=>{
  if(syntheticInputEvents.has(e))return;
  e.stopImmediatePropagation();
  if(type==='keyup'){if(keys.delete(e.code))e.preventDefault();return;}
  if(!emulator||editor.isEditing()||isFormTarget(e.target)||e.metaKey)return;
  if(isBound(e.code,'solo')){e.preventDefault();keys.add(e.code);}
},true);
window.addEventListener('keypress',e=>{if(!syntheticInputEvents.has(e)&&!isFormTarget(e.target)){e.preventDefault();e.stopImmediatePropagation();}},true);
window.addEventListener('blur',()=>{focused=false;release();});window.addEventListener('focus',()=>{focused=true;});
let hiddenPaused=false;
document.addEventListener('visibilitychange',()=>{if(document.hidden){release();soloMusic?.suspend();hiddenPaused=emulator?.state==='running';emulator?.pause();}
  else if(hiddenPaused){hiddenPaused=false;emulator?.run();soloMusic?.resume();}});
document.addEventListener('focusin',e=>{if(isFormTarget(e.target))release();});
canvas.onpointerdown=()=>canvas.focus();
$('restart').onclick=()=>location.reload();
$('start').onclick=async()=>{
  if(started)return;started=true;$('start').disabled=true;audioMode.disabled=true;runtimeMode.disabled=true;$('language').disabled=true;player.enter();
  const version=gameVersion($('language').value);
  const status=text=>{$('status').textContent=text;player.note(text);player.diagnostics(text);};
  try{
    if(audioMode.value==='independent')soloMusic=new SoloMusic(status);
    status(`正在加载${version.label}单机磁盘…`);
    const meta=await fetch(version.soloPatch,{cache:'no-store'});if(!meta.ok)throw Error(`配置 HTTP ${meta.status}`);patch=await meta.json();
    const response=await fetch(version.soloDisk,{cache:'no-store'});if(!response.ok)throw Error(`磁盘 HTTP ${response.status}`);
    const data=new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    if(data.length!==patch.disk.size||await sha256(data)!==patch.disk.sha256)throw Error('单机磁盘校验失败');
    if(soloMusic)await soloMusic.install(data,'GENSO');
    const config={canvas,clk_base:2457600,clk_mult:16,ExMemory:7,Latencys:100,SampleHz:44100,SNDboard:4,nativeSoloAudio:audioMode.value!=='original',no_mouse:true,use_menu:false,fontfile:'font.bmp'};
    emulator=runtimeMode.value==='worker'?await WorkerNP21.create(config,{game:'04',patch,music:soloMusic?.reader.patch,onError:e=>{soloMusic?.suspend();player.exit();status('模拟线程停止：'+e.message);}}):await NP21.create(config);
    if(emulator.isWorker)emulator.onMusic=(ax,hash)=>soloMusic?.player.command(ax,hash);
    await emulator.addDiskImage('th04-solo.hdi',data);await emulator.setHdd(0,'th04-solo.hdi');emulator.run();player.setActive(true);canvas.focus();
    status(`${version.label}单机已启动，请等待开头，在游戏内选择模式与角色。`);$('restart').disabled=false;
  }catch(e){emulator?.dispose?.();soloMusic?.dispose();player.setActive(false);player.exit();status(`启动失败：${e.message}`);$('restart').disabled=false;console.error(e);}
};

// Read-only diagnostics used by the standalone browser smoke test.
export function readFrameStats(){return {limit:60,callbacks:emulator?.module.localFrameCount||0};}
export function readSoloState(){
  if(emulator?.isWorker)return emulator.snapshot.state;
  if(!emulator||mailbox<0)return null;
  const h=emulator.module.HEAPU8,v=new DataView(h.buffer);
  const data=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
  return {mode:h[mailbox+22],flags:h[mailbox+23],ticks:v.getUint32(mailbox+16,true),
    generation:v.getUint16(mailbox+24,true),pointOptions:h[mailbox+26],
    x:v.getInt16(data+0x464e,true)/16,y:v.getInt16(data+0x4650,true)/16,
    stage:h[data+0x5394],focus:h[data+0x3976],touchFlags:v.getUint16(mailbox+28,true)};
}
