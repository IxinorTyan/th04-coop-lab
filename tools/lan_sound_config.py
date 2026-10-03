"""Locate native sound settings in the verified disk, without changing it."""
import gzip
import hashlib
import json
import struct


def native_sound_config(root):
    web = root/'web'
    data = gzip.decompress((web/'th04-coop.hdi.gz').read_bytes())
    meta = json.loads((web/'disk.json').read_text(encoding='utf-8'))
    assert hashlib.sha256(data).hexdigest() == meta['sha256']
    u16 = lambda p: struct.unpack_from('<H', data, p)[0]
    u32 = lambda p: struct.unpack_from('<I', data, p)[0]
    header, sector, spt, heads = (u32(p) for p in (8, 16, 20, 24))
    part = header+sector
    base = header+((u16(part+10)*heads+data[part+9])*spt+data[part+8])*sector
    bps = u16(base+11)
    cluster_size = bps*data[base+13]
    fat = base+u16(base+14)*bps
    directory = fat+data[base+16]*u16(base+22)*bps
    clusters = directory+((u16(base+17)*32+bps-1)//bps)*bps

    def chain(c):
        seen = set()
        while 2 <= c < 0xff8:
            assert c not in seen and c < 0xff0
            seen.add(c)
            at = clusters+(c-2)*cluster_size
            assert at+cluster_size <= len(data)
            yield at
            value = u16(fat+c*3//2)
            c = value >> 4 if c & 1 else value & 0xfff

    def find(blocks, name):
        found = [at for start, size in blocks for at in range(start, start+size, 32)
                 if data[at:at+11] == name]
        assert len(found) == 1, (name, found)
        return found[0]

    folder = find([(directory, u16(base+17)*32)], b'GENSO      ')
    entry = find([(at, cluster_size) for at in chain(u16(folder+26))], b'MIKO    CFG')
    assert u32(entry+28) == 10
    at = next(chain(u16(entry+26)))
    # launch.asm copies cfg[3] to resident BGM mode and cfg[4] to SE mode.
    # Native snd_determine_modes retains FM effects before applying BGM OFF.
    assert data[at+3] in (0, 1, 2, 3) and data[at+4] in (0, 1, 2)
    options = list(data[at:at+6])
    assert sum(options) & 255 == data[at+9], 'Original MIKO.CFG checksum invalid'
    options[3:5] = [0, 1]
    edits = [{'targets': [at+3, at+4, at+9],
              'expected': [data[at+3], data[at+4], data[at+9]],
              'values': [0, 1, sum(options) & 255]}]

    main = find([(p, cluster_size) for p in chain(u16(folder+26))], b'MAIN    EXE')
    parts = list(chain(u16(main+26)))
    image = b''.join(data[p:p+cluster_size] for p in parts)[:u32(main+28)]
    patch = json.loads((web/'patch.json').read_text(encoding='utf-8'))
    assert image[:2] == b'MZ'
    image_start = struct.unpack_from('<H', image, 8)[0]*16
    gap = patch['insert_size']
    assert isinstance(gap,int) and gap > 0 and gap % 16 == 0
    assert patch['payload_size'] <= gap and 0x85f0+gap < 0x10000
    assert patch['data_segment'] == 0x2134+gap//16
    # MAIN snd_load copies the current name to DS:3964 before returning for
    # BGM OFF. Its OFF extension pointer (SND_LOAD_EXT[0], DS:08F8..08FB)
    # is unreachable in that mode, so use those four bytes as seq/command.
    anchors = {
        0x134a6: '88846439',  # snd_load_fn copy
        0x134fe: '803ef508007476',  # native BGM OFF load bypass
        0x13517: 'c49ff808',  # extension table base
    }
    for pos, hex_bytes in anchors.items():
        expected = bytes.fromhex(hex_bytes)
        assert image[image_start+gap+pos:image_start+gap+pos+len(expected)] == expected
    offset = image_start+gap+0x133df
    expected = bytes.fromhex('803ef5080074108b4606803ef508037404cd60eb02cd61')
    # Preserve incoming AX just like the original BGM OFF path; capture only
    # play/stop/fade/set-volume. Queries remain no-ops. SE uses a separate path.
    replacement = bytes.fromhex('508b460680fc02760580fc197507a3fa08ff06f8085890')
    assert len(replacement) == len(expected) == 23
    assert image[offset:offset+len(expected)] == expected
    edits.append({'targets': [parts[(offset+i)//cluster_size]+(offset+i)%cluster_size for i in range(len(expected))],
                  'expected': list(expected), 'values': list(replacement)})
    return {'disk_sha256': meta['sha256'], 'bgm': 0, 'se': 1, 'schema': 2,
            'edits': edits, 'observer': {'bgm_mode': 0x8f5, 'se_mode': 0x8f4,
              'filename': 0x3964, 'sequence': 0x8f8, 'command': 0x8fa}}
