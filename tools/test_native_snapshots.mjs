// Mock host regression, no NP21 is instantiated. Not executed in this turn.
import assert from 'node:assert/strict';
import {createNativeSnapshots} from '../web/netplay/native-snapshots.js';
const root={mode:1,contents:{}},file={mode:2,contents:new Uint8Array(8192),usedBytes:8192,parent:root};
root.contents.disk=file;
const stream={node:file,fd:3,shared:{position:10,flags:2}};
const fs={root,streams:[null,null,null,stream],nameTable:[file],nextInode:4,currentPath:'/',isDir:m=>m===1};
const memfs={stream_ops:{write(s,b,o,n,p){s.node.contents.set(b.subarray(o,o+n),p);s.shared.position=p+n;return n;}}};
const globals={__rollback_g0:new WebAssembly.Global({value:'i32',mutable:true},100),
  __rollback_g1:new WebAssembly.Global({value:'i32',mutable:true},0)};
const module={HEAPU8:new Uint8Array(328*65536)};
let clock=1,bridge=2;
const snapshots=createNativeSnapshots({module,fs,memfs,tty:{ttys:[]},exports:()=>globals,
  host:{capture:()=>clock,restore:value=>{clock=value;}},
  readBridge:()=>bridge,writeBridge:value=>{bridge=value;}});
snapshots.capture(0);
module.HEAPU8[123]=7;globals.__rollback_g0.value=77;clock=8;bridge=9;
memfs.stream_ops.write(stream,new Uint8Array([4,5,6]),0,3,4095);
snapshots.seal();
snapshots.capture(1);
module.HEAPU8[123]=9;globals.__rollback_g1.value=55;
memfs.stream_ops.write(stream,new Uint8Array([8,9]),0,2,4096);
fs.streams=[];root.contents.extra={mode:2};fs.nextInode=6;snapshots.seal();
snapshots.restore(0);
assert.equal(module.HEAPU8[123],0);assert.equal(globals.__rollback_g0.value,100);
assert.equal(globals.__rollback_g1.value,0);assert.equal(clock,1);assert.equal(bridge,2);
assert.deepEqual([...file.contents.slice(4095,4098)],[0,0,0]);
assert.equal(fs.streams[3],stream);assert.equal(stream.shared.position,10);
assert.equal(root.contents.extra,undefined);assert.equal(fs.nextInode,4);
snapshots.capture(0);snapshots.seal();snapshots.confirm(1);
assert.equal(snapshots.info().snapshots,0);
console.log('PASS: heap/globals/clock/bridge/files/stream positions and multi-frame disk undo');
