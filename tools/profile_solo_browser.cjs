const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
 const page=await browser.newPage({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
 const samples={};
 await page.route('**/np21-60.js',async route=>{const r=await route.fetch();let s=await r.text();if(process.env.TABLE_CACHE==='0')s=s.replace('var wasmTableMirror=[];var getWasmTableEntry=funcPtr=>wasmTableMirror[funcPtr]||(wasmTableMirror[funcPtr]=wasmTable.get(funcPtr));','var getWasmTableEntry=funcPtr=>wasmTable.get(funcPtr);');s=s.replace('iterFunc();','const begin=performance.now();iterFunc();(globalThis.__nativeTimes??=[]).push(performance.now()-begin);');await route.fulfill({response:r,body:s});});
 await page.goto('http://127.0.0.1:9886/solo.html');await page.evaluate(async()=>{const m=await import('./solo.js');window.readSolo=m.readSoloState;});await page.locator('#start').click();await page.waitForTimeout(24000);
 for(let i=0;i<5;i++){if((await page.evaluate(()=>window.readSolo()))?.mode===1)break;await page.locator('[data-layout-control=confirm]').tap();await page.waitForTimeout(2000);}
 await page.waitForFunction(()=>window.readSolo()?.mode===1);await page.locator('[data-auto]').click();
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
 for(const rate of [1,2]){
 await cdp.send('Emulation.setCPUThrottlingRate',{rate});await page.evaluate(()=>{window.__nativeTimes=[];});const start=await page.evaluate(()=>({time:performance.now(),state:window.readSolo()}));
 await page.waitForTimeout(7000);const end=await page.evaluate(()=>({time:performance.now(),state:window.readSolo(),native:window.__nativeTimes}));
 const stats=a=>{a.sort((a,b)=>a-b);return {count:a.length,mean:a.reduce((a,b)=>a+b,0)/a.length,p95:a[Math.floor(a.length*.95)],max:a.at(-1)}};
 await cdp.send('Profiler.start');await page.waitForTimeout(2000);const {profile}=await cdp.send('Profiler.stop');const counts=new Map();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
 samples[rate]={duration:end.time-start.time,start:start.state,end:end.state,native:stats(end.native),hot:profile.nodes.map(n=>({name:n.callFrame.functionName,url:n.callFrame.url,hits:counts.get(n.id)||0})).sort((a,b)=>b.hits-a.hits).slice(0,14)};
 }
 fs.writeFileSync(process.argv[2]||'th04-coop-lab/reports/solo-performance.json',JSON.stringify(samples,null,2));console.log(JSON.stringify(samples,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
