const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/14915/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true,deviceScaleFactor:1});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/__touch-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><div id="host"></div><script type="module">import {mountPlayer} from "./player-ui.js"; window.player=mountPlayer(document.querySelector("#host")); player.setActive(true);player.setContext({key:"stage:play",play:true});await player.enter({native:false});window.ready=true;</script>'}));
 await page.goto('http://127.0.0.1:9886/__touch-test');await page.waitForFunction(()=>window.ready);await page.waitForTimeout(200);
 const q=s=>page.locator(s);
 assert.equal(await q('link[href*="touch-overlay"]').count(),1);
 // Settings remain visible in immersive/fullscreen mode, which used to hide them.
 await q('.touch-help-open').click();
 for(const sel of ['[data-unlimited]','[data-always-point]','[data-double-tap]']){assert(await q(sel).isVisible());await q(sel).check();}
 await q('[data-save]').click();
 assert.equal(await page.evaluate(()=>player.alwaysPoint()),true);
 const cdp=await context.newCDPSession(page);
 const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:2,radiusY:2,force:1}))});
 const sample=()=>page.evaluate(()=>{const b=player.sample();const p=player.pack(b);player.consume();return {b,p};});
 await touch('touchStart',[[1,500,180]]);await touch('touchEnd',[]);
 await touch('touchStart',[[2,500,180]]);let result=await sample();assert(result.b&16,'double tap Bomb');assert.equal(Math.floor(result.p/2**40)%2,0,'Bomb finger must not own movement');
 assert.equal((await sample()).b&16,0,'one Bomb edge');await touch('touchEnd',[]);
 await page.evaluate(()=>player.reset());
 // Independent secondary finger double-taps while the first still moves.
 await touch('touchStart',[[1,450,180]]);await touch('touchMove',[[1,490,180]]);
 await touch('touchStart',[[1,490,180],[2,650,200]]);await touch('touchEnd',[[2,650,200]]);
 await touch('touchStart',[[1,490,180],[3,650,200]]);result=await sample();assert(result.b&16);assert.equal(result.b&64,0,'Bomb tap must not latch focus');assert.equal(Math.floor(result.p/2**41)%2,1);await touch('touchEnd',[]);
 await page.evaluate(()=>player.reset());
 await touch('touchStart',[[1,450,180]]);await touch('touchMove',[[1,520,180]]);await touch('touchEnd',[]);await touch('touchStart',[[2,520,180]]);assert.equal((await sample()).b&16,0,'swipe is not tap');await touch('touchEnd',[]);
 await q('.touch-help-open').click();
 await q('[data-selected]').selectOption('fire');await q('[data-size]').fill('1.5');await q('[data-size]').dispatchEvent('input');
 await q('[data-viewport]').fill('0.1');await q('[data-viewport]').dispatchEvent('input');
 await q('[data-save]').click();
 const landscape=await q('.touch-fire').boundingBox();assert.equal(landscape.width,144);
 for(const name of ['focus','bomb','escape','rescue']){const box=await q('[data-layout-control='+name+']').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=844&&box.y+box.height<=390,'default control inside viewport: '+name);assert.equal(await q('[data-layout-control='+name+'].custom-position').count(),0);}
 await page.screenshot({path:path.resolve('th04-coop-lab/reports/touch-landscape.png')});
 await q('.touch-help-open').click();await q('[data-size]').fill('0.6');await q('[data-size]').dispatchEvent('input');await q('[data-close]').click();assert.equal((await q('.touch-fire').boundingBox()).width,144,'exit discards draft');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(120);assert.equal((await q('.touch-fire').boundingBox()).width,86,'portrait independent');
 await q('.touch-help-open').click();await q('[data-selected]').selectOption('fire');await q('[data-size]').fill('1.2');await q('[data-size]').dispatchEvent('input');await q('[data-save]').click();
 await page.reload();await page.waitForFunction(()=>window.ready);await page.waitForTimeout(150);
 assert(Math.abs((await q('.touch-fire').boundingBox()).width-103.2)<1,'portrait persisted');
 await q('.touch-help-open').click();assert(await q('[data-unlimited]').isChecked());assert(await q('[data-always-point]').isChecked());assert(await q('[data-double-tap]').isChecked());
 await page.screenshot({path:path.resolve('th04-coop-lab/reports/touch-portrait-editor.png')});
 await q('[data-unlimited]').uncheck();await q('[data-always-point]').uncheck();await q('[data-double-tap]').uncheck();await q('[data-save]').click();
 await touch('touchStart',[[1,200,500]]);await touch('touchEnd',[]);await touch('touchStart',[[2,200,500]]);result=await sample();assert.equal(result.b&16,0);assert.equal(Math.floor(result.p/2**41)%2,0);assert.equal(Math.floor(result.p/2**42)%2,0);await touch('touchEnd',[]);
 await page.evaluate(()=>player.setContext({key:'title:menu',play:false}));assert(await q('[data-layout-control=up]').isVisible());
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);assert.equal((await q('.touch-fire').boundingBox()).width,144);
 await page.goto('http://127.0.0.1:9886/local.html');await q('#start').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已进入关卡'),{},{timeout:60000});await page.screenshot({path:path.resolve('th04-coop-lab/reports/touch-local-game.png')});
 assert.deepEqual(errors,[]);console.log('PASS: TH06 geometry, fullscreen settings, Bomb/multitouch, toggles, portrait/landscape drafts and persistence');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
