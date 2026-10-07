"""Exact-binary solo isolation audit and real 16-bit movement/marker tests."""
from pathlib import Path
import gzip,json,struct
from unicorn import Uc,UC_ARCH_X86,UC_MODE_16,UC_HOOK_INSN
from unicorn.x86_const import *
from build_solo import Fat12,ROOT,INSERT,CS_BASE
meta=json.loads((ROOT/'web/solo-patch.json').read_text(encoding='utf-8'))
base=Fat12(gzip.decompress((ROOT/'baseline/4-jp.hdi.gz').read_bytes()))
solo=Fat12(gzip.decompress((ROOT/'web/th04-solo.hdi.gz').read_bytes()))
a,b=base.files(),solo.files();assert a.keys()==b.keys()
assert [n for n in a if base.read(a[n])!=solo.read(b[n])]==['GENSO/MAIN.EXE']
original=base.read(a['GENSO/MAIN.EXE']);exe=solo.read(b['GENSO/MAIN.EXE'])
hsize=struct.unpack_from('<H',exe,8)[0]*16;gap=meta['insert_size'];image=bytearray(exe[hsize:]);del image[INSERT:INSERT+gap]
# Undo only declared hooks and relocation rebasing: every other image byte
# must equal the original, including resource, score, damage, HUD and heap code.
for hook in meta['hooks']:image[hook['image_offset']:hook['image_offset']+3]=bytes.fromhex(hook['original'])
n=struct.unpack_from('<H',original,6)[0];table=struct.unpack_from('<H',original,24)[0]
for i in range(n):
 off,seg=struct.unpack_from('<HH',original,table+i*4);loc=seg*16+off
 old=struct.unpack_from('<H',original,hsize+loc)[0]
 if old*16>=INSERT:struct.pack_into('<H',image,loc,struct.unpack_from('<H',image,loc)[0]-gap//16)
assert bytes(image)==original[hsize:]
LOAD=0x1000;CS=LOAD+meta['code_segment'];DS=LOAD+meta['data_segment'];SS=0x7000
M=CS*16+meta['mailbox_cs_offset'];entries=meta['entries']
def w(u,at,v):u.mem_write(at,struct.pack('<H',v&65535))
def word(u,at):return struct.unpack('<h',u.mem_read(at,2))[0]
def machine():
 u=Uc(UC_ARCH_X86,UC_MODE_16);u.mem_map(0,0x100000);u.mem_write(LOAD*16,exe[hsize:])
 for i in range(n):
  off,seg=struct.unpack_from('<HH',exe,table+i*4);at=LOAD*16+seg*16+off;v=struct.unpack('<H',u.mem_read(at,2))[0];w(u,at,v+LOAD)
 for reg,val in [(UC_X86_REG_CS,CS),(UC_X86_REG_DS,DS),(UC_X86_REG_SS,SS),(UC_X86_REG_SP,0xff00)]:u.reg_write(reg,val)
 u.mem_write(M+22,b'\x01');w(u,DS*16+0x464e,1600);w(u,DS*16+0x4650,4800)
 return u
def run(u,entry):
 sp=0xfefe;w(u,SS*16+sp,0xff00);u.reg_write(UC_X86_REG_SP,sp)
 u.emu_start(CS*16+entry,CS*16+0xff00,count=30000)
 assert u.reg_read(UC_X86_REG_IP)==0xff00
for slow,unlimited,delta,expected in [(0,0,160,64),(1,0,160,32),(0,1,160,160),(1,1,-160,-160)]:
 u=machine();u.mem_write(DS*16+0x3976,bytes([slow]));w(u,M+28,3 if unlimited else 1);w(u,M+30,delta)
 run(u,entries[3]);assert word(u,DS*16+0x464e)==1600+expected
 assert word(u,M+30)==delta-expected
u=machine();w(u,M+28,3);w(u,M+30,-8192);w(u,M+32,8191);run(u,entries[3]);assert word(u,DS*16+0x464e)==128;assert word(u,DS*16+0x4650)==5632
u=machine();w(u,DS*16+0x4656,64);run(u,entries[3]);assert word(u,DS*16+0x464e)==1664 # inactive touch preserves native keyboard velocity
for options,slow,flags,mode,draw in [(0,1,0,1,False),(1,0,0,1,False),(1,1,0,1,True),(8,0,0,1,True),(8,0,1,1,False),(8,0,2,1,False),(8,1,0,4,False)]:
 u=machine();u.mem_write(LOAD*16+0x10bfd,b'\xc3') # isolate original sprite rendering, not our marker
 u.mem_write(M+22,bytes([mode,flags]));u.mem_write(M+26,bytes([options]));u.mem_write(DS*16+0x3976,bytes([slow]));ports=[]
 u.hook_add(UC_HOOK_INSN,lambda u,port,size,value,_:ports.append((port,value)),None,1,0,UC_X86_INS_OUT)
 run(u,entries[2]);assert bool(ports)==draw,(options,slow,flags,mode,ports)
print('PASS: 31 original files unchanged; all MAIN differences limited to six declared hooks/relocation/payload; actual x86 touch limits, native keyboard movement, bounds, focus/always-point gating')
