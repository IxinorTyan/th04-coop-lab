// Read-only audit of the pinned native table; requires the local QA server.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
 const page=await browser.newPage();const cdp=await page.context().newCDPSession(page);await cdp.send('Debugger.enable');let wasmId;
 cdp.on('Debugger.scriptParsed',p=>{if(p.scriptLanguage==='WebAssembly')wasmId=p.scriptId;});
 await page.goto('http://127.0.0.1:9886/solo.html');await page.locator('#start').click();
 for(let i=0;i<100&&!wasmId;i++)await page.waitForTimeout(100);assert(wasmId);
 let part=await cdp.send('Debugger.disassembleWasmModule',{scriptId:wasmId});const streamId=part.streamId;let lines=0,mutations=[];
 while(true){const chunk=part.chunk.lines;lines+=chunk.length;mutations.push(...chunk.filter(l=>/\btable\.(set|init|copy|fill|grow)\b/.test(l)));if(!streamId||chunk.length===0)break;part=await cdp.send('Debugger.nextWasmDisassemblyChunk',{streamId});}
 assert(lines>1000);assert.deepEqual(mutations,[]);console.log(`PASS: ${lines} WASM disassembly lines; no table mutation instructions`);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
