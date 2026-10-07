const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
 const host=await browser.newPage(),guest=await browser.newPage();
 await host.goto('http://127.0.0.1:9887/lan.html?network=lan');
 await guest.goto('http://127.0.0.1:9887/lan.html?network=lan&rollback=off');
 await host.locator('#create').click();await host.locator('#lobby').waitFor({state:'visible'});
 const code=(await host.locator('#room-info').textContent()).match(/房间 (\d{4})/)[1];
 await guest.locator('#room').fill(code);await guest.locator('#join').click();await guest.locator('#lobby').waitFor({state:'visible'});
 assert(await host.locator('#rollback').isChecked());assert(await guest.locator('#rollback').isChecked());assert(await guest.locator('#rollback').isDisabled());
 await host.locator('#rollback').uncheck();await guest.waitForFunction(()=>!document.querySelector('#rollback').checked);
 await host.locator('#seat1').click();await guest.locator('#seat0').click();await host.waitForTimeout(600);
 await host.locator('#ready').click();await guest.locator('#ready').click();await host.waitForFunction(()=>!document.querySelector('#start').disabled);
 await host.locator('#rollback').check();await guest.waitForFunction(()=>document.querySelector('#rollback').checked);
 assert(await host.locator('#start').isDisabled());assert(!(await guest.locator('#seats').textContent()).includes('已准备'));
 // Inspect lock at loading without launching emulators during this lobby test.
 for(const page of [host,guest])await page.route('**/netplay/runtime.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Lobby test</title>'}));
 await host.locator('#ready').click();await guest.locator('#ready').click();await host.waitForFunction(()=>!document.querySelector('#start').disabled);await host.locator('#start').click();
 await host.waitForFunction(()=>document.querySelector('#settings').disabled);await guest.waitForFunction(()=>document.querySelector('#settings').disabled);
 assert(await host.locator('#rollback').isDisabled());assert(await guest.locator('#rollback').isDisabled());
 console.log('PASS: real two-client lobby switch, guest read-only/opposite URL, host P2 authority, readiness reset, loading lock');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
