"""Read exact signing metadata while the tested release source stays frozen."""
from pathlib import Path, PurePosixPath
import base64
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
from release_files import api, digest, download_asset, git, review_release, upload


def metadata_member(package, path, expected):
    name = PurePosixPath(path)
    assert path.startswith('payload/OpenGEO.app/') and path.endswith('/_CodeSignature/CodeResources')
    assert not name.is_absolute() and '..' not in name.parts and '\\' not in path and name.as_posix() == path
    assert expected['kind'] == 'file' and 0 < expected['bytes'] <= 1_000_000
    members = [member for member in package.getmembers() if member.name == path]
    assert len(members) == 1 and members[0].isfile()
    member = members[0]
    assert member.size == expected['bytes'] and member.mode == expected['mode']
    data = package.extractfile(member).read()
    assert hashlib.sha256(data).hexdigest() == expected['sha256']
    return {'path': path.removeprefix('payload/'), 'bytes': len(data), 'sha256': expected['sha256'], 'base64': base64.b64encode(data).decode('ascii')}


def main():
    assert os.environ['GITHUB_ACTIONS'] == 'true' and os.environ['GITHUB_REPOSITORY'] == 'surfacedby/OpenGEO'
    assert os.environ['GITHUB_REF'] == 'refs/heads/develop'
    source, candidate, tool = os.environ['REVIEW_SOURCE'], os.environ['CANDIDATE_RUN'], os.environ['GITHUB_SHA']
    assert re.fullmatch('[0-9a-f]{40}', source) and candidate.isdecimal() and git('rev-parse', 'HEAD') == tool
    assert not git('status', '--porcelain=v1')
    subprocess.run(['git', 'merge-base', '--is-ancestor', source, tool], check=True)
    # Inspection code can evolve independently; application changes cannot enter
    # this branch while the original package verification remains authoritative.
    allowed = {'.github/workflows/release.yml', 'scripts/inspect_release_metadata.py', 'tests/package_inspection_test.py'}
    assert set(git('diff', '--name-only', source, tool).splitlines()) <= allowed
    assert api('repos/surfacedby/OpenGEO/git/ref/heads/master')['object']['sha'] == source
    prepared = api('repos/surfacedby/OpenGEO/actions/runs/' + candidate)
    assert prepared['head_sha'] == source and prepared['path'] == '.github/workflows/release.yml' and prepared['conclusion'] == 'success'
    release = review_release()
    target = os.environ['INSPECT_TARGET']
    targets = ['macos-arm64', 'macos-x64'] if target == 'all' else [target]
    assert all(value in ['macos-arm64', 'macos-x64'] for value in targets)
    for target in targets:
        with tempfile.TemporaryDirectory(prefix='opengeo-readonly-inspection-') as temporary:
            directory = Path(temporary)
            pattern = 'review-' + candidate + '-' + target + '-'
            reports = [asset for asset in release['assets'] if asset['name'].startswith(pattern) and re.fullmatch(re.escape(pattern) + r'[0-9]+\.json', asset['name'])]
            assert reports
            selected = min(reports, key=lambda row: row['id'])
            report_path = download_asset(selected['name'], directory)
            report = json.loads(report_path.read_text())
            assert report['source'] == source and report['candidateRun'] == candidate and report['target'] == target
            audited = api('repos/surfacedby/OpenGEO/actions/runs/' + report['auditRun'])
            assert audited['head_sha'] == source and audited['path'] == '.github/workflows/release.yml' and audited['status'] == 'completed'
            assert report['payloadTransport']['allArchiveHeaderModesVerified'] and report['payloadTransport']['allNativeFilesAndDirectoriesExact']
            paths = {row['path'] for row in report['audit']['findings'] if row.get('scope') == 'artifact:payload' and row['path'].endswith('/_CodeSignature/CodeResources')}
            assert paths and len(paths) <= 16
            bundle = download_asset('candidate-' + candidate + '-' + target + '.tar.gz', directory)
            assert digest(bundle) == report['bundleSha256']
            with tarfile.open(bundle) as package:
                files = [metadata_member(package, 'payload/' + path, report['nativeChecks']['payload'][path]) for path in sorted(paths)]
            result = {'source': source, 'candidateRun': candidate, 'target': target, 'inspectionRun': os.environ['GITHUB_RUN_ID'],
                      'inspectionToolCommit': tool, 'originalAuditReport': selected['name'], 'originalAuditReportSha256': digest(report_path),
                      'bundleSha256': report['bundleSha256'], 'files': files, 'readOnlyInspection': True,
                      'testsOrBuildsExecuted': False, 'publicationApproved': False}
            output = directory / ('inspection-' + candidate + '-' + target + '-' + os.environ['GITHUB_RUN_ID'] + '.json')
            output.write_text(json.dumps(result, indent=2))
            upload(output)
            print(json.dumps({'target': target, 'readOnlyFiles': len(files), 'privateReportSha256': digest(output), 'publicationApproved': False}))


if __name__ == '__main__':
    main()
