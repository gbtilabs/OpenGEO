"""Keep the optional signing-file reader bounded and independent of package acceptance."""
from pathlib import Path
import base64
import hashlib
import io
import sys
import tarfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
from inspect_release_metadata import metadata_member


class SigningFileInspection(unittest.TestCase):
    path = 'payload/OpenGEO.app/Contents/_CodeSignature/CodeResources'
    data = b'synthetic resource metadata'

    def archive(self, *, duplicates=False, link=False):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as package:
            for _ in range(2 if duplicates else 1):
                member = tarfile.TarInfo(self.path)
                member.mode = 0o644
                if link:
                    member.type, member.linkname = tarfile.SYMTYPE, 'elsewhere'
                    package.addfile(member)
                else:
                    member.size = len(self.data)
                    package.addfile(member, io.BytesIO(self.data))
        stream.seek(0)
        return tarfile.open(fileobj=stream)

    def expected(self):
        return {'kind': 'file', 'mode': 0o644, 'bytes': len(self.data), 'sha256': hashlib.sha256(self.data).hexdigest()}

    def test_exact_bytes_are_read_without_extraction(self):
        with self.archive() as package:
            record = metadata_member(package, self.path, self.expected())
            self.assertEqual(base64.b64decode(record['base64']), self.data)
            self.assertEqual(record['sha256'], self.expected()['sha256'])

    def test_duplicate_and_link_members_are_refused(self):
        for options in [{'duplicates': True}, {'link': True}]:
            with self.subTest(options=options), self.archive(**options) as package:
                with self.assertRaises(AssertionError):
                    metadata_member(package, self.path, self.expected())

    def test_changed_hash_mode_and_size_are_refused(self):
        for key, value in [('sha256', '0' * 64), ('mode', 0o777), ('bytes', 1_000_001)]:
            with self.subTest(key=key), self.archive() as package:
                with self.assertRaises(AssertionError):
                    metadata_member(package, self.path, {**self.expected(), key: value})

    def test_parent_and_unrelated_paths_are_refused(self):
        for path in ['payload/OpenGEO.app/../_CodeSignature/CodeResources', 'payload/other/_CodeSignature/CodeResources']:
            with self.subTest(path=path), self.archive() as package:
                with self.assertRaises(AssertionError):
                    metadata_member(package, path, self.expected())


if __name__ == '__main__':
    unittest.main()
