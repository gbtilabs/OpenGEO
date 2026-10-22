"""Compare every installed vendor file with pinned official distribution bytes."""
from pathlib import Path
import hashlib
import json
import os
import stat
import struct
import sys
import zipfile
from release_files import digest, download_public
from release_macho import sections, without_signing_record


def pe_sections(data):
    """Expose PE resource-only branding changes without treating code changes as branding."""
    if data[:2] != b'MZ':
        return None
    at = struct.unpack_from('<I', data, 0x3c)[0]
    assert data[at:at + 4] == b'PE\0\0'
    count = struct.unpack_from('<H', data, at + 6)[0]
    optional = struct.unpack_from('<H', data, at + 20)[0]
    assert 0 < count < 97
    table = at + 24 + optional
    assert table + count * 40 <= len(data)
    result = {}
    for index in range(count):
        row = table + index * 40
        name = data[row:row + 8].rstrip(b'\0').decode('ascii')
        size, offset = struct.unpack_from('<II', data, row + 16)
        assert offset + size <= len(data) and name not in result
        result[name] = hashlib.sha256(data[offset:offset + size]).hexdigest()
    return result

payload, output = map(Path, sys.argv[1:3])
target = os.environ['REVIEW_TARGET']
mac = target.startswith('macos-')
pins = json.loads(Path('scripts/release-vendors.json').read_text())[target]
matches, differences, links = {}, [], []
signatures = output / 'signatures'
signatures.mkdir()
archives = []
for kind, url, expected in pins:
    archive = output / (kind + '.zip')
    download_public(url, archive, expected)
    archives.append({'kind': kind, 'url': url, 'sha256': expected})
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            if member.is_dir():
                continue
            name = member.filename
            if kind == 'electron':
                if mac:
                    if not name.startswith('Electron.app/'):
                        continue
                    relative = name.replace('Electron.app/', 'OpenGEO.app/', 1).replace('/Electron Helper', '/OpenGEO Helper').replace('/Contents/MacOS/Electron', '/Contents/MacOS/OpenGEO')
                else:
                    relative = 'OpenGEO.exe' if name == 'electron.exe' else name
            else:
                relative = ('OpenGEO.app/Contents/Resources/' if mac else 'resources/') + 'browsers/' + kind + '/' + name
            shipped = payload / relative
            if not shipped.exists():
                continue
            before = package.read(member)
            if stat.S_ISLNK(member.external_attr >> 16):
                assert shipped.is_symlink() and os.readlink(shipped) == before.decode().replace('Electron Helper', 'OpenGEO Helper')
                links.append(relative)
                continue
            assert shipped.is_file() and not shipped.is_symlink()
            value = digest(shipped)
            original = hashlib.sha256(before).hexdigest()
            method = None
            if value == original:
                method = 'exact-official-file'
            elif mac and sections(before) is not None:
                actual = shipped.read_bytes()
                if sections(actual) == sections(before) and without_signing_record(actual)[0] == without_signing_record(before)[0]:
                    method = 'all-sections-and-all-nonsignature-bytes-equal'
                    for blob in without_signing_record(actual)[1]:
                        (signatures / (hashlib.sha256(blob).hexdigest() + '.bin')).write_bytes(blob)
            row = {'path': relative, 'sha256': value, 'upstreamSha256': original, 'archiveSha256': expected}
            if method:
                matches[relative] = {**row, 'method': method}
            else:
                if not mac and name == 'electron.exe':
                    old_sections = pe_sections(before)
                    new_sections = pe_sections(shipped.read_bytes())
                    row['upstreamSections'] = old_sections
                    row['packagedSections'] = new_sections
                    row['nonResourceSectionsEqual'] = {k: v for k, v in old_sections.items() if k != '.rsrc'} == {k: v for k, v in new_sections.items() if k != '.rsrc'}
                differences.append(row)
    archive.unlink()
report = {'target': target, 'archives': archives, 'matches': matches, 'links': links, 'differencesRequireReview': differences, 'publicationApproved': False}
(output / 'vendor-provenance.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'vendorFiles': len(matches), 'differencesRequiringReview': len(differences)}))
