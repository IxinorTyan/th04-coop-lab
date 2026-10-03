"""LAN lobby/signaling only. Each browser runs its own deterministic NP21."""
import argparse
import json
import secrets
import socket
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PROTOCOL='th04-rollback/2'
ROLES=('host','guest','guest2')
ROOMS={}
LOCK=threading.Lock()
TTL=120


def snapshot(room):
    return {'protocol':PROTOCOL,'revision':room['revision'],'phase':room['phase'],'slots':room['slots'],
            'present':{r:bool(room[r]) for r in ROLES},
            'ready':room['ready'],'settings':room['settings'],'generation':room['generation']}


class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.js':'text/javascript','.wasm':'application/wasm','.opus':'audio/ogg'}

    def log_message(self,*args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        super().end_headers()

    def list_directory(self,path):
        self.send_error(404)

    def reply(self,value,status=200):
        body=json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url=urlparse(self.path)
        if url.path=='/api/events':
            self.api('events',{k:v[0] for k,v in parse_qs(url.query).items()})
        elif url.path.startswith('/api/'):
            self.reply({'error':'未知接口'},404)
        else:
            if url.path=='/':
                self.path='/lan.html'
            super().do_GET()

    def do_POST(self):
        try:
            origin=self.headers.get('Origin')
            if origin and urlparse(origin).netloc!=self.headers.get('Host'):
                raise ValueError('来源不匹配')
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=65536:
                raise ValueError('消息大小无效')
            data=json.loads(self.rfile.read(size))
            if not isinstance(data,dict):
                raise ValueError('消息格式无效')
            self.api(urlparse(self.path).path.removeprefix('/api/'),data)
        except (ValueError,TypeError):
            self.reply({'error':'请求格式或来源不合法'},400)

    def api(self,action,data):
        with LOCK:
            now=time.monotonic()
            for code,room in list(ROOMS.items()):
                if now-room['seen']['host']>TTL:
                    del ROOMS[code]
            if action=='create':
                if data.get('protocol')!=PROTOCOL:
                    return self.reply({'error':'请刷新帧同步版网页'},400)
                if len(ROOMS)>=64:
                    return self.reply({'error':'房间数量已满'},429)
                code=secrets.token_hex(3).upper()
                while code in ROOMS:
                    code=secrets.token_hex(3).upper()
                token=secrets.token_urlsafe(24)
                ROOMS[code]={'host':token,'guest':None,'guest2':None,'queues':{r:[] for r in ROLES},
                    'seen':{r:now for r in ROLES},'revision':1,'phase':'lobby','slots':{r:None for r in ROLES},
                    'ready':{r:False for r in ROLES},'generation':secrets.token_hex(8),
                    'settings':{'p1':0,'p2':2,'p3':0,'players':2,'difficulty':1,'lives':3,'bombs':2}}
                return self.reply({'room':code,'token':token,'role':'host','protocol':PROTOCOL,'state':snapshot(ROOMS[code])})
            code=str(data.get('room','')).upper()
            room=ROOMS.get(code)
            if not room:
                return self.reply({'error':'房间不存在或已结束，请重新建房'},404)
            if action=='join':
                if data.get('protocol')!=PROTOCOL:
                    return self.reply({'error':'请刷新帧同步版网页'},400)
                available=next((r for r in ROLES[1:room['settings']['players']] if not room[r]),None)
                if available is None or room['phase']!='lobby':
                    return self.reply({'error':'房间已满或本局已经开始'},409)
                room[available]=secrets.token_urlsafe(24)
                room['revision']+=1
                room['seen'][available]=now
                return self.reply({'room':code,'token':room[available],'role':available,'protocol':PROTOCOL,'state':snapshot(room)})
            token=data.get('token')
            role=next((r for r in ROLES if room[r] and room[r]==token),None)
            if not role:
                return self.reply({'error':'房间身份无效'},403)
            room['seen'][role]=now
            active=ROLES[:room['settings']['players']]
            if action=='events':
                events=room['queues'][role]
                room['queues'][role]=[]
                return self.reply({'events':events,'state':snapshot(room)})
            if action in ('seat','settings','ready'):
                if room['phase']!='lobby':
                    return self.reply({'error':'本局已经锁定，请结束后重新建房'},409)
                if action=='seat':
                    slot=data.get('slot')
                    if type(slot) is not int or slot not in range(room['settings']['players']):
                        return self.reply({'error':'请选择已开放的座位'},400)
                    if any(room['slots'][r]==slot for r in active if r!=role):
                        return self.reply({'error':'该座位已有人'},409)
                    room['slots'][role]=slot
                    room['ready']={r:False for r in ROLES}
                elif action=='settings':
                    if role!='host':
                        return self.reply({'error':'只有房主可以修改本局设置'},403)
                    value=data.get('settings',{})
                    bounds={'p1':(0,3),'p2':(0,3),'p3':(0,3),'players':(2,3),'difficulty':(0,4),'lives':(1,6),'bombs':(0,2)}
                    if not isinstance(value,dict) or set(value)!=set(bounds) or any(type(value[k]) is not int or not lo<=value[k]<=hi for k,(lo,hi) in bounds.items()):
                        return self.reply({'error':'开局设置无效'},400)
                    if value['players']==2 and (room['guest2'] or 2 in room['slots'].values()):
                        return self.reply({'error':'请先让第三位加入者离开，并腾出 P3 座位，再关闭 3P'},409)
                    room['settings']=value
                    room['ready']={r:False for r in ROLES}
                else:
                    if room['slots'][role] is None:
                        return self.reply({'error':'请先选择座位'},409)
                    room['ready'][role]=not room['ready'][role]
                room['revision']+=1
                return self.reply({'state':snapshot(room)})
            if action=='start':
                if role!='host' or room['phase']!='lobby' or not all(room[r] and room['ready'][r] for r in active) or {room['slots'][r] for r in active}!=set(range(len(active))):
                    return self.reply({'error':'需要所有已开放座位的玩家加入并准备'},409)
                room['phase']='loading'
                room['revision']+=1
                return self.reply({'state':snapshot(room)})
            if action=='signal':
                message=data.get('message')
                other=data.get('to')
                if other not in active or other==role or not room[other]:
                    return self.reply({'error':'信令目标无效'},400)
                if not isinstance(message,dict) or message.get('type') not in ('offer','answer','ice','ended'):
                    return self.reply({'error':'信令格式不合法'},400)
                if room['phase']!='loading':
                    return self.reply({'error':'本局尚未开始或已经结束'},409)
                if len(room['queues'][other])>=256:
                    return self.reply({'error':'对方长时间没有响应，请重新建房'},409)
                room['queues'][other].append({'from':role,'message':message})
                return self.reply({'ok':True})
            if action=='drop':
                dropped=data.get('roles')
                if role!='host' or room['phase']!='loading' or not isinstance(dropped,list) or not dropped or any(r not in active[1:] for r in dropped):
                    return self.reply({'error':'无效离线通知'},400)
                for other in dropped:
                    room[other]=None
                    room['queues'][other]=[]
                    room['ready'][other]=False
                room['revision']+=1
                return self.reply({'state':snapshot(room)})
            if action=='leave':
                if role=='host':
                    del ROOMS[code]
                elif room['phase']=='lobby':
                    room[role]=None
                    room['slots'][role]=None
                    room['queues'][role]=[]
                    room['ready']={r:False for r in ROLES}
                    room['revision']+=1
                else:
                    # Keep the locked seat. The host schedules its removal from
                    # deterministic input membership; this is not a room end.
                    room[role]=None
                    room['queues'][role]=[]
                    room['ready'][role]=False
                    room['revision']+=1
                return self.reply({'ok':True})
            self.reply({'error':'未知接口'},404)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=9866)
    args=parser.parse_args()
    root=Path(__file__).resolve().parent/'web'
    try:
        server=ThreadingHTTPServer(('0.0.0.0',args.port),partial(Handler,directory=str(root)))
    except OSError as error:
        raise SystemExit(f'Cannot listen on port {args.port}. Close the previous LAN server window and try again. ({error})')
    print('TH04 INPUT LOCKSTEP (not screen streaming)',flush=True)
    print(f'A computer: http://localhost:{args.port}/lan.html',flush=True)
    addresses=sorted({item[4][0] for item in socket.getaddrinfo(socket.gethostname(),None,socket.AF_INET) if not item[4][0].startswith('127.')})
    for address in addresses:
        print(f'B computer: http://{address}:{args.port}/lan.html',flush=True)
    print('Keep this window open. Each browser loads and runs the game. LAN prototype only.',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
