"""Small authenticated room relay using websockets' Sans-I/O RFC6455 engine.

Client -> server: E7,target,payload (eagler BrowserPeerTransport convention).
Server -> client: E8,authenticated-source,payload (TH04 adapter extension).
"""
import json
import select
import socket
import threading
import time
from urllib.parse import urlparse, parse_qs

HUB_LOCK=threading.RLock()
HUBS={}


def handle(handler,rooms,room_lock,roles,ttl):
    try:
        from websockets.server import ServerProtocol
        from websockets.protocol import OPEN
        from websockets.frames import OP_BINARY, OP_CONT, OP_TEXT, OP_CLOSE
    except ImportError:
        handler.reply({'error':'请安装 requirements-relay.txt 后重启服务'},503)
        return
    origin=urlparse(handler.headers.get('Origin',''))
    if origin.scheme not in ('http','https') or origin.netloc!=handler.headers.get('Host'):
        handler.reply({'error':'中继来源不匹配'},403);return
    data={k:v[0] for k,v in parse_qs(urlparse(handler.path).query).items()}
    code=data.get('room','').upper()
    token=data.get('token')
    with room_lock:
        room=rooms.get(code)
        if not room or time.monotonic()-room['seen']['host']>ttl:
            handler.reply({'error':'房间已结束'},404);return
        role=next((r for r in roles if room[r] and room[r]==token),None)
        if role is None or room['phase']!='loading' or room.get('transport','rtc')!='ws':
            handler.reply({'error':'中继身份或房间模式无效'},403);return
        generation=room['generation'];count=room['settings']['players'];source=roles.index(role)
    key=(code,generation)
    sock=handler.connection
    sock.settimeout(5)
    sock.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)
    protocol=ServerProtocol(max_size=262146)
    send_lock=threading.Lock()
    handler.close_connection=True

    def flush():
        for chunk in protocol.data_to_send():
            if chunk:sock.sendall(chunk)

    def send(value):
        with send_lock:
            if protocol.state is not OPEN:raise OSError('relay closed')
            if isinstance(value,bytes):protocol.send_binary(value)
            else:protocol.send_text(json.dumps(value).encode())
            flush()

    entry={'send':send,'ready':False}
    try:
        # Browser waits for HTTP 101 before sending WebSocket frames. The HTTP
        # parser has consumed the request; upgraded reads now use the socket.
        request=(handler.requestline+'\r\n'+''.join(f'{k}: {v}\r\n' for k,v in handler.headers.items())+'\r\n').encode('iso-8859-1')
        protocol.receive_data(request)
        events=protocol.events_received()
        if len(events)!=1:return
        response=protocol.accept(events[0]);protocol.send_response(response);flush()
        if response.status_code!=101:return
        with HUB_LOCK:
            hub=HUBS.setdefault(key,{})
            if source in hub or any(item['ready'] for item in hub.values()):
                send({'type':'error','message':'不支持重复加入或中途重连'});return
            hub[source]=entry
            if len(hub)==count:
                # One lock orders every route notification before any payload.
                for item in hub.values():item['send']({'type':'route','mode':'relay','generation':generation})
                for item in hub.values():item['ready']=True
        fragments=bytearray();started=time.monotonic();last_data=started
        while True:
            with room_lock:
                current=rooms.get(code)
                valid=current and current['generation']==generation and current[role]==token and time.monotonic()-current['seen']['host']<=ttl
            if not valid:break
            if (entry['ready'] and time.monotonic()-last_data>40) or (not entry['ready'] and time.monotonic()-started>30):break
            if not select.select([sock],[],[],1)[0]:continue
            chunk=sock.recv(65536)
            if not chunk:break
            with send_lock:
                protocol.receive_data(chunk);events=protocol.events_received();flush()
                opened=protocol.state is OPEN
            if not opened:break
            for event in events:
                if event.opcode==OP_CLOSE:return
                if event.opcode==OP_TEXT:raise ValueError('binary expected')
                if event.opcode not in (OP_BINARY,OP_CONT):continue
                fragments.extend(event.data)
                if len(fragments)>262146:raise ValueError('too large')
                if not event.fin:continue
                packet=bytes(fragments);fragments.clear();last_data=time.monotonic()
                if len(packet)<3 or packet[0]!=0xe7 or packet[1]>=count or packet[1]==source:raise ValueError('bad envelope')
                with HUB_LOCK:
                    if not entry['ready']:raise ValueError('route not released')
                    target=HUBS.get(key,{}).get(packet[1])
                    # Membership removal may be in flight; never reroute data.
                    if target:
                        try:target['send'](bytes((0xe8,source))+packet[2:])
                        except OSError:pass
    except (OSError,ValueError):
        pass
    finally:
        with HUB_LOCK:
            hub=HUBS.get(key,{})
            if hub.get(source) is entry:
                del hub[source]
                for item in hub.values():
                    try:item['send']({'type':'peer-left','peer':source})
                    except OSError:pass
                if not hub:HUBS.pop(key,None)
        with send_lock:
            try:
                if protocol.state is OPEN:protocol.send_close(1000,'relay ended');flush()
            except OSError:pass
