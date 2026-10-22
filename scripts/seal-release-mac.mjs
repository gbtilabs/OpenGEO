import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { sealMacApplication, makeMacCodeIgnore } from './mac-signing.mjs';
const arch = process.env.REVIEW_TARGET?.replace('macos-', '');
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch) || process.arch !== arch) throw new Error('A matching native Mac runner is required');
const app = path.resolve('release/candidate', arch === 'arm64' ? 'mac-arm64' : 'mac', 'OpenGEO.app');
const entitlements = path.join(process.env.RUNNER_TEMP, 'preview-jit.plist');
// These upstream functionless stubs have no load-command padding. Their exact vendor
// bytes are resources in the enclosing seal; signing them would corrupt dyld fixups.
const stubHome = 'Contents/Resources/browsers/chromium_headless_shell-1243/chrome-headless-shell-mac-x64/';
const preserved = arch === 'x64' ? new Map([
  [path.join(app, stubHome, 'libEGL.dylib'), '71a00bc0c12b510e63364720f1cda4735863113017e5051ee3a952dfcc475c69'],
  [path.join(app, stubHome, 'libGLESv2.dylib'), '3a26faf71edbbbac22668b20c79ec787196084023e002be987fa5420179008de'],
]) : new Map();
const verifyStubs = () => { for (const [file, hash] of preserved) if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash) throw new Error('Vendor resource changed'); };
verifyStubs();
await sealMacApplication(app, entitlements, makeMacCodeIgnore(preserved));
verifyStubs();
const copy = path.resolve('release/mac-sealed', arch === 'arm64' ? 'mac-arm64' : 'mac', 'OpenGEO.app');
fs.mkdirSync(path.dirname(copy), { recursive: true });
execFileSync('ditto', [app, copy]);
const allowed = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SHELL', 'USER', 'LOGNAME']);
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name)));
env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
execFileSync(process.execPath, ['node_modules/electron-builder/out/cli/cli.js', '--mac', 'dmg', '--' + arch,
  '--prepackaged', copy, '--config.directories.output=release/mac-sealed', '--config.mac.notarize=false', '--publish', 'never'],
{ stdio: 'inherit', timeout: 600000, env });
