const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    openOverlayWindow: () => ipcRenderer.invoke('open-overlay-window'),
    closeOverlayWindow: () => ipcRenderer.invoke('close-overlay-window'),
    isOverlayOpen: () => ipcRenderer.invoke('is-overlay-open'),
    setOverlayAlwaysOnTop: (flag) => ipcRenderer.invoke('set-overlay-always-on-top', flag),
    setOverlayIgnoreMouse: (ignore) => ipcRenderer.invoke('set-overlay-ignore-mouse', ignore),
    getServerInfo: () => ipcRenderer.invoke('get-server-info'),
    copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    restartServer: () => ipcRenderer.invoke('restart-server'),
    startFbLiveMonitor: (url) => ipcRenderer.invoke('start-fb-live-monitor', url),
    stopFbLiveMonitor: () => ipcRenderer.invoke('stop-fb-live-monitor'),
    onOverlayStatus: (callback) => {
        ipcRenderer.on('overlay-window-status', (event, data) => callback(data));
    }
});
