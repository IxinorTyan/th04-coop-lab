import {MAX_INPUT} from '../touch-input.js';
export const PROTOCOL='th04-rollback/3';
export const TICK_MS=1000/60;
export const BOOT_DELAY=2;
export const MAX_ROLLBACK=12;
export const VALID_INPUT=MAX_INPUT;
const HELD=32|64|2048,DIRECTIONS=15;

// confirmed is an exclusive contiguous prefix of authoritative inputs, not
// the largest frame received. Prediction never advances it.
export class RollbackQueue {
  constructor(slot,players=2,{inputDelay=0,directionPrediction=3,rollbackEnabled=true}={}){
    if(![2,3].includes(players)||!Number.isInteger(slot)||slot<0||slot>=players)throw Error('无效玩家槽位');
    // Limit delay to the prefilled boot prefix, so activation cannot create
    // uncaptured input holes. Policy is fixed and checked during hello.
    if(!Number.isInteger(inputDelay)||inputDelay<0||inputDelay>BOOT_DELAY||
       !Number.isInteger(directionPrediction)||directionPrediction<0||directionPrediction>MAX_ROLLBACK||
       typeof rollbackEnabled!=='boolean')throw Error('无效预测策略');
    this.inputDelay=inputDelay;this.directionPrediction=directionPrediction;this.rollbackEnabled=rollbackEnabled;
    this.slot=slot;this.players=players;this.frame=0;this.confirmed=BOOT_DELAY;
    this.activation=null;this.dirty=null;this.inputs=Array.from({length:players},()=>new Map());
    this.used=new Map();
    this.offline=new Map();
    for(const lane of this.inputs)for(let n=0;n<BOOT_DELAY;n++)lane.set(n,0);
  }
  get active(){return this.activation!==null&&this.frame>=this.activation;}
  arm(frame){
    if(this.activation!==null||!Number.isSafeInteger(frame)||frame<this.frame||frame>this.frame+240)throw Error('无效回滚启用帧');
    this.activation=frame;
  }
  capture(buttons){
    const frame=this.frame+(this.active?this.inputDelay:BOOT_DELAY),lane=this.inputs[this.slot];
    if(lane.has(frame))return null;
    if(!Number.isSafeInteger(buttons)||buttons<0||buttons>VALID_INPUT)throw Error('无效本机输入');
    const packet={type:'input',frame,slot:this.slot,buttons};
    lane.set(frame,packet.buttons);this.updateConfirmed();return packet;
  }
  predicted(slot,frame){
    if(this.isOffline(slot,frame))return 0;
    const lane=this.inputs[slot];
    if(lane.has(frame))return lane.get(frame);
    for(let age=1;age<=MAX_ROLLBACK;age++)if(lane.has(frame-age)){
      return lane.get(frame-age)&(HELD|(age<=this.directionPrediction?DIRECTIONS:0));
    }
    return 0;
  }
  receive(frame,buttons,slot){
    if(!Number.isInteger(slot)||slot<0||slot>=this.players||slot===this.slot||
       !Number.isSafeInteger(frame)||frame<0||frame>this.frame+120||
       !Number.isInteger(buttons)||buttons<0||buttons>VALID_INPUT)throw Error('收到越界输入');
    const lane=this.inputs[slot];
    if(this.isOffline(slot,frame))return;
    if(frame<Math.min(this.frame,this.confirmed)-32)return;
    if(lane.has(frame)){if(lane.get(frame)!==buttons)throw Error('同一帧收到冲突输入');return;}
    lane.set(frame,buttons);
    // A new matching input can extend the bounded direction prediction
    // horizon, so compare subsequent predictions too, not only this frame.
    for(const [at,pair]of this.used)if(at>=frame&&pair[slot]!==this.predicted(slot,at)){
      this.dirty=this.dirty===null?at:Math.min(this.dirty,at);break;
    }
    this.updateConfirmed();
  }
  isOffline(slot,frame){return this.offline.has(slot)&&frame>=this.offline.get(slot);}
  offlineMask(frame=this.frame){let mask=0;for(const [slot,at]of this.offline)if(frame>=at)mask|=1<<slot;return mask;}
  membershipReport(){
    const prefix=Math.min(this.frame,this.confirmed);
    return {frame:this.frame,prefix,inputs:this.inputs.map(lane=>[...lane].filter(([at])=>at>=prefix-32))};
  }
  applyDeparture({frame,slots,inputs}){
    if(!Number.isSafeInteger(frame)||frame<Math.min(this.frame,this.confirmed)||frame>this.frame+120||
       !Array.isArray(slots)||slots.includes(this.slot)||!Array.isArray(inputs)||inputs.length!==this.players)
      throw Error('无效离线同步边界');
    for(const slot of slots){
      if(!Number.isInteger(slot)||slot<0||slot>=this.players)throw Error('无效离线座位');
      this.offline.set(slot,frame);
      for(const at of this.inputs[slot].keys())if(at>=frame)this.inputs[slot].delete(at);
    }
    for(let slot=0;slot<this.players;slot++)for(const [at,value]of inputs[slot]){
      if(slot===this.slot){
        if(this.inputs[slot].get(at)!==value)throw Error('离线同步试图修改本机输入');
      }else this.receive(at,value,slot);
    }
    // Dropped lanes become authoritative neutral input, forever. Their last
    // uncertain pre-boundary steps are supplied by the host's merged report.
    this.updateConfirmed();
  }
  updateConfirmed(){while(this.inputs.every((lane,slot)=>this.isOffline(slot,this.confirmed)||lane.has(this.confirmed)))this.confirmed++;}
  peek(allowPrediction=true){
    this.waitReason='';
    if(this.active&&this.frame-this.confirmed>=MAX_ROLLBACK){this.waitReason='window';return null;}
    if(this.inputs.every((lane,slot)=>this.isOffline(slot,this.frame)||lane.has(this.frame)))return this.inputs.map((lane,slot)=>this.isOffline(slot,this.frame)?0:lane.get(this.frame));
    if(!this.active){this.waitReason='boot';return null;}
    if(!allowPrediction){this.waitReason='prediction-disabled';return null;}
    if(!this.inputs[this.slot].has(this.frame)){this.waitReason='local-input';return null;}
    return this.inputs.map((_,slot)=>this.predicted(slot,this.frame));
  }
  commit(pair){this.used.set(this.frame,pair.slice());this.frame++;}
  rewind(frame){
    this.frame=frame;this.dirty=null;
    for(const at of this.used.keys())if(at>=frame)this.used.delete(at);
  }
  prune(){
    const prefix=Math.min(this.frame,this.confirmed);
    for(const at of this.used.keys())if(at<prefix)this.used.delete(at);
    for(const lane of this.inputs)for(const at of lane.keys())if(at<prefix-32)lane.delete(at);
  }
}
