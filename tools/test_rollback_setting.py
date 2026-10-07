"""Host-only rollback policy: exercise the real handler without a server."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import lan_server as server
class Client(server.Handler):
    def __init__(self):pass
    def reply(self,value,status=200):return status,value
h=Client()
for transport,default in [('rtc',True),('ws',False)]:
    server.ROOMS.clear()
    code,result=h.api('create',{'protocol':server.PROTOCOL,'transport':transport})
    assert code==200 and result['state']['settings']['rollback'] is default
    room,host=result['room'],result['token']
    def act(action,token=host,**kw):return h.api(action,{'room':room,'token':token,'protocol':server.PROTOCOL,'transport':transport,**kw})
    code,guest=act('join',rollback=not default);assert code==200
    guest=guest['token']
    assert act('events',token=guest)[1]['state']['settings']['rollback'] is default
    settings={k:result['state']['settings'][k] for k in ['players','difficulty','lives','bombs','rollback']}
    assert act('settings',token=guest,settings=dict(settings,rollback=not default))[0]==403
    for bad in [0,1,'false',None]:assert act('settings',settings=dict(settings,rollback=bad))[0]==400
    assert act('settings',settings={k:v for k,v in settings.items() if k!='rollback'})[0]==400
    assert act('seat',slot=1)[0]==200  # Host authority is independent of P1.
    assert act('seat',token=guest,slot=0)[0]==200
    for token in [host,guest]:assert act('ready',token=token)[0]==200
    settings['rollback']=not default
    code,result=act('settings',settings=settings)
    assert code==200 and not any(result['state']['ready'].values())
    assert act('events',token=guest)[1]['state']['settings']['rollback'] is not default
    for token in [host,guest]:assert act('ready',token=token)[0]==200
    assert act('start')[0]==200
    assert act('settings',settings=dict(settings,rollback=default))[0]==409
print('PASS: transport defaults, guest URL ignored, host-only authority, strict booleans, readiness reset, start lock')
