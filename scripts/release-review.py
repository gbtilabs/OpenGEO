"""Keep candidates private until exact runtime, source and payload reviews approve publication."""
from pathlib import Path, PureWindowsPath
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from release_files import api, digest, download_asset, extract_bundle, git, inventory, review_release, upload

TARGETS = ['windows-x64', 'macos-arm64', 'macos-x64']
source = os.environ['REVIEW_SOURCE']
run = os.environ.get('CANDIDATE_RUN', '')
phase = sys.argv[1]


def scope():
    assert re.fullmatch('[0-9a-f]{40}', source) and re.fullmatch('[0-9]+', os.environ['REVIEW_RELEASE'])
    assert source == git('rev-parse', 'HEAD') and not git('status', '--porcelain=v1')
    assert api('repos/surfacedby/OpenGEO/git/ref/heads/master')['object']['sha'] == source
    review_release()
    if phase != 'scope':
        assert re.fullmatch('[0-9]+', run)
        prepared = api('repos/surfacedby/OpenGEO/actions/runs/' + run)
        assert prepared['head_sha'] == source and prepared['path'] == '.github/workflows/release.yml'
        assert prepared['conclusion'] == 'success', 'Complete native and Docker preparation must pass first'


def seven_extract(archive, output):
    listing = subprocess.check_output(['7z', 'l', '-slt', str(archive)], text=True)
    for line in listing.split('----------', 1)[-1].splitlines():
        if line.startswith('Path = '):
            path = PureWindowsPath(line[7:])
            assert not path.is_absolute() and not path.drive and '..' not in path.parts
        assert not line.startswith(('Symbolic Link = ', 'Hard Link = '))
    subprocess.run(['7z', 'x', str(archive), '-o' + str(output), '-y'], check=True, stdout=subprocess.DEVNULL)


def audit():
    target = os.environ['REVIEW_TARGET']
    assert target in TARGETS
    out = Path(tempfile.mkdtemp(prefix='opengeo-release-review-'))
    bundle = download_asset('candidate-' + run + '-' + target + '.tar.gz', out)
    unpacked = extract_bundle(bundle, out / 'candidate')
    record = json.loads((unpacked / 'candidate.json').read_text())
    assert record['source'] == source and record['runId'] == run and record['target'] == target
    assert record['freshInstalledWorkflow'] and record['upgradeWorkspaceAndOsEncryptedStorage'] and record['removedOwnedInstallation']
    if target.startswith('macos'):
        consent = record['macUpgradeExplicitKeychainConsent']
        assert consent['trustedDecryptClients'] == 2 and consent['explicitFixtureOwnerConsent']
        assert consent['protectedKeychainFormat'] is True and len(consent['partitionMetadataBefore']) == 1
        assert len(set(consent['partitionCodeIdentities'])) == 2 and consent['unlistedClientDenied'] is True
        assert all(re.fullmatch(r'cdhash:[0-9a-f]{40}', identity) for identity in consent['partitionCodeIdentities'])
        assert consent['originalDefaultAndSearchRestored'] and consent['ownedKeychainRemoved']
        assert consent['fixtureSourceSha256'] == digest('scripts/mac-keychain-fixture.m')
    installer = unpacked / record['installer']['name']
    assert digest(installer) == record['installer']['sha256'] and installer.stat().st_size == record['installer']['bytes']
    payload = unpacked / 'payload'
    assert inventory(payload) == record['payload']
    asar = payload / ('OpenGEO.app/Contents/Resources/app.asar' if target.startswith('macos') else 'resources/app.asar')
    app = out / 'app-asar'
    subprocess.run(['node', '-e', "require('@electron/asar').extractAll(process.argv[1],process.argv[2])", str(asar), str(app)], check=True)
    app_files = inventory(app)
    assert json.loads((app / 'package.json').read_text())['version'] == record['version']
    tracked = set(git('ls-files').splitlines())
    for directory in ['desktop', 'assets']:
        for path, row in app_files.items():
            if not path.startswith(directory + '/') or row['kind'] != 'file':
                continue
            assert path in tracked and digest(Path(path)) == row['sha256'], 'Packaged application source differs'
    assert (app / 'dist-server/main.js').is_file() and (app / 'dist/index.html').is_file()
    extra = []
    if target == 'windows-x64':
        wrapper = out / 'nsis-wrapper'
        seven_extract(installer, wrapper)
        archives = list(wrapper.rglob('app-64.7z'))
        assert len(archives) == 1
        extracted = out / 'nsis-application'
        seven_extract(archives[0], extracted)
        installed_files = {k: v['sha256'] for k, v in inventory(payload).items() if v['kind'] == 'file' and k != 'Uninstall OpenGEO.exe'}
        assert installed_files == {k: v['sha256'] for k, v in inventory(extracted).items() if v['kind'] == 'file'}
        extra.append(wrapper)
    provenance = out / 'provenance'
    provenance.mkdir()
    subprocess.run(['python', 'scripts/release-provenance.py', str(payload), str(provenance)], check=True)
    fresh = out / 'source'
    subprocess.run(['git', 'clone', '--no-hardlinks', '--quiet', '.', str(fresh)], check=True)
    subprocess.run(['git', 'checkout', '--quiet', '--detach', source], cwd=fresh, check=True)
    private = json.loads(os.environ['OPENGEO_RELEASE_REVIEW'])
    assert isinstance(private, list) and all(isinstance(value, str) for value in private)
    values = out / 'confidential-values.json'
    values.write_text(json.dumps(private))
    values.chmod(0o600)
    env = {name: value for name, value in os.environ.items() if name in ['PATH', 'HOME', 'TMPDIR', 'LANG']}
    env.update(OPENGEO_CONFIDENTIAL_VALUES_FILE=str(values), OPENGEO_AUDIT_OUTPUT=str(out / 'audit'))
    dispositions = next((row for row in review_release()['assets'] if row['name'] == 'dispositions-' + run + '-' + target + '.json'), None)
    if dispositions:
        env['OPENGEO_DISPOSITIONS_FILE'] = str(download_asset(dispositions['name'], out))
    command = ['node', 'scripts/release-audit.mjs']
    for directory in [payload, app, provenance / 'signatures', *extra]:
        command += ['--artifact', str(directory)]
    with (out / 'audit.stdout').open('wb') as stdout, (out / 'audit.stderr').open('wb') as stderr:
        result = subprocess.run(command, cwd=fresh, env=env, stdout=stdout, stderr=stderr)
    values.unlink()
    assert result.returncode in [0, 1]
    audit_record = json.loads((out / 'audit/release-receipt.json').read_text())
    assert audit_record['commit'] == source and audit_record['clean']
    report = {'source': source, 'candidateRun': run, 'auditRun': os.environ['GITHUB_RUN_ID'], 'target': target,
              'bundleSha256': digest(bundle), 'installer': record['installer'], 'nativeChecks': record,
              'asarFiles': app_files, 'provenance': json.loads((provenance / 'vendor-provenance.json').read_text()),
              'audit': audit_record, 'auditExit': result.returncode, 'publicationApproved': False}
    file = out / ('review-' + run + '-' + target + '-' + os.environ['GITHUB_RUN_ID'] + '.json')
    file.write_text(json.dumps(report, indent=2))
    upload(file)
    print(json.dumps({'target': target, 'auditExit': result.returncode, 'unresolved': len(audit_record['findings']), 'privateReviewSha256': digest(file)}))
    return result.returncode


def publish():
    out = Path(tempfile.mkdtemp(prefix='opengeo-release-publication-'))
    approval_path = download_asset('publication-' + run + '.json', out)
    approval = json.loads(approval_path.read_text())
    assert approval['sourceCommit'] == source and approval['candidateRun'] == run and approval['approvedForUnsignedBeta'] is True
    assert set(approval['targets']) == set(TARGETS)
    for name in ['applicationRun', 'remoteRun']:
        verified = api('repos/surfacedby/OpenGEO/actions/runs/' + str(approval[name]))
        assert verified['head_sha'] == source and verified['conclusion'] == 'success'
        assert verified['path'] == ('.github/workflows/verify.yml' if name == 'applicationRun' else '.github/workflows/verify-remote-access.yml')
    version = json.loads(Path('package.json').read_text())['version']
    assert re.fullmatch(r'\d+\.\d+\.\d+-beta\.\d+', version)
    tag = 'v' + version
    public = api('repos/surfacedby/OpenGEO/releases/tags/' + tag)
    assert public['draft'] and public['prerelease'] and public['target_commitish'] == source and not public['assets']
    published = []
    for target in TARGETS:
        approved = approval['targets'][target]
        report_path = download_asset(approved['reviewFile'], out)
        assert digest(report_path) == approved['reviewSha256']
        report = json.loads(report_path.read_text())
        assert report['source'] == source and report['candidateRun'] == run and report['target'] == target
        audited = api('repos/surfacedby/OpenGEO/actions/runs/' + str(report['auditRun']))
        assert audited['head_sha'] == source and audited['path'] == '.github/workflows/release.yml' and audited['conclusion'] == 'success'
        assert report['auditExit'] == 0 and not report['audit']['findings']
        assert report['audit']['clean'] and report['audit']['commit'] == source
        assert approved['provenanceAndPackagingReviewed'] is True
        bundle = download_asset('candidate-' + run + '-' + target + '.tar.gz', out)
        assert digest(bundle) == report['bundleSha256']
        info = report['installer']
        with tarfile.open(bundle) as package:
            member = package.getmember(info['name'])
            assert member.isfile() and member.size == info['bytes'] and Path(member.name).name == member.name
            installer = out / member.name
            with package.extractfile(member) as source_file, installer.open('xb') as destination:
                shutil.copyfileobj(source_file, destination)
        assert digest(installer) == info['sha256']
        subprocess.run(['gh', 'release', 'upload', tag, str(installer), '--repo', 'surfacedby/OpenGEO'], check=True, timeout=900)
        published.append(info)
        bundle.unlink()
        installer.unlink()
    archive = out / ('OpenGEO-' + version + '-source.zip')
    subprocess.run(['git', 'archive', '--format=zip', '--prefix=OpenGEO-' + version + '/', '--output=' + str(archive), source], check=True)
    published.append({'name': archive.name, 'bytes': archive.stat().st_size, 'sha256': digest(archive)})
    manifest = {'schemaVersion': 1, 'version': version, 'sourceCommit': source, 'artifacts': published,
                'buildOrigin': 'GitHub hosted native runners', 'candidateRun': run,
                'cryptographicBuildAttestation': False, 'windowsAuthenticodeSigned': False,
                'macAdHocSealVerified': True, 'macDeveloperIdSigned': False, 'macNotarized': False,
                'macUpgradeRequiresKeychainApproval': True,
                'cleanMachineCertification': False, 'manualUpdates': True,
                'verification': {'applicationRun': approval['applicationRun'], 'remoteRun': approval['remoteRun'],
                                 'freshInstallAndBeta1Upgrade': TARGETS, 'docker': ['linux-amd64', 'linux-arm64'],
                                 'unresolvedConfidentialityFindings': 0},
                'scope': 'Beta local workflow and optional authenticated private-network access; no paid provider or managed production acceptance implied'}
    manifest_file = out / 'release-manifest.json'
    manifest_file.write_text(json.dumps(manifest, indent=2))
    sums = out / 'SHA256SUMS.txt'
    sums.write_text(''.join(row['sha256'] + '  ' + row['name'] + '\n' for row in published) + digest(manifest_file) + '  release-manifest.json\n')
    subprocess.run(['gh', 'release', 'upload', tag, str(archive), str(manifest_file), str(sums), '--repo', 'surfacedby/OpenGEO'], check=True)
    release = api('repos/surfacedby/OpenGEO/releases/tags/' + tag)
    expected = {row['name']: (row['bytes'], row['sha256']) for row in published}
    for file in [manifest_file, sums]:
        expected[file.name] = (file.stat().st_size, digest(file))
    assert set(row['name'] for row in release['assets']) == set(expected)
    assert all((row['size'], row['digest']) == (expected[row['name']][0], 'sha256:' + expected[row['name']][1]) for row in release['assets'])
    subprocess.run(['gh', 'release', 'edit', tag, '--draft=false', '--prerelease', '--repo', 'surfacedby/OpenGEO'], check=True)
    downloaded = []
    for asset in api('repos/surfacedby/OpenGEO/releases/tags/' + tag)['assets']:
        # urllib receives no GitHub credentials. This is a complete anonymous download.
        destination = out / ('download-' + asset['name'])
        with urllib.request.urlopen(asset['browser_download_url'], timeout=60) as response, destination.open('xb') as stream:
            shutil.copyfileobj(response, stream, length=1024 * 1024)
        assert destination.stat().st_size == expected[asset['name']][0] and digest(destination) == expected[asset['name']][1]
        downloaded.append({'name': asset['name'], 'bytes': destination.stat().st_size, 'sha256': digest(destination)})
        destination.unlink()
    receipt = out / ('public-download-verification-' + run + '.json')
    receipt.write_text(json.dumps({'source': source, 'tag': tag, 'publicationRun': os.environ['GITHUB_RUN_ID'], 'anonymousFullDownloads': downloaded}, indent=2))
    upload(receipt)
    print(json.dumps({'tag': tag, 'assets': len(downloaded), 'anonymousFullDownloadVerification': True}))


scope()
if phase == 'audit':
    sys.exit(audit())
elif phase == 'publish':
    publish()
else:
    assert phase == 'scope'
