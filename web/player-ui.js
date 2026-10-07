// Presentation and local device state only. The caller samples once per tick.
import {packTouch} from './touch-input.js';
import {mountTouchLayout} from './touch-layout.js';
export function mountPlayer(host,{onGesture=()=>{},onChange=()=>{},solo=false}={}){
  host.classList.add('th04-player');
  // Keep styles outside the subtree replaced below, and resolve from this module
  // so local play and the netplay room use the same styles and geometry.
  for(const file of ['player-ui.css','touch-overlay.css']){
    const href=new URL(file+'?v=20261007-touch3',import.meta.url).href;
    if(![...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>link.href===href))
      document.head.append(Object.assign(document.createElement('link'),{rel:'stylesheet',href}));
  }
  host.innerHTML='<div class="player-toolbar"><button type="button" data-full>全屏</button><button type="button" data-window>返回网页</button><button type="button" data-touch>触屏操作</button><button type="button" data-sound>启用声音</button><button type="button" data-layout>自定义布局</button><span class="player-label"></span></div><div class="player-stage"></div><div class="player-movement"><label class="touch-option"><input type="checkbox" data-unlimited> 触摸不限速移动</label><label>灵敏度 <input data-sensitivity type="range" min="100" max="300" step="10" value="150"><output>150%</output></label><label class="touch-option"><input type="checkbox" role="switch" data-always-point> 触摸模式一直显示判定点</label><label class="touch-option"><input type="checkbox" data-double-tap> 双击同一位置使用 Bomb</label><small>单指拖动移动 · 第二指按住低速</small><div class="player-menu-directions"><button type="button" data-pulse="1">菜单 ↑</button><button type="button" data-pulse="2">菜单 ↓</button></div></div><div class="player-actions"><button type="button" data-pulse="16">Bomb / 返回</button><button type="button" data-held="64">低速</button><button type="button" data-rescue>停火救援</button><button type="button" data-pulse="128">暂停 / 继续</button><button type="button" data-pulse="256">确认</button><button type="button" data-auto>开火：关</button></div><div class="player-note" role="status">等待开始；在画面上拖动控制当前玩家。</div><div class="touch-layout-editor" hidden><strong>按键与触控</strong><button type="button" data-layout-close>完成</button></div>';
  if(solo){
    host.classList.add('solo-player');
    host.querySelector('.player-menu-directions').insertAdjacentHTML('beforeend','<button type="button" data-pulse="4">菜单 ←</button><button type="button" data-pulse="8">菜单 →</button>');
  }
  const stage=host.querySelector('.player-stage');
  const diagnosticButton=document.createElement('button');diagnosticButton.type='button';diagnosticButton.textContent='启动／运行详情';
  const diagnosticPanel=document.createElement('pre');diagnosticPanel.className='player-diagnostics';diagnosticPanel.hidden=true;
  host.querySelector('.player-toolbar').append(diagnosticButton);host.append(diagnosticPanel);
  diagnosticButton.onclick=()=>{diagnosticPanel.hidden=!diagnosticPanel.hidden;diagnosticButton.setAttribute('aria-expanded',String(!diagnosticPanel.hidden));};
  const surface=document.createElement('div');surface.className='touch-surface';surface.setAttribute('aria-label','拖动移动，第二指低速');stage.append(surface);
  const unlimited=host.querySelector('[data-unlimited]'),sensitivity=host.querySelector('[data-sensitivity]'),alwaysPoint=host.querySelector('[data-always-point]'),doubleTap=host.querySelector('[data-double-tap]');
  let drag=null,focusId=null,dx=0,dy=0,sampledX=0,sampledY=0;
  try{unlimited.checked=localStorage.getItem('th04.touch.mode')==='unlimited';sensitivity.value=String(Math.max(100,Math.min(300,Number(localStorage.getItem('th04.touch.sensitivity'))||150)));doubleTap.checked=localStorage.getItem('th04.touch.double-tap')==='on';}catch{}
  try{alwaysPoint.checked=localStorage.getItem('th04.touch.always-point')==='on';}catch{}
  const saveMovement=()=>{reset();host.querySelector('output').textContent=`${sensitivity.value}%`;try{localStorage.setItem('th04.touch.sensitivity',sensitivity.value);}catch{}};
  sensitivity.oninput=saveMovement;host.querySelector('output').textContent=`${sensitivity.value}%`;
  unlimited.onchange=()=>{try{localStorage.setItem('th04.touch.mode',unlimited.checked?'unlimited':'limited');}catch{};reset();notify();};
  doubleTap.onchange=()=>{tapDown=lastTap=null;try{localStorage.setItem('th04.touch.double-tap',doubleTap.checked?'on':'off');}catch{};};
  alwaysPoint.onchange=()=>{try{localStorage.setItem('th04.touch.always-point',alwaysPoint.checked?'on':'off');}catch{};notify();};
  const full=host.querySelector('[data-full]'),touch=host.querySelector('[data-touch]'),autoButton=host.querySelector('[data-auto]');
  let touchLayout,touchGeometry=null;
  // Movement needs dimensions only. Cache them until layout actually changes;
  // reading layout for every pointermove can force synchronous style/layout.
  function geometry(){
    if(!touchGeometry){const r=stage.getBoundingClientRect();touchGeometry={scale:Math.min(r.width/640,r.height/400),width:host.clientWidth,height:host.clientHeight};}
    return touchGeometry;
  }
  const geometryObserver=new ResizeObserver(()=>{touchGeometry=null;});
  geometryObserver.observe(stage);geometryObserver.observe(host);
  const held=new Map();let contextKey='',pulses=0,lastPulse=0,auto=false,active=false,gameplay=false,immersive=false,requestId=0,lastTap=null,tapDown=null;
  let touchEnabled=matchMedia('(pointer:coarse)').matches;
  try{const saved=localStorage.getItem('th04.touch.enabled');if(saved!==null)touchEnabled=saved==='true';}catch{}
  const nativeFull=()=>document.fullscreenElement||document.webkitFullscreenElement;
  function notify(){onChange();}
  function renderTouch(){host.classList.toggle('has-touch',touchEnabled);touch.setAttribute('aria-pressed',String(touchEnabled));}
  function renderAuto(){autoButton.querySelector('strong').textContent='开火';autoButton.querySelector('small').textContent=auto?'已开启 · 点按关闭':'点按开启';autoButton.setAttribute('aria-pressed',String(auto));}
  function reset({keepFire=false}={}){held.clear();drag=null;focusId=null;tapDown=lastTap=null;dx=dy=sampledX=sampledY=0;pulses=0;lastPulse=0;if(!keepFire)auto=false;host.querySelectorAll('.pressed').forEach(n=>n.classList.remove('pressed'));renderAuto();notify();}
  touchLayout=mountTouchLayout(host,{reset,solo});
  function note(text){host.querySelector('.player-note').textContent=text;}
  function fit(){touchGeometry=null;host.style.setProperty('--player-height',`${Math.round(window.visualViewport?.height||innerHeight)}px`);reset();}
  function gesture(){
    const focused=document.activeElement;if(focused?.closest?.('.player-toolbar,[data-layout-control]'))focused.blur();
    try{Promise.resolve(onGesture()).catch(()=>{});}catch{}
  }
  async function enter({native=true}={}){
    const token=++requestId;immersive=true;host.classList.add('immersive');document.documentElement.classList.add('th04-immersive');fit();gesture();
    if(!native){full.textContent='全屏布局';return;}
    try{
      if(nativeFull()!==host){
        if(host.requestFullscreen)await host.requestFullscreen({navigationUI:'hide'});
        else if(host.webkitRequestFullscreen)await host.webkitRequestFullscreen();
        else throw Error('unsupported');
      }
      if(token!==requestId){if(nativeFull()===host)await document.exitFullscreen?.();return;}
      full.textContent='已全屏';
    }catch{if(token===requestId){full.textContent='点击进入全屏';note('已铺满网页；浏览器未允许系统全屏，可点击“进入全屏”重试。');}}
  }
  async function exit(){
    requestId++;immersive=false;host.classList.remove('immersive');document.documentElement.classList.remove('th04-immersive');reset();full.textContent='全屏';
    try{if(nativeFull()===host){if(document.exitFullscreen)await document.exitFullscreen();else await document.webkitExitFullscreen?.();}}catch{}
  }
  full.onclick=()=>enter();host.querySelector('[data-window]').onclick=()=>exit();
  touch.onclick=()=>{touch.blur();touchEnabled=!touchEnabled;reset();renderTouch();try{localStorage.setItem('th04.touch.enabled',String(touchEnabled));}catch{}};
  host.querySelector('[data-sound]').onclick=gesture;
  autoButton.onclick=()=>{if(!active||!gameplay)return;gesture();auto=!auto;renderAuto();notify();};
  for(const button of host.querySelectorAll('[data-held],[data-pulse],[data-rescue]')){
    button.addEventListener('pointerdown',event=>{
      if(!active||event.button!==0)return;event.preventDefault();gesture();button.setPointerCapture(event.pointerId);
      held.set(event.pointerId,{button,bits:Number(button.dataset.held)||0,rescue:button.hasAttribute('data-rescue')});
      pulses|=Number(button.dataset.pulse)||(Number(button.dataset.held)&32);button.classList.add('pressed');notify();
    });
    const release=event=>{if(!held.has(event.pointerId))return;held.delete(event.pointerId);if(![...held.values()].some(v=>v.button===button))button.classList.remove('pressed');notify();};
    button.addEventListener('pointerup',release);button.addEventListener('lostpointercapture',release);
    button.addEventListener('pointercancel',()=>reset());
    button.addEventListener('click',event=>event.preventDefault());
  }
  function move(event){
    if(tapDown?.id===event.pointerId&&Math.hypot(event.clientX-tapDown.x,event.clientY-tapDown.y)>geometry().height*.05)tapDown.moved=true;
    if(!drag||event.pointerId!==drag.id)return;
    const {scale}=geometry();
    if(scale>0&&gameplay){const gain=16*Number(sensitivity.value)/100/scale;dx=Math.max(-8192,Math.min(8191,dx+(event.clientX-drag.x)*gain));dy=Math.max(-8192,Math.min(8191,dy+(event.clientY-drag.y)*gain));}
    drag.x=event.clientX;drag.y=event.clientY;notify();
  }
  surface.addEventListener('pointerdown',event=>{
    if(!active||touchLayout.isEditing()||event.button!==0)return;event.preventDefault();gesture();
    const now=performance.now();
    // TH06 gives the Bomb tap its own gesture owner: it must not become a
    // movement/second-finger focus press, including while another finger moves.
    if(doubleTap.checked&&gameplay&&lastTap&&now-lastTap.time<=320&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<=Math.min(geometry().width,geometry().height)*.08){pulses|=16;lastTap=tapDown=null;notify();return;}
    else{lastTap=null;tapDown={x:event.clientX,y:event.clientY,time:now,id:event.pointerId,moved:false};}
    if(!gameplay&&contextKey.endsWith(':menu')){pulses|=256;notify();return;}
    surface.setPointerCapture(event.pointerId);
    if(!drag){drag={id:event.pointerId,x:event.clientX,y:event.clientY};dx=dy=0;}
    else if(focusId===null)focusId=event.pointerId;
    notify();
  });
  surface.addEventListener('pointermove',move);
  surface.addEventListener('pointerup',event=>{move(event);const down=tapDown,now=performance.now();if(down?.id===event.pointerId){tapDown=null;lastTap=doubleTap.checked&&gameplay&&!down.moved&&now-down.time<=220?{x:event.clientX,y:event.clientY,time:now}:null;}if(drag?.id===event.pointerId){drag=null;focusId=null;}if(focusId===event.pointerId)focusId=null;notify();});
  surface.addEventListener('pointercancel',()=>reset());
  surface.addEventListener('lostpointercapture',event=>{if(drag?.id===event.pointerId||focusId===event.pointerId)reset();});
  host.addEventListener('contextmenu',event=>{if(event.target.closest('.touch-surface,[data-layout-control]'))event.preventDefault();});
  // Prevent virtual controls from taking focus away from an active pointer.
  host.addEventListener('pointerdown',event=>{if(event.target.closest('[data-layout-control]'))event.preventDefault();});
  window.addEventListener('blur',reset);window.addEventListener('pagehide',reset);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
  window.addEventListener('resize',fit);window.visualViewport?.addEventListener('resize',fit);
  for(const name of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(name,()=>{reset();if(!nativeFull()&&immersive)exit();});
  renderTouch();renderAuto();fit();
  return {stage,enter,exit,reset,note,
    alwaysPointControl:alwaysPoint.closest('label'),
    alwaysPoint:()=>touchEnabled&&alwaysPoint.checked,
    diagnostics(text,{show=false}={}){diagnosticPanel.textContent=text;if(show){diagnosticPanel.hidden=false;diagnosticButton.setAttribute('aria-expanded','true');}},
    setLabel(text){host.querySelector('.player-label').textContent=text;},
    setActive(value){active=value;if(!value)reset();},
    setGameplay(value){host.classList.toggle('touch-menu',!value);if(gameplay!==value){gameplay=value;reset();}},
    setContext({key,play}){
      host.classList.toggle('touch-menu',key.endsWith(':menu'));
      if(key!==contextKey){contextKey=key;reset({keepFire:true});}
      // Temporary injury/entry blocks output, never forgets a held finger.
      if(gameplay!==play){dx=dy=sampledX=sampledY=0;pulses=lastPulse=0;tapDown=lastTap=null;}
      gameplay=play;
    },
    sample(base=0){
      if(touchLayout.isEditing())return 0;
      if(!active||document.hidden||!touchEnabled)return base;
      let value=base|(pulses&~lastPulse),rescue=false;
      for(const v of held.values()){value|=v.bits;rescue||=v.rescue;}
      if(auto&&gameplay)value|=32;
      if(focusId!==null&&gameplay)value|=64;
      if(gameplay&&(drag!==null||dx||dy))value&=~15;
      // Rescue deliberately suppresses firing/Bomb across all local devices.
      if(rescue&&gameplay)value=(value&~(16|32))|64;
      return value;
    },
    pack(buttons){
      sampledX=Math.trunc(dx);sampledY=Math.trunc(dy);
      return packTouch(buttons,{x:sampledX,y:sampledY,active:active&&touchEnabled&&gameplay&&!touchLayout.isEditing()&&(drag!==null||sampledX!==0||sampledY!==0),unlimited:unlimited.checked,alwaysPoint:touchEnabled&&alwaysPoint.checked});
    },
    consume(){dx-=sampledX;dy-=sampledY;sampledX=sampledY=0;if(!drag)dx=dy=0;const emitted=pulses&~lastPulse;pulses&=~emitted;lastPulse=emitted;}
  };
}
