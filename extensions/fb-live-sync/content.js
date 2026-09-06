/**
 * Facebook Live POS - Real-Time Comment Auto-Sync Extension
 * Captures live stream comments from Facebook DOM and transmits to POS (Render Cloud or Localhost)
 */

console.log('🚀 [FB Live POS Extension] Loaded on Facebook!');

const DEFAULT_SERVER_URL = 'https://fb-live-shop.onrender.com';
let posServerUrl = DEFAULT_SERVER_URL;
const processedComments = new Set();
let isPosReachable = false;
let syncedCount = 0;
let healthCheckTimer = null;

function getHostLabel(url) {
    try {
        const u = new URL(url);
        return u.hostname.replace('.onrender.com', ' (Cloud)').replace('localhost', 'Local');
    } catch {
        return 'Server';
    }
}

// ── 1. Floating Status Badge & Mini Switcher Menu ──────────────────────────────
function createFloatingBadge() {
    if (document.getElementById('fb-pos-floating-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'fb-pos-floating-badge';
    badge.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999999;
        background: rgba(15, 23, 42, 0.94);
        border: 1.5px solid rgba(56, 189, 248, 0.45);
        backdrop-filter: blur(14px);
        padding: 7px 13px;
        border-radius: 24px;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 7px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        cursor: pointer;
        user-select: none;
        transition: all 0.2s ease;
    `;
    badge.innerHTML = `
        <span id="fb-pos-badge-dot" style="width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 8px #f59e0b;"></span>
        <span id="fb-pos-badge-text">⚡ Connecting: ${getHostLabel(posServerUrl)}</span>
        <span id="fb-pos-badge-count" style="font-size:10px;background:#1e293b;padding:2px 6px;border-radius:10px;color:#38bdf8;">0 Synced</span>
    `;

    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMiniMenu();
    });

    document.body.appendChild(badge);
    createMiniMenu();
}

// Floating Mini Switcher Menu directly on Facebook page
function createMiniMenu() {
    if (document.getElementById('fb-pos-mini-menu')) return;

    const menu = document.createElement('div');
    menu.id = 'fb-pos-mini-menu';
    menu.style.cssText = `
        position: fixed;
        bottom: 64px;
        right: 20px;
        z-index: 10000000;
        background: #0f172a;
        border: 1.5px solid #334155;
        border-radius: 12px;
        padding: 12px;
        width: 260px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.6);
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: none;
        flex-direction: column;
        gap: 8px;
    `;
    menu.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <strong style="font-size:12px;color:#38bdf8;">⚡ FB Live POS Host</strong>
            <button id="fb-pos-menu-close" style="background:transparent;border:none;color:#94a3b8;font-size:14px;cursor:pointer;padding:2px 5px;">✕</button>
        </div>
        <div style="font-size:10px;color:#94a3b8;">Select your POS hosting location:</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
            <button id="fb-pos-btn-render" style="padding:6px 4px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;background:#0369a1;color:#fff;border:1px solid #38bdf8;">☁️ Cloud Render</button>
            <button id="fb-pos-btn-local" style="padding:6px 4px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;background:#1e293b;color:#e2e8f0;border:1px solid #475569;">💻 Localhost</button>
        </div>
        <div style="font-size:9px;color:#64748b;word-break:break-all;" id="fb-pos-active-url">${posServerUrl}</div>
        <button id="fb-pos-btn-open" style="width:100%;padding:7px;border-radius:7px;background:linear-gradient(135deg, #1877f2, #0284c7);border:none;color:#fff;font-size:11px;font-weight:800;cursor:pointer;">🛒 Open Cashier Live</button>
    `;

    document.body.appendChild(menu);

    document.getElementById('fb-pos-menu-close')?.addEventListener('click', () => {
        menu.style.display = 'none';
    });

    document.getElementById('fb-pos-btn-render')?.addEventListener('click', () => {
        setServerUrl('https://fb-live-shop.onrender.com');
    });

    document.getElementById('fb-pos-btn-local')?.addEventListener('click', () => {
        setServerUrl('http://localhost:3000');
    });

    document.getElementById('fb-pos-btn-open')?.addEventListener('click', () => {
        window.open(`${posServerUrl}/cashier/live.html`, '_blank');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#fb-pos-mini-menu') && !e.target.closest('#fb-pos-floating-badge')) {
            menu.style.display = 'none';
        }
    });
}

function toggleMiniMenu() {
    const menu = document.getElementById('fb-pos-mini-menu');
    if (menu) {
        menu.style.display = menu.style.display === 'none' || !menu.style.display ? 'flex' : 'none';
    }
}

function updateBadge(connected, count, hostLabel) {
    const dot = document.getElementById('fb-pos-badge-dot');
    const txt = document.getElementById('fb-pos-badge-text');
    const cnt = document.getElementById('fb-pos-badge-count');
    const activeUrlEl = document.getElementById('fb-pos-active-url');

    if (activeUrlEl) activeUrlEl.textContent = posServerUrl;

    if (dot && txt) {
        if (connected) {
            dot.style.background = '#22c55e';
            dot.style.boxShadow = '0 0 8px #22c55e';
            txt.textContent = `⚡ POS Online: ${hostLabel}`;
        } else {
            dot.style.background = '#ef4444';
            dot.style.boxShadow = '0 0 8px #ef4444';
            txt.textContent = `⚠️ POS Offline: ${hostLabel}`;
        }
    }
    if (cnt) cnt.textContent = `${count} Synced`;
}

// ── 2. Connection Health Check & Host Switching ────────────────────────────────
async function checkPosConnection() {
    const hostLabel = getHostLabel(posServerUrl);
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        const res = await fetch(`${posServerUrl}/api/comments/status`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
            isPosReachable = true;
            updateBadge(true, syncedCount, hostLabel);
        } else {
            isPosReachable = false;
            updateBadge(false, syncedCount, hostLabel);
        }
    } catch (err) {
        isPosReachable = false;
        updateBadge(false, syncedCount, hostLabel);
    }
}

function setServerUrl(newUrl) {
    posServerUrl = newUrl.replace(/\/+$/, '');
    if (chrome?.storage?.local) {
        chrome.storage.local.set({ pos_server_url: posServerUrl });
    }
    updateBadge(false, syncedCount, getHostLabel(posServerUrl));
    checkPosConnection();
}

// Initialize server URL from storage (default to Cloud Render)
if (chrome?.storage?.local) {
    chrome.storage.local.get(['pos_server_url'], (res) => {
        if (res.pos_server_url) {
            posServerUrl = res.pos_server_url.replace(/\/+$/, '');
        }
        checkPosConnection();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.pos_server_url) {
            posServerUrl = changes.pos_server_url.newValue.replace(/\/+$/, '');
            checkPosConnection();
        }
    });
} else {
    checkPosConnection();
}

// Periodic Health Check every 8 seconds
healthCheckTimer = setInterval(checkPosConnection, 8000);

// ── 3. Send Scraped Comment to POS ────────────────────────────────────────────
async function sendCommentToPos(author, text) {
    const endpoint = `${posServerUrl}/api/comments/process-stream`;
    try {
        const payload = {
            sender_name: author,
            text: text,
            autoPokup: true,
            timestamp: new Date().toISOString()
        };

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment: payload })
        });

        if (res.ok) {
            const data = await res.json();
            isPosReachable = true;
            syncedCount++;
            updateBadge(true, syncedCount, getHostLabel(posServerUrl));

            if (data.results && data.results[0] && data.results[0].isPokUp && data.results[0].status === 'CONFIRMED') {
                console.log(`🎉 [FB Live POS] Order Booked on ${posServerUrl}! ${author} -> ${text}`);
            }
        } else {
            isPosReachable = false;
            updateBadge(false, syncedCount, getHostLabel(posServerUrl));
        }
    } catch (err) {
        console.warn(`[FB Live POS Sync Error] Could not reach ${endpoint}:`, err.message);
        isPosReachable = false;
        updateBadge(false, syncedCount, getHostLabel(posServerUrl));
    }
}

// ── 4. DOM Scanner for Live Stream Comments ──────────────────────────────────
function extractCommentFromNode(rawText) {
    if (!rawText || rawText.length < 3 || rawText.length > 500) return null;
    let lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;

    // Remove Facebook action buttons (Reply, Pin, etc.)
    lines = lines.filter(line => !/^(Reply|Pin|Hide|Like|Share|Report|Translate|Send message|Send Message|View more|ឆ្លើយតប)$/i.test(line));
    if (lines.length === 0) return null;

    let author = 'Live Viewer';
    let message = '';

    // Format 1: "Pu Deth · 1m" on first line
    if (lines[0].includes('·') || /[-•·\s]*\b\d+\s*[smhdwy]\b/i.test(lines[0])) {
        author = lines[0].replace(/[-•·\s]*\b\d+\s*[smhdwy]\b.*/i, '').trim() || 'Live Viewer';
        message = lines.slice(1).join(' ').trim();
    } else if (lines.length >= 2 && (/^[-•·\s]*\d+\s*[smhdwy]/i.test(lines[1]) || /just now/i.test(lines[1]))) {
        // Format 2: Line 0 is author, Line 1 is timestamp, Line 2 is message
        author = lines[0];
        message = lines.slice(2).join(' ').trim();
    } else if (lines.length >= 2) {
        author = lines[0];
        message = lines.slice(1).join(' ').trim();
    } else {
        const colonIdx = lines[0].indexOf(':');
        if (colonIdx > 0 && colonIdx < 30) {
            author = lines[0].slice(0, colonIdx).trim();
            message = lines[0].slice(colonIdx + 1).trim();
        } else {
            message = lines[0];
        }
    }

    message = message
        .replace(/\b(Reply|Pin|Hide|Like|Share|Report|Translate|Send message)\b/gi, '')
        .replace(/^[-•·\s]*\d+\s*[smhdwy]\b/i, '')
        .replace(/^[-•·\s]*just now\b/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!message || message.length < 2) return null;
    return { author, message };
}

function findCommentElements() {
    const candidates = new Set();
    // 1. Standard Facebook Watch comments
    document.querySelectorAll('[role="article"], div[data-visualcompletion="ignore-dynamic"]').forEach(el => candidates.add(el));

    // 2. Facebook Live Producer rows
    document.querySelectorAll('div[role="row"], div[role="listitem"]').forEach(el => candidates.add(el));

    // 3. Comments with Reply or Pin buttons in Live Producer
    document.querySelectorAll('div, span, button').forEach(el => {
        const txt = (el.innerText || '').trim();
        if (txt === 'Reply' || txt === 'Pin' || txt === 'ឆ្លើយតប') {
            const parent = el.closest('[role="row"], [role="listitem"], [role="article"]') || el.parentElement?.parentElement;
            if (parent) candidates.add(parent);
        }
    });

    return Array.from(candidates);
}

function isOldTimestamp(rawText) {
    if (!rawText) return false;
    if (/just now|now|\b\d+\s*s\b/i.test(rawText)) return false;
    // Only filter comments that are >4 hours or from previous days/weeks/years
    const m = rawText.match(/[-•·\s]*\b(\d+)\s*([smhdwy])\b/i);
    if (m) {
        const val = parseInt(m[1], 10);
        const unit = m[2].toLowerCase();
        if (unit === 'd' || unit === 'w' || unit === 'y') return true;
        if (unit === 'h' && val >= 4) return true;
    }
    return false;
}

function scanFacebookComments() {
    const commentNodes = findCommentElements();

    commentNodes.forEach(node => {
        const rawText = (node.innerText || '').trim();
        if (!rawText || rawText.length < 3 || rawText.length > 500) return;

        // Skip ancient comments (>4 hours or days old)
        if (isOldTimestamp(rawText)) return;

        const extracted = extractCommentFromNode(rawText);
        if (!extracted || !extracted.message) return;

        const { author, message } = extracted;

        // Signature based on author + message text
        const signature = `${author}:::${message}`;
        if (processedComments.has(signature)) return;

        processedComments.add(signature);

        if (processedComments.size > 2000) {
            const arr = Array.from(processedComments);
            processedComments.clear();
            arr.slice(-1000).forEach(s => processedComments.add(s));
        }

        console.log(`💬 [FB Live POS] Detected comment from "${author}": "${message}"`);
        sendCommentToPos(author, message);
    });
}

// ── 5. Initialize Extension ───────────────────────────────────────────────────
createFloatingBadge();

const domObserver = new MutationObserver(() => {
    scanFacebookComments();
});

if (document.body) {
    domObserver.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', () => {
        domObserver.observe(document.body, { childList: true, subtree: true });
    });
}

setInterval(scanFacebookComments, 300);

