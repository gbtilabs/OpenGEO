import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('release feeds bind all three native installers and reject missing or redirected assets', () => {
  const result = execFileSync('python', ['-c', `
import sys, base64
sys.path.insert(0, 'scripts')
from release_updates import update_feeds
version = '0.1.0-beta.4'
items = {target: {'name': 'OpenGEO-' + version + '-' + target + ext, 'bytes': 123, 'sha512': base64.b64encode(bytes(64)).decode()} for target, ext in [('windows-x64', '.exe'), ('macos-x64', '.dmg'), ('macos-arm64', '.dmg')]}
feeds = update_feeds(version, items)
assert set(feeds) == {'beta.yml', 'beta-mac.yml'}
assert feeds['beta.yml']['files'][0]['url'] == items['windows-x64']['name']
assert len(feeds['beta-mac.yml']['files']) == 2
try:
    update_feeds(version, {'windows-x64': items['windows-x64']})
    raise AssertionError('Missing architecture was accepted')
except ValueError:
    pass
items['windows-x64']['name'] = 'https://example.com/installer.exe'
try:
    update_feeds(version, items)
    raise AssertionError('External installer was accepted')
except ValueError:
    pass
print('verified')
`], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.trim(), 'verified');
});
