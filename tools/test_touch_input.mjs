import assert from 'node:assert/strict';
import {packTouch,unpackTouch,ALWAYS_POINT,MAX_INPUT} from '../web/touch-input.js';
import {RollbackQueue} from '../web/netplay/rollback-queue.js';
import {writeNativeTouch} from '../web/native-touch.js';
for(const unlimited of [false,true])for(const alwaysPoint of [false,true]){
 const packed=packTouch(16|32,{x:-1234,y:4321,active:true,unlimited,alwaysPoint});
 assert(Number.isSafeInteger(packed)&&packed<=MAX_INPUT);
 assert.deepEqual(unpackTouch(JSON.parse(JSON.stringify(packed))),{x:-1234,y:4321,active:true,unlimited});
 assert.equal(Math.floor(packed/ALWAYS_POINT)%2,Number(alwaysPoint));
 const q=new RollbackQueue(0,2);q.arm(0);q.commit(q.peek());q.commit(q.peek());q.capture(packed);q.receive(2,packed,1);assert.deepEqual(q.peek(),[packed,packed]);
 const heap=new Uint8Array(1024),patch={mailbox_cs_offset:0,touch_cs_offset:32,touch_stride:8};
 writeNativeTouch(heap,100,patch,[packed,0,0]);const view=new DataView(heap.buffer);
 assert.equal(view.getUint16(132,true),unlimited?3:1);assert.equal(view.getInt16(134,true),-1234);assert.equal(view.getInt16(136,true),4321);
 writeNativeTouch(heap,100,patch,[packed,0,0],true);assert.equal(view.getUint16(132,true),0);assert.equal(view.getInt32(134,true),0);
}
assert.equal(packTouch(0,{alwaysPoint:true}),ALWAYS_POINT);
console.log('PASS: touch flags and signed movement survive JSON, rollback and native mailbox; blocked movement cleared');
