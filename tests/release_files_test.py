"""Exercise release transport boundaries independently of GitHub or application fixtures."""
from pathlib import Path
import io
import copy
import hashlib
import os
import struct
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
from release_files import extract_bundle, inventory, verify_bundle_inventory
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


class NativeInventoryTransport(unittest.TestCase):
    def write_archive(self, path, *, link_mode=0o755, link_target='physical/file'):
        with tarfile.open(path, 'w') as package:
            for name, kind, content in [('payload', 'directory', None), ('payload/physical', 'directory', None),
                                        ('payload/physical/file', 'file', b'audited'), ('payload/physical/other', 'file', b'other'),
                                        ('payload/alias', 'symlink', link_target)]:
                member = tarfile.TarInfo(name)
                member.mode = 0o755 if kind == 'directory' else link_mode if kind == 'symlink' else 0o644
                if kind == 'directory':
                    member.type = tarfile.DIRTYPE
                    package.addfile(member)
                elif kind == 'symlink':
                    member.type = tarfile.SYMTYPE
                    member.linkname = content
                    package.addfile(member)
                else:
                    member.size = len(content)
                    package.addfile(member, io.BytesIO(content))

    def native_inventory(self):
        return {'physical': {'kind': 'directory', 'mode': 0o755},
                'physical/file': {'kind': 'file', 'mode': 0o644, 'bytes': 7, 'sha256': hashlib.sha256(b'audited').hexdigest()},
                'physical/other': {'kind': 'file', 'mode': 0o644, 'bytes': 5, 'sha256': hashlib.sha256(b'other').hexdigest()},
                'alias': {'kind': 'symlink', 'mode': 0o755, 'target': 'physical/file'}}

    def test_regular_file_data_and_archive_modes_are_exact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            mode = 0o666 if os.name == 'nt' else 0o644
            archive = root / 'candidate.tar'
            def write(path, header_mode):
                with tarfile.open(path, 'w') as package:
                    member = tarfile.TarInfo('payload/only')
                    member.mode, member.size = header_mode, 7
                    package.addfile(member, io.BytesIO(b'audited'))
            write(archive, mode)
            payload = extract_bundle(archive, root / 'restored') / 'payload'
            native = {'only': {'kind': 'file', 'mode': mode, 'bytes': 7, 'sha256': hashlib.sha256(b'audited').hexdigest()}}
            original = copy.deepcopy(native)
            proof = verify_bundle_inventory(archive, payload, native, 'win32')
            self.assertEqual(proof['symlinkModeTranslations'], [])
            self.assertEqual(native, original)
            (payload / 'only').write_bytes(b'tamperd')
            with self.assertRaises(AssertionError):
                verify_bundle_inventory(archive, payload, native, 'win32')
            (payload / 'only').write_bytes(b'audited')
            forged = root / 'forged.tar'
            write(forged, mode ^ 0o100)
            with self.assertRaises(AssertionError):
                verify_bundle_inventory(forged, payload, native, 'win32')

    @unittest.skipIf(os.name == 'nt', 'Requires actual Unix symlinks')
    def test_native_mac_link_mode_remains_verified_in_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'candidate.tar'
            self.write_archive(archive)
            payload = extract_bundle(archive, root / 'restored') / 'payload'
            native = self.native_inventory()
            original = copy.deepcopy(native)
            proof = verify_bundle_inventory(archive, payload, native, 'darwin')
            self.assertTrue(proof['allArchiveHeaderModesVerified'])
            self.assertTrue(proof['allNativeFilesAndDirectoriesExact'])
            if sys.platform == 'linux':
                self.assertEqual(proof['symlinkModeTranslations'], [{'path': 'alias', 'nativeAndArchiveMode': 0o755, 'restoredLinuxMode': 0o777, 'target': 'physical/file'}])
            else:
                self.assertEqual(proof['symlinkModeTranslations'], [])
            self.assertEqual(native, original)

    @unittest.skipIf(os.name == 'nt', 'Requires actual Unix symlinks')
    def test_native_header_mode_and_link_target_cannot_be_changed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'candidate.tar'
            self.write_archive(archive)
            payload = extract_bundle(archive, root / 'restored') / 'payload'
            for mode, target in [(0o777, 'physical/file'), (0o755, 'physical/other')]:
                with self.subTest(mode=mode, target=target):
                    forged = root / 'forged.tar'
                    self.write_archive(forged, link_mode=mode, link_target=target)
                    with self.assertRaises(AssertionError):
                        verify_bundle_inventory(forged, payload, self.native_inventory(), 'darwin')

    @unittest.skipIf(os.name == 'nt', 'Requires actual Unix modes and symlinks')
    def test_restored_file_mode_link_target_and_path_set_stay_exact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'candidate.tar'
            self.write_archive(archive)
            payload = extract_bundle(archive, root / 'restored') / 'payload'
            alias = payload / 'alias'
            alias.unlink()
            alias.symlink_to('physical/other')
            with self.assertRaises(AssertionError):
                verify_bundle_inventory(archive, payload, self.native_inventory(), 'darwin')
            alias.unlink()
            alias.symlink_to('physical/file')
            (payload / 'physical/file').chmod(0o600)
            with self.assertRaises(AssertionError):
                verify_bundle_inventory(archive, payload, self.native_inventory(), 'darwin')
            (payload / 'physical/file').chmod(0o644)
            (payload / 'extra').write_bytes(b'unrecorded')
            with self.assertRaises(AssertionError):
                verify_bundle_inventory(archive, payload, self.native_inventory(), 'darwin')


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
