"""Read original PF archive assets without changing or redistributing them."""
from pathlib import Path
import struct

ROOT=Path(__file__).resolve().parents[1]

def assets(names=None, archive='東方幻想.郷'):
    data=(ROOT/'extracted/GENSO'/archive).read_bytes()
    size=struct.unpack_from('<H',data)[0]
    key=data[6]
    table=bytearray(data[16:16+size])
    for i in range(size):
        table[i]^=key
        key=(key-table[i])&255
    result={}
    for i in range(0,size,32):
        kind,key=struct.unpack_from('<HB',table,i)
        if not kind:break
        name=bytes(table[i+3:i+16]).split(b'\0')[0].decode('ascii').lower()
        if names is not None and name not in names:continue
        packed,original,offset=struct.unpack_from('<HHI',table,i+16)
        source=bytes(x^key for x in data[offset:offset+packed])
        if kind==0x9595:
            decoded=bytearray()
            j=0
            previous=None
            while j<len(source):
                value=source[j];j+=1
                decoded.append(value)
                if value==previous:
                    count=source[j];j+=1
                    decoded.extend(bytes([value])*count)
                previous=value
            source=bytes(decoded)
        else:assert kind==0xf388,(name,hex(kind))
        assert len(source)>=original,(name,len(source),original)
        result[name]=source[:original]
    return result

if __name__=='__main__':
    names=('miko.bft','mari.bft','mikod.bft','miko32.bft','miko16.bft','st00.bft','bb0.cdg','bb1.cdg')
    files=assets(names)
    for name in names:
        b=files[name]
        if name.endswith('.bft'):
            start=32+struct.unpack_from('<H',b,28)[0]
            print(name,'size',len(b),'palette',bool(b[5]&128),'rgb data',b[start:start+48].hex() if b[5]&128 else '-')
        else:print(name,'size',len(b),'header',b[:16].hex())
