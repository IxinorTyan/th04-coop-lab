// Opt-in only. Written, but not executed during implementation.
import assert from 'node:assert/strict';
import {RollbackQueue,MAX_ROLLBACK} from '../web/netplay/rollback-queue.js';

for(const players of [2,3])for(let local=0;local<players;local++){
  const q=new RollbackQueue(local,players);q.arm(0);
  const truth=Array.from({length:players},(_,slot)=>Array.from({length:120},(_,frame)=>
    frame<2?0:((frame+slot*9)%19<8?8:0)|((frame+slot)%11<6?32:0)|(frame===40+slot?16:0)));
  const inbox=[];const saved=new Map();let value=0,replays=0;
  const fold=(state,pair)=>pair.reduce((v,bits,i)=>Math.imul(v^(bits+i),16777619)>>>0,state);
  function advance(pair){saved.set(q.frame,value);value=fold(value,pair);q.commit(pair);}
  for(let wall=0;wall<1000&&q.frame<120;wall++){
    for(let i=inbox.length-1;i>=0;i--)if(inbox[i].at<=wall){
      const p=inbox.splice(i,1)[0];q.receive(p.frame,p.buttons,p.slot);
    }
    if(q.dirty!==null){
      const target=q.frame,from=q.dirty;value=saved.get(from);q.rewind(from);replays++;
      while(q.frame<target){const pair=q.peek();assert(pair);advance(pair);}
    }
    const packet=q.capture(truth[local][q.frame]);
    if(packet)for(let slot=0;slot<players;slot++)if(slot!==local)
      inbox.push({at:wall+1+(packet.frame+slot)%7,frame:packet.frame,slot,buttons:truth[slot][packet.frame]});
    const pair=q.peek();if(pair)advance(pair);
    // Late input is already captured locally; do not resample on retry.
    q.prune();
  }
  // Drain late real inputs, then replay the final speculative suffix.
  for(const p of inbox)q.receive(p.frame,p.buttons,p.slot);
  if(q.dirty!==null){const target=q.frame,from=q.dirty;value=saved.get(from);q.rewind(from);
    while(q.frame<target)advance(q.peek());}
  assert.equal(q.frame,120);assert(replays>0);
  let baseline=0;for(let frame=0;frame<120;frame++)baseline=fold(baseline,truth.map(lane=>lane[frame]));
  assert.equal(value,baseline,`prediction replay parity: ${players} players, local ${local}`);
}

const bound=new RollbackQueue(0,2);bound.arm(0);
for(let frame=0;frame<MAX_ROLLBACK+2;frame++){bound.capture(32);const pair=bound.peek();assert(pair);bound.commit(pair);}
bound.capture(32);assert.equal(bound.peek(),null);
assert.equal(bound.confirmed,2);
const policy=new RollbackQueue(0,2);policy.arm(0);policy.receive(2,2047,1);
assert.equal(policy.predicted(1,3),15|32|64);
assert.equal(policy.predicted(1,6),32|64);
assert.equal(policy.predicted(1,15),0);
assert.throws(()=>policy.receive(2,0,1));
assert.throws(()=>policy.receive(2,0,0));
assert.throws(()=>policy.receive(999,0,1));
console.log('PASS: 2/3P replay parity, all local seats, bounded speculation and button policy');
