import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { signAsync } = require('@electron/osx-sign');

export function makeMacCodeIgnore(preserved = new Set()) {
  return file => {
    if (fs.realpathSync(file) !== file || preserved.has(file)) return true;
    if (fs.statSync(file).isDirectory()) return !file.endsWith('.app') && !file.endsWith('.framework');
    const fd = fs.openSync(file, 'r'), magic = Buffer.alloc(4);
    try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
    return !['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'cafebabf', 'bebafeca', 'bfbafeca'].includes(magic.toString('hex'));
  };
}

// Native storage regressions must use the release's actual seal and entitlements.
export async function sealMacApplication(app, entitlements, ignore = makeMacCodeIgnore()) {
  if (process.platform !== 'darwin') throw new Error('Mac signing requires a native Mac host');
  fs.writeFileSync(entitlements, '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>');
  await signAsync({ app, identity: '-', identityValidation: false, platform: 'darwin', version: require('electron/package.json').version,
    strictVerify: true, preAutoEntitlements: false, preEmbedProvisioningProfile: false, ignore,
    // The locked signer accepts a scalar callback; its array path drops this option.
    optionsForFile: () => ({ hardenedRuntime: false, entitlements, timestamp: 'none' }) });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
}
