"""Prove scoped native Keychain consent before building any release installer."""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == 'darwin' and os.environ.get('GITHUB_ACTIONS') == 'true', 'Requires an owned native Mac release runner')
class KeychainConsent(unittest.TestCase):
    def test_two_reviewed_clients_decrypt_and_an_unlisted_client_is_refused(self):
        assert os.environ['GITHUB_REPOSITORY'] == 'surfacedby/OpenGEO' and os.environ['RUNNER_OS'] == 'macOS'
        temporary = Path(os.environ['RUNNER_TEMP']).resolve()
        directory = Path(tempfile.mkdtemp(prefix='release-macos-unit-', dir=temporary))
        controller = temporary / 'opengeo-keychain-fixture'
        self.assertTrue(controller.is_file())
        clients = [directory / ('client-' + str(number)) for number in [1, 2, 3]]
        try:
            for number, client in enumerate(clients, 1):
                subprocess.run(['clang', '-fobjc-arc', '-DCLIENT_ID=' + str(number), '-framework', 'Foundation', '-framework', 'Security', 'tests/mac-keychain-client.m', '-o', str(client)], check=True, timeout=30)
                subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(client)], check=True, timeout=30)
            subprocess.run([str(controller), 'setup', str(directory), str(clients[0]), str(clients[1])], check=True, timeout=30)
            results = [subprocess.run([str(client), str(directory)], capture_output=True, text=True, timeout=10) for client in clients]
            self.assertEqual([row.returncode for row in results], [0, 0, 77], [(row.returncode, row.stdout, row.stderr) for row in results])
            values = [json.loads(row.stdout) for row in results]
            self.assertEqual([row['client'] for row in values], [1, 2, 3])
            self.assertRegex(values[0]['secretSha256'], r'^[0-9a-f]{64}$')
            self.assertEqual(values[0]['secretSha256'], values[1]['secretSha256'])
            self.assertNotIn('secretSha256', values[2])
            consent = json.loads((directory / 'keychain-consent.json').read_text())
            self.assertEqual(len(set(consent['partitionCodeIdentities'])), 2)
            self.assertTrue(all(re.fullmatch('cdhash:[0-9a-f]{40}', value) for value in consent['partitionCodeIdentities']))
            self.assertTrue(consent['unlistedClientDenied'])
            self.assertTrue(consent['protectedKeychainFormat'])
        finally:
            if (directory / 'keychain-state.json').exists():
                subprocess.run([str(controller), 'cleanup', str(directory)], check=True, timeout=30)
                self.assertEqual(json.loads((directory / 'keychain-cleanup.json').read_text()), {'originalDefaultAndSearchRestored': True, 'ownedKeychainRemoved': True})
            self.assertEqual(directory.parent, temporary)
            shutil.rmtree(directory)


if __name__ == '__main__':
    unittest.main()
