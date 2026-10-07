import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../web/vendor/np2/',import.meta.url);
const original=readFileSync(new URL('np21.js',root),'utf8');
const build=source=>{
 const declaration=source.match(/(?:var wasmTableMirror=\[\];)?var getWasmTableEntry=funcPtr=>[^;]+;/)?.[0];
 assert(declaration);return new Function('wasmTable',declaration+'return getWasmTableEntry;');
};
// Actual WASM function identities, not JS stand-ins.
const wasm=new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,7,1,3,114,117,110,0,0,10,6,1,4,0,65,7,11]);
const fn=new WebAssembly.Instance(new WebAssembly.Module(wasm)).exports.run;
for(const file of ['np21-60.js','np21-lockstep.js']){
 const source=readFileSync(new URL(file,root),'utf8'),lookup=build(source);
 const table=new WebAssembly.Table({element:'anyfunc',initial:2,maximum:2});table.set(1,fn);
 let gets=0;const cached=lookup({get:i=>{gets++;return table.get(i);}}),baseline=build(original)(table);
 for(let i=0;i<10000;i++){assert.equal(cached(1),baseline(1));assert.equal(cached(1)(),7);}assert.equal(gets,1);
 assert.equal(cached(0),null);assert.throws(()=>cached(2),RangeError);assert.throws(()=>cached(-1),TypeError);
 const second=lookup(new WebAssembly.Table({element:'anyfunc',initial:2,maximum:2}));assert.equal(second(1),null,'instance-local cache');
 console.log('PASS: '+file+' cached dispatch identity, calls, null/out-of-bounds, instance isolation');
}
