const { contextBridge, ipcRenderer } = require('electron');

// Expose only fixed actions; no filesystem paths or arbitrary update URLs cross IPC.
contextBridge.exposeInMainWorld('opengeoDesktop', Object.freeze({
  updates(action = 'status', value) {
    return ipcRenderer.invoke('opengeo:updates', action, value);
  },
  onUpdate(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('opengeo:update-state', listener);
    return () => ipcRenderer.removeListener('opengeo:update-state', listener);
  },
  setDraftProtectionPending(value) {
    if (typeof value === 'boolean') ipcRenderer.send('opengeo:draft-pending', value);
  },
  onQuitDeferred(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('opengeo:quit-deferred', listener);
    return () => ipcRenderer.removeListener('opengeo:quit-deferred', listener);
  },
}));
