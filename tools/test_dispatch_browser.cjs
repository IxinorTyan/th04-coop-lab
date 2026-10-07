const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
 const runs=[];
 for(const optimized of [false,true]){
  const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(!optimized)await page.route('**/np21-lockstep.js',async route=>{const response=await route.fetch();let source=await response.text();const cached='var wasmTableMirror=[];var getWasmTableEntry=funcPtr=>wasmTableMirror[funcPtr]||(wasmTableMirror[funcPtr]=wasmTable.get(funcPtr));';assert(source.includes(cached));source=source.replace(cached,'var getWasmTableEntry=funcPtr=>wasmTable.get(funcPtr);');await route.fulfill({response,body:source});});
  await page.goto('http://127.0.0.1:9886/netplay/runtime.html');await page.waitForFunction(()=>!!window.th04Sync);
  await page.evaluate(async()=>{const r=window.th04Sync;r.configure(0,0,2);await r.load({players:2,p1:0,p2:2,difficulty:1,lives:3,bombs:2});r.start();window.testFrame=0;});
  const checks=[];let found=false;
  for(let batch=0;batch<45;batch++){
   const c=await page.evaluate(()=>{for(let i=0;i<60;i++){const f=window.testFrame++;window.th04Sync.step([f%120<60?32:40,32],{frame:f});}return window.th04Sync.checksum();});checks.push(c);
   if(c.gameFrame>120){found=true;break;}
  }
  assert(found,'actual game must boot');
  const replay=await page.evaluate(()=>{const r=window.th04Sync,start=window.testFrame;r.capture(start);for(let i=0;i<12;i++)r.step([40,36],{frame:start+i});const before=r.checksum();r.restore(start);for(let i=0;i<12;i++)r.step([40,36],{frame:start+i,replay:true});const after=r.checksum();r.stop();return {before,after};});
  assert.deepEqual(replay.after,replay.before);assert.deepEqual(errors,[]);runs.push({checks,replay});await context.close();
 }
 assert.deepEqual(runs[0],runs[1]);console.log('PASS: real NP21 original/cached dispatch boot and game checksums match; native restore/replay matches in both');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
