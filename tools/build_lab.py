"""Build a reversible, exact-version MZ patch and independent playable disk."""
from pathlib import Path
import gzip
import hashlib
import json
import shutil
import struct
import subprocess
from audit_assets import assets

ROOT = Path(__file__).resolve().parents[1]
INSERT = 0x130e0
CS_BASE = 0xaaf0
# Keep executable expansion + DOS heap within the previous two-player budget.
# Extended/EMS memory does not satisfy DOS INT 21h/AH=48h conventional memory.
EXTRA_AND_HEAP_BYTES = 0x2000 + 0x5e20 * 16
MIN_HEAP_BYTES = 320000 + 60 * 1024
MD5 = '06d74719b6f72b11014a392fd34d5f57'

def build_exe():
    original = (ROOT/'extracted/GENSO/MAIN.EXE').read_bytes()
    assert hashlib.md5(original).hexdigest() == MD5
    out = ROOT/'build'
    out.mkdir(exist_ok=True)
    # Lossless dictionary leaves room for scoring without shrinking asset heap.
    masks=(ROOT/'patches/ghosts.bin').read_bytes()[33:]
    rows=list(struct.iter_unpack('<I',masks))
    unique=list(dict.fromkeys(rows))
    assert len(unique)<=256
    (out/'ghost-rows.bin').write_bytes(b''.join(struct.pack('<I',r[0]) for r in unique))
    (out/'ghost-indices.bin').write_bytes(bytes(unique.index(r) for r in rows))
    assert b''.join(struct.pack('<I',unique[i][0]) for i in (out/'ghost-indices.bin').read_bytes())==masks
    subprocess.run([str(ROOT/'tools/nasm-2.16.03/nasm.exe'), '-f', 'bin',
                    'patches/coop.asm', '-o', 'build/coop.bin',
                    '-l', 'build/coop.lst'], check=True, cwd=ROOT)
    payload = bytearray((out/'coop.bin').read_bytes())
    GAP = (len(payload) + 15) & ~15
    HEAP_PARAS = (EXTRA_AND_HEAP_BYTES - GAP) // 16
    assert HEAP_PARAS * 16 >= MIN_HEAP_BYTES, 'Payload leaves too little asset heap'
    assert GAP + HEAP_PARAS * 16 == EXTRA_AND_HEAP_BYTES
    assert len(payload) <= GAP
    entries = struct.unpack_from('<79H', payload)
    assert 0x85f0+GAP < 0x10000, 'Extended near-code group must fit one segment'
    header_size = struct.unpack_from('<H', original, 8)[0]*16
    header = bytearray(original[:header_size])
    image = bytearray(original[header_size:])
    nreloc = struct.unpack_from('<H', header, 6)[0]
    table = struct.unpack_from('<H', header, 24)[0]
    original_image = bytes(image)
    reloc_locations = set()
    # Move every later segment and relocation location by exactly GAP bytes.
    kept_relocs = 0
    for i in range(nreloc):
        off, seg = struct.unpack_from('<HH', header, table+4*i)
        loc = seg*16+off
        if loc in (0x1df40,0xf2ee,0xb2da,0xb31e,0xb3aa,0xaba1):  # replaced far calls
            continue
        reloc_locations.add(loc)
        target = struct.unpack_from('<H', image, loc)[0]
        if target*16 >= INSERT:
            struct.pack_into('<H', image, loc, target+GAP//16)
        moved = loc + (GAP if loc >= INSERT else 0)
        struct.pack_into('<HH', header, table+4*kept_relocs, moved % 16, moved//16)
        kept_relocs += 1
    for at in (14, 22):  # SS and CS; SP and IP remain relative to the segment
        seg = struct.unpack_from('<H', header, at)[0]
        if seg*16 >= INSERT:
            struct.pack_into('<H', header, at, seg+GAP//16)
    hooks = [
        (0x10b75, 'e8d8fd', entries[76], 'synchronized direct touch velocity'),
        (0xab9e, '9ac4060e13', entries[54], 'offline seats before world update'),
        (0xabae, 'e81e07', entries[47], 'native pause entry'),
        (0xb2d7, '9abc060e13', entries[48], 'pause release at entry'),
        (0xb31b, '9a33010e13', entries[49], 'pause synchronized menu input'),
        (0xb3a7, '9abc060e13', entries[48], 'pause release at resume'),
        (0xaf76, 'e85702', entries[0], 'stage init'),
        (0xabe1, 'e8db5e', entries[1], 'player update'),
        (0xac18, 'e8e25f', entries[2], 'player render'),
        (0xcb5e, 'e8813c', entries[3], 'background invalidation'),
        (0x10bb0, 'ff169a44', entries[4], 'shot dispatch'),
        (0x10ab7, 'e887da', entries[12], 'last life / retirement'),
        (0xee71, 'c41e86ba26807f0b63772726fe470b', entries[13], 'score extend for survivors'),
        (0xabe4, 'e8cf58', entries[23], 'shared shots and independent lasers update'),
        (0xac15, 'e83a59', entries[24], 'shared shots and independent lasers render'),
        (0xcb61, 'e8e038', entries[25], 'shared shots and independent lasers invalidate'),
        (0x10704, '660fb7c7', entries[26], 'guest laser damage'),
        (0xaf90, 'e8a14f', entries[28], 'preload both Bomb characters'),
        (0xfffa, 'c606684301', entries[29], 'latch Bomb owner'),
        (0x105e3, '33ffc646f100', entries[70], 'reset hit ownership'),
        (0x1063f, '03f8fe064046', entries[71], 'record shot damage owner'),
        (0x1067b, '83c705803e5c1b00', entries[72], 'record Bomb damage owner'),
        (0x106b4, '83c703fe064046', entries[73], 'record first P1 laser'),
        (0x106e4, '83c703fe064046', entries[73], 'record second P1 laser'),
        (0xac07, 'e80056', entries[30], 'render owner Bomb resources'),
    ]
    for at, expected, entry, name in hooks:
        before = bytes.fromhex(expected)
        assert image[at:at+len(before)] == before, (name, image[at:at+len(before)].hex())
        displacement = (CS_BASE+entry-at-3) & 0xffff
        image[at:at+len(before)] = b'\xe8'+struct.pack('<H', displacement)+b'\x90'*(len(before)-3)
    # Boss and midboss damage sites only, not ordinary enemies or destructible
    # bullets. Existing far-call relocation records already target main_01.
    boss_sites = {0x1e5f9:42, 0x1b404:42,
                  0x1426b:43, 0x1e634:43}
    for at, index in boss_sites.items():
        assert original_image[at:at+5] == bytes.fromhex('9ac95aaf0a')
        assert at+3 in reloc_locations
        image[at:at+5] = b'\x9a'+struct.pack('<HH',entries[index],CS_BASE//16)
    # Marisa divides damage again after the common helper. Apply scaling
    # after that integer division, not before it (which loses weak hits).
    assert original_image[0x179cb:0x179ce] == bytes.fromhex('e80a6c')
    assert original_image[0x179df:0x179e6] == bytes.fromhex('2906d653a1d653')
    image[0x179df:0x179e6] = b'\x9a'+struct.pack('<HH',entries[44],CS_BASE//16)+b'\x90\x90'
    # Replace only the pickup predicate, retaining the original single item
    # update, award, sound, removal and velocity paths.
    at, end = 0x1df10, 0x1df37
    expected = bytes.fromhex('803e6a460075308b1e4e4681c3800129c381fb000377208b1e504681c3800129d381fb60027710')
    assert original_image[at:end] == expected
    predicate = b'\x9a'+struct.pack('<HH', entries[6], CS_BASE//16)
    predicate += b'\x73'+bytes([0x1df47-(at+7)])  # JNC original no-pickup path
    image[at:end] = predicate.ljust(end-at, b'\x90')
    extra_relocs = [at+3, CS_BASE+entries[8]+2, 0x179e2]
    pause_pointer_relocs = [CS_BASE+entries[i]+2 for i in (51,52,53,56)]
    extra_relocs += pause_pointer_relocs
    # Audited exhaustive list of original score-delta additions.
    # Register-valued awards use EAX. Immediate-valued awards MUST use their
    # constant-loading wrappers: EAX is unrelated at those sites and may cap
    # the score at 99,999,999. Clear wrappers also retain Bomb/world ownership.
    # Hooks replace the old shared accumulator write.
    score_sites={0x10708:(60,'6601065a43'),
        0x16d37:(66,'6681065a4300140000'),0x17f6d:(60,'6601065a43'),
        0x19f7f:(60,'6601065a43'),0x19fe9:(60,'6601065a43'),
        0x1a201:(67,'6681065a43b80b0000'),
        0x1c929:(63,'6683065a4364'),0x1c931:(64,'6683065a430a'),
        0x1cac0:(60,'6601065a43'),0x1cbc1:(60,'6601065a43'),
        0x1d801:(60,'6601065a43'),0x1da13:(60,'6601065a43'),
        0x1dda8:(60,'6601065a43')}
    for at,(index,expected) in score_sites.items():
        before=bytes.fromhex(expected)
        assert original_image[at:at+len(before)]==before,hex(at)
        image[at:at+len(before)]=b'\x9a'+struct.pack('<HH',entries[index],CS_BASE//16)+b'\x90'*(len(before)-5)
        extra_relocs.append(at+3)
    assert original_image[0x116c4:0x116c8]==bytes.fromhex('66a15a43')
    image[0x116c4:0x116c8]=b'\xe9'+struct.pack('<H',(CS_BASE+entries[59]-0x116c7)&0xffff)+b'\x90'
    for i in (51,52,53,56):
        struct.pack_into('<H',payload,entries[i]-0x85f0+2,0x130e+GAP//16)
    assert original_image[0xafa4:0xafa9] == bytes.fromhex('9a742a0000')
    image[0xafa4:0xafa9] = b'\x9a'+struct.pack('<HH',entries[21],CS_BASE//16)
    extra_relocs.append(CS_BASE+entries[22]+2)
    # Keep the original near award function in its original code segment,
    # bracketing it with far player-context switches. No second item update.
    assert original_image[0x1df37:0x1df45].hex() == '56e873fc6a0b9ad2070e13c60402'
    farcall = lambda entry: b'\x9a'+struct.pack('<HH', entry, CS_BASE//16)
    image[0x1df37:0x1df45] = (farcall(entries[9])+b'\x56\xe8'
        +struct.pack('<H',(0x1dbae-0x1df40)&0xffff)+farcall(entries[10]))
    extra_relocs += [0x1df3a,0x1df43,CS_BASE+entries[11]+2]
    struct.pack_into('<H',payload,entries[11]-0x85f0+2,0x130e+GAP//16)
    assert original_image[0x1d854:0x1d85c].hex() == 'c41e86ba26fe470d'
    image[0x1d854:0x1d85c] = farcall(entries[14])+b'\x90'*3
    extra_relocs.append(0x1d857)
    # These three routines only draw the old single-player resource HUD.
    for at in (0xeee8,0xefa1,0xf0a5):
        assert original_image[at] == 0x55
        image[at] = 0xcb  # RETF; all existing callers retain their convention
    # Free the resource rows without losing the original boss HP bar.
    # Move both visible and empty HP rendering to the old power area.
    for at,old,new in ((0xf11d,8,21),(0xf12e,9,22),
                       (0xf14e,8,21),(0xf161,9,22)):
        assert original_image[at] == old
        image[at] = new
    assert original_image[0xf2e8:0xf2f0].hex() == '68c1009a501b0000'
    image[0xf2e8:0xf2f0] = bytes.fromhex('83c408')+b'\x90'*5
    # Exact-version audited player-relative iatan2 call sites. Includes the
    # common regular bullet aim, boss aimed patterns and item attraction.
    aimed_calls = [0x1430b,0x14c63,0x14cb5,0x1509a,0x1519d,0x155c1,
                   0x16327,0x170e8,0x183fa,0x19744,0x1a1ad,0x1b9f8,
                   0x1bc54,0x1be9b,0x1bfce,0x1c0e2,0x1c76e,0x1d19d,
                   0x1deaf,0x1ed44,0x1f078,0x1fb2a,0x1fe3b,0x1ff86]
    for at in aimed_calls:
        assert original_image[at:at+5] == bytes.fromhex('9aa81d0000')
        assert b'\xa1\x50\x46' in original_image[at-18:at]
        assert b'\xa1\x4e\x46' in original_image[at-18:at]
        assert at+3 in reloc_locations
        image[at:at+5] = b'\x9a'+struct.pack('<HH', entries[7],CS_BASE//16)
    # Reuse existing aim-call relocation entries; add only the new item call
    # and the library tail pointer. The MZ header has verified spare capacity.
    assert table+4*(kept_relocs+len(extra_relocs)) <= header_size
    for i, loc in enumerate(extra_relocs):
        moved = loc if loc < INSERT else loc+GAP
        # Payload addresses already refer to the newly inserted code.
        if loc in (CS_BASE+entries[8]+2, CS_BASE+entries[11]+2, CS_BASE+entries[22]+2) or loc in pause_pointer_relocs:
            moved = loc
        struct.pack_into('<HH',header,table+4*(kept_relocs+i),moved%16,moved//16)
    struct.pack_into('<H',header,6,kept_relocs+len(extra_relocs))
    # Mixed characters retain another 52608-byte Bomb CDG, 2048-byte BB and
    # three BFT patterns. The original 320000-byte pool exhausts on stage 2;
    # unchecked resource loaders then write through segment 0, destroying IVT.
    # Share the old combined budget with the paragraph-aligned payload. The
    # three-player 12 KiB slot + unchanged heap exceeded the old budget by
    # 4 KiB, so game_init_main could fail before installing the vsync handler.
    assert original_image[0xab16:0xab1c] == bytes.fromhex('c7067239204e')
    struct.pack_into('<H', image, 0xab1a, HEAP_PARAS)
    image[INSERT:INSERT] = payload + bytes(GAP-len(payload))
    size = len(header)+len(image)
    struct.pack_into('<HH', header, 2, size%512, (size+511)//512)
    patched = bytes(header+image)
    (out/'MAIN.EXE').write_bytes(patched)
    report = {'original_md5': MD5, 'original_size': len(original), 'patched_size': size,
              'insert_image_offset': INSERT, 'insert_size': GAP, 'payload_size': len(payload),
              'heap_bytes': HEAP_PARAS*16,
              'payload_and_heap_bytes': EXTRA_AND_HEAP_BYTES,
              'payload_padding_bytes': GAP-len(payload),
              'mailbox_cs_offset': entries[5], 'relocations_rebased': nreloc,
              'native_pause_cs_offset': entries[50],
              'offline_mask_cs_offset': entries[55],
              'focus_visible_mask_cs_offset': entries[57],
              'personal_stats': {'cs_offset':entries[58],'stride':20,'players':3,
                  'bonus_cs_offset':entries[75],
                  'score':0,'high_score':4,'point':8,'dream_count':9,'dream':10,'graze':12,
                  'total_point':14,'max_point':16,'extends':18,'score_cap':99999999},
              'score_multiplier': {'2_players':1.5,'3_players':2.2},
              'score_award_hooks':list(score_sites),
              'power_pickup_multiplier': {'2_players':1.5,'3_players':2,'fraction_resource_offset':12},
              'loadout_cs_offset': entries[27],
              'loadout_file_offset': header_size+CS_BASE+entries[27],
              'bomb_owner_cs_offset': entries[31],
              'entry_count': len(entries),
              'touch_cs_offset': entries[77], 'touch_stride': 8,
              'touch_status_cs_offset': entries[78],
              'rescue_cs_offset': entries[36],
              'p3_input_cs_offset': entries[40], 'p3_motion_cs_offset': entries[41],
              'boss_damage_call_sites': list(boss_sites),
              'boss_resistance_hook':0x179df,
              'effective_boss_hp': {'2_players':1.5,'3_players':2.2,'method':'fractional damage scaling'},
              'aim_call_sites': aimed_calls, 'added_relocations': len(extra_relocs),
              'resource_schema': {'offset':609,'stride':16,'capacity':4,'players':2,
                                  'power_max':128,'lives_include_current':True,'players_max':3},
              'hooks': [{'image_offset':a,'original':b,'target_cs_offset':c,'name':d} for a,b,c,d in hooks],
              'sha256': hashlib.sha256(patched).hexdigest()}
    (ROOT/'reports/patch-manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    return patched

def build_disk(exe, *, copy_vendor=True):
    # Keep the local presentation in the game's original 16x16 gaiji font.
    font=assets(('gameft.bft',))['gameft.bft']
    assert struct.unpack_from('<4H',font,8)==(16,16,0,255) and font[5]==0
    first=32+struct.unpack_from('<H',font,28)[0]+0xa0*32
    digits=[list(font[first+n*32:first+(n+1)*32]) for n in range(10)]
    assert all(len(glyph)==32 for glyph in digits)
    (ROOT/'web/netplay/hud-digits.js').write_text(
        '// Generated from the original GAMEFT.bft; do not hand-edit.\n'
        +'export const hudDigits='+json.dumps(digits,separators=(',',':'))+';\n',encoding='utf-8')
    subprocess.run([str(ROOT/'tools/nasm-2.16.03/nasm.exe'), '-f','bin',
                    'patches/launch.asm','-o','build/COOP.COM'],check=True,cwd=ROOT)
    data = bytearray(gzip.decompress((ROOT/'baseline/4-jp.hdi.gz').read_bytes()))
    meta = json.loads((ROOT/'baseline/manifest.json').read_text(encoding='utf-8-sig'))
    assert hashlib.sha256(data).hexdigest() == meta['sha256']
    u16=lambda p: struct.unpack_from('<H',data,p)[0]
    u32=lambda p: struct.unpack_from('<I',data,p)[0]
    header, sector, spt, heads = (u32(p) for p in (8,16,20,24))
    part=header+sector
    base=header+((u16(part+10)*heads+data[part+9])*spt+data[part+8])*sector
    bps=u16(base+11)
    cluster_size=bps*data[base+13]
    fat=base+u16(base+14)*bps
    fat_size=u16(base+22)*bps
    copies=data[base+16]
    root=fat+fat_size*copies
    clusters=root+((u16(base+17)*32+bps-1)//bps)*bps
    count=(base+(u16(base+19) or u32(base+32))*bps-clusters)//cluster_size
    def nxt(c):
        val=u16(fat+c*3//2)
        return val>>4 if c&1 else val&0xfff
    def chain(c):
        seen=set()
        while 2<=c<0xff8:
            assert c not in seen and c<count+2
            seen.add(c)
            yield c
            c=nxt(c)
    def offset(c): return clusters+(c-2)*cluster_size
    def setfat(c,v):
        for copy in range(copies):
            at=fat+copy*fat_size+c*3//2
            old=u16(at)
            struct.pack_into('<H',data,at,(old&15)|(v<<4) if c&1 else (old&0xf000)|v)
    def find_entry(blocks,name):
        matches=[at for start,size in blocks for at in range(start,start+size,32)
                 if data[at:at+11]==name]
        assert len(matches)==1, (name,matches)
        return matches[0]
    folder=find_entry([(root,u16(base+17)*32)],b'GENSO      ')
    blocks=[(offset(c),cluster_size) for c in chain(u16(folder+26))]
    def write_file(name, content, create=False):
        if create:
            entry=next(at for start,size in blocks for at in range(start,start+size,32)
                       if data[at] in (0,0xe5))
            data[entry:entry+32]=bytes(32)
            data[entry:entry+11]=name
            data[entry+11]=0x20
            allocated=[]
        else:
            entry=find_entry(blocks,name)
            allocated=list(chain(u16(entry+26)))
        required=(len(content)+cluster_size-1)//cluster_size
        if len(allocated)>required:
            for c in allocated[required:]:setfat(c,0)
            allocated=allocated[:required]
        for c in range(2,count+2):
            if len(allocated)>=required:break
            if nxt(c)==0:allocated.append(c)
        assert len(allocated)==required
        for i,c in enumerate(allocated):
            setfat(c,allocated[i+1] if i+1<len(allocated) else 0xfff)
            data[offset(c):offset(c)+cluster_size]=content[i*cluster_size:(i+1)*cluster_size].ljust(cluster_size,b'\0')
        struct.pack_into('<H',data,entry+26,allocated[0])
        struct.pack_into('<I',data,entry+28,len(content))
        assert b''.join(data[offset(c):offset(c)+cluster_size] for c in chain(u16(entry+26)))[:len(content)]==content
        return allocated
    main_clusters=write_file(b'MAIN    EXE',exe)
    launcher=(ROOT/'build/COOP.COM').read_bytes()
    launch_clusters=write_file(b'COOP    COM',launcher,True)
    game=(ROOT/'extracted/GENSO/GAME.BAT').read_bytes()
    assert game.count(b'\nop\r\n')==5
    game=game.replace(b'\nop\r\n',b'\ncoop\r\nif errorlevel 1 goto fin\r\nmain\r\n')
    write_file(b'GAME    BAT',game)
    assert all(data[fat:fat+fat_size]==data[fat+i*fat_size:fat+(i+1)*fat_size] for i in range(copies))
    script=b'@ECHO OFF\r\nPATH A:\\DOS;A:\\\r\nSET TEMP=A:\\DOS\r\nSET DOSDIR=A:\\DOS\r\nA:\r\nCD \\GENSO\r\nCALL GAME.BAT\r\n'
    at=meta['autoexecOffset']
    data[at:at+meta['autoexecCapacity']]=script.ljust(meta['autoexecCapacity'],b'\0')
    struct.pack_into('<I',data,meta['autoexecSizeOffset'],len(script))
    web=ROOT/'web'
    web.mkdir(exist_ok=True)
    (web/'th04-coop.hdi.gz').write_bytes(gzip.compress(bytes(data),mtime=0))
    (web/'disk.json').write_text(json.dumps({'sha256':hashlib.sha256(data).hexdigest(),'size':len(data)}),encoding='utf-8')
    patch=json.loads((ROOT/'reports/patch-manifest.json').read_text(encoding='utf-8'))
    patch.update({'code_segment':CS_BASE//16,'data_segment':0x2134+patch['insert_size']//16})
    def disk_bytes(allocated,at):
        return [offset(allocated[(at+i)//cluster_size])+(at+i)%cluster_size for i in range(11)]
    patch['launch_config']={'schema':2,'defaults':[2,1,3,2,0,0,1,0,0,0,2],
        'targets':[disk_bytes(main_clusters,patch['loadout_file_offset']),
                   disk_bytes(launch_clusters,launcher.index(b'TH04WEBSTARTv1!')+len(b'TH04WEBSTARTv1!'))]}
    (web/'patch.json').write_text(json.dumps(patch,indent=2),encoding='utf-8')
    if not copy_vendor:
        print('Built',web/'th04-coop.hdi.gz','(existing emulator adapters preserved)')
        return
    vendor=web/'vendor/np2'
    vendor.mkdir(parents=True,exist_ok=True)
    for name in ['np2-wasm.js','np21.js','np21.wasm','font.bmp','LICENSE','NOTICE.md']:
        shutil.copy2(ROOT.parent/'np2/vendor/np2'/name,vendor/name)
    js=(vendor/'np21.js').read_text(encoding='utf-8')
    needle='JSEvents.lastGamepadState=navigator.getGamepads()'
    assert js.count(needle)==1
    # App owns physical gamepad input; SDL must not also deliver it to P1.
    js=js.replace(needle,'JSEvents.lastGamepadState=[]')
    (vendor/'np21.js').write_text(js,encoding='utf-8')
    print('Built',web/'th04-coop.hdi.gz')

if __name__=='__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keep-vendor', action='store_true',
                        help='Rebuild the game disk without overwriting existing emulator adapters')
    args = parser.parse_args()
    build_disk(build_exe(), copy_vendor=not args.keep_vendor)
