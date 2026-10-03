"""Expose native mutable globals without changing any WASM instructions.

Static binary transformation only: no WebAssembly instantiation or execution.
The verified module has fixed memory/table limits and two i32 mutable globals.
"""
from pathlib import Path
import hashlib


def leb(value):
    out = bytearray()
    while True:
        byte = value & 127
        value >>= 7
        out.append(byte | (128 if value else 0))
        if not value:
            return bytes(out)


def read_leb(data, at):
    value = shift = 0
    while True:
        byte = data[at]
        at += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, at
        shift += 7
        assert shift < 35


def build(vendor):
    original = (vendor/'np21.wasm').read_bytes()
    assert hashlib.sha256(original).hexdigest() == 'd64bbe39549a48686b1ed04fbadec68d8b33643d220395a9c09b8d54834f36e4', 'Unaudited NP21 binary'
    assert original[:8] == b'\0asm\x01\0\0\0'
    sections = []
    at = 8
    while at < len(original):
        kind = original[at]
        size, start = read_leb(original, at+1)
        end = start+size
        assert end <= len(original)
        sections.append((kind, original[start:end]))
        at = end
    section = dict(sections)
    assert section[4] == bytes.fromhex('017001c411c411'), 'Table layout changed'
    assert section[5] == bytes.fromhex('0101c802c802'), 'Fixed 328-page memory changed'
    assert section[6] == bytes.fromhex('027f0141f0e29d020b7f0141000b'), 'Native globals changed'
    # Reject global/memory/table imports: their indices would shift our exports.
    imports, pos = read_leb(section[2], 0)
    for _ in range(imports):
        for _ in range(2):
            size, pos = read_leb(section[2], pos)
            pos += size
        assert section[2][pos] == 0, 'Unexpected non-function import'
        _, pos = read_leb(section[2], pos+1)
    count, pos = read_leb(section[7], 0)
    exports = bytearray(leb(count+2) + section[7][pos:])
    for index in range(2):
        name = f'__rollback_g{index}'.encode()
        assert name not in original
        exports += leb(len(name)) + name + b'\x03' + leb(index)
    result = bytearray(original[:8])
    for kind, body in sections:
        if kind == 7:
            body = exports
        result += bytes([kind]) + leb(len(body)) + body
    result = bytes(result)
    (vendor/'np21-rollback.wasm').write_bytes(result)
    return {'source_sha256':hashlib.sha256(original).hexdigest(),
            'sha256':hashlib.sha256(result).hexdigest(),
            'memory_bytes':328*65536, 'globals':2, 'table_entries':2244}


if __name__ == '__main__':
    print(build(Path(__file__).resolve().parents[1]/'web/vendor/np2'))
