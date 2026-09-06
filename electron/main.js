const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, session, screen } = require('electron');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');

// Enable transparency support on Windows hardware acceleration
app.commandLine.appendSwitch('enable-transparent-visuals');

const logFile = path.join(__dirname, 'electron-app.log');
function log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}\n`;
    try { fs.appendFileSync(logFile, line); } catch(e) {}
    console.log(line.trim());
}

process.on('uncaughtException', (err) => {
    log(`[UncaughtException] ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason) => {
    log(`[UnhandledRejection] ${reason}`);
});

log('Starting Electron Main Process...');

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let backendProcess = null;
let mysqldProcess = null;
const SERVER_PORT = parseInt(process.env.PORT, 10) || 3000;

// Disable default top menu bar completely across all windows
Menu.setApplicationMenu(null);

log('Initializing Electron Application...');

function checkPort(port, host = '127.0.0.1', timeout = 1200) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, host);
    });
}

async function ensureMySQLRunning() {
    try {
        const envPath = path.join(__dirname, '../backend/.env');
        let dbHost = 'localhost';
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const match = envContent.match(/^DB_HOST=(.+)$/m);
            if (match) dbHost = match[1].trim();
        }

        const isLocalDB = !dbHost || dbHost === 'localhost' || dbHost === '127.0.0.1';
        if (!isLocalDB) {
            log(`[Database] Cloud Database configured (${dbHost}). Skipping local MySQL.`);
            return true;
        }

        const isRunning = await checkPort(3306);
        if (isRunning) {
            log('[MySQL] Already running on port 3306');
            return true;
        }

        log('[MySQL] Not running on port 3306. Attempting to start local WAMP MySQL...');
        const wampMysqld = 'C:\\wamp64\\bin\\mysql\\mysql9.1.0\\bin\\mysqld.exe';
        const wampIni = 'C:\\wamp64\\bin\\mysql\\mysql9.1.0\\my.ini';

        if (fs.existsSync(wampMysqld)) {
            mysqldProcess = spawn(wampMysqld, [`--defaults-file=${wampIni}`], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            mysqldProcess.unref();

            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 1000));
                if (await checkPort(3306)) {
                    log('[MySQL] Started successfully');
                    return true;
                }
            }
        }
    } catch (e) {
        log(`[MySQL] Error starting mysqld: ${e.message}`);
    }
    return false;
}

function getLanIP() {
    const nets = os.networkInterfaces();
    for (const iface of Object.values(nets)) {
        for (const net of iface) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
}

function startBackend() {
    return new Promise(async (resolve) => {
        const serverReady = await checkPort(SERVER_PORT);
        if (serverReady) {
            log(`[Backend] Server already active on port ${SERVER_PORT}`);
            return resolve(true);
        }

        const backendDir = path.join(__dirname, '../backend');
        const serverScript = path.join(backendDir, 'server.js');

        log('[Backend] Spawning backend server process with node...');
        backendProcess = spawn('node', [serverScript], {
            cwd: backendDir,
            env: { ...process.env, PORT: SERVER_PORT, NODE_ENV: 'production' },
            stdio: 'pipe'
        });

        if (backendProcess.stdout) {
            backendProcess.stdout.on('data', (d) => log(`[Backend] ${d.toString().trim()}`));
        }
        if (backendProcess.stderr) {
            backendProcess.stderr.on('data', (d) => log(`[Backend ERR] ${d.toString().trim()}`));
        }

        backendProcess.on('exit', (code) => {
            log(`[Backend] Process exited with code ${code}`);
            backendProcess = null;
        });

        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (await checkPort(SERVER_PORT)) {
                log('[Backend] Server is online & ready');
                return resolve(true);
            }
        }
        resolve(false);
    });
}

function createMainWindow() {
    try {
        log('Creating main desktop window...');
        
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            const responseHeaders = Object.assign({}, details.responseHeaders);
            delete responseHeaders['x-frame-options'];
            delete responseHeaders['X-Frame-Options'];
            delete responseHeaders['content-security-policy'];
            delete responseHeaders['Content-Security-Policy'];
            callback({ cancel: false, responseHeaders });
        });

        const iconPath = path.join(__dirname, 'assets/icon.ico');

        mainWindow = new BrowserWindow({
            width: 1400,
            height: 900,
            minWidth: 1024,
            minHeight: 700,
            title: 'Facebook Live Product System',
            icon: fs.existsSync(iconPath) ? iconPath : undefined,
            backgroundColor: '#0f172a',
            show: false,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
                webviewTag: true
            }
        });

        mainWindow.setMenuBarVisibility(false);
        mainWindow.autoHideMenuBar = true;

        mainWindow.loadFile(path.join(__dirname, 'shell.html'));

        mainWindow.once('ready-to-show', () => {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.center();
            mainWindow.setAlwaysOnTop(true);
            mainWindow.setAlwaysOnTop(false);
            log('Main window displayed and focused.');
        });

        mainWindow.on('closed', () => {
            log('Main window closed by user. Quitting application...');
            mainWindow = null;
            cleanupAndExit();
        });

        log('Main window created successfully.');
    } catch (e) {
        log(`Error creating main window: ${e.message}`);
    }
}

function createOverlayWindow() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (overlayWindow.isMinimized()) overlayWindow.restore();
        overlayWindow.show();
        overlayWindow.focus();
        return;
    }

    try {
        log('Creating 100% transparent floating OBS overlay window...');
        const iconPath = path.join(__dirname, 'assets/icon.ico');

        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.bounds;

        overlayWindow = new BrowserWindow({
            x: 0,
            y: 0,
            width: width,
            height: height,
            transparent: true,
            frame: false,
            backgroundColor: '#00000000',
            hasShadow: false,
            alwaysOnTop: true,
            skipTaskbar: false,
            title: 'OBS Overlay (Transparent)',
            icon: fs.existsSync(iconPath) ? iconPath : undefined,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        overlayWindow.setMenuBarVisibility(false);
        overlayWindow.autoHideMenuBar = true;
        overlayWindow.loadURL(`http://localhost:${SERVER_PORT}/overlay/index.html?mode=desktop`);

        overlayWindow.on('closed', () => {
            overlayWindow = null;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('overlay-window-status', { open: false });
            }
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('overlay-window-status', { open: true });
        }

        log('Transparent overlay window created successfully.');
    } catch (e) {
        log(`Error creating overlay window: ${e.message}`);
    }
}

function createTray() {
    try {
        const iconPath = path.join(__dirname, 'assets/icon.ico');
        if (!fs.existsSync(iconPath)) return;

        tray = new Tray(iconPath);
        const lanIP = getLanIP();

        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Facebook Live Product System',
                enabled: false
            },
            { type: 'separator' },
            {
                label: '🖥️ Open Main Workspace',
                click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();
                    } else {
                        createMainWindow();
                    }
                }
            },
            {
                label: '✨ Open Transparent Overlay Window',
                click: () => createOverlayWindow()
            },
            {
                label: '📊 Open Admin in Browser',
                click: () => shell.openExternal(`http://localhost:${SERVER_PORT}/admin/dashboard.html`)
            },
            {
                label: '🛒 Open Cashier in Browser',
                click: () => shell.openExternal(`http://localhost:${SERVER_PORT}/cashier/live.html`)
            },
            { type: 'separator' },
            {
                label: `📱 Copy Mobile URL (http://${lanIP}:${SERVER_PORT})`,
                click: () => clipboard.writeText(`http://${lanIP}:${SERVER_PORT}`)
            },
            { type: 'separator' },
            {
                label: '🔄 Restart Backend Server',
                click: async () => {
                    if (backendProcess) {
                        backendProcess.kill();
                        backendProcess = null;
                    }
                    await startBackend();
                    if (mainWindow) mainWindow.reload();
                }
            },
            {
                label: '❌ Exit Completely',
                click: () => {
                    cleanupAndExit();
                }
            }
        ]);

        tray.setToolTip('Facebook Live Product System');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            } else {
                createMainWindow();
            }
        });
        log('System tray initialized successfully.');
    } catch (e) {
        log(`Error creating tray: ${e.message}`);
    }
}

function cleanupAndExit() {
    log('Cleaning up processes and exiting...');
    if (backendProcess) {
        try { backendProcess.kill(); } catch (e) {}
    }
    if (tray) {
        try { tray.destroy(); } catch(e) {}
    }
    app.exit(0);
    process.exit(0);
}

// Global window and popup handler
app.on('browser-window-created', (event, window) => {
    window.setMenuBarVisibility(false);
    window.autoHideMenuBar = true;
});

app.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
        if (url.includes('/overlay')) {
            createOverlayWindow();
            return { action: 'deny' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });
});

// IPC Handlers
ipcMain.handle('open-external', async (event, url) => {
    return shell.openExternal(url);
});

ipcMain.handle('open-overlay-window', async () => {
    createOverlayWindow();
    return true;
});

ipcMain.handle('close-overlay-window', async () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close();
        overlayWindow = null;
    }
    return true;
});

ipcMain.handle('is-overlay-open', async () => {
    return !!(overlayWindow && !overlayWindow.isDestroyed());
});

ipcMain.handle('set-overlay-always-on-top', async (event, flag) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setAlwaysOnTop(!!flag);
    }
    return true;
});

ipcMain.handle('set-overlay-ignore-mouse', async (event, ignore) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(!!ignore, { forward: true });
    }
    return true;
});

ipcMain.handle('get-server-info', async () => {
    const lanIP = getLanIP();
    return {
        port: SERVER_PORT,
        localUrl: `http://localhost:${SERVER_PORT}`,
        lanIP: lanIP,
        lanUrl: `http://${lanIP}:${SERVER_PORT}`
    };
});

ipcMain.handle('copy-to-clipboard', (event, text) => {
    clipboard.writeText(text);
    return true;
});

ipcMain.handle('restart-server', async () => {
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
    }
    await startBackend();
    return true;
});

let fbLiveWindow = null;
let fbScraperInterval = null;

ipcMain.handle('start-fb-live-monitor', async (event, targetUrl) => {
    if (fbLiveWindow && !fbLiveWindow.isDestroyed()) {
        fbLiveWindow.show();
        fbLiveWindow.focus();
        if (targetUrl && targetUrl.startsWith('http')) {
            fbLiveWindow.loadURL(targetUrl);
        }
        return { success: true, message: 'Monitor already running' };
    }

    try {
        log('Starting In-App Facebook Live Stream Monitor Window...');
        const iconPath = path.join(__dirname, 'assets/icon.ico');

        fbLiveWindow = new BrowserWindow({
            width: 500,
            height: 750,
            title: '🔴 Facebook Live Stream - Real-Time Comment Monitor',
            icon: fs.existsSync(iconPath) ? iconPath : undefined,
            backgroundColor: '#0f172a',
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        const urlToLoad = (targetUrl && targetUrl.startsWith('http'))
            ? targetUrl
            : 'https://www.facebook.com/live/producer';

        fbLiveWindow.loadURL(urlToLoad);

        const processedSignatures = new Set();

        const scraperScript = `
            (function() {
                if (!window.__fbCommentsQueue) {
                    window.__fbCommentsQueue = [];
                    window.__fbSeenText = new Set();

                    function isOldTimestamp(raw) {
                        const m = raw.match(/[-•·\\s]*\\b(\\d+)\\s*([smhdwy])\\b/i);
                        if (m && !/just now|now|\\b\\d+\\s*s\\b/i.test(raw)) {
                            const val = parseInt(m[1], 10);
                            const unit = m[2].toLowerCase();
                            if (unit === 'd' || unit === 'w' || unit === 'y') return true;
                            if (unit === 'h' && val >= 4) return true;
                        }
                        return false;
                    }

                    function scanAndQueue(root) {
                        const target = root || document;
                        const nodes = target.querySelectorAll ? target.querySelectorAll('[role="article"], [role="row"], [role="listitem"], div[data-visualcompletion="ignore-dynamic"]') : [];
                        nodes.forEach(node => {
                            const text = (node.innerText || '').trim();
                            if (text && text.length > 2 && text.length < 500 && !window.__fbSeenText.has(text)) {
                                window.__fbSeenText.add(text);
                                if (window.__fbSeenText.size > 2000) {
                                    window.__fbSeenText.clear();
                                }
                                // Only skip ancient (>4h or days old) comments!
                                if (!isOldTimestamp(text)) {
                                    window.__fbCommentsQueue.push(text);
                                }
                            }
                        });
                    }

                    // Real-time MutationObserver: ONLY captures brand new incoming comments added to the page
                    const observer = new MutationObserver((mutations) => {
                        for (const m of mutations) {
                            for (const n of m.addedNodes) {
                                if (n.nodeType === 1) {
                                    scanAndQueue(n);
                                }
                            }
                        }
                    });
                    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
                }

                // Drain and return pending queue
                const pending = window.__fbCommentsQueue.splice(0, 50);
                return pending;
            })()
        `;

        if (fbScraperInterval) clearInterval(fbScraperInterval);
        fbScraperInterval = setInterval(async () => {
            if (!fbLiveWindow || fbLiveWindow.isDestroyed()) {
                clearInterval(fbScraperInterval);
                fbScraperInterval = null;
                return;
            }

            try {
                const rawComments = await fbLiveWindow.webContents.executeJavaScript(scraperScript);
                if (Array.isArray(rawComments) && rawComments.length > 0) {
                    const http = require('http');
                    const postData = JSON.stringify({ comments: rawComments });
                    const req = http.request({
                        hostname: 'localhost',
                        port: SERVER_PORT,
                        path: '/api/comments/process-stream',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(postData)
                        }
                    });
                    req.on('error', () => {});
                    req.write(postData);
                    req.end();
                }
            } catch(e) {}
        }, 200);

        fbLiveWindow.on('closed', () => {
            fbLiveWindow = null;
            if (fbScraperInterval) {
                clearInterval(fbScraperInterval);
                fbScraperInterval = null;
            }
        });

        return { success: true };
    } catch(e) {
        log('Error starting FB live monitor: ' + e.message);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('stop-fb-live-monitor', async () => {
    if (fbLiveWindow && !fbLiveWindow.isDestroyed()) {
        fbLiveWindow.close();
    }
    fbLiveWindow = null;
    if (fbScraperInterval) {
        clearInterval(fbScraperInterval);
        fbScraperInterval = null;
    }
    return { success: true };
});

ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    cleanupAndExit();
});

// App Lifecycle
app.whenReady().then(async () => {
    log('App is ready, initializing services...');
    await ensureMySQLRunning();
    await startBackend();
    createMainWindow();
    createTray();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
});

app.on('before-quit', () => {
    cleanupAndExit();
});

app.on('window-all-closed', () => {
    log('All windows closed.');
    cleanupAndExit();
});
