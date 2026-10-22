"""Private hosted release transport and complete payload inventories."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import stat
import subprocess
import tarfile
import urllib.request


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def api(route):
    return json.loads(subprocess.check_output(['gh', 'api', route]))


def review_release():
    release = api('repos/surfacedby/OpenGEO/releases/' + os.environ['REVIEW_RELEASE'])
    assert release['draft'] and release['target_commitish'] == os.environ['REVIEW_SOURCE'], 'Private review source changed'
    return release


def upload(path):
    release = review_release()
    assert not any(row['name'] == Path(path).name for row in release['assets']), 'Review assets are immutable'
    subprocess.run(['gh', 'release', 'upload', release['tag_name'], str(path), '--repo', 'surfacedby/OpenGEO'], check=True, timeout=900)
    asset = next(row for row in review_release()['assets'] if row['name'] == Path(path).name)
    assert asset['size'] == Path(path).stat().st_size and asset['digest'] == 'sha256:' + digest(path)


def download_asset(name, directory):
    asset = next(row for row in review_release()['assets'] if row['name'] == name)
    output = Path(directory) / name
    assert not output.exists()
    with output.open('xb') as stream:
        subprocess.run(['gh', 'api', 'repos/surfacedby/OpenGEO/releases/assets/' + str(asset['id']), '-H', 'Accept: application/octet-stream'], stdout=stream, check=True, timeout=900)
    assert output.stat().st_size == asset['size'] and asset['digest'] == 'sha256:' + digest(output)
    return output


def download_public(url, path, expected):
    assert url.startswith(('https://github.com/', 'https://cdn.playwright.dev/'))
    with urllib.request.urlopen(url, timeout=60) as response, Path(path).open('xb') as target:
        while block := response.read(1024 * 1024):
            target.write(block)
    assert digest(path) == expected, 'Public dependency or previous installer changed'


def inventory(base):
    base = Path(base).resolve()
    result = {}
    for current, directories, files in os.walk(base, followlinks=False):
        for name in sorted(directories + files):
            path = Path(current) / name
            relative = path.relative_to(base).as_posix()
            mode = path.lstat().st_mode
            assert not mode & (stat.S_ISUID | stat.S_ISGID)
            row = {'mode': stat.S_IMODE(mode)}
            if path.is_symlink():
                assert path.resolve(strict=True).is_relative_to(base), 'Payload symlink escapes or is broken'
                row.update(kind='symlink', target=os.readlink(path))
            elif path.is_dir():
                row.update(kind='directory')
            else:
                assert stat.S_ISREG(mode)
                row.update(kind='file', bytes=path.stat().st_size, sha256=digest(path))
            result[relative] = row
    return result


def extract_bundle(archive, destination):
    """Extract owned archives without trusting path names, links or extraction order."""
    destination = Path(destination).resolve()
    destination.mkdir()
    with tarfile.open(archive) as package:
        members = package.getmembers()
        seen = set()
        for member in members:
            name = PurePosixPath(member.name)
            assert not name.is_absolute() and '..' not in name.parts and '\\' not in member.name
            assert member.name not in seen
            seen.add(member.name)
            assert member.isfile() or member.isdir() or member.issym()
            assert not member.mode & (stat.S_ISUID | stat.S_ISGID)
            if member.issym():
                target = (destination / member.name).parent / member.linkname
                assert target.resolve().is_relative_to(destination)
        # Symlinks are last so no file can be written through an archive-provided link.
        for member in sorted(members, key=lambda item: item.issym()):
            target = destination / member.name
            assert target.resolve().is_relative_to(destination)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with package.extractfile(member) as source, target.open('xb') as output:
                    while block := source.read(1024 * 1024):
                        output.write(block)
                target.chmod(member.mode)
            else:
                target.symlink_to(member.linkname)
        for member in reversed(members):
            if member.isdir():
                (destination / member.name).chmod(member.mode)
    return destination
