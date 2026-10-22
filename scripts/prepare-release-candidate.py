"""Exercise actual installers and an existing beta workspace on matching hosted runners."""
from pathlib import Path
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tarfile
from release_files import digest, download_public, git, inventory, upload

source = os.environ['REVIEW_SOURCE']
target = os.environ['REVIEW_TARGET']
assert source == git('rev-parse', 'HEAD') and not git('status', '--porcelain=v1')
assert target in ['windows-x64', 'macos-x64', 'macos-arm64']
root = Path.cwd()
out = Path(os.environ['RUNNER_TEMP']) / ('release-' + target)
out.mkdir()
version = json.loads((root / 'package.json').read_text())['version']
suffix = '.exe' if target.startswith('windows') else '.dmg'
name = 'OpenGEO-' + version + '-' + target + suffix
candidate = out / name
build = root / 'release' / ('candidate' if suffix == '.exe' else 'mac-sealed')
files = list(build.glob('*' + suffix))
assert len(files) == 1
shutil.copyfile(files[0], candidate)
old_hash = {
    'windows-x64': 'd85052f027ce2d2e23eba7609d45f078043e8fff1d607ccf926e81118b7b7b9c',
    'macos-arm64': '23485758370a09d9f39ced43db34f7511a49c453703a23f9eb31e0045f903ae8',
    'macos-x64': '2b42948aa1de52745464a4fe52e71b12021e0bc388e3175ce97f76c9f20863a2',
}[target]
previous = out / ('previous' + suffix)
download_public('https://github.com/surfacedby/OpenGEO/releases/download/v0.1.0-beta.1/OpenGEO-0.1.0-beta.1-' + target + suffix, previous, old_hash)
profile = out / 'upgrade-profile'
profile.mkdir()
receipt = out / 'upgrade-workspace.json'
installation = out / 'installation'
payload = out / 'payload'
signatures = {}


def install(installer):
    if suffix == '.exe':
        # NSIS requires /D as the final argument, without embedded quotes.
        subprocess.run([str(installer), '/S', '/D=' + str(installation)], check=True, timeout=180)
        assert (installation / 'OpenGEO.exe').is_file()
        return installation / 'OpenGEO.exe'
    attached = plistlib.loads(subprocess.check_output(['hdiutil', 'attach', '-readonly', '-nobrowse', '-plist', str(installer)]))
    mounts = [Path(row['mount-point']) for row in attached['system-entities'] if 'mount-point' in row]
    assert len(mounts) == 1
    mount = mounts[0]
    try:
        app = installation / 'OpenGEO.app'
        if app.exists():
            shutil.rmtree(app)
        installation.mkdir(exist_ok=True)
        before = inventory(mount / 'OpenGEO.app')
        subprocess.run(['ditto', str(mount / 'OpenGEO.app'), str(app)], check=True)
        assert before == inventory(app)
    finally:
        subprocess.run(['hdiutil', 'detach', str(mount)], check=True)
    return app / 'Contents/MacOS/OpenGEO'


def smoke(executable, phase=None):
    command = ['node', 'scripts/desktop-smoke.mjs', str(executable)]
    if phase:
        command += ['--profile', str(profile), '--phase', phase, '--receipt', str(receipt)]
    with (out / ('smoke-' + (phase or 'fresh') + '.stdout')).open('wb') as stdout, (out / ('smoke-' + (phase or 'fresh') + '.stderr')).open('wb') as stderr:
        result = subprocess.run(command, stdout=stdout, stderr=stderr, timeout=180)
    if result.returncode:
        # This isolated test profile contains synthetic data; retain the actual failure in the job log too.
        print((out / ('smoke-' + (phase or 'fresh') + '.stderr')).read_text(), file=sys.stderr)
        raise RuntimeError('Installed workflow failed at phase ' + str(phase))


old_executable = install(previous)
smoke(old_executable, 'seed')
executable = install(candidate)
smoke(executable, 'verify')
smoke(executable)
if suffix == '.exe':
    built = build / 'win-unpacked'
    actual = inventory(installation)
    expected = inventory(built)
    assert all(actual.get(path) == row for path, row in expected.items())
    assert set(actual) - set(expected) == {'Uninstall OpenGEO.exe'}
    shutil.copytree(installation, payload)
    signature_script = out / 'signature.ps1'
    signature_result = out / 'signature.json'
    signature_script.write_text('param([string]$Installer,[string]$Output)\n$ErrorActionPreference="Stop"\n@{status=[string](Get-AuthenticodeSignature -LiteralPath $Installer).Status} | ConvertTo-Json -Compress | Set-Content -LiteralPath $Output -Encoding utf8\n')
    result = subprocess.run(['powershell', '-NoProfile', '-File', str(signature_script), '-Installer', str(candidate), '-Output', str(signature_result)], capture_output=True, check=True)
    (out / 'signature.stdout').write_bytes(result.stdout)
    (out / 'signature.stderr').write_bytes(result.stderr)
    actual_signature = json.loads(signature_result.read_text(encoding='utf-8-sig'))
    assert actual_signature['status'] == 'NotSigned', repr(actual_signature)
    signatures = {'windowsAuthenticode': 'NotSigned'}
    uninstaller = installation / 'Uninstall OpenGEO.exe'
    subprocess.run([str(uninstaller), '/S', '_?=' + str(installation)], check=True, timeout=180)
    assert not (installation / 'OpenGEO.exe').exists()
else:
    app = installation / 'OpenGEO.app'
    built = build / ('mac-arm64' if target.endswith('arm64') else 'mac') / 'OpenGEO.app'
    assert inventory(built) == inventory(app)
    for key, command in {
        'display': ['codesign', '-dv', '--verbose=4', str(app)],
        'verify': ['codesign', '--verify', '--deep', '--strict', str(app)],
        'gatekeeper': ['spctl', '--assess', '--type', 'execute', '--verbose=4', str(app)],
    }.items():
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        signatures[key] = {'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}
    assert signatures['verify']['exit'] == 0 and 'Signature=adhoc' in signatures['display']['stderr']
    payload.mkdir()
    subprocess.run(['ditto', str(app), str(payload / 'OpenGEO.app')], check=True)
    shutil.rmtree(app)
assert not git('status', '--porcelain=v1')
record = {'source': source, 'runId': os.environ['GITHUB_RUN_ID'], 'target': target, 'version': version,
          'installer': {'name': name, 'bytes': candidate.stat().st_size, 'sha256': digest(candidate)},
          'payload': inventory(payload), 'previousInstallerSha256': old_hash,
          'freshInstalledWorkflow': True, 'upgradeWorkspaceAndOsEncryptedStorage': True,
          'removedOwnedInstallation': True, 'signatures': signatures,
          'cleanMachineCertification': False, 'publicationApproved': False}
(out / 'candidate.json').write_text(json.dumps(record, indent=2))
bundle = out / ('candidate-' + os.environ['GITHUB_RUN_ID'] + '-' + target + '.tar.gz')
with tarfile.open(bundle, 'w:gz', dereference=False) as archive:
    for path in [candidate, out / 'candidate.json', payload, *out.glob('smoke-*.stdout'), *out.glob('smoke-*.stderr')]:
        archive.add(path, arcname=path.name, recursive=True)
upload(bundle)
print(json.dumps({'target': target, 'installerSha256': record['installer']['sha256'], 'installedAndUpgradeChecks': True, 'privateBundleSha256': digest(bundle)}))
