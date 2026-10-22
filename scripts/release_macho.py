"""Compare runtime code sections independently of replaceable Mac signing records."""
import hashlib
import struct


def sections(data):
    magic = data[:4]
    if magic in [b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf', b'\xbe\xba\xfe\xca', b'\xbf\xba\xfe\xca']:
        endian = '>' if magic[:2] == b'\xca\xfe' else '<'
        wide = magic in [b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca']
        count = struct.unpack_from(endian + 'I', data, 4)[0]
        assert 0 < count < 33
        result = {}
        for index in range(count):
            offset = 8 + index * (32 if wide else 20)
            cpu, subtype, start, size = struct.unpack_from(endian + ('IIQQ' if wide else 'IIII'), data, offset)
            assert start + size <= len(data)
            inner = sections(data[start:start + size])
            assert inner
            for name, value in inner.items():
                key = str(cpu) + ':' + str(subtype) + '/' + name
                assert key not in result
                result[key] = value
        return result
    if magic not in [b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xfe\xed\xfa\xce']:
        return None
    endian = '<' if magic[-2:] == b'\xed\xfe' else '>'
    wide = magic in [b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf']
    count, command_bytes = struct.unpack_from(endian + 'II', data, 16)
    cursor = 32 if wide else 28
    end = cursor + command_bytes
    assert end <= len(data)
    result = {}
    for _ in range(count):
        command, size = struct.unpack_from(endian + 'II', data, cursor)
        assert size >= 8 and cursor + size <= end
        if command in [0x19, 0x1]:
            is64 = command == 0x19
            segment = data[cursor + 8:cursor + 24].split(b'\0')[0].decode()
            nsects = struct.unpack_from(endian + 'I', data, cursor + (64 if is64 else 48))[0]
            first = cursor + (72 if is64 else 56)
            width = 80 if is64 else 68
            assert first + nsects * width <= cursor + size
            for n in range(nsects):
                at = first + n * width
                section = data[at:at + 16].split(b'\0')[0].decode()
                length = struct.unpack_from(endian + ('Q' if is64 else 'I'), data, at + (40 if is64 else 36))[0]
                start = struct.unpack_from(endian + 'I', data, at + (48 if is64 else 40))[0]
                flags = struct.unpack_from(endian + 'I', data, at + (64 if is64 else 56))[0]
                if flags & 0xff in [1, 0xc, 0x12]:
                    value = {'bytes': length, 'zero_fill': True}
                else:
                    assert start + length <= len(data)
                    value = {'bytes': length, 'sha256': hashlib.sha256(data[start:start + length]).hexdigest()}
                key = segment + '/' + section
                assert key not in result
                result[key] = value
        cursor += size
    assert cursor == end
    return result


def without_signing_record(data):
    """Keep all executable and metadata bytes except the replaceable signature and its size fields."""
    magic = data[:4]
    if magic in [b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf', b'\xbe\xba\xfe\xca', b'\xbf\xba\xfe\xca']:
        endian = '>' if magic[:2] == b'\xca\xfe' else '<'
        wide = magic in [b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca']
        count = struct.unpack_from(endian + 'I', data, 4)[0]
        assert 0 < count < 33
        result = {}
        signatures = []
        regions = []
        for index in range(count):
            offset = 8 + index * (32 if wide else 20)
            cpu, subtype, start, size = struct.unpack_from(endian + ('IIQQ' if wide else 'IIII'), data, offset)
            assert start + size <= len(data)
            inner, blobs = without_signing_record(data[start:start + size])
            result[str(cpu) + ':' + str(subtype)] = inner
            signatures.extend(blobs)
            regions.append((start, start + size))
        cursor = 8 + count * (32 if wide else 20)
        for start, end in sorted(regions):
            assert start >= cursor and not any(data[cursor:start])
            cursor = end
        assert not any(data[cursor:])
        return result, signatures
    assert magic in [b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xfe\xed\xfa\xce']
    endian = '<' if magic[-2:] == b'\xed\xfe' else '>'
    wide = magic in [b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf']
    count, command_bytes = struct.unpack_from(endian + 'II', data, 16)
    cursor = 32 if wide else 28
    end = cursor + command_bytes
    mutable = bytearray(data)
    signature = None
    for _ in range(count):
        command, size = struct.unpack_from(endian + 'II', data, cursor)
        assert size >= 8 and cursor + size <= end
        if command == 0x1d:
            assert signature is None and size == 16
            start, length = struct.unpack_from(endian + 'II', data, cursor + 8)
            assert start >= end and start + length <= len(data)
            signature = (start, length)
            mutable[cursor:cursor + 16] = bytes(16)
        elif command in [0x19, 0x1] and data[cursor + 8:cursor + 24].split(b'\0')[0] == b'__LINKEDIT':
            for offset, width in ([(32, 8), (48, 8)] if command == 0x19 else [(28, 4), (36, 4)]):
                mutable[cursor + offset:cursor + offset + width] = bytes(width)
        cursor += size
    assert cursor == end
    if signature is None:
        start, length = len(data), 0
    else:
        struct.pack_into(endian + 'II', mutable, 16, count - 1, command_bytes - 16)
        start, length = signature
        assert not any(data[start + length:])
    stable = bytes(mutable[:start]).rstrip(b'\0')
    return {'non_signature_sha256': hashlib.sha256(stable).hexdigest(), 'non_signature_bytes_without_alignment': len(stable)}, [data[start:start + length]] if length else []
