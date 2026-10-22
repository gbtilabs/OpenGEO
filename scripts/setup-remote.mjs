import { mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

if (process.argv.slice(2).some(value => value !== "--rotate")) throw new Error("Usage: node scripts/setup-remote.mjs [--rotate]");
const directory = resolve(".local"), file = resolve(directory, "remote-access-key");
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
if (existsSync(file) && !process.argv.includes("--rotate")) throw new Error("An access key already exists. Use --rotate to revoke existing remote browser sessions.");
// The private parent protects host access; Docker's unprivileged UID must read the mounted secret.
writeFileSync(file, randomBytes(32).toString("hex") + "\n", { flag: process.argv.includes("--rotate") ? "w" : "wx", mode: 0o644 });
chmodSync(file, 0o644);
console.log("Remote access key saved to .local/remote-access-key. Read it locally and keep it private. Restart Docker after rotation to refresh its mounted secret. No network access has been enabled.");
