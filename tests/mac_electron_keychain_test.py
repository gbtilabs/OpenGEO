"""Exercise real Electron encryption and Chromium cookies without building installers."""
from pathlib import Path
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == 'darwin' and os.environ.get('GITHUB_ACTIONS') == 'true', 'Requires an owned native Mac release runner')
class ElectronKeychain(unittest.TestCase):
    def test_replaced_release_seal_retains_real_os_storage(self):
        self.assertEqual(os.environ['GITHUB_REPOSITORY'], 'surfacedby/OpenGEO')
        self.assertEqual(os.environ['RUNNER_OS'], 'macOS')
        root = Path(__file__).resolve().parents[1]
        temporary = Path(os.environ['RUNNER_TEMP']).resolve()
        locked = json.loads((root / 'package-lock.json').read_text())['packages']['node_modules/electron']['version']
        self.assertEqual(json.loads((root / 'node_modules/electron/package.json').read_text())['version'], locked)
        self.assertNotIn('ELECTRON_OVERRIDE_DIST_PATH', os.environ)
        directory = Path(tempfile.mkdtemp(prefix='release-macos-electron-', dir=temporary))
        installed = directory / 'installation/OpenGEO.app'
        apps = [directory / ('build-' + str(number)) / 'OpenGEO.app' for number in [1, 2]]
        controller = directory / 'keychain-fixture'

        def inspect(stage, pid=None):
            command = [str(controller), 'inspect', str(directory), str(installed), str(apps[1])]
            if pid is not None:
                command.append(str(pid))
            result = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            record = json.loads(result.stdout)
            print(json.dumps({'nativeStorageStage': stage, 'observation': record}), flush=True)
            return record

        def launch(phase, data_root=directory):
            allowed = {'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SHELL', 'USER', 'LOGNAME', 'DISPLAY'}
            env = {name: value for name, value in os.environ.items() if name in allowed}
            env.update(RUNNER_TEMP=str(temporary), GITHUB_ACTIONS='true', RUNNER_OS='macOS', GITHUB_REPOSITORY='surfacedby/OpenGEO',
                       OPENGEO_NATIVE_KEYCHAIN_ROOT=str(data_root), OPENGEO_NATIVE_KEYCHAIN_PHASE=phase)
            child = subprocess.Popen([str(installed / 'Contents/MacOS/OpenGEO'), '--inspect=0', '--remote-debugging-port=0'], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                stdout, stderr = child.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                # The original deadline remains a failure. Observe the live owned
                # child before killing it; no late result can become acceptance.
                try:
                    if (directory / 'keychain-state.json').exists():
                        inspect(phase + '-timeout', child.pid if child.poll() is None else None)
                finally:
                    child.kill()
                    stdout, stderr = child.communicate(timeout=10)
                self.fail('Actual Electron storage timed out at 30s during ' + phase + ': ' + stderr[-2000:])
            self.assertEqual(child.returncode, 0, (phase, stdout, stderr))
            record = json.loads(stdout.strip().splitlines()[-1])
            self.assertEqual(record, {'phase': phase, 'applicationName': 'OpenGEO', 'osEncryptedRoundtrip': True, 'persistentCookie': True})
            print(json.dumps({'electronStorage': record}), flush=True)

        try:
            # The installed package resolves its locked runtime lazily. Keep its
            # download chatter separate from the executable path being verified.
            resolved = directory / 'electron-runtime.json'
            result = subprocess.run(['node', '-e', 'const fs=require("node:fs");const executable=require("electron");fs.writeFileSync(process.argv[1],JSON.stringify({executable}));',
                                     str(resolved)], cwd=root, capture_output=True, text=True, timeout=180)
            self.assertEqual(result.returncode, 0, result.stderr[-2000:])
            executable = Path(json.loads(resolved.read_text())['executable']).resolve(strict=True)
            runtime = executable.parents[2]
            self.assertEqual(runtime, (root / 'node_modules/electron/dist/Electron.app').resolve())
            self.assertTrue(runtime.is_dir())
            self.assertEqual((runtime.parent / 'version').read_text().strip().removeprefix('v'), locked)
            subprocess.run(['clang', '-fobjc-arc', '-framework', 'Foundation', '-framework', 'Security', str(root / 'scripts/mac-keychain-fixture.m'), '-o', str(controller)], check=True, timeout=30)
            for number, app in enumerate(apps, 1):
                app.parent.mkdir()
                subprocess.run(['ditto', str(runtime), str(app)], check=True, timeout=60)
                executable = app / 'Contents/MacOS/Electron'
                executable.rename(executable.with_name('OpenGEO'))
                info = app / 'Contents/Info.plist'
                value = plistlib.loads(info.read_bytes())
                value.update(CFBundleExecutable='OpenGEO', CFBundleName='OpenGEO', CFBundleDisplayName='OpenGEO',
                             CFBundleIdentifier='org.opengeo.keychain-fixture', CFBundleVersion=str(number), CFBundleShortVersionString='0.0.' + str(number))
                info.write_bytes(plistlib.dumps(value))
                application = app / 'Contents/Resources/app'
                application.mkdir()
                (application / 'package.json').write_text(json.dumps({'name': 'opengeo', 'version': '0.0.' + str(number), 'main': 'main.cjs'}))
                shutil.copyfile(root / 'tests/mac-electron-keychain.cjs', application / 'main.cjs')
                subprocess.run(['node', '--input-type=module', '-e', 'const {sealMacApplication}=await import(process.argv[1]); await sealMacApplication(process.argv[2],process.argv[3]);',
                                (root / 'scripts/mac-signing.mjs').as_uri(), str(app), str(directory / ('entitlements-' + str(number) + '.plist'))], check=True, timeout=180)
            installed.parent.mkdir()
            subprocess.run(['ditto', str(apps[1]), str(installed)], check=True, timeout=60)
            fresh = directory / 'fresh'
            fresh.mkdir()
            # Match the real installer sequence, including normal Keychain startup
            # before the independently isolated encrypted-upgrade fixture exists.
            launch('seed', fresh)
            shutil.rmtree(installed)
            subprocess.run(['ditto', str(apps[0]), str(installed)], check=True, timeout=60)
            subprocess.run([str(controller), 'setup', str(directory), str(installed), str(apps[1])], check=True, timeout=30)
            before = inspect('before-seed')
            self.assertEqual(before['itemStatus'], 0)
            self.assertEqual(before['genericItems'], [{'service': 'OpenGEO Safe Storage', 'account': 'OpenGEO Key'}])
            launch('seed')
            seeded = inspect('after-seed')
            self.assertEqual(seeded['itemStatus'], 0)
            self.assertEqual(seeded['genericItems'], before['genericItems'])
            self.assertEqual(set(seeded['partitions']), set(before['partitions']))
            self.assertEqual(seeded['trustedClientDataSha256'], before['trustedClientDataSha256'])
            shutil.rmtree(installed)
            subprocess.run(['ditto', str(apps[1]), str(installed)], check=True, timeout=60)
            copied = inspect('after-copy')
            self.assertEqual(copied['firstStaticCode'], copied['secondStaticCode'])
            launch('verify')
            verified = inspect('after-verify')
            self.assertEqual(verified['itemStatus'], 0)
            self.assertEqual(verified['genericItems'], before['genericItems'])
            self.assertEqual(set(verified['partitions']), set(before['partitions']))
            self.assertEqual(verified['trustedClientDataSha256'], before['trustedClientDataSha256'])
        finally:
            if (directory / 'keychain-state.json').exists():
                subprocess.run([str(controller), 'cleanup', str(directory)], check=True, timeout=30)
                self.assertEqual(json.loads((directory / 'keychain-cleanup.json').read_text()), {'originalDefaultAndSearchRestored': True, 'ownedKeychainRemoved': True})
            self.assertEqual(directory.parent, temporary)
            shutil.rmtree(directory)


if __name__ == '__main__':
    unittest.main()
