// Input-only lockstep entry. Game rendering and audio run in each browser.
// Explicit test preset only; ordinary LAN URLs and host-supplied settings keep
// their existing behavior. No arbitrary server URLs or credentials in queries.
const networkMode=new URLSearchParams(location.search).get('network');
if(networkMode==='public-ws')document.getElementById('status').textContent='公网 WebSocket 中继测试：无需 STUN/TURN 账号。双方使用同一完整链接，保持服务和 Tunnel 窗口开启。';
const publicTest=['public-test','public-turn','public-relay'].includes(networkMode);
if(publicTest){
  if(window.th04NetplayConnection===undefined){
    if(networkMode==='public-test'){
      window.th04NetplayConnection={iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],iceTransportPolicy:'all'};
      document.getElementById('status').textContent='公网直连测试：已启用 STUN，未配置 TURN。直连超时时请改用已配置凭据的 TURN 测试入口。';
    }else{
      window.th04NetplayConnection=async(session,signal)=>{
        const response=await fetch('/api/ice',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(session),signal});
        const config=await response.json();
        if(!response.ok)throw Error(config.error||`获取 TURN 配置失败：HTTP ${response.status}`);
        return {...config,iceTransportPolicy:networkMode==='public-relay'?'relay':'all'};
      };
      document.getElementById('status').textContent=networkMode==='public-relay'
        ?'TURN 验证：强制中继；开始时自动获取临时凭据。电脑须先完成 configure-turn.bat 配置。'
        :'公网联机：直连或 TURN 中继；开始时自动获取临时凭据。';
    }
  }else document.getElementById('status').textContent='公网测试入口：使用宿主提供的连接配置。';
}
import('./netplay/room.js').catch(error=>{
  document.getElementById('status').textContent=`联机模块加载失败：${error.message||error}`;
});
