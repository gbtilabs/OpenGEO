"""Exercise release transport boundaries independently of GitHub or application fixtures."""
from pathlib import Path
import io
import os
import struct
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
from release_files import extract_bundle, inventory
from release_macho import sections, without_signing_record


class ArchiveBoundary(unittest.TestCase):
    def archive(self, root, entries):
        path = root / 'candidate.tar'
        with tarfile.open(path, 'w') as archive:
            for name, kind, content in entries:
                member = tarfile.TarInfo(name)
                member.mode = 0o644
                if kind == 'link':
                    member.type = tarfile.SYMTYPE
                    member.linkname = content
                    archive.addfile(member)
                else:
                    member.size = len(content)
                    archive.addfile(member, io.BytesIO(content))
        return path

    def test_reject_traversal_duplicate_and_escaping_links(self):
        for entries in [[('../outside', 'file', b'bad')], [('/outside', 'file', b'bad')],
                        [('same', 'file', b'1'), ('same', 'file', b'2')], [('escape', 'link', '../outside')]]:
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                with self.assertRaises(AssertionError):
                    extract_bundle(self.archive(root, entries), root / 'payload')
                self.assertFalse((root / 'outside').exists())

    @unittest.skipIf(os.name == 'nt', 'Unix framework aliases are exercised on Mac and Linux runners')
    def test_contained_alias_preserves_bytes_and_modes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = extract_bundle(self.archive(root, [('physical/file', 'file', b'audited'), ('alias', 'link', 'physical')]), root / 'payload')
            result = inventory(payload)
            self.assertEqual(result['alias']['target'], 'physical')
            self.assertEqual(result['physical/file']['mode'], 0o644)
            self.assertEqual((payload / 'alias/file').read_bytes(), b'audited')


class NativeComparison(unittest.TestCase):
    def image(self, signature=b'signature', body=b'code'):
        header = struct.pack('<8I', 0xfeedfacf, 0x1000007, 3, 6, 1, 16, 0, 0)
        command = struct.pack('<4I', 0x1d, 16, 64, len(signature))
        return header + command + body.ljust(16, b'\0') + signature

    def test_only_signature_bytes_are_replaceable(self):
        original = self.image()
        resigned = self.image(b'different signing bytes')
        self.assertEqual(without_signing_record(original)[0], without_signing_record(resigned)[0])
        self.assertNotEqual(without_signing_record(original)[0], without_signing_record(self.image(body=b'evil'))[0])
        self.assertEqual(sections(original), {})
        with self.assertRaises((AssertionError, struct.error)):
            without_signing_record(original[:30])
        malformed = bytearray(original)
        struct.pack_into('<I', malformed, 40, len(original) + 100)
        with self.assertRaises(AssertionError):
            without_signing_record(malformed)


if __name__ == '__main__':
    unittest.main()
