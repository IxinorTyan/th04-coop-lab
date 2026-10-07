"""Build a separate original single-player disk with input/display hooks only."""
from pathlib import Path
import gzip, hashlib, json, struct, subprocess
ROOT=Path(__file__).resolve().parents[1]
INSERT=0x130e0
CS_BASE=0xaaf0
MD5='06d74719b6f72b11014a392fd34d5f57'

class Fat12:
    def __init__(self,data):
        self.data=bytearray(data)
        u16=self.u16;u32=lambda p:struct.unpack_from('<I',self.data,p)[0]
        header,sector,spt,heads=(u32(p) for p in (8,16,20,24));part=header+sector
        base=header+((u16(part+10)*heads+self.data[part+9])*spt+self.data[part+8])*sector
        bps=u16(base+11);self.cluster_size=bps*self.data[base+13]
        self.fat=base+u16(base+14)*bps;self.fat_size=u16(base+22)*bps;self.copies=self.data[base+16]
        self.root=self.fat+self.fat_size*self.copies;self.root_size=u16(base+17)*32
        self.clusters=self.root+((self.root_size+bps-1)//bps)*bps
        self.count=(base+(u16(base+19) or u32(base+32))*bps-self.clusters)//self.cluster_size
    def u16(self,p):return struct.unpack_from('<H',self.data,p)[0]
    def nxt(self,c):
        v=self.u16(self.fat+c*3//2);return v>>4 if c&1 else v&0xfff
    def chain(self,c):
        seen=set()
        while 2<=c<0xff8:
            assert c not in seen and c<self.count+2
            seen.add(c);yield c;c=self.nxt(c)
    def offset(self,c):return self.clusters+(c-2)*self.cluster_size
    def setfat(self,c,v):
        for copy in range(self.copies):
            at=self.fat+copy*self.fat_size+c*3//2;old=self.u16(at)
            struct.pack_into('<H',self.data,at,(old&15)|(v<<4) if c&1 else (old&0xf000)|v)
    def files(self):
        result={}
        def walk(blocks,parent):
            for start,size in blocks:
                for at in range(start,start+size,32):
                    e=self.data[at:at+32]
                    if e[0]==0:return
                    if e[0]==0xe5 or e[11]&8 or e[11]==15:continue
                    stem=e[:8].decode('cp932').strip();ext=e[8:11].decode('cp932').strip()
                    if stem in ('.','..'):continue
                    name=parent+stem+('.'+ext if ext else '')
                    if e[11]&16:walk([(self.offset(c),self.cluster_size) for c in self.chain(self.u16(at+26))],name+'/')
                    else:result[name]=at
        walk([(self.root,self.root_size)],'');return result
    def read(self,entry):
        size=struct.unpack_from('<I',self.data,entry+28)[0]
        return b''.join(self.data[self.offset(c):self.offset(c)+self.cluster_size] for c in self.chain(self.u16(entry+26)))[:size]
    def replace(self,entry,content):
        allocated=list(self.chain(self.u16(entry+26)));required=(len(content)+self.cluster_size-1)//self.cluster_size
        assert required>=len(allocated) # this builder only extends MAIN
        for c in range(2,self.count+2):
            if len(allocated)==required:break
            if self.nxt(c)==0:allocated.append(c)
        assert len(allocated)==required
        for i,c in enumerate(allocated):
            self.setfat(c,allocated[i+1] if i+1<len(allocated) else 0xfff)
            self.data[self.offset(c):self.offset(c)+self.cluster_size]=content[i*self.cluster_size:(i+1)*self.cluster_size].ljust(self.cluster_size,b'\0')
        struct.pack_into('<I',self.data,entry+28,len(content))
        assert self.read(entry)==content
        for i in range(1,self.copies):assert self.data[self.fat:self.fat+self.fat_size]==self.data[self.fat+i*self.fat_size:self.fat+(i+1)*self.fat_size]

def build_exe(original):
    assert hashlib.md5(original).hexdigest()==MD5
    out=ROOT/'build';out.mkdir(exist_ok=True)
    touch=(ROOT/'patches/touch.asm').read_text(encoding='utf-8')
    touch=touch[touch.index('touch_move:'):]
    old='    movzx ebx,byte [cs:active_p2]\n    shl bx,3'
    assert touch.count(old)==1
    touch=touch.replace(old,'    xor bx,bx\n    cmp byte [cs:mode],1\n    jne .clear')
    (out/'solo-touch.inc').write_text(touch,encoding='utf-8')
    subprocess.run([str(ROOT/'tools/nasm-2.16.03/nasm.exe'),'-f','bin','patches/solo.asm','-o','build/solo.bin','-l','build/solo.lst'],cwd=ROOT,check=True)
    payload=(out/'solo.bin').read_bytes();gap=(len(payload)+15)&~15
    entries=struct.unpack_from('<7H',payload)
    assert 0x85f0+gap<0x10000
    hsize=struct.unpack_from('<H',original,8)[0]*16
    header=bytearray(original[:hsize]);image=bytearray(original[hsize:])
    count=struct.unpack_from('<H',header,6)[0];table=struct.unpack_from('<H',header,24)[0]
    for i in range(count):
        off,seg=struct.unpack_from('<HH',header,table+4*i);loc=seg*16+off
        target=struct.unpack_from('<H',image,loc)[0]
        if target*16>=INSERT:struct.pack_into('<H',image,loc,target+gap//16)
        moved=loc+(gap if loc>=INSERT else 0)
        struct.pack_into('<HH',header,table+4*i,moved%16,moved//16)
    for at in (14,22):
        seg=struct.unpack_from('<H',header,at)[0]
        if seg*16>=INSERT:struct.pack_into('<H',header,at,seg+gap//16)
    hooks=[(0xaf76,'e85702',0,'stage init/status'),(0xabe1,'e8db5e',1,'player status'),
           (0xac18,'e8e25f',2,'optional collision point'),(0x10b75,'e8d8fd',3,'touch velocity'),
           (0xabae,'e81e07',4,'original pause/status'),(0xab6e,'e81700',5,'world exit/status')]
    for at,expected,index,name in hooks:
        assert image[at:at+3]==bytes.fromhex(expected),(name,hex(at))
        image[at:at+3]=b'\xe8'+struct.pack('<H',(CS_BASE+entries[index]-at-3)&0xffff)
    image[INSERT:INSERT]=payload+bytes(gap-len(payload))
    size=len(header)+len(image);struct.pack_into('<HH',header,2,size%512,(size+511)//512)
    result=bytes(header+image);(out/'SOLO-MAIN.EXE').write_bytes(result)
    manifest={'version':1,'original_md5':MD5,'original_size':len(original),'patched_size':size,
              'sha256':hashlib.sha256(result).hexdigest(),'insert_image_offset':INSERT,'insert_size':gap,
              'code_segment':CS_BASE//16,'data_segment':0x2134+gap//16,'mailbox_cs_offset':entries[6],
              'signature':'TH04SOLOINPUTv1!','entries':list(entries),
              'hooks':[{'image_offset':at,'original':old,'target_cs_offset':entries[i],'name':name} for at,old,i,name in hooks],
              'heap_bytes':320000,'changed_files':['GENSO/MAIN.EXE']}
    return result,manifest

def main():
    original=gzip.decompress((ROOT/'baseline/4-jp.hdi.gz').read_bytes())
    meta=json.loads((ROOT/'baseline/manifest.json').read_text(encoding='utf-8-sig'))
    assert hashlib.sha256(original).hexdigest()==meta['sha256']
    disk=Fat12(original);files=disk.files();before={name:hashlib.sha256(disk.read(at)).hexdigest() for name,at in files.items()}
    exe,manifest=build_exe(disk.read(files['GENSO/MAIN.EXE']))
    disk.replace(files['GENSO/MAIN.EXE'],exe)
    after={name:hashlib.sha256(disk.read(at)).hexdigest() for name,at in disk.files().items()}
    assert before.keys()==after.keys()
    assert [name for name in before if before[name]!=after[name]]==['GENSO/MAIN.EXE']
    web=ROOT/'web';(web/'th04-solo.hdi.gz').write_bytes(gzip.compress(bytes(disk.data),mtime=0))
    manifest['disk']={'sha256':hashlib.sha256(disk.data).hexdigest(),'size':len(disk.data)}
    manifest['unchanged_files']={name:value for name,value in before.items() if name!='GENSO/MAIN.EXE'}
    (web/'solo-patch.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf-8')
    print(f'Built original single-player disk: {len(exe)} byte MAIN, {manifest["insert_size"]} byte input/display patch; {len(before)-1} files unchanged')
if __name__=='__main__':main()
