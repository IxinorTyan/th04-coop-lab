import {NP21} from '../vendor/np2/np2-wasm.js';
import {encodeConfig,installConfig} from '../launch-config.js';
import {sha256} from './sha256.js';
import {isBound,keyboardBits} from './controls.js';
import {useControlSnapshot,isFormTarget,controlsSummary} from '../control-settings.js';
import {PauseMenu} from './pause.js';
const canvas=document.getElementById('canvas'),details=document.getElementById('details');
const signature=new TextEncoder().encode('TH04COOPLABv001!');
const keyTable=[['ArrowUp','ArrowUp',38,1],['ArrowDown','ArrowDown',40,2],['ArrowLeft','ArrowLeft',37,4],['ArrowRight','ArrowRight',39,8],['KeyX','x',88,16],['KeyZ','z',90,32],['ShiftLeft','Shift',16,64],['Escape','Escape',27,128],['Enter','Enter',13,256]];
let emulator,patch,soundPolicy,bgm,musicTask,closed=false,bootPromise,oldP1=0,ticks=0,inputListener=()=>{},keys=new Set(),enabled=false,mailbox=-1;
let musicStatus='浏览器音乐：等待游戏开始后加载',musicError=false,lastMusicSequence=null;
let pendingMusic=[],lastMusicName='',musicSettings,musicReady=false;
let pauseMenu,localSlot,menuAction=()=>{},blocked=[0,0],emulatedTicks=0,playerCount=2;
const rollbackStates=new Map(),effects=new Map();
let confirmedPrefix=0,replaying=false,currentEffect;
let controlsBlocked=false;
function localButtons(){
  return keyboardBits(keys);
}
function clearKeys(){keys.clear();inputListener(0);}
window.addEventListener('keydown',event=>{
  if(controlsBlocked||isFormTarget(event.target)||event.metaKey||!isBound(event.code))return;
  event.preventDefault();event.stopImmediatePropagation();keys.add(event.code);inputListener(localButtons());
},true);
window.addEventListener('keyup',event=>{keys.delete(event.code);inputListener(localButtons());},true);
window.addEventListener('blur',clearKeys);
document.addEventListener('focusin',event=>{if(isFormTarget(event.target))clearKeys();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearKeys();emulator?.module.netFlushAudio?.();}});
canvas.addEventListener('pointerdown',()=>canvas.focus());
function nativePauseAddress(){
  return mailbox<0?-1:mailbox-patch.mailbox_cs_offset+patch.native_pause_cs_offset;
}
function nativePauseActive(){
  const at=nativePauseAddress();
  return at>=0&&emulator.module.HEAPU8[at+3]!==0;
}
function predictionBlockReason(){
  if(pauseMenu.exited)return '退出同步';
  if(pauseMenu.paused)return '同步暂停菜单';
  if(nativePauseActive())return '原生暂停菜单尚未退出';
  return '';
}
document.getElementById('bgm-volume').addEventListener('input',event=>bgm?.setVolume(Number(event.target.value)/100));
window.addEventListener('pagehide',()=>{closed=true;bgm?.dispose();});
document.getElementById('sound').onclick=async()=>{
  try{
    const context=emulator?.module.SDL2?.audioContext;
    if(!context)throw Error('模拟器音频尚未就绪');
    await context.resume();document.getElementById('sound').textContent='本机声音已启用';canvas.focus();
  }catch(error){details.textContent=error.message;}
};
async function get(path,type='json'){
  const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw Error(`资源读取失败：${path}`);
  if(type==='arrayBuffer'&&response.body){
    const total=Number(response.headers.get('content-length'))||0,reader=response.body.getReader(),chunks=[];
    let received=0,last=0;
    while(true){
      const {done,value}=await reader.read();if(done)break;
      chunks.push(value);received+=value.length;
      if(performance.now()-last>200){
        last=performance.now();
        await bootProgress(`下载游戏磁盘：${(received/1048576).toFixed(2)} MiB${total?` / ${(total/1048576).toFixed(2)} MiB（${Math.min(100,Math.floor(received/total*100))}%）`:''}`,1);
      }
    }
    const bytes=new Uint8Array(received);let at=0;
    for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    return bytes.buffer;
  }
  return response[type]();
}
async function bootProgress(message,step){
  details.textContent=`启动进度：${message}`;
  window.parent.postMessage({protocol:'th04-rollback/2',event:'boot-progress',message,step},location.origin);
  // Give the parent page a chance to display the stage before expensive work.
  await new Promise(resolve=>setTimeout(resolve,0));
}
async function boot(config){
  await bootProgress('下载游戏磁盘与版本清单',1);
  if(typeof WebAssembly==='undefined')throw Error('浏览器不支持 WebAssembly，请使用最新版 Chrome / Edge / Safari');
  if(typeof DecompressionStream==='undefined')throw Error('浏览器缺少 gzip 解压支持，请更新浏览器');
  const [compressed,meta,manifest,version]=await Promise.all([
    get('../th04-coop.hdi.gz','arrayBuffer'),get('../disk.json'),get('../patch.json'),get('./runtime.json')]);
  patch=manifest;
  await bootProgress('解压游戏磁盘',2);
  const disk=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  await bootProgress('校验游戏磁盘（局域网 HTTP 下可能需要更长时间）',3);
  if(disk.length!==meta.size||await sha256(disk)!==meta.sha256)throw Error('游戏磁盘校验失败，请刷新页面');
  installConfig(disk,patch,encodeConfig(config));
  await bootProgress('安装本局配置和声音补丁',4);
  // Apply the game's own BGM OFF / FM SE ON settings to this private copy.
  // Keep the original launcher, PMD driver, shared disk and single-player intact.
  const sound=soundPolicy=version.native_sound;
  if(sound?.disk_sha256!==meta.sha256||sound.bgm!==0||sound.se!==1||sound.schema!==2||!sound.edits?.length)
    throw Error('联机声音配置版本不匹配，请重启服务并刷新所有玩家页面');
  for(const edit of sound.edits){
    if(edit.targets.length!==edit.expected.length||edit.targets.length!==edit.values.length)throw Error('声音配置长度不匹配');
    for(const [i,at]of edit.targets.entries()){
      if(!Number.isInteger(at)||at<0||at>=disk.length||disk[at]!==edit.expected[i])throw Error('游戏声音配置位置不匹配');
    }
  }
  for(const edit of sound.edits)edit.targets.forEach((at,i)=>{disk[at]=edit.values[i];});
  await bootProgress('下载、编译并初始化 NP2 WASM 与音频设备',5);
  emulator=await NP21.create({canvas,lockstep:true,lockstepEpoch:version.epoch,
    clk_base:2457600,clk_mult:16,ExMemory:7,Latencys:40,SampleHz:44100,SNDboard:4,
    no_mouse:true,use_menu:false,fontfile:'font.bmp',
    onExit:()=>{enabled=false;closed=true;bgm?.dispose();window.parent.postMessage({protocol:'th04-rollback/2',event:'runtime-exit'},location.origin);}});
  if(closed){emulator.pause();return;}
  await bootProgress('挂载游戏磁盘',6);
  emulator.addDiskImage('th04-sync.hdi',disk);emulator.setHdd(0,'th04-sync.hdi');
  if(emulator.module.SDL2?.audioContext?.sampleRate!==44100)throw Error('此浏览器未提供统一的 44100 Hz 音频，请改用新版 Chrome 或 Edge');
  // No music imports/downloads/decoding until an actual game frame is observed.
  musicSettings=config;
  await bootProgress('原游戏磁盘和引擎已就绪，等待全员同步开局',7);
  return {disk:meta.sha256,runtime:version.generated_js_sha256,wasm:version.wasm_sha256,clock:version.clock_sha256,audio:version.audio_output_sha256,nativeSound:sound,queue:version.rollback_queue_sha256,snapshots:version.native_snapshots_sha256,controls:version.controls_sha256,pause:version.pause_sha256,game:version.game_adapter_sha256,room:version.room_sha256,membership:version.membership_sha256,startup:version.startup_sha256,hostSlot:pauseMenu.hostSlot,adapter:version.adapter};
}
function findMailbox(){
  const heap=emulator.module.HEAPU8,view=new DataView(heap.buffer);
  if(mailbox>=0&&signature.every((v,i)=>heap[mailbox+i]===v))return;
  mailbox=-1;
  const candidates=[];
  for(let at=heap.indexOf(signature[0]);at>=0;at=heap.indexOf(signature[0],at+1)){
    if(at+675<heap.length&&signature.every((v,i)=>heap[at+i]===v)&&heap[at+25]===1&&view.getUint32(at+16,true)>0&&view.getUint16(at+20,true)>0)candidates.push(at);
  }
  if(candidates.length===1)mailbox=candidates[0];
}
function applyP1(bits){
  for(const [code,key,keyCode,bit]of keyTable){
    if((bits&bit)===(oldP1&bit))continue;
    emulator.module.netKey(bits&bit?'keydown':'keyup',{code,key,keyCode,which:keyCode,charCode:0,
      location:code==='ShiftLeft'?1:0,timeStamp:emulatedTicks*1000/60,shiftKey:!!(bits&64),ctrlKey:false,altKey:false,metaKey:false,repeat:false,preventDefault(){}});
  }
  oldP1=bits;
}
function stepInner(inputs){
  if(!enabled)throw Error('本机游戏没有运行');
  // There is no native stage pause before the first gameplay mailbox exists.
  if(mailbox<0&&emulatedTicks%15===0)findMailbox();
  const wasPaused=pauseMenu.paused,result=mailbox>=0?pauseMenu.step(inputs):'play';
  ticks++;
  if(result==='exit')return 'exit';
  if(result==='paused'&&!wasPaused)currentEffect.flushAudio=true;
  if(result==='resume')blocked=[...inputs];
  inputs=inputs.map((value,i)=>{blocked[i]&=value;return value&~blocked[i]&~(128|512|1024);});
  const pauseAt=nativePauseAddress(),active=nativePauseActive();
  if(pauseAt>=0){
    const heap=emulator.module.HEAPU8;
    heap[pauseAt]=1;heap[pauseAt+1]=pauseMenu.paused?1:0;heap[pauseAt+2]=pauseMenu.selection;
    if(pauseMenu.paused||active||result==='resume'){
      inputs=Array(playerCount).fill(0);
      // Any seat can request the original P1 pause entry. Release Esc as soon
      // as native code acknowledges it; native menu commands use the bridge.
      if(pauseMenu.paused&&!active)inputs[0]=128;
    }
  }
  applyP1(inputs[0]);
  if(mailbox>=0){
    const heap=emulator.module.HEAPU8;
    for(let slot=1;slot<playerCount;slot++){
      const at=slot===1?mailbox+22:mailbox-patch.mailbox_cs_offset+patch.p3_input_cs_offset;
      heap[at]=inputs[slot]&63;heap[at+1]=0;heap[at+2]=(inputs[slot]>>>6)&1;
    }
  }
  emulator.step();emulatedTicks++;
  if(mailbox>=0&&!musicError){
    try{currentEffect.music=readMusic();}
    catch(error){currentEffect.musicError=error.message;}
  }
  if(mailbox<0&&emulatedTicks>=10800)throw Error('模拟启动超过 180 秒仍未进入游戏，请记录两边的画面');
  if(!replaying&&ticks%30===0){
    const s=snapshot();
    const info=emulator.module.netInfo();
    details.textContent=`本机同步步 ${ticks} · 游戏帧 ${s?.gameFrame??'启动中'} · 音频断供 ${info.audioUnderruns??0}\n声音待播 ${(info.audioQueuedMs??0).toFixed(1)} ms · 设备延迟 ${info.audioDeviceMs==null?'浏览器未提供':info.audioDeviceMs.toFixed(1)+' ms'} · 清理积压 ${info.audioResets??0} 次`;
    if(s)details.textContent+='\n'+s.players.map((xy,i)=>`P${i+1} (${xy.join(', ')})`).join(' · ');
    else details.textContent+=`\n启动进度：正在执行 DOS / 游戏启动，尚未检测到游戏首帧（模拟时间 ${(emulatedTicks/60).toFixed(1)} 秒）。`;
    details.textContent+=`\n${musicError?musicStatus:(bgm?.status??musicStatus)}`;
    if(mailbox>=0){const d=gameDataBase(),h=emulator.module.HEAPU8;details.textContent+=` · 游戏实际 BGM=${h[d+soundPolicy.observer.bgm_mode]} / SE=${h[d+soundPolicy.observer.se_mode]}`;}
  }
}
function step(inputs,{frame=ticks,replay=false,offlineMask=0}={}){
  replaying=replay;currentEffect={};
  emulator.module.netBeginFrame(frame,replay);
  try{
    if(mailbox>=0)emulator.module.HEAPU8[mailbox-patch.mailbox_cs_offset+patch.offline_mask_cs_offset]=offlineMask;
    currentEffect.result=stepInner(inputs);effects.set(frame,currentEffect);
    return currentEffect.result;
  }finally{emulator.module.netEndFrame();replaying=false;currentEffect=null;}
}
function capture(frame){
  emulator.module.netCapture(frame);
  rollbackStates.set(frame,{ticks,emulatedTicks,oldP1,mailbox,blocked:blocked.slice(),
    pause:{previous:pauseMenu.previous.slice(),paused:pauseMenu.paused,selection:pauseMenu.selection,exited:pauseMenu.exited}});
}
function restore(frame){
  const saved=rollbackStates.get(frame);
  if(!saved||frame<confirmedPrefix)throw Error('游戏回滚状态已过期');
  emulator.module.netRestore(frame);
  ({ticks,emulatedTicks,oldP1,mailbox}=saved);blocked=saved.blocked.slice();
  Object.assign(pauseMenu,saved.pause,{previous:saved.pause.previous.slice()});
  for(const key of rollbackStates.keys())if(key>=frame)rollbackStates.delete(key);
  for(const key of effects.keys())if(key>=frame)effects.delete(key);
}
function confirm(prefix){
  let exit=false;
  for(let frame=confirmedPrefix;frame<prefix;frame++){
    const effect=effects.get(frame);if(!effect)throw Error('确认帧缺少模拟结果');
    if(effect.flushAudio)emulator.module.netFlushAudio();
    emulator.module.netConfirm(frame+1);
    if(effect.musicError){musicError=true;musicStatus=`浏览器音乐错误（游戏继续）：${effect.musicError}`;}
    if(effect.music&&!musicError){try{observeMusic(effect.music);}catch(error){musicError=true;musicStatus=`浏览器音乐错误（游戏继续）：${error.message}`;}}
    if(effect.result==='exit')exit=true;
    effects.delete(frame);rollbackStates.delete(frame);
  }
  confirmedPrefix=prefix;return exit?'exit':undefined;
}
function snapshot(){
  if(mailbox<0)return null;
  const v=new DataView(emulator.module.HEAPU8.buffer),m=mailbox;
  const players=[[v.getInt16(m+36,true)/16,v.getInt16(m+38,true)/16],[v.getInt16(m+46,true)/16,v.getInt16(m+48,true)/16]];
  if(playerCount===3){const at=m-patch.mailbox_cs_offset+patch.p3_motion_cs_offset;players.push([v.getInt16(at+2,true)/16,v.getInt16(at+4,true)/16]);}
  return {gameFrame:v.getUint32(m+16,true),stageFrame:v.getUint16(m+40,true),players,p1:players[0],p2:players[1]};
}
function deliverMusic(ax,name){
  if(musicReady)bgm.commandTrack(ax,name);
  else{pendingMusic.push([ax,name]);if(pendingMusic.length>64)pendingMusic.shift();}
}
function readMusic(){
  const heap=emulator.module.HEAPU8,view=new DataView(heap.buffer),d=gameDataBase(),o=soundPolicy.observer;
  let raw='';
  for(let i=0;i<13&&heap[d+o.filename+i];i++)raw+=String.fromCharCode(heap[d+o.filename+i]);
  const name=/^(st\d\d[bc]?|end[12]|staff|name|op|logo)\./.exec(raw.toLowerCase())?.[1];
  const sequence=view.getUint16(d+o.sequence,true),ax=view.getUint16(d+o.command,true);
  return {name,sequence,ax,mode:heap[d+o.bgm_mode]};
}
function observeMusic({name,sequence,ax,mode}){
  if(mode!==0)throw Error('游戏内 BGM 未关闭，暂不叠加浏览器音乐');
  const changed=lastMusicSequence!==sequence;
  if(name){
    // The current filename remains observable even with native BGM OFF.
    // On the first frame, restore the current song then apply its latest event.
    if(!lastMusicName){deliverMusic(0,name);if(changed&&(ax>>>8)!==0)deliverMusic(ax,name);}
    else if(changed)deliverMusic(ax,name);
    lastMusicName=name;
  }else if(changed&&lastMusicName)deliverMusic(ax,lastMusicName);
  lastMusicSequence=sequence;
  if(!musicTask){
    musicStatus='浏览器音乐：游戏已运行，正在后台加载';
    musicTask=new Promise(resolve=>setTimeout(resolve,0)).then(async()=>{
      if(closed)return;
      const {LocalBgm}=await import('./local-bgm.js');
      if(closed)return;
      bgm=new LocalBgm(emulator.module.SDL2.audioContext,()=>{});
      bgm.setVolume(Number(document.getElementById('bgm-volume').value)/100);
      await bgm.load({...musicSettings,warmOpening:false});
      if(closed)return;
      musicReady=true;
      for(const [command,track]of pendingMusic.splice(0))bgm.commandTrack(command,track);
    }).catch(error=>{if(!closed){musicError=true;musicStatus=`浏览器音乐加载失败（游戏继续）：${error.message}`;}});
  }
}
function gameDataBase(){return mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;}
function guestBase(){
  const heap=emulator.module.HEAPU8,v=new DataView(heap.buffer);
  const dataBase=gameDataBase();
  const base=dataBase-v.getUint16(mailbox+20,true)*16;
  if(!Number.isInteger(base)||base<0||base+0xa0000>heap.length)throw Error('游戏内存布局不匹配');
  return base;
}
function checksum(){
  let h=0x811c9dc5;
  for(const value of [...pauseMenu.signature(),...blocked,emulatedTicks])h=Math.imul(h^value,0x01000193);
  if(mailbox<0)return {tick:ticks,hash:(h>>>0).toString(16).padStart(8,'0'),gameFrame:0};
  const heap=emulator.module.HEAPU8,v=new DataView(heap.buffer),base=guestBase();
  for(let at=base;at<base+0xa0000;at++)h=Math.imul(h^heap[at],0x01000193);
  return {tick:ticks,hash:(h>>>0).toString(16).padStart(8,'0'),gameFrame:v.getUint32(mailbox+16,true)};
}
window.th04Sync={
  updateControls(value,editing=false){clearKeys();useControlSnapshot(value);controlsBlocked=editing;document.getElementById('controls-summary').textContent=controlsSummary('online');},
  configure(host,local,players=2){
    if(![2,3].includes(players)||![host,local].every(n=>Number.isInteger(n)&&n>=0&&n<players))throw Error('无效暂停菜单座位');
    playerCount=players;blocked=Array(players).fill(0);pauseMenu=new PauseMenu(host,players);localSlot=local;
  },
  onMenuAction(callback){menuAction=callback;},
  load(config){if(!bootPromise)bootPromise=boot(config);return bootPromise;},
  onInput(callback){inputListener=callback;},
  start(){emulator.run();enabled=true;details.textContent='启动进度：全员已同步开局，正在启动 DOS 和游戏。';canvas.focus();},
  stop(){enabled=false;closed=true;clearKeys();bgm?.dispose();if(emulator){emulator.module.netFlushAudio();emulator.pause();}},
  step,checksum,snapshot,capture,restore,confirm,
  readyForRollback:()=>mailbox>=0&&!!emulator?.module.netCapture,
  canPredict:()=>!predictionBlockReason(),predictionBlockReason,
  rollbackInfo:()=>emulator?.module.netSnapshotInfo()
};
