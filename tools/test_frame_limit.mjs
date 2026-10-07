import assert from 'node:assert/strict';
import {createFrameGate,startFrameLoop} from '../web/frame-limit.js';
for(const hz of [60,90,120,144,165,240]){
 const due=createFrameGate();let count=0;
 for(let i=0;i<hz*10;i++)count+=Number(due(i*1000/hz));
 assert.equal(count,600,`${hz} Hz callbacks must yield 600 frames in 10 seconds`);
}
const jitter=createFrameGate();let count=0;
for(let i=0;i<1440;i++)count+=Number(jitter(i*1000/144+Math.sin(i)*.8));
assert(Math.abs(count-600)<=1);
const stalled=createFrameGate();assert(stalled(0));assert(stalled(5000));
for(let i=0;i<100;i++)assert.equal(stalled(5000),false,'no catch-up burst');
assert.equal(stalled(NaN),false);assert(stalled(5017));
let next=0,pending=new Map(),calls=0;
globalThis.requestAnimationFrame=fn=>{pending.set(++next,fn);return next;};
globalThis.cancelAnimationFrame=id=>pending.delete(id);
const stop=startFrameLoop(()=>calls++);
for(let i=0;i<120;i++){const batch=[...pending.values()];pending.clear();for(const fn of batch)fn(i*1000/120);}
assert.equal(calls,60);stop();assert.equal(pending.size,0);
let stopInside;stopInside=startFrameLoop(()=>stopInside());
const batch=[...pending.values()];pending.clear();batch[0](2000);assert.equal(pending.size,0);
console.log('PASS: 60/90/120/144/165/240 Hz, jitter, stalls, cancellation');
