const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true});const page=await context.newPage();const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.goto('http://127.0.0.1:9886/solo.html');
 await page.evaluate(async()=>{const solo=await import('./solo.js');window.readSolo=solo.readSoloState;window.frameStats=solo.readFrameStats;});
 const q=s=>page.locator(s),state=()=>page.evaluate(()=>window.readSolo());
 await q('#control-settings [data-always-point]').check();await q('#start').click();
 await page.waitForTimeout(12000);assert.equal(await state(),null,'opening must not jump into a stage');
 await page.screenshot({path:'th04-coop-lab/reports/solo-opening.png'});
 const a=await page.evaluate(()=>({time:performance.now(),...window.frameStats()}));
 await page.waitForTimeout(12000);
 const b=await page.evaluate(()=>({time:performance.now(),...window.frameStats()}));
 const rate=(b.callbacks-a.callbacks)*1000/(b.time-a.time);
 assert.equal(b.limit,60);assert(rate>20&&rate<=61,`native callback ceiling: ${rate}`);console.log('local callback rate',rate);
 await page.screenshot({path:'th04-coop-lab/reports/solo-title.png'});
 assert.equal(await q('[data-rescue]').count(),0);
 // Choose through original menus with actual touch controls; no injected start config.
 for(let i=0;i<5;i++){if((await state())?.mode===1)break;await q('[data-layout-control=confirm]').tap();await page.waitForTimeout(1300);if((await state())?.mode===1)break;}
 const live=await page.waitForFunction(()=>{const s=window.readSolo();return s?.mode===1&&!s.flags&&s.ticks>30?s:false;},{},{timeout:30000});
 let s=await live.jsonValue();assert.equal(s.stage,0);assert(s.pointOptions&8);console.log('native stage',s);
 await page.screenshot({path:'th04-coop-lab/reports/solo-stage.png'});
 // Real multi-touch browser input drives the native single-player coordinates.
 const cdp=await context.newCDPSession(page);
 const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(([id,x,y])=>({id,x,y,radiusX:2,radiusY:2,force:1}))});
 const before=await state();await touch('touchStart',[[1,480,280]]);await touch('touchMove',[[1,520,280]]);await page.waitForTimeout(250);const after=await state();assert(after.x>before.x+5,'native touch moves player');await touch('touchEnd',[]);
 // Original pause continues to render its own menu, then returns to play.
 await page.keyboard.press('Escape',{delay:120});await page.waitForFunction(()=>window.readSolo()?.mode===2);await page.waitForTimeout(300);await page.screenshot({path:'th04-coop-lab/reports/solo-pause.png'});
 assert(await q('[data-layout-control=confirm]').isVisible());
 await page.keyboard.press('KeyZ',{delay:120});await page.waitForFunction(()=>window.readSolo()?.mode===1);
 // Both preferences remain together and can be changed outside fullscreen.
 await q('.touch-help-open').click();await q('[data-window]').click();await q('[data-close]').click();
 await q('#control-settings [data-always-point]').uncheck();await page.waitForTimeout(100);assert.equal((await state()).pointOptions&8,0);
 const focus=q('#control-settings input:not([data-always-point])');await focus.uncheck();await page.waitForTimeout(100);assert.equal((await state()).pointOptions,0);
 await focus.check();await page.waitForTimeout(100);assert.equal((await state()).pointOptions,1);
 await q('#canvas').focus();await page.keyboard.press('Escape',{delay:120});await page.waitForTimeout(400);await page.keyboard.press('ArrowDown',{delay:120});await page.waitForTimeout(200);await page.keyboard.press('KeyZ',{delay:120});
 await page.waitForFunction(()=>window.readSolo()===null,{},{timeout:15000});await page.waitForTimeout(10000);await page.screenshot({path:'th04-coop-lab/reports/solo-return-title.png'});
 assert(!requests.some(u=>/th04-coop|\/api\/|COOP.COM|netplay\/runtime/.test(u)));assert.deepEqual(errors,[]);
 console.log('PASS: original opening/title/menu/stage, native touch movement, original pause/resume, both point switches; no cooperative disk or room service');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
