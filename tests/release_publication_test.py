"""Exercise draft discovery and actual Git boundaries before spending release runners."""
from pathlib import Path
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
spec = importlib.util.spec_from_file_location('release_review', Path(__file__).resolve().parent.parent / 'scripts/release-review.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class DraftDiscovery(unittest.TestCase):
    def test_draft_on_later_page_is_read_by_id(self):
        first = [{'tag_name': 'older-' + str(i), 'id': i} for i in range(100)]
        draft = {'tag_name': 'v1-beta', 'id': 101, 'draft': True}
        with patch.object(review, 'api', side_effect=[first, [draft], draft]) as api:
            self.assertEqual(review.release_for_tag('v1-beta'), draft)
            self.assertEqual(api.call_args_list[-1].args, ('repos/surfacedby/OpenGEO/releases/101',))

    def test_missing_duplicate_and_changed_id_are_refused(self):
        row = {'tag_name': 'v1-beta', 'id': 1}
        for responses in [[[]], [[row, row]], [[row], {**row, 'id': 2}]]:
            with self.subTest(responses=responses), patch.object(review, 'api', side_effect=responses):
                with self.assertRaises(AssertionError):
                    review.release_for_tag('v1-beta')


class SourceBoundary(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original = Path.cwd()
        os.chdir(self.directory.name)
        self.git('init', '--quiet')
        self.git('config', 'user.name', 'Release test')
        self.git('config', 'user.email', 'release-test@example.invalid')
        Path('package.json').write_text('{}')
        self.commit('original source')
        self.source = self.git('rev-parse', 'HEAD')

    def tearDown(self):
        os.chdir(self.original)
        # Git creates read-only loose objects on Windows; retain its native cleanup.
        if os.name == 'nt':
            for path in Path(self.directory.name).rglob('*'):
                if path.is_file():
                    path.chmod(0o600)
        self.directory.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', *args], text=True, stderr=subprocess.PIPE).strip()

    def commit(self, message):
        self.git('add', '--all')
        self.git('commit', '--quiet', '-m', message)

    def verify(self, remote=None):
        with patch.object(review, 'api', return_value={'object': {'sha': remote or self.git('rev-parse', 'HEAD')}}):
            return review.publication_tree(self.source)

    def test_exact_source_and_publisher_only_extension_are_accepted(self):
        self.assertEqual(self.verify(), self.source)
        Path('scripts').mkdir()
        Path('scripts/release-review.py').write_text('publisher repair')
        self.commit('publisher only')
        self.assertEqual(self.verify(), self.git('rev-parse', 'HEAD'))

    def test_application_change_dirty_tree_and_remote_drift_are_refused(self):
        Path('untracked.txt').write_text('not qualified')
        with self.assertRaises(AssertionError):
            self.verify()
        Path('untracked.txt').unlink()
        with self.assertRaises(AssertionError):
            self.verify('0' * 40)
        Path('package.json').write_text('{"changed":true}')
        self.commit('application change')
        with self.assertRaises(AssertionError):
            self.verify()


if __name__ == '__main__':
    unittest.main()
