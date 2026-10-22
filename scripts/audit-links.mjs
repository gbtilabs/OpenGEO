import { realpathSync, readlinkSync } from 'node:fs';
import { relative, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';

/** Bundles may contain framework aliases only when their physical target is audited in the same tree. */
export function containedArtifactLink(root, file) {
  const base = realpathSync(root), target = readlinkSync(file);
  if (isAbsolute(target)) return null;
  try {
    const destination = realpathSync(file), location = relative(base, destination);
    if (!location || location === '..' || location.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(location)) return null;
    return { target, resolved: relative(resolve(root), destination).replaceAll('\\', '/'), sha256: createHash('sha256').update(target).digest('hex') };
  } catch { return null; }
}
