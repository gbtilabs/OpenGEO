"""Generate update feeds only from installers already verified by the release publisher."""
import base64
import re


def update_feeds(version, installers):
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-beta\.\d+)?', version):
        raise ValueError('Unsupported release version')
    expected = {'windows-x64': '.exe', 'macos-arm64': '.dmg', 'macos-x64': '.dmg'}
    if set(installers) != set(expected):
        raise ValueError('Complete native installer set required')
    files = {}
    for target, extension in expected.items():
        item = installers[target]
        name = 'OpenGEO-' + version + '-' + target + extension
        if item['name'] != name or not isinstance(item['bytes'], int) or item['bytes'] <= 0:
            raise ValueError('Installer identity mismatch')
        if len(base64.b64decode(item['sha512'], validate=True)) != 64:
            raise ValueError('Invalid installer checksum')
        files[target] = {'url': name, 'sha512': item['sha512'], 'size': item['bytes']}
    channel = 'beta' if '-beta.' in version else 'latest'
    win = files['windows-x64']
    return {
        channel + '.yml': {'version': version, 'files': [win], 'path': win['url'], 'sha512': win['sha512']},
        channel + '-mac.yml': {'version': version, 'files': [files['macos-arm64'], files['macos-x64']]},
    }
