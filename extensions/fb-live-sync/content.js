/**
 * Facebook Live POS - Real-Time Comment Auto-Sync Extension
 * Captures live stream comments from Facebook DOM and transmits to local POS
 */

console.log('🚀 [FB Live POS Extension] Loaded on Facebook!');

const POS_API_ENDPOINT = 'http://localhost:3000/api/comments/process-stream';
const processedComments = new Set();
let isPosReachable = false;
let syncedCount = 0;

// Create floating status badge on Facebook page
function createFloatingBadge() {
    if (document.getElementById('fb-pos-floating-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'fb-pos-floating-badge';
    badge.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999999;
        background: rgba(15, 23, 42, 0.92);
        border: 1.5px solid rgba(56, 189, 248, 0.4);
        backdrop-filter: blur(12px);
        padding: 8px 14px;
        border-radius: 24px;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.45);
        cursor: pointer;
        transition: all 0.2s ease;
    `;
    badge.innerHTML = `
        <span id="fb-pos-badge-dot" style="width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;"></span>
        <span id="fb-pos-badge-text">⚡ FB Live POS: Active</span>
        <span id="fb-pos-badge-count" style="font-size:10px;background:#1e293b;padding:2px 6px;border-radius:10px;color:#38bdf8;">0 Synced</span>
    `;

    badge.addEventListener('click', () => {
        window.open('http://localhost:3000/cashier/live.html', '_blank');
    });

    document.body.appendChild(badge);
}

// Update floating badge status
function updateBadge(connected, count) {
    const dot = document.getElementById('fb-pos-badge-dot');
    const txt = document.getElementById('fb-pos-badge-text');
    const cnt = document.getElementById('fb-pos-badge-count');

    if (dot && txt) {
        if (connected) {
            dot.style.background = '#22c55e';
            dot.style.boxShadow = '0 0 8px #22c55e';
            txt.textContent = '⚡ FB Live POS: Active';
        } else {
            dot.style.background = '#ef4444';
            dot.style.boxShadow = '0 0 8px #ef4444';
            txt.textContent = '⚠️ FB Live POS: Offline';
        }
    }
    if (cnt) cnt.textContent = `${count} Synced`;
}

// Send comment to local POS system
async function sendCommentToPos(author, text) {
    try {
        const payload = {
            sender_name: author,
            text: text,
            autoPokup: true,
            timestamp: new Date().toISOString()
        };

        const res = await fetch(POS_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment: payload })
        });

        if (res.ok) {
            const data = await res.json();
            isPosReachable = true;
            syncedCount++;
            updateBadge(true, syncedCount);

            if (data.results && data.results[0] && data.results[0].isPokUp && data.results[0].status === 'CONFIRMED') {
                console.log(`🎉 [FB Live POS] Order Booked! ${author} -> ${text}`);
            }
        }
    } catch (err) {
        isPosReachable = false;
        updateBadge(false, syncedCount);
    }
}

/**
 * Scan Facebook DOM for comments across Watch page and Live Producer
 */
function scanFacebookComments() {
    // 1. Selector strategy for Facebook Live chat
    const commentNodes = document.querySelectorAll(
        '[role="article"], div[data-visualcompletion="ignore-dynamic"], div.x1n2onr6'
    );

    commentNodes.forEach(node => {
        const rawText = (node.innerText || '').trim();
        if (!rawText || rawText.length < 2 || rawText.length > 400) return;

        // Extract lines
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) return;

        // Check if this looks like a comment (has an author or author + message)
        let author = 'Live Viewer';
        let message = '';

        if (lines.length >= 2) {
            author = lines[0];
            const rest = lines.slice(1);
            // Skip timestamp line if present (e.g. 8m, 13m, Just now)
            if (/^[-•·\s]*\d+\s*[smhd]|just now/i.test(rest[0])) {
                message = rest.slice(1).join(' ');
            } else {
                message = rest.join(' ');
            }
        } else {
            message = lines[0];
        }

        // Clean action links & Facebook Producer buttons (Hide, Reply, Pin, Like, etc.)
        message = message
            .replace(/^[-•·\s]*\d+\s*[smhd]\b/i, '')
            .replace(/^[-•·\s]*just now\b/i, '')
            .replace(/\b(Hide|Reply|Pin|Like|Share|Report|Translate|Send message|Send Message)\b/gi, '')
            .replace(/\s+/g, ' ')
        // Ignore comments that already have timestamps like 1m, 2m, 1h, etc.
        const isOld = /[-•·\s]*\b(\d+)\s*([smhd])\b/i.test(rawText) && !/just now/i.test(rawText);
        if (isOld) {
            const timeMatch = rawText.match(/[-•·\s]*\b(\d+)\s*([smhd])\b/i);
            if (timeMatch) {
                const val = parseInt(timeMatch[1], 10);
                const unit = timeMatch[2].toLowerCase();
                if (unit === 'h' || unit === 'd' || (unit === 'm' && val >= 1)) {
                    // Mark as seen so we don't log it, but do not send
                    processedComments.add(signature);
                    return;
                }
            }
        }

        if (!message) return;

        const signature = `${author}:::${message}`;
        if (processedComments.has(signature)) return;

        processedComments.add(signature);

        // Prevent memory leak
        if (processedComments.size > 2000) {
            const arr = Array.from(processedComments);
            processedComments.clear();
            arr.slice(-1000).forEach(s => processedComments.add(s));
        }

        console.log(`💬 [FB Live POS] Detected NEW comment from "${author}": "${message}"`);
        sendCommentToPos(author, message);
    });
}

// 1. Initial Baseline: Mark all comments already on the screen as processed so we ONLY send NEW incoming comments!
function markBaselineComments() {
    const existingNodes = document.querySelectorAll(
        '[role="article"], div[data-visualcompletion="ignore-dynamic"], div.x1n2onr6, div.xdj266r'
    );
    existingNodes.forEach(node => {
        const rawText = (node.innerText || '').trim();
        if (rawText) {
            processedComments.add(rawText.slice(0, 80));
        }
    });
    console.log(`🛡️ [FB Live POS] Baseline initialized: ${existingNodes.length} existing comments filtered out.`);
}

// Initialize immediately on page load
createFloatingBadge();
markBaselineComments();

// High-speed real-time MutationObserver (0ms trigger on brand new incoming comments)
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

// Fast fallback interval (every 200ms)
setInterval(scanFacebookComments, 200);
