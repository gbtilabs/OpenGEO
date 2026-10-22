"""Prove scoped native Keychain consent before building any release installer."""
from pathlib import Path
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == 'darwin' and os.environ.get('GITHUB_ACTIONS') == 'true', 'Requires an owned native Mac release runner')
class KeychainConsent(unittest.TestCase):
    def test_two_reviewed_clients_decrypt_and_an_unlisted_client_is_refused(self):
        self.check_clients(bundled=False)

    def test_bundle_replacement_uses_the_same_secitem_query_as_chromium(self):
        self.check_clients(bundled=True)

    def check_clients(self, *, bundled):
        assert os.environ['GITHUB_REPOSITORY'] == 'surfacedby/OpenGEO' and os.environ['RUNNER_OS'] == 'macOS'
        temporary = Path(os.environ['RUNNER_TEMP']).resolve()
        directory = Path(tempfile.mkdtemp(prefix='release-macos-unit-', dir=temporary))
        controller = temporary / 'opengeo-keychain-fixture'
        self.assertTrue(controller.is_file())
        clients = [directory / ('client-' + str(number) + ('.app' if bundled else '')) for number in [1, 2, 3]]
        executables = [client / 'Contents/MacOS/OpenGEO' if bundled else client for client in clients]
        try:
            for number, (client, executable) in enumerate(zip(clients, executables), 1):
                if bundled:
                    executable.parent.mkdir(parents=True)
                    (client / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'org.opengeo.keychain-fixture', 'CFBundleExecutable':'OpenGEO', 'CFBundleName':'OpenGEO Fixture', 'CFBundleVersion':str(number), 'CFBundlePackageType':'APPL'}))
                flags = ['-DCLIENT_API_V2=1'] if bundled else []
                subprocess.run(['clang', '-fobjc-arc', '-DCLIENT_ID=' + str(number), *flags, '-framework', 'Foundation', '-framework', 'Security', 'tests/mac-keychain-client.m', '-o', str(executable)], check=True, timeout=30)
                subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(client)], check=True, timeout=30)
            subprocess.run([str(controller), 'setup', str(directory), str(clients[0]), str(clients[1])], check=True, timeout=30)
            observed = subprocess.run([str(controller), 'inspect', str(directory), str(clients[0]), str(clients[1])], capture_output=True, text=True, timeout=10)
            self.assertEqual(observed.returncode, 0, observed.stderr)
            observation = json.loads(observed.stdout)
            self.assertEqual(observation['itemStatus'], 0)
            self.assertEqual(len(observation['trustedClientDataSha256']), 2)
            if bundled:
                old = subprocess.run([str(executables[0]), str(directory)], capture_output=True, text=True, timeout=10)
                self.assertEqual(old.returncode, 0, (old.stdout, old.stderr))
                # Match installation: replace the old bundle at its existing path.
                shutil.rmtree(clients[0])
                subprocess.run(['ditto', str(clients[1]), str(clients[0])], check=True, timeout=30)
                results = [old, *[subprocess.run([str(client), str(directory)], capture_output=True, text=True, timeout=10) for client in [executables[0], executables[2]]]]
            else:
                results = [subprocess.run([str(client), str(directory)], capture_output=True, text=True, timeout=10) for client in executables]
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
            self.assertEqual(set(observation['partitions']), set(consent['partitionCodeIdentities']))
        finally:
            if (directory / 'keychain-state.json').exists():
                subprocess.run([str(controller), 'cleanup', str(directory)], check=True, timeout=30)
                self.assertEqual(json.loads((directory / 'keychain-cleanup.json').read_text()), {'originalDefaultAndSearchRestored': True, 'ownedKeychainRemoved': True})
            self.assertEqual(directory.parent, temporary)
            shutil.rmtree(directory)


if __name__ == '__main__':
    unittest.main()
