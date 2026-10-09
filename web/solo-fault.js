// On-demand, read-only CPU evidence, including after the MAIN mailbox is gone.
export function readSoloFault(heap){
  if(!(heap instanceof Uint8Array)||heap.length<4590280)return null;
  const v=new DataView(heap.buffer,heap.byteOffset,heap.byteLength);
  const ip=v.getUint32(4590048,true),cs=v.getUint32(4590192,true),linear=cs+ip;
  // Direct bytes are reliable only in the ordinary guest RAM window. Extended
  // memory and paging may use a different physical backing; keep registers.
  const code=linear<0xa0000?Array.from(heap.subarray(2492848+linear,2492848+Math.min(linear+32,0xa0000))):null;
  return {ip,previousIp:v.getUint32(4590052,true),csBase:cs,dsBase:v.getUint32(4590240,true),
    flags:v.getUint32(4590044,true),registerBytes:Array.from(heap.subarray(4590000,4590280)),
    linearCode:code,codeAssumption:'ordinary guest RAM, before any paging translation'};
}

export function mountSoloFault({host,getEmulator,readState,readContext}){
  const button=document.createElement('button');button.type='button';button.dataset.faultDownload='';button.textContent='下载故障信息';
  const output=document.createElement('p');output.setAttribute('role','status');output.hidden=true;output.style.fontSize='11px';
  host.querySelector('.player-toolbar').append(button);button.after(output);
  const errors=[];
  const remember=message=>{if(errors.length===8)errors.shift();errors.push({at:new Date().toISOString(),message:String(message).slice(0,4000)});};
  window.addEventListener('error',event=>remember(event.error?.stack||event.message));
  window.addEventListener('unhandledrejection',event=>remember(event.reason?.stack||event.reason));
  button.onclick=async()=>{
    const emulator=getEmulator();if(!emulator){output.hidden=false;output.textContent='请先启动游戏。';return;}
    button.disabled=true;
    try{
      let cpu=null,captureError=null;
      if(emulator.isWorker){
        if(!emulator.closed)try{cpu=await emulator.call('soloFault');emulator.lastDiagnostics=cpu;}catch(error){captureError=error.message;}
        cpu??=emulator.lastDiagnostics??null;
      }else cpu=readSoloFault(emulator.module.HEAPU8);
      let game=null;try{game=readState();}catch(error){captureError??=error.message;}
      const report={schema:'touhou-solo-fault/1',recordedAt:new Date().toISOString(),
        environment:{userAgent:navigator.userAgent,visibility:document.visibilityState},context:readContext(),
        emulator:{state:emulator.state,thread:emulator.isWorker?'worker':'main',wasm:emulator.module.mobileRuntime,
          clockBase:emulator.config.clk_base,clockMultiplier:emulator.config.clk_mult,
          frames:emulator.module.localFrameCount??null,uploads:emulator.module.frameUploads??null,
          error:emulator.failedError?.message??null,captureError},game,cpu,errors:[...errors]};
      const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='th04-solo-fault.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      output.hidden=false;output.textContent='故障信息已下载，只保存在本机。黑屏后可用此文件排查。';
    }catch(error){output.hidden=false;output.textContent='读取故障信息失败：'+error.message;}
    finally{button.disabled=false;}
  };
}
