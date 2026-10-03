import {PROTOCOL,RollbackQueue,TICK_MS,MAX_ROLLBACK} from './rollback-queue.js';
import {mapping,keyboardBits,gamepadBits,gamepadStatus,normalize} from './controls.js';
import {mergeDeparture} from './membership.js';
const $=id=>document.getElementById(id),roles=['host','guest','guest2'];
const label=role=>({host:'房主',guest:'客机 1',guest2:'客机 2'})[role];
const status=text=>{$('status').textContent=text;};
const settingNames=['players','p1','p2','p3','difficulty','lives','bombs'];
let session,state,iframe,runtime,queue,localReady;
let preparing=false,running=false,stopped=false,busy=false,runRequested=false;
let pollTimer,heartbeatTimer,loadTimer,raf,wakeTimer=null,wakeAt=0;
let waitingSince=0,replayUntil=0,rollbackCount=0,resimulated=0,maxRewind=0;
const pendingHashes=new Map();
let keys=new Set(),childBits=0,pendingAction=0,bits=0,inputChangedAt=0;
let peers=new Map(),hashes=new Map(),captureTimes=new Map();
let pumping=false,lastNow=0,accumulator=0,lastUi=0,lastMeasure=0,measureFrame=0;
let stepCost=0,stepCount=0,maxCost=0,hz=0,averageCost=0,peakCost=0,inputAge=0,lastApplied=0,receivedInputs=0;
const activeRoles=()=>roles.slice(0,state.settings.players);
const onlinePeers=()=>[...peers.values()].filter(peer=>!peer.offline);
const GRACE_MS=5000;
let membership=null,membershipId=0,pollFailedAt=0;
let bootStage='等待加载游戏页面';
let bootStep=0,bootStartedAt=0;
let stopReason='';
function startupFailure(reason){
  if(!preparing)return;
  const panel=$('startup-progress');panel.hidden=false;
  const message=document.createElement('p');message.setAttribute('role','alert');
  message.textContent=`本局已停止：${reason}。下面是停止前的最后状态，不再更新。`;
  panel.prepend(message);
  $('diagnostics').textContent=`本局已停止：${reason}\n${$('diagnostics').textContent}`;
  // Publish even when WebRTC never opened. This is a diagnostic, not an
  // authoritative gameplay departure or a reason to alter other peers' state.
  if(session){
    const q=new URLSearchParams({room:session.room,token:session.token,boot_stage:`启动已停止：${reason}`.slice(0,300),boot_step:String(bootStep)});
    fetch(`/api/events?${q}`,{signal:AbortSignal.timeout(5000)}).catch(()=>{});
  }
}
function showStartup(){
  const panel=$('startup-progress');
  if(running){panel.hidden=true;return;}
  if(!preparing||stopped)return;
  panel.hidden=false;panel.replaceChildren();
  const rows=[{name:'本机',stage:bootStage,step:bootStep},...onlinePeers().map(p=>({
    name:label(p.role),stage:p.ready?'资源已就绪':p.bootStage||'尚未收到加载状态（不代表正在下载）',
    step:p.ready?7:p.bootStep??0,connection:`数据通道 ${p.channel?.readyState||'未建立'} / ICE ${p.pc.iceConnectionState} / 协商 ${p.pc.signalingState} · ${p.signalStage||'等待协商'} · 候选 本机 ${p.localCandidates||0} / 收到 ${p.remoteCandidates||0} / 已提交 ${p.appliedCandidates||0}${p.iceWarning?' · '+p.iceWarning:''}`,
    age:p.bootReportedAt==null?null:(performance.now()-p.bootReportedAt)/1000
  }))];
  for(const row of rows){
    const box=document.createElement('div'),caption=document.createElement('p'),bar=document.createElement('progress');
    caption.textContent=`${row.name}：${row.stage}${row.connection?' · '+row.connection:''}${row.age>5?` · 状态已 ${Math.floor(row.age)} 秒未更新`:''}`;
    bar.max=7;bar.value=row.step;bar.style.width='100%';bar.setAttribute('aria-label',`${row.name} 已完成 ${row.step}/7 个加载阶段`);
    const note=document.createElement('small');note.textContent=`已完成 ${row.step}/7 个阶段（不是下载百分比）`;
    box.append(caption,bar,note);panel.append(box);
  }
  $('diagnostics').textContent=`启动已用 ${Math.floor((performance.now()-bootStartedAt)/1000)} 秒。资源加载与连接建立是两个独立过程。\n`
    +'资源就绪但通道仍 connecting：正在等待局域网直连，不是继续下载资源。';
}
function closeDisconnected(reason){
  if(stopped)return;
  stopReason=String(reason);startupFailure(stopReason);
  stopped=true;running=false;clearInput();runtime?.stop();iframe?.remove();runtime=null;
  clearTimers();disconnect();render();status(`${reason}。本局游戏已关闭。`);
}
function suspect(peer){
  if(stopped||peer.offline)return;
  if(!running){
    // Membership/eviction only exists after the shared run gate. During boot,
    // record browser state without closing peers or starting a grace timer.
    peer.iceWarning=`开局连接等待：${peer.pc.connectionState}（由建连/加载期限处理）`;
    showStartup();
    return;
  }
  peer.suspectAt??=performance.now();
  status(`${label(peer.role)}连接中断，等待恢复（5 秒）…`);
}
function reportDeparture(role){
  if(session.role==='host')beginDeparture([role]);
  else send(peers.get('host'),{type:'suspect',role});
}
function beginDeparture(dropped){
  if(stopped||!running||session.role!=='host')return;
  const targets=[...new Set([...(membership?.roles||[]),...dropped])].filter(r=>!peers.get(r)?.offline);
  if(!targets.length||targets.some(r=>r==='host'||!peers.has(r)))throw Error('无效离线目标');
  membership={id:++membershipId,roles:targets,reports:new Map(),started:performance.now()};
  // Freeze before collecting reports. The original guest input lane may have
  // arrived at different frontiers; surviving peers contribute their history.
  membership.reports.set(session.role,queue.membershipReport());
  broadcast({type:'departure-prepare',id:membership.id,roles:targets});
  finishDeparture();
}
function finishDeparture(){
  if(session.role!=='host'||!membership)return;
  const remaining=onlinePeers().filter(p=>!membership.roles.includes(p.role));
  if(!remaining.every(p=>membership.reports.has(p.role)))return;
  const closed=remaining.filter(p=>p.channel?.readyState!=='open');
  if(closed.length){beginDeparture(closed.map(p=>p.role));return;}
  const change=mergeDeparture([...membership.reports.values()],membership.roles.map(r=>state.slots[r]),state.settings.players);
  const message={type:'departure-commit',id:membership.id,roles:membership.roles,...change};
  for(const peer of remaining)send(peer,message);
  const dropped=membership.roles.slice();applyDeparture(message);
  request('drop',{roles:dropped}).then(r=>update(r.state)).catch(()=>{});
}
function applyDeparture(message){
  if(!membership||message.id!==membership.id||JSON.stringify(message.roles)!==JSON.stringify(membership.roles)||
     JSON.stringify(message.slots)!==JSON.stringify(message.roles.map(r=>state.slots[r])))throw Error('离线确认不匹配');
  queue.applyDeparture(message);
  for(const role of message.roles){
    const peer=peers.get(role);peer.offline=true;peer.ended=true;
    clearTimeout(peer.connectTimer);peer.channel?.close();peer.pc.close();
  }
  membership=null;lastNow=performance.now();accumulator=0;
  render();
  status(`${message.roles.map(label).join('、')}已离线，角色转为离线幽灵，其余玩家继续。`);
  wake();
}
async function request(action,data={}){
  const response=await fetch(`/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({protocol:PROTOCOL,room:session?.room,token:session?.token,...data}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);return result;
}
function signal(peer,message){return request('signal',{to:peer.role,message});}
function send(peer,message){
  if(!peer||peer.offline)return;
  if(peer.channel?.readyState!=='open'){suspect(peer);return;}
  if(peer.channel.bufferedAmount>262144){suspect(peer);return;}
  try{peer.channel.send(JSON.stringify({...message,protocol:PROTOCOL,generation:state.generation}));}
  catch{suspect(peer);}
}
function broadcast(message){for(const peer of onlinePeers())send(peer,message);}
function pingPeer(peer){
  const id=++peer.pingId;peer.pings.set(id,performance.now());trim(peer.pings);
  send(peer,{type:'ping',id});
}
function recordPong(peer,id){
  if(!peer.pings.has(id))return;
  peer.rtt=performance.now()-peer.pings.get(id);peer.pings.delete(id);
}
function clearInput(){keys.clear();childBits=0;pendingAction=0;bits=0;}
function clearTimers(){
  clearTimeout(pollTimer);clearTimeout(loadTimer);clearInterval(heartbeatTimer);
  clearTimeout(wakeTimer);cancelAnimationFrame(raf);
  for(const peer of peers.values())clearTimeout(peer.connectTimer);
}
function disconnect(){for(const peer of peers.values()){peer.channel?.close();peer.pc.close();}}
function fail(error){
  if(stopped)return;
  stopReason=String(error.message||error);startupFailure(stopReason);
  stopped=true;running=false;clearInput();
  for(const peer of peers.values())if(peer.channel?.readyState==='open'){
    try{send(peer,{type:'fatal',reason:String(error.message||error).slice(0,600)});}catch{}
  }
  runtime?.stop();clearTimers();disconnect();render();
  status(`本局已停止：${error.message||error}。所有玩家点击“结束并返回”后重新建房。`);
}
function closeFinishedRoom(){
  if(session.role!=='host'||!stopped||!onlinePeers().every(peer=>peer.ended))return;
  disconnect();request('leave').catch(()=>{});
}
function finishGame(){
  if(stopped)return;stopped=true;running=false;clearInput();
  runtime?.stop();iframe?.remove();runtime=null;clearTimers();
  if(session.role==='host'){broadcast({type:'end'});closeFinishedRoom();}
  else send(peers.get('host'),{type:'end-ack'});
  status('房主已退出，本局游戏已关闭。');render();
}
function render(){
  if(!session||!state)return;
  const slot=state.slots[session.role],lobby=state.phase==='lobby'&&!stopped,active=activeRoles();
  $('entry').hidden=true;$('lobby').hidden=false;
  $('room-info').textContent=`房间 ${session.room} · ${state.settings.players} 人模式 · 你是${label(session.role)} · ${slot===null?'尚未选座':`P${slot+1}`}`;
  $('seats').textContent=Array.from({length:state.settings.players},(_,n)=>{
    const role=active.find(r=>state.slots[r]===n);return `P${n+1}：${role?`${label(role)}${peers.get(role)?.offline?'（已离线）':state.ready[role]?'（已准备）':''}`:'空位'}`;
  }).join(' / ');
  for(let n=0;n<3;n++){
    $(`seat${n}`).hidden=n>=state.settings.players;
    $(`seat${n}`).disabled=!lobby||busy||active.some(r=>r!==session.role&&state.slots[r]===n);
    $(`seat${n}`).textContent=slot===n?`已选择 P${n+1}`:`选择 P${n+1}`;
  }
  $('settings').disabled=!lobby||busy||session.role!=='host';
  for(const key of settingNames)$(key).value=state.settings[key];
  $('p3-setting').hidden=state.settings.players!==3;
  $('ready').disabled=!lobby||busy||slot===null;
  $('ready').textContent=state.ready[session.role]?'取消准备':'准备';
  $('start').hidden=session.role!=='host';
  $('start').disabled=!lobby||busy||!active.every(role=>state.present[role]&&state.ready[role]);
}
function update(value){
  if(stopped)return;
  if(!value||value.protocol!==PROTOCOL)throw Error('请重启新版 start-lan.bat 并刷新所有玩家的页面');
  if(state&&value.revision<=state.revision)return;
  state=value;render();
  if(state.phase==='ended'){closeDisconnected('房主已离开');return;}
  if(running)for(const peer of onlinePeers())if(!state.present[peer.role])suspect(peer);
  if(state.phase==='loading'&&!preparing){preparing=true;beginGame().catch(fail);}
}
async function action(name,data={}){
  if(busy)return;busy=true;render();
  try{const result=await request(name,data);if(result.state)update(result.state);}
  catch(error){status(error.message);}finally{busy=false;render();}
}
async function enter(role){
  if(busy||session)return;busy=true;$('create').disabled=true;$('join').disabled=true;
  try{
    const result=await request(role==='host'?'create':'join',{room:$('room').value.trim().toUpperCase()});
    if(result.protocol!==PROTOCOL)throw Error('请重新启动新版 start-lan.bat');
    session={room:result.room,token:result.token,role:result.role};update(result.state);
    status('房主选择双人或三人模式；所有玩家分别选座并准备后开始。');poll();
  }catch(error){status(error.message);}finally{busy=false;$('create').disabled=false;$('join').disabled=false;render();}
}
async function poll(){
  if(stopped)return;
  try{
    const q=new URLSearchParams({room:session.room,token:session.token});
    if(preparing&&!running){q.set('boot_stage',bootStage);q.set('boot_step',String(bootStep));}
    const response=await fetch(`/api/events?${q}`,{signal:AbortSignal.timeout(10000)});
    const result=await response.json();if(!response.ok)throw Error(result.error);
    pollFailedAt=0;
    update(result.state);
    for(const [role,progress]of Object.entries(result.startup||{})){
      const peer=peers.get(role);if(!peer)continue;
      peer.bootStage=progress.stage;peer.bootStep=progress.step;
      peer.bootReportedAt=performance.now()-progress.age*1000;
    }
    showStartup();
    // HTTP polling must not wait for browser ICE/mDNS operations. Preserve
    // description ordering per peer, while candidate resolution is separate.
    for(const event of result.events)if(!stopped)dispatchSignal(event);
    if(!stopped)pollTimer=setTimeout(poll,400);
  }catch(error){
    if(stopped)return;
    pollFailedAt||=performance.now();
    if(performance.now()-pollFailedAt>=GRACE_MS){closeDisconnected('房间服务连接已断开');return;}
    status('房间服务暂时无响应，正在重试…');pollTimer=setTimeout(poll,500);
  }
}
function trim(map){while(map.size>60)map.delete(map.keys().next().value);}
function compare(peer,tick){
  if(peer.offline||membership)return;
  const a=hashes.get(tick),b=peer.hashes.get(tick);if(!a||!b)return;
  if(a.hash!==b.hash||a.gameFrame!==b.gameFrame)throw Error(`${label(peer.role)}在同步步 ${tick} 不一致：本机 ${a.hash}/${a.gameFrame}，对方 ${b.hash}/${b.gameFrame}`);
  peer.confirmed=tick;peer.hashes.delete(tick);
}
function attachChannel(peer,channel){
  if(channel.label!=='th04-inputs')throw Error('未知连接通道');
  if(peer.channel)throw Error('重复操作通道');peer.channel=channel;
  channel.onopen=()=>{
    if(stopped){channel.close();return;}
    clearTimeout(peer.connectTimer);peer.lastPacket=performance.now();
    try{send(peer,{type:'hello',settings:state.settings,slots:state.slots});if(localReady)send(peer,{type:'ready',build:localReady});}
    catch(error){fail(error);}
  };
  channel.onmessage=event=>{
    try{
      if(peer.offline)return;
      if(typeof event.data!=='string'||event.data.length>65536)throw Error('无效同步消息');
      const m=JSON.parse(event.data);
      if(m.protocol!==PROTOCOL||m.generation!==state.generation)throw Error('同步消息不属于本局');
      peer.lastPacket=performance.now();peer.suspectAt=null;
      if(stopped&&m.type!=='end'&&m.type!=='end-ack')return;
      switch(m.type){
        case 'hello':
          if(JSON.stringify(m.settings)!==JSON.stringify(state.settings)||JSON.stringify(m.slots)!==JSON.stringify(state.slots))throw Error('开局设置不一致');
          peer.hello=true;maybeRun();break;
        case 'ready':peer.ready=m.build;maybeRun();break;
        case 'run':
          if(peer.role!=='host'||session.role==='host')throw Error('无效开局通知');
          if(runRequested)throw Error('重复开局通知');
          runRequested=true;maybeRun();break;
        case 'input':
          if(m.slot!==state.slots[peer.role])throw Error('玩家输入身份不匹配');
          if(membership?.roles.includes(peer.role))break;
          queue.receive(m.frame,m.buttons,m.slot);receivedInputs++;wake();break;
        case 'input-tail':
          if(m.slot!==state.slots[peer.role]||!Array.isArray(m.inputs)||m.inputs.length>160)throw Error('无效输入补包');
          if(membership?.roles.includes(peer.role))break;
          for(const [frame,buttons]of m.inputs)queue.receive(frame,buttons,m.slot);
          wake();break;
        case 'rollback':
          if(peer.role!=='host'||session.role==='host')throw Error('无效回滚启用通知');
          queue.arm(m.frame);break;
        case 'hash':
          if(!Number.isSafeInteger(m.tick)||m.tick<0||m.tick>queue.frame+120||typeof m.hash!=='string'||m.hash.length>16||!Number.isInteger(m.gameFrame))throw Error('无效状态摘要');
          peer.hashes.set(m.tick,m);compare(peer,m.tick);trim(peer.hashes);
          if(m.boot===true)peer.rollbackReady=true;armRollback();break;
        case 'heartbeat':
          peer.hidden=!!m.hidden;
          if(typeof m.bootStage==='string')peer.bootStage=m.bootStage.slice(0,300);
          showStartup();break;
        case 'ping':if(Number.isSafeInteger(m.id))send(peer,{type:'pong',id:m.id});break;
        case 'pong':recordPong(peer,m.id);break;
        case 'suspect':
          if(session.role!=='host'||!peers.has(m.role)||m.role==='host'||m.role===peer.role)throw Error('无效断链报告');
          if(!peers.get(m.role).offline&&!membership?.roles.includes(m.role))beginDeparture([m.role]);break;
        case 'departure-prepare':
          if(peer.role!=='host'||!Number.isSafeInteger(m.id)||m.id<=membershipId||!Array.isArray(m.roles)||
             !m.roles.length||new Set(m.roles).size!==m.roles.length||m.roles.some(r=>r==='host'||!activeRoles().includes(r)))throw Error('无效离线协商');
          membershipId=m.id;
          if(m.roles.includes(session.role)){closeDisconnected('你已与本局断开连接');return;}
          membership={id:m.id,roles:m.roles,started:performance.now()};
          send(peer,{type:'departure-report',id:m.id,report:queue.membershipReport()});break;
        case 'departure-report':
          if(session.role!=='host'||!membership||m.id!==membership.id)break;
          if(!membership.roles.includes(peer.role)){membership.reports.set(peer.role,m.report);finishDeparture();}break;
        case 'departure-commit':
          if(peer.role!=='host')throw Error('只有房主能确认离线');applyDeparture(m);break;
        case 'end':
          if(peer.role!=='host'||session.role==='host')throw Error('只有房主能退出本局');
          if(stopped)send(peer,{type:'end-ack'});else finishGame();break;
        case 'end-ack':if(session.role!=='host')throw Error('无效退出确认');peer.ended=true;closeFinishedRoom();break;
        case 'fatal':
          if(!running){fail(Error(`${label(peer.role)}启动失败：${String(m.reason).slice(0,600)}`));return;}
          if(peer.role==='host'){closeDisconnected('房主已停止游戏');return;}
          suspect(peer);break;
        default:throw Error('未知同步消息');
      }
    }catch(error){fail(error);}
  };
  channel.onclose=()=>{if(stopped||peer.offline)peer.pc.close();else suspect(peer);};
  channel.onerror=()=>suspect(peer);
}
function makePeer(role){
  const pc=new RTCPeerConnection({iceServers:[]});
  const peer={role,pc,candidates:[],hashes:new Map(),pings:new Map(),confirmed:0,lastPacket:performance.now(),pingId:0};peers.set(role,peer);
  peer.signalChain=Promise.resolve();
  pc.onicecandidate=event=>{if(event.candidate&&!stopped){peer.localCandidates=(peer.localCandidates||0)+1;signal(peer,{type:'ice',candidate:event.candidate.toJSON()}).catch(fail);showStartup();}};
  pc.onconnectionstatechange=()=>{
    showStartup();
    if(['failed','disconnected'].includes(pc.connectionState))suspect(peer);
  };
  pc.oniceconnectionstatechange=showStartup;
  pc.onsignalingstatechange=showStartup;
  pc.ondatachannel=event=>{try{attachChannel(peer,event.channel);}catch(error){fail(error);}};
  peer.connectTimer=setTimeout(()=>fail(Error(`与${label(role)}建立数据通道超过 30 秒（ICE ${pc.iceConnectionState}）；这是连接超时，资源状态见加载进度`)),30000);return peer;
}
async function signalingStep(peer,name,operation){
  peer.signalStage=name;showStartup();
  let timer;
  try{
    return await Promise.race([operation(),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error(`${label(peer.role)}：${name}超过 15 秒（ICE ${peer.pc.iceConnectionState}）`)),15000);
    })]);
  }finally{clearTimeout(timer);}
}
function submitCandidate(peer,candidate){
  // A single unresolved/unsupported candidate must not hold up the SDP answer
  // or other candidates. Overall connection timeout still bounds the attempt.
  let settled=false;
  const timer=setTimeout(()=>{if(!settled&&!stopped&&!peer.offline){peer.iceWarning='有候选解析超过 8 秒，继续尝试其他候选';showStartup();}},8000);
  Promise.resolve().then(()=>peer.pc.addIceCandidate(candidate)).then(()=>{
    peer.appliedCandidates=(peer.appliedCandidates||0)+1;
  }).catch(error=>{peer.iceWarning=`候选处理失败：${String(error.message||error).slice(0,120)}`;})
    .finally(()=>{settled=true;clearTimeout(timer);showStartup();});
}
function dispatchSignal(event){
  const peer=peers.get(event?.from);
  if(!peer||!event.message)throw Error('未知信令来源');
  if(peer.offline)return;
  if(event.message.type==='ice'){
    peer.remoteCandidates=(peer.remoteCandidates||0)+1;
    if(peer.pc.remoteDescription)submitCandidate(peer,event.message.candidate);
    else peer.candidates.push(event.message.candidate);
    showStartup();return;
  }
  peer.signalChain=peer.signalChain.then(()=>{
    if(!stopped&&!peer.offline)return receivedSignal(event);
  }).catch(fail);
}
async function remoteDescription(peer,description){
  await signalingStep(peer,'应用远端连接描述',()=>peer.pc.setRemoteDescription(description));
  for(const candidate of peer.candidates.splice(0))submitCandidate(peer,candidate);
}
async function receivedSignal({from,message}){
  const peer=peers.get(from);if(!peer||!message)throw Error('未知信令来源');
  if(peer.offline)return;
  if(message.type==='offer'){
    if(roles.indexOf(from)>=roles.indexOf(session.role)||peer.pc.remoteDescription)throw Error('重复或无效连接请求');
    await remoteDescription(peer,message.description);
    await signalingStep(peer,'生成连接应答',async()=>peer.pc.setLocalDescription(await peer.pc.createAnswer()));
    await signal(peer,{type:'answer',description:peer.pc.localDescription.toJSON()});
    peer.signalStage='已发送应答，等待直连';showStartup();
  }else if(message.type==='answer'){
    if(roles.indexOf(from)<=roles.indexOf(session.role)||peer.pc.remoteDescription)throw Error('无效连接响应');
    await remoteDescription(peer,message.description);
    peer.signalStage='已接收应答，等待直连';showStartup();
  }else throw Error('未知信令');
}
async function beginGame(){
  bootStartedAt=performance.now();
  if(!window.RTCPeerConnection)throw Error('请使用新版 Chrome 或 Edge');
  queue=new RollbackQueue(state.slots[session.role],state.settings.players);
  for(const role of activeRoles())if(role!==session.role)makePeer(role);
  for(const peer of peers.values())if(roles.indexOf(session.role)<roles.indexOf(peer.role)){
    attachChannel(peer,peer.pc.createDataChannel('th04-inputs',{ordered:true}));
    peer.signalChain=signalingStep(peer,'生成连接邀请',async()=>peer.pc.setLocalDescription(await peer.pc.createOffer()))
      .then(async()=>{if(!stopped){await signal(peer,{type:'offer',description:peer.pc.localDescription.toJSON()});peer.signalStage='已发送邀请，等待应答';showStartup();}}).catch(fail);
  }
  heartbeatTimer=setInterval(()=>{
    try{
      const now=performance.now();
      showStartup();
      for(const peer of onlinePeers()){
        // Connecting/loading have their own 30 s / 180 s deadlines. A mobile
        // browser compiling WASM must not be evicted by the in-game watchdog.
        if(running&&now-peer.lastPacket>3000)suspect(peer);
        if(running&&peer.suspectAt!=null&&now-peer.suspectAt>=GRACE_MS){
          if(peer.role==='host'){closeDisconnected('主机连接已断开');return;}
          if(!membership?.roles.includes(peer.role))reportDeparture(peer.role);
        }
        if(peer.channel?.readyState==='open'){
          pingPeer(peer);send(peer,{type:'heartbeat',hidden:document.hidden,bootStage:running?undefined:bootStage});
          send(peer,{type:'input-tail',slot:queue.slot,inputs:[...queue.inputs[queue.slot]].filter(([at])=>at>=queue.frame-32)});
        }
      }
      if(running&&membership&&now-membership.started>=GRACE_MS){
        if(session.role==='host')beginDeparture(onlinePeers().filter(p=>!membership.roles.includes(p.role)&&!membership.reports.has(p.role)).map(p=>p.role));
        else if(now-membership.started>=15000)closeDisconnected('房主未完成离线同步');
      }
    }catch(error){fail(error);}
  },1000);
  status('所有玩家正在各自加载游戏并建立直接连接…');
  loadTimer=setTimeout(()=>fail(Error(`等待全员资源就绪超过 180 秒；本机：${bootStage}。请查看下方各端加载状态`)),180000);
  bootStage='加载游戏页面与 JavaScript 模块';showStartup();
  iframe=document.createElement('iframe');iframe.title='本机游戏模拟器';iframe.allow='autoplay; gamepad';
  const loaded=new Promise((resolve,reject)=>{iframe.onload=resolve;iframe.onerror=()=>reject(Error('游戏页面加载失败'));});
  iframe.src='netplay/runtime.html';$('game').append(iframe);await loaded;if(stopped)return;
  if(!iframe.contentWindow.th04RuntimeReady)throw Error('游戏页面版本不匹配，请刷新所有页面');
  if(!await iframe.contentWindow.th04RuntimeReady)throw Error('游戏模块加载失败，详情见游戏页面');
  if(stopped)return;
  runtime=iframe.contentWindow.th04Sync;if(!runtime)throw Error('游戏模块没有就绪');
  runtime.configure(state.slots.host,state.slots[session.role],state.settings.players);
  runtime.onInput(value=>{childBits=value;});runtime.onMenuAction(value=>{pendingAction|=value;wake();});
  localReady=await runtime.load({...state.settings});if(stopped){runtime.stop();return;}
  for(const peer of peers.values())if(peer.channel?.readyState==='open')send(peer,{type:'ready',build:localReady});maybeRun();
}
function maybeRun(){
  showStartup();
  if(running||stopped||!localReady||![...peers.values()].every(peer=>peer.channel?.readyState==='open'&&peer.hello&&peer.ready))return;
  if([...peers.values()].some(peer=>JSON.stringify(peer.ready)!==JSON.stringify(localReady)))throw Error('游戏资源版本不一致，请所有玩家刷新页面');
  if(session.role==='host'){broadcast({type:'run'});runRequested=true;}
  if(!runRequested)return;
  clearTimeout(loadTimer);runtime.start();running=true;
  for(const peer of onlinePeers()){peer.lastPacket=performance.now();peer.suspectAt=null;}
  lastNow=lastMeasure=performance.now();measureFrame=queue.frame;accumulator=0;
  status(`${state.settings.players} 人已同步开局，你操作 P${queue.slot+1}。`);raf=requestAnimationFrame(tick);
  showStartup();
}
function wake(delay=0){
  if(!running||stopped||document.hidden)return;
  const deadline=performance.now()+delay;if(wakeTimer!==null&&wakeAt<=deadline)return;
  clearTimeout(wakeTimer);wakeAt=deadline;wakeTimer=setTimeout(()=>{wakeTimer=null;pump(performance.now());},Math.max(0,delay));
}
function tick(){if(!running||stopped)return;pump(performance.now());if(!stopped)raf=requestAnimationFrame(tick);}
function armRollback(){
  if(session.role!=='host'||!running||membership||queue.activation!==null||!runtime.readyForRollback()||
     !onlinePeers().every(peer=>peer.rollbackReady))return;
  // DOS boot remains confirmed-only. All devices/audio are initialized before
  // taking snapshots; every peer switches at the same future simulation tick.
  const frame=queue.frame+120;queue.arm(frame);broadcast({type:'rollback',frame});
}
function confirmFrames(){
  const prefix=Math.min(queue.frame,queue.confirmed);
  if(runtime.confirm(prefix)==='exit'){finishGame();return;}
  for(const [tick,sample]of pendingHashes)if(tick<=prefix){
    hashes.set(tick,sample);broadcast({type:'hash',...sample});
    for(const peer of onlinePeers())compare(peer,tick);
    pendingHashes.delete(tick);trim(hashes);
  }
  queue.prune();armRollback();
}
function simulate(pair,replay){
  const before=performance.now();
  const frame=queue.frame;
  if(queue.active&&frame>=queue.confirmed)runtime.capture(frame);
  runtime.step(pair,{frame,replay,offlineMask:queue.offlineMask(frame)});queue.commit(pair);
  if(queue.frame%120===0)pendingHashes.set(queue.frame,{...runtime.checksum(),boot:runtime.readyForRollback()});
  const cost=performance.now()-before;stepCost+=cost;stepCount++;maxCost=Math.max(maxCost,cost);
}
function updateMetrics(now,waiting){
  const span=now-lastMeasure;
  if(span>=1000){hz=(queue.frame-measureFrame)*1000/span;averageCost=stepCount?stepCost/stepCount:0;peakCost=maxCost;lastMeasure=now;measureFrame=queue.frame;stepCost=stepCount=maxCost=0;}
  if(now-lastUi<250)return;lastUi=now;
  const links=[...peers.values()].map(p=>p.offline?`${label(p.role)}：已离线（幽灵）`:`${label(p.role)}：往返 ${p.rtt==null?'—':p.rtt.toFixed(1)} ms · 相同状态步 ${p.confirmed||'等待'}${p.hidden?' · 页面隐藏':''}`).join('\n');
  $('diagnostics').textContent=`${label(session.role)} · P${queue.slot+1} · ${state.settings.players} 人 · 同步步 ${queue.frame}\n`
    +`本机 ${hz.toFixed(1)}/60 步每秒 · 执行平均 ${averageCost.toFixed(1)} / 最慢 ${peakCost.toFixed(1)} ms\n`
    +`${queue.active?'预测回滚 · 本地输入无额外缓冲':'启动锁步 · 2 步缓冲'} · 最近输入至应用 ${inputAge.toFixed(1)} ms · 已收输入 ${receivedInputs}\n${links}\n`
    +`已确认 ${Math.min(queue.frame,queue.confirmed)} · 预测领先 ${Math.max(0,queue.frame-queue.confirmed)}/${MAX_ROLLBACK} 步\n`
    +`回滚 ${rollbackCount} 次 · 重算 ${resimulated} 步 · 最长 ${maxRewind} 步 · 快照 ${((runtime.rollbackInfo()?.snapshotBytes||0)/1048576).toFixed(0)} MiB\n`
    +`当前等待 ${waitingSince?(now-waitingSince).toFixed(0):0} ms\n`
    +(waiting?'等待本步其他玩家操作':'全员操作同步中')+`\n${gamepadStatus}`;
}
function pump(now){
  if(!running||stopped||pumping)return;
  if(membership){lastNow=now;accumulator=0;return;}
  if(document.hidden){lastNow=now;accumulator=0;return;}pumping=true;
  try{
    accumulator=Math.min(accumulator+Math.max(0,now-lastNow),TICK_MS*4);lastNow=now;
    let count=0,waiting=false;const budgetStart=performance.now();
    if(queue.dirty!==null){
      const from=queue.dirty;replayUntil=Math.max(replayUntil,queue.frame);
      maxRewind=Math.max(maxRewind,replayUntil-from);rollbackCount++;
      runtime.restore(from);queue.rewind(from);
      for(const at of pendingHashes.keys())if(at>from)pendingHashes.delete(at);
    }
    while(queue.frame<replayUntil&&count<4&&(count===0||performance.now()-budgetStart<6)){
      const pair=queue.peek(runtime.canPredict());if(!pair){waiting=true;break;}
      simulate(pair,queue.frame+1<replayUntil);resimulated++;count++;
    }
    confirmFrames();if(stopped)return;
    if(queue.frame<replayUntil){
      if(waiting&&!waitingSince)waitingSince=performance.now();
      updateMetrics(performance.now(),waiting);wake(waiting?16:0);return;
    }
    while(accumulator>=TICK_MS&&count<4&&(count===0||performance.now()-budgetStart<6)){
      const value=normalize(keyboardBits(keys)|childBits|gamepadBits());if(value!==bits){bits=value;inputChangedAt=performance.now();}
      const captured=queue.capture(bits|pendingAction);
      if(captured){pendingAction=0;captureTimes.set(captured.frame,performance.now());broadcast(captured);}
      const pair=queue.peek(runtime.canPredict());if(!pair){waiting=true;break;}
      waitingSince=0;
      simulate(pair,false);
      const after=performance.now();
      const at=captureTimes.get(queue.frame-1);if(pair[queue.slot]!==lastApplied&&at)inputAge=after-at;
      lastApplied=pair[queue.slot];captureTimes.delete(queue.frame-1);accumulator-=TICK_MS;count++;
      confirmFrames();if(stopped)return;
    }
    const after=performance.now();
    if(waiting&&!waitingSince)waitingSince=after;
    updateMetrics(after,waiting);
    // Native execution time counts toward this tick's budget. The old timer
    // waited another full interval after a 15 ms step, reducing throughput.
    wake(waiting?16:Math.max(0,TICK_MS-accumulator-(after-lastNow)));
  }catch(error){fail(error);}finally{pumping=false;}
}
window.addEventListener('keydown',event=>{if(!running||!mapping[event.code])return;event.preventDefault();keys.add(event.code);});
window.addEventListener('keyup',event=>keys.delete(event.code));window.addEventListener('blur',clearInput);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();else wake();});
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===iframe?.contentWindow&&event.data?.protocol===PROTOCOL&&event.data?.event==='runtime-exit')fail(Error('游戏模拟器已经退出'));});
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==iframe?.contentWindow||event.data?.protocol!==PROTOCOL||stopped)return;
  if(event.data.event==='boot-progress'){
    bootStage=String(event.data.message).slice(0,300);
    if(Number.isInteger(event.data.step)&&event.data.step>=0&&event.data.step<=7)bootStep=event.data.step;
    showStartup();
    for(const peer of onlinePeers())if(peer.channel?.readyState==='open')send(peer,{type:'heartbeat',hidden:document.hidden,bootStage});
  }else if(event.data.event==='boot-error')fail(Error(`游戏页面：${String(event.data.message).slice(0,600)}`));
  else if(event.data.event==='page-warning'){
    let warning=$('page-warning');
    if(!warning){warning=document.createElement('pre');warning.id='page-warning';$('diagnostics').after(warning);}
    warning.textContent=`页面异常记录（未自动结束游戏）：\n${String(event.data.message).slice(0,1500)}`;
  }
});
window.addEventListener('pagehide',()=>{if(session)navigator.sendBeacon('/api/leave',new Blob([JSON.stringify(session)],{type:'application/json'}));});
$('create').onclick=()=>enter('host');$('join').onclick=()=>enter('guest');
for(let n=0;n<3;n++)$(`seat${n}`).onclick=()=>action('seat',{slot:n});
for(const name of settingNames)$(name).onchange=()=>action('settings',{settings:Object.fromEntries(settingNames.map(key=>[key,Number($(key).value)]))});
$('ready').onclick=()=>action('ready');$('start').onclick=()=>action('start');
$('leave').onclick=async()=>{stopped=true;running=false;clearInput();runtime?.stop();clearTimers();disconnect();try{await request('leave');}finally{location.href='lan.html';}};
