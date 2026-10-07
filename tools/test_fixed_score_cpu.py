"""Execute fixed-score hook sites in the relocated cooperative MAIN.EXE."""
from pathlib import Path
import gzip,json,struct
from build_solo import Fat12
from unicorn import Uc,UC_ARCH_X86,UC_MODE_16
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
p=json.loads((ROOT/'web/patch.json').read_text())
disk=Fat12(gzip.decompress((ROOT/'web/th04-coop.hdi.gz').read_bytes()))
exe=disk.read(disk.files()['GENSO/MAIN.EXE']);header=struct.unpack_from('<H',exe,8)[0]*16
LOAD=0x1000;CS=LOAD+p['code_segment'];DS=LOAD+p['data_segment'];M=CS*16+p['mailbox_cs_offset']
S=CS*16+p['personal_stats']['cs_offset'];GAP=p['insert_size']
def machine(players,eax,bomb):
 u=Uc(UC_ARCH_X86,UC_MODE_16);u.mem_map(0,0x100000);u.mem_write(LOAD*16,exe[header:])
 n,table=struct.unpack_from('<H',exe,6)[0],struct.unpack_from('<H',exe,24)[0]
 for i in range(n):
  off,seg=struct.unpack_from('<HH',exe,table+4*i);at=LOAD*16+seg*16+off
  value=struct.unpack('<H',u.mem_read(at,2))[0];u.mem_write(at,struct.pack('<H',(value+LOAD)&65535))
 u.mem_write(S,bytes(60));u.mem_write(M+606,bytes([players]));u.mem_write(M+84,b'\0')
 u.mem_write(CS*16+p['bomb_owner_cs_offset'],bytes([players-1]));u.mem_write(DS*16+0x4368,bytes([bomb]))
 for r,v in [(UC_X86_REG_DS,DS),(UC_X86_REG_SS,0x7000),(UC_X86_REG_SP,0xff00),(UC_X86_REG_EAX,eax),(UC_X86_REG_EBX,0xaabbccdd),(UC_X86_REG_ECX,0x11223344),(UC_X86_REG_EDX,0x55667788)]:u.reg_write(r,v)
 return u
cases=[(0x16d37,9,5120,False),(0x1a201,9,3000,False),(0x1c929,6,100,True),(0x1c931,6,10,True)]
checks=0
for players in (2,3):
 for site,length,units,clear in cases:
  for bomb in ((0,1) if clear else (0,)):
   for eax in (0xffffffff,0,0xdeadbeef,0x12340070):
    u=machine(players,eax,bomb);at=LOAD*16+site+GAP
    expected=[0]*3;total=units*(15 if players==2 else 22)
    if clear and not bomb:
     for seat in range(players):expected[seat]=total//players+(seat<total%players)
    else:expected[players-1 if clear else 0]=total
    for repeat in range(1,4):
     u.reg_write(UC_X86_REG_CS,at>>4)
     u.emu_start(at,at+length,count=2000)
     got=[struct.unpack('<I',u.mem_read(S+seat*20,4))[0] for seat in range(3)]
     assert got==[v*repeat for v in expected],(hex(site),players,bomb,hex(eax),got,expected)
     assert [struct.unpack('<I',u.mem_read(S+seat*20+4,4))[0] for seat in range(3)]==got
     assert u.reg_read(UC_X86_REG_EAX)==eax
     assert u.reg_read(UC_X86_REG_EBX)==0xaabbccdd
     assert u.reg_read(UC_X86_REG_ECX)==0x11223344
     assert u.reg_read(UC_X86_REG_EDX)==0x55667788
     assert u.reg_read(UC_X86_REG_SP)==0xff00
     checks+=1
print(f'PASS: {checks} relocated x86 fixed-score calls; dirty EAX, 2/3 players, Bomb owner, shared clear, repeated awards, registers/stack')
