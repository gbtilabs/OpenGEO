const fs = require('node:fs');
const path = require('node:path');
const root = process.env.OPENGEO_NATIVE_KEYCHAIN_ROOT;
const phase = process.env.OPENGEO_NATIVE_KEYCHAIN_PHASE;
const temporary = process.env.RUNNER_TEMP;
if (process.platform !== 'darwin' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'macOS'
  || process.env.GITHUB_REPOSITORY !== 'surfacedby/OpenGEO' || !root || !temporary || !['seed', 'verify'].includes(phase)
  || !fs.realpathSync(root).startsWith(fs.realpathSync(temporary) + '/release-macos-electron-')
  || fs.lstatSync(root).isSymbolicLink()) throw new Error('An owned native Mac storage fixture is required');
const { app, BrowserWindow, safeStorage, session } = require('electron');
app.setName('OpenGEO');
app.setPath('userData', path.join(root, 'profile'));
app.whenReady().then(async () => {
  try {
    const observe = operation => console.error(JSON.stringify({ nativeStorageOperation: operation, phase }));
    observe('encryption-availability');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS-backed storage unavailable');
    const file = path.join(root, 'encrypted-probe.json');
    const value = 'synthetic native upgrade observation';
    if (phase === 'seed') fs.writeFileSync(file, JSON.stringify({ encrypted: safeStorage.encryptString(value).toString('base64') }));
    const encrypted = JSON.parse(fs.readFileSync(file, 'utf8')).encrypted;
    if (safeStorage.decryptString(Buffer.from(encrypted, 'base64')) !== value) throw new Error('OS-encrypted upgrade roundtrip failed');
    observe('encrypted-roundtrip-complete');
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await window.loadURL('data:text/html,<!doctype html><title>Native storage fixture</title>');
    if (phase === 'seed') await session.defaultSession.cookies.set({ url: 'https://example.com', name: 'native-fixture', value: 'synthetic-cookie', expirationDate: Date.now() / 1000 + 3600 });
    const cookies = await session.defaultSession.cookies.get({ url: 'https://example.com', name: 'native-fixture' });
    if (cookies.length !== 1 || cookies[0].value !== 'synthetic-cookie') throw new Error('Persistent Chromium cookie roundtrip failed');
    await session.defaultSession.cookies.flushStore();
    observe('persistent-cookie-complete');
    console.log(JSON.stringify({ phase, applicationName: app.getName(), osEncryptedRoundtrip: true, persistentCookie: true }));
    app.exit(0);
  } catch (error) {
    console.error(error.message);
    app.exit(1);
  }
});
