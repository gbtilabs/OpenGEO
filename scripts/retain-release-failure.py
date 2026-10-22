"""Retain bounded synthetic installer-test diagnostics in the private review channel."""
from pathlib import Path
import json
import os
import subprocess
import tarfile
from release_files import digest, upload

target = os.environ['REVIEW_TARGET']
assert target in ['windows-x64', 'macos-arm64', 'macos-x64']
out = Path(os.environ['RUNNER_TEMP']) / ('release-' + target)
out.mkdir(exist_ok=True)
if target.startswith('macos-'):
    # Observe only the disposable runner's GUI. No consent button, keychain or system setting is changed.
    for name, command in {
        'native-window-observation': ['osascript', '-e', 'tell application "System Events" to get {name, name of every window} of every process whose visible is true'],
        'native-screen': ['screencapture', '-x', str(out / 'native-screen.png')],
    }.items():
        try:
            result = subprocess.run(command, capture_output=True, timeout=10)
            (out / (name + '.stdout')).write_bytes(result.stdout)
            (out / (name + '.stderr')).write_bytes(result.stderr)
        except subprocess.TimeoutExpired:
            (out / (name + '.stderr')).write_text('Read-only observation exceeded its original 10-second bound')
files = [path for path in out.iterdir() if path.is_file() and path.suffix in ['.stdout', '.stderr', '.json', '.png']]
assert all(path.stat().st_size < 10_000_000 for path in files)
record = {'source': os.environ['REVIEW_SOURCE'], 'runId': os.environ['GITHUB_RUN_ID'], 'target': target,
          'files': {path.name: {'bytes': path.stat().st_size, 'sha256': digest(path)} for path in files}, 'acceptance': False}
manifest = out / 'failure-inventory.json'
manifest.write_text(json.dumps(record, indent=2))
bundle = out / ('failure-' + os.environ['GITHUB_RUN_ID'] + '-' + target + '.tar.gz')
with tarfile.open(bundle, 'w:gz') as archive:
    for path in [*files, manifest]:
        archive.add(path, arcname=path.name)
upload(bundle)
print(json.dumps({'retainedPrivateFailure': bundle.name, 'sha256': digest(bundle), 'acceptance': False}))
