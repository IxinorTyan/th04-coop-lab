import {hudDigits} from './hud-digits.js';
import {drawCollisionPoints} from './collision-points.js';

// Only final pixels differ by local seat. Never write a local seat selector
// into NP21 RAM, VRAM, devices, snapshots or the state checksum.
export function createPersonalHud(canvas,nativeCanvas){
  const context=canvas.getContext('2d',{alpha:false});
  const atlas=document.createElement('canvas');atlas.width=160;atlas.height=16;
  const ink=atlas.getContext('2d'),pixels=ink.createImageData(160,16);
  for(let digit=0;digit<10;digit++)for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    if(!(hudDigits[digit][y*2+(x>>>3)]&(0x80>>>(x&7))))continue;
    const at=(y*160+digit*16+x)*4;pixels.data.fill(255,at,at+4);
  }
  ink.putImageData(pixels,0,0);
  function number(value,x,y,count,zeros=false){
    context.fillStyle='#000';context.fillRect(x,y,count*16,16);
    const text=String(value).padStart(count,zeros?'0':' ').slice(-count);
    for(let i=0;i<count;i++)if(text[i]!==' ')
      context.drawImage(atlas,Number(text[i])*16,0,16,16,x+i*16,y,16,16);
  }
  return ({heap,mailbox,patch,slot,guestBase,raw=false,points={}})=>{
    if(canvas.width!==nativeCanvas.width||canvas.height!==nativeCanvas.height){
      canvas.width=nativeCanvas.width;canvas.height=nativeCanvas.height;
    }
    context.imageSmoothingEnabled=false;
    context.drawImage(nativeCanvas,0,0);
    if(raw||mailbox<0||!patch?.personal_stats||slot==null)return;
    const view=new DataView(heap.buffer),tram=guestBase+0xa0000;
    // Native score digits are gaiji 0xA0..0xA9 -> TRAM 0x2057..0x2957.
    // Don't paint over the boot screen, cleared menus or ending artwork.
    const cell=view.getUint16(tram+6*160+56*2,true);
    if((cell&255)!==0x57||(cell>>>8)<0x20||(cell>>>8)>0x29)return;
    drawCollisionPoints(context,{heap,mailbox,patch,...points});
    const schema=patch.personal_stats;
    const at=mailbox-patch.mailbox_cs_offset+schema.cs_offset+slot*schema.stride;
    number(view.getUint32(at+schema.high_score,true),448,64,8,true);
    number(view.getUint32(at+schema.score,true),448,96,8,true);
    number(heap[at+schema.point],496,240,5);
    number(view.getUint16(at+schema.dream,true)*10,496,272,5);
    number(view.getUint16(at+schema.graze,true),496,304,5);
    const bonus=mailbox-patch.mailbox_cs_offset+schema.bonus_cs_offset;
    const mode=heap[bonus];
    const stageTitle=view.getUint16(tram+4*160+20*2,true)===0x4d56;
    const clearTitle=view.getUint16(tram+4*160+19*2,true)===0x5c56;
    if(mode===1&&stageTitle||mode===2&&clearTitle){
      const data=mailbox-patch.mailbox_cs_offset+(patch.data_segment-patch.code_segment)*16;
      const resource=mailbox+patch.resource_schema.offset+slot*patch.resource_schema.stride;
      const all=mode===2;
      number(all?10000:(heap[data+0x5394]+1)*1000,272,all?96:112,8);
      number(heap[resource]*50,272,all?128:144,8);
      number(view.getUint16(at+schema.dream,true)*10,272,all?160:176,8);
      number(view.getUint16(at+schema.graze,true)*50,272,all?192:208,8);
      if(all)number(Math.max(0,heap[resource+4]-1)*(heap[data+0x4348]===4?30000:10000),272,224,8);
      number(heap[at+schema.point],320,all?272:256,5);
      number(view.getUint32(bonus+1+slot*4,true),272,336,8);
    }
  };
}
