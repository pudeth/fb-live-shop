let currentUrl = 'http://localhost:3000/login.html';
let isServerReady = false;
let serverInfo = {
    port: 3000,
    localUrl: 'http://localhost:3000',
    publicUrl: 'https://fb-live-shop.onrender.com'
};

document.addEventListener('DOMContentLoaded', async () => {
    const mainFrame = document.getElementById('mainFrame');
    const loadingSplash = document.getElementById('loadingSplash');
    const splashMessage = document.getElementById('splashMessage');
    const navTabs = document.querySelectorAll('.nav-tab');
    const btnReload = document.getElementById('btnReload');
    const btnOpenBrowser = document.getElementById('btnOpenBrowser');
    const networkHub = document.getElementById('networkHub');
    const btnCloseHub = document.getElementById('btnCloseHub');
    const btnCopyPublic = document.getElementById('btnCopyPublic');
    const btnCopyLocal = document.getElementById('btnCopyLocal');
    const publicUrlInput = document.getElementById('publicUrlInput');
    const localUrlInput = document.getElementById('localUrlInput');
    const publicQrCanvas = document.getElementById('publicQrCanvas');

    // Polling function to wait until server is online
    async function waitForServer() {
        for (let attempt = 1; attempt <= 40; attempt++) {
            try {
                splashMessage.innerText = `Connecting to TiDB Cloud Database & Backend... (${attempt})`;
                const res = await fetch('http://localhost:3000/health');
                if (res.ok) {
                    isServerReady = true;
                    updateIndicator(true);
                    break;
                }
            } catch (e) {
                // Wait 400ms before next retry
                await new Promise(r => setTimeout(r, 400));
            }
        }

        if (isServerReady) {
            splashMessage.innerText = 'Connected! Loading application...';
            // Set iframe src now that server is active
            mainFrame.src = currentUrl;
            setTimeout(() => {
                loadingSplash.classList.add('hidden');
            }, 500);
        } else {
            splashMessage.innerText = 'Server startup taking longer than usual. Retrying...';
            setTimeout(waitForServer, 1000);
        }
    }

    // Load server info and generate QR
    async function loadInfo() {
        if (window.electronAPI) {
            try {
                const info = await window.electronAPI.getServerInfo();
                if (info) {
                    serverInfo.localUrl = info.localUrl;
                }
            } catch (e) {}
        }

        if (typeof QRCode !== 'undefined' && publicQrCanvas) {
            QRCode.toCanvas(publicQrCanvas, publicUrlInput.value, {
                width: 140,
                margin: 1,
                color: {
                    dark: '#0f172a',
                    light: '#ffffff'
                }
            });
        }
    }

    // Start server detection
    waitForServer();
    loadInfo();

    // Tab navigation
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const url = tab.dataset.url;
            const tabId = tab.dataset.tab;

            navTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            if (tabId === 'network-hub') {
                networkHub.classList.remove('hidden');
            } else if (url) {
                networkHub.classList.add('hidden');
                currentUrl = url;
                if (isServerReady) {
                    mainFrame.src = url;
                }
            }
        });
    });

    // Close hub modal
    btnCloseHub.addEventListener('click', () => {
        networkHub.classList.add('hidden');
        navTabs.forEach(tab => {
            if (tab.dataset.url === currentUrl) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
    });

    // Reload frame
    btnReload.addEventListener('click', () => {
        if (!networkHub.classList.contains('hidden')) return;
        mainFrame.src = currentUrl;
    });

    // Open current page in default browser
    btnOpenBrowser.addEventListener('click', () => {
        openExternal(currentUrl);
    });

    // Open 100% Transparent Floating Overlay Window
    const btnPopoutOverlay = document.getElementById('btnPopoutOverlay');
    let isOverlayActive = false;

    function updateOverlayButton(active) {
        isOverlayActive = active;
        if (!btnPopoutOverlay) return;
        if (active) {
            btnPopoutOverlay.classList.add('active-overlay');
            btnPopoutOverlay.innerHTML = '✨ Overlay Window Active (Focused)';
            btnPopoutOverlay.style.background = '#4338ca';
            btnPopoutOverlay.style.boxShadow = '0 0 12px rgba(99, 102, 241, 0.6)';
        } else {
            btnPopoutOverlay.classList.remove('active-overlay');
            btnPopoutOverlay.innerHTML = '✨ Transparent Overlay Window';
            btnPopoutOverlay.style.background = '';
            btnPopoutOverlay.style.boxShadow = '';
        }
    }

    if (btnPopoutOverlay) {
        btnPopoutOverlay.addEventListener('click', async () => {
            if (window.electronAPI && window.electronAPI.openOverlayWindow) {
                await window.electronAPI.openOverlayWindow();
                updateOverlayButton(true);
            } else {
                openExternal('http://localhost:3000/overlay/index.html');
            }
        });
    }

    if (window.electronAPI && window.electronAPI.onOverlayStatus) {
        window.electronAPI.onOverlayStatus(({ open }) => {
            updateOverlayButton(open);
        });
        window.electronAPI.isOverlayOpen().then(open => {
            if (open) updateOverlayButton(true);
        }).catch(() => {});
    }

    // Copy URLs
    btnCopyPublic.addEventListener('click', () => {
        copyText(publicUrlInput.value, btnCopyPublic);
    });

    btnCopyLocal.addEventListener('click', () => {
        copyText(localUrlInput.value, btnCopyLocal);
    });

    // Status checker
    setInterval(async () => {
        try {
            const res = await fetch('http://localhost:3000/health');
            updateIndicator(res.ok);
        } catch {
            updateIndicator(false);
        }
    }, 4000);

    // Bridge messages from child iframes (Cashier Live, etc.) to Electron IPC
    window.addEventListener('message', async (event) => {
        if (!event.data || typeof event.data !== 'object') return;
        const { action, payload, requestId } = event.data;

        if (action === 'start-fb-live-monitor') {
            let result = { success: false };
            if (window.electronAPI && window.electronAPI.startFbLiveMonitor) {
                result = await window.electronAPI.startFbLiveMonitor(payload ? payload.url : '');
            }
            if (event.source) {
                event.source.postMessage({ type: 'fb-live-monitor-response', requestId, result }, '*');
            }
        } else if (action === 'stop-fb-live-monitor') {
            let result = { success: false };
            if (window.electronAPI && window.electronAPI.stopFbLiveMonitor) {
                result = await window.electronAPI.stopFbLiveMonitor();
            }
            if (event.source) {
                event.source.postMessage({ type: 'fb-live-monitor-response', requestId, result }, '*');
            }
        }
    });
});

function updateIndicator(online) {
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.getElementById('statusIndicator');
    if (!statusIndicator) return;

    if (online) {
        statusIndicator.className = 'status-indicator online';
        statusText.innerText = 'Online :3000';
    } else {
        statusIndicator.className = 'status-indicator offline';
        statusText.innerText = 'Connecting...';
    }
}

function openExternal(url) {
    if (window.electronAPI) {
        window.electronAPI.openExternal(url);
    } else {
        window.open(url, '_blank');
    }
}

function copyText(text, buttonElement) {
    if (window.electronAPI) {
        window.electronAPI.copyToClipboard(text);
    } else {
        navigator.clipboard.writeText(text);
    }
    const originalText = buttonElement.innerText;
    buttonElement.innerText = 'Copied! ✓';
    buttonElement.style.background = '#10b981';
    setTimeout(() => {
        buttonElement.innerText = originalText;
        buttonElement.style.background = '';
    }, 2000);
}
