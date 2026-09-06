const express = require('express');
const router = express.Router();
const https = require('https');
const { pool } = require('../config/database');

let ioInstance = null;

function setSocketIO(io) {
    ioInstance = io;
}

// Memory state for Facebook Live Polling
let fbPoller = {
    timer: null,
    isRunning: false,
    liveVideoId: '',
    accessToken: '',
    intervalMs: 2000,
    processedCommentIds: new Set(),
    processedCount: 0,
    pokupCount: 0,
    lastError: null,
    startedAt: null
};

// Memory cache for recent live stream comments
let recentStreamComments = [];
const MAX_RECENT_COMMENTS = 50;

function addRecentComment(item) {
    recentStreamComments.unshift(item);
    if (recentStreamComments.length > MAX_RECENT_COMMENTS) {
        recentStreamComments.pop();
    }
}

// In-memory cache for ultra-low latency (<2ms response)
let cachedCatalog = null;
let catalogCacheTime = 0;
const CATALOG_CACHE_TTL = 4000; // 4s TTL

async function getProductCatalog(force = false) {
    const now = Date.now();
    if (!force && cachedCatalog && (now - catalogCacheTime < CATALOG_CACHE_TTL)) {
        return cachedCatalog;
    }
    try {
        const [products] = await pool.query(
            'SELECT id, product_code, name, price, stock FROM products WHERE status != "inactive"'
        );
        cachedCatalog = products;
        catalogCacheTime = now;
        return products;
    } catch (e) {
        console.error('Error fetching product catalog:', e.message);
        return cachedCatalog || [];
    }
}

let cachedSession = null;
let sessionCacheTime = 0;
async function getActiveLiveSession(force = false) {
    const now = Date.now();
    if (!force && cachedSession !== undefined && (now - sessionCacheTime < 4000)) {
        return cachedSession;
    }
    try {
        const [sessions] = await pool.query(
            'SELECT * FROM live_sessions WHERE status = "active" ORDER BY started_at DESC LIMIT 1'
        );
        cachedSession = sessions.length > 0 ? sessions[0] : null;
        sessionCacheTime = now;
        return cachedSession;
    } catch (e) {
        return cachedSession || null;
    }
}

// Khmer Digits & Words Normalization Maps
const KHMER_DIGITS_MAP = { '០': '0', '១': '1', '២': '2', '៣': '3', '៤': '4', '៥': '5', '៦': '6', '៧': '7', '៨': '8', '៩': '9' };
const KHMER_NUM_WORDS_MAP = { 'មួយ': 1, 'ពីរ': 2, 'បី': 3, 'បួន': 4, 'ប្រាំ': 5, 'ប្រាំមួយ': 6, 'ប្រាំពីរ': 7, 'ប្រាំបី': 8, 'ប្រាំបួន': 9, 'ដប់': 10 };

function normalizeKhmerDigits(str) {
    if (!str) return '';
    let res = str;
    for (const [k, v] of Object.entries(KHMER_DIGITS_MAP)) {
        res = res.replaceAll(k, v);
    }
    return res;
}

/**
 * Intelligent Comment Parser for Pok Up (booking products)
 * Accurately detects:
 * - Short comments: "P02", "po1", "p1", "PO2 2", "po1 10", "យកP02", "p 02"
 * - Letter 'o' / 'O' for zero: "po1" -> "P01", "po2" -> "P02", "po5" -> "P005"
 * - Khmer scripts: "យក P02 10 អាវ 068656263", "យកpo1 ២ 012345678", "យក po1 មួយ"
 * - Long comments with addresses, polite words, phone numbers, and units
 */
function parseCommentText(commentText, catalog, onAirProduct = null) {
    if (!commentText || typeof commentText !== 'string') {
        return { isPokUp: false, reason: 'Empty text' };
    }

    let text = normalizeKhmerDigits(commentText.trim());

    // 0. Clean Facebook Live Producer & Watch UI artifacts:
    text = text
        .replace(/^[-•·\s]*\d+\s*[smhdwy]\b/i, '')
        .replace(/^[-•·\s]*just now\b/i, '')
        .replace(/\b(Hide|Reply|Pin|Like|Share|Report|Translate|Send message|Send Message)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    // 1. Extract Phone Number (safe boundary so it never consumes "01" / "02" from "P01" / "P02")
    let phoneNumber = null;
    const phoneMatch = text.match(/(?:^|[^0-9a-zA-Z])((?:\+?855[\s.-]?|0)[1-9][0-9\s.-]{7,9})(?![0-9a-zA-Z])/);
    if (phoneMatch) {
        phoneNumber = phoneMatch[1].replace(/[\s.-]/g, '');
        if (phoneNumber.startsWith('+855')) {
            phoneNumber = '0' + phoneNumber.slice(4);
        } else if (phoneNumber.startsWith('855')) {
            phoneNumber = '0' + phoneNumber.slice(3);
        }
    }

    // Isolate text without phone number for accurate code & quantity detection
    const textWithoutPhone = (phoneNumber && phoneMatch) ? text.replace(phoneMatch[1], ' ') : text;

    // 2. Identify Product Code with Smart Normalization (supports 'po1', 'P02', 'p1', 'p 01', 'យកP02')
    let matchedProduct = null;
    let matchedCode = null;
    let matchedSubstr = null;

    // Sort catalog by product_code length descending so longer codes (e.g. P005) match before shorter (P5)
    const sortedCatalog = [...(catalog || [])].sort((a, b) => (b.product_code || '').length - (a.product_code || '').length);

    for (const prod of sortedCatalog) {
        if (!prod.product_code) continue;

        const codeClean = prod.product_code.trim();
        // Match code with letters + numbers: e.g. "P01", "P02", "P005"
        const codeParts = codeClean.match(/^([a-zA-Z]+)[-_.]*0*(\d+)$/);

        let codeRegex = null;
        if (codeParts) {
            const prefix = codeParts[1];
            const num = codeParts[2];
            // Matches:
            // - Starts at string start or non-alphanumeric (including Khmer characters like យក)
            // - prefix (e.g. 'P' or 'p')
            // - optional space, dash, dot: [\s\-_.]*
            // - optional zeros or letter 'o'/'O' or spaces: [0oO\s]*
            // - number: num (e.g. 1 or 2)
            // - Not followed by letters or digits: (?![0-9a-zA-Z])
            codeRegex = new RegExp('(^|[^a-zA-Z0-9])(' + prefix + '[\\s\\-_.]*[0oO\\s]*' + num + ')(?![0-9a-zA-Z])', 'i');
        } else {
            const codeEscaped = codeClean.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            codeRegex = new RegExp('(^|[^a-zA-Z0-9])(' + codeEscaped + ')(?![0-9a-zA-Z])', 'i');
        }

        const match = textWithoutPhone.match(codeRegex);
        if (match) {
            matchedProduct = prod;
            matchedCode = prod.product_code;
            matchedSubstr = match[2]; // e.g. "po1", "P02", "p1"
            break;
        }
    }

    // 3. Fallback: If no code found, check if comment expresses "CF", "Pok", "Buy", "Want", "យក"
    // and an ON-AIR product is currently active
    if (!matchedProduct && onAirProduct) {
        const cfRegex = /\b(cf|pok|buy|order|want|yok)\b|យក|បិទ|ពុក|កក់/i;
        if (cfRegex.test(textWithoutPhone)) {
            matchedProduct = onAirProduct;
            matchedCode = onAirProduct.product_code;
            matchedSubstr = onAirProduct.product_code;
        }
    }

    if (!matchedProduct) {
        return {
            isPokUp: false,
            phoneNumber,
            rawText: commentText,
            reason: 'No matching product code found'
        };
    }

    // 4. Extract Quantity (Smart detection across short & long comments)
    let quantity = 1;

    // A. Explicit multiplier: x2, *3, =4, qty 2, ចំនួន 2, etc.
    const explicitMult = textWithoutPhone.match(/(?:[xX*=:–-]|qty|កំរិត|ចំនួន)\s*([1-9][0-9]?)/i);
    if (explicitMult) {
        quantity = parseInt(explicitMult[1], 10);
    } else {
        // B. Khmer number words: មួយ, ពីរ, បី, បួន, etc.
        let wordFound = false;
        for (const [w, val] of Object.entries(KHMER_NUM_WORDS_MAP)) {
            if (textWithoutPhone.includes(w)) {
                quantity = val;
                wordFound = true;
                break;
            }
        }

        if (!wordFound) {
            // C. Quantity with unit: 2អាវ, 2កំប៉ុង, 2pcs, 2 pcs, 2ដប, 2ឈុត, 2គូ, 2កញ្ចប់, 2ប្រអប់
            const unitMatch = textWithoutPhone.match(/([1-9][0-9]?)\s*(?:pcs|pc|items|unit|units|អាវ|កំប៉ុង|ដប|ឈុត|គូ|កញ្ចប់|ប្រអប់|កែវ|ថង់|គីឡូ|kg)/i);
            if (unitMatch) {
                quantity = parseInt(unitMatch[1], 10);
            } else if (matchedSubstr) {
                // D. Number immediately following the matched code: e.g. "po1 2", "P02 10"
                const subEscaped = matchedSubstr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const afterCodeMatch = textWithoutPhone.match(new RegExp(subEscaped + '\\s*([1-9][0-9]?)', 'i'));
                if (afterCodeMatch && afterCodeMatch[1]) {
                    quantity = parseInt(afterCodeMatch[1], 10);
                }
            }
        }
    }

    if (isNaN(quantity) || quantity <= 0) quantity = 1;
    if (quantity > 100) quantity = 100;

    return {
        isPokUp: true,
        product: matchedProduct,
        productCode: matchedCode,
        quantity,
        phoneNumber,
        rawText: commentText
    };
}

/**
 * Execute automatic Pok Up order creation and stock deduction
 */
async function executeAutoPokUp(parsedData, customerName = 'FB Live Viewer', commentId = null) {
    const { product, quantity, phoneNumber, rawText } = parsedData;

    try {
        // Re-verify latest product stock directly from database
        const [freshProducts] = await pool.query(
            'SELECT id, product_code, name, price, stock FROM products WHERE id = ?',
            [product.id]
        );

        if (freshProducts.length === 0) {
            return {
                success: false,
                status: 'PRODUCT_NOT_FOUND',
                message: `Product ${product.product_code} not found in database`
            };
        }

        const freshProduct = freshProducts[0];

        // Stock validation
        if (freshProduct.stock < quantity) {
            const outOfStockEvent = {
                type: 'OUT_OF_STOCK',
                commentId,
                customerName,
                product: freshProduct,
                requestedQty: quantity,
                availableStock: freshProduct.stock,
                timestamp: new Date().toISOString()
            };

            if (ioInstance) {
                ioInstance.to('live-room').emit('pokup-out-of-stock', outOfStockEvent);
            }

            return {
                success: false,
                status: 'OUT_OF_STOCK',
                availableStock: freshProduct.stock,
                message: `Out of stock for ${freshProduct.product_code} (Requested: ${quantity}, Available: ${freshProduct.stock})`
            };
        }

        // Get or link live session
        const liveSession = await getActiveLiveSession();
        const sessionId = liveSession ? liveSession.id : null;

        const orderNumber = 'ORD-POK-' + Date.now().toString().slice(-6) + Math.random().toString(36).substr(2, 4).toUpperCase();
        const price = parseFloat(freshProduct.price) || 0;
        const totalAmount = (price * quantity).toFixed(2);
        const customerPhone = phoneNumber || '000000000';
        const customerAddress = 'FB Live Stream Order (Auto-Pokup)';
        const notes = `Auto-Pokup from Live Comment: "${rawText}"`;

        // 1. Insert into orders table
        const [orderResult] = await pool.query(
            `INSERT INTO orders 
             (order_number, customer_name, customer_email, customer_phone, customer_address, total_amount, notes, payment_method, payment_status, status, live_session_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'cod', 'unpaid', 'confirmed', ?)`,
            [orderNumber, customerName, `${customerName.toLowerCase().replace(/[^a-z0-9]/g, '')}@fblive.com`, customerPhone, customerAddress, totalAmount, notes, sessionId]
        );

        const orderId = orderResult.insertId;

        // 2 & 3. Insert into order_items table and deduct stock in parallel for ultra-low latency
        await Promise.all([
            pool.query(
                `INSERT INTO order_items 
                 (order_id, product_id, product_code, product_name, price, quantity, subtotal)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [orderId, freshProduct.id, freshProduct.product_code, freshProduct.name, price, quantity, totalAmount]
            ),
            pool.query(
                'UPDATE products SET stock = stock - ? WHERE id = ?',
                [quantity, freshProduct.id]
            )
        ]);
        cachedCatalog = null; // Invalidate cache immediately

        const orderPayload = {
            order_id: orderId,
            order_number: orderNumber,
            customer_name: customerName,
            customer_phone: customerPhone,
            product_id: freshProduct.id,
            product_code: freshProduct.product_code,
            product_name: freshProduct.name,
            price: price,
            quantity: quantity,
            total_amount: totalAmount,
            notes: notes,
            created_at: new Date().toISOString()
        };

        // 4. Emit real-time Socket.IO events
        if (ioInstance) {
            // Trigger standard order notification for OBS Overlay slide & banner
            ioInstance.to('live-room').emit('order-notification', {
                customer_name: customerName,
                product_name: `${freshProduct.name} (${freshProduct.product_code} x${quantity})`,
                total_amount: `$${totalAmount}`,
                order_number: orderNumber
            });

            // Dedicated pokup confirmed event for Cashier live UI
            ioInstance.to('live-room').emit('pokup-confirmed', orderPayload);
        }

        return {
            success: true,
            status: 'CONFIRMED',
            order: orderPayload,
            message: `Order #${orderNumber} automatically booked for ${customerName}!`
        };

    } catch (e) {
        console.error('Execute Auto-Pokup Error:', e);
        return {
            success: false,
            status: 'ERROR',
            message: e.message
        };
    }
}

/**
 * Process a single incoming comment through the entire automated pipeline
 */
async function processIncomingComment(commentObj, catalog = null, onAirProduct = null, autoCreateOrder = true) {
    if (!catalog) {
        catalog = await getProductCatalog();
    }
    if (onAirProduct === null) {
        const liveSession = await getActiveLiveSession();
        if (liveSession && liveSession.current_product_id) {
            const onAir = catalog.find(p => p.id === liveSession.current_product_id);
            if (onAir) onAirProduct = onAir;
        }
    }

    // Standardize comment fields
    let commentId = commentObj.id || `c_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    let commentText = commentObj.message || commentObj.text || commentObj.comment || '';
    let commenterName = 'Live Viewer';

    if (commentObj.from && commentObj.from.name) {
        commenterName = commentObj.from.name;
    } else if (commentObj.sender_name || commentObj.customer_name || commentObj.name) {
        commenterName = commentObj.sender_name || commentObj.customer_name || commentObj.name;
    } else if (commentText.includes('\n')) {
        // Facebook DOM format: "Author\n8m\nMessage"
        const lines = commentText.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
            commenterName = lines[0];
            const rest = lines.slice(1);
            if (/^[-•·\s]*\d+\s*[smhdwy]|just now/i.test(rest[0])) {
                commentText = rest.slice(1).join(' ');
            } else {
                commentText = rest.join(' ');
            }
        }
    } else {
        // Try to parse "Name: Comment" format
        const colonSplit = commentText.split(/:\s*(.+)/);
        if (colonSplit.length >= 2 && colonSplit[0].length < 30) {
            commenterName = colonSplit[0].trim();
            commentText = colonSplit[1].trim();
        }
    }

    // Clean any attached timestamp artifact from commenter name (e.g. "Pu Deth · 1m" -> "Pu Deth")
    commenterName = commenterName.replace(/[-•·\s]*\b\d+\s*[smhdwy]\b.*/i, '').trim() || 'Live Viewer';

    // Filter out Facebook Producer UI artifacts & timer counters
    if (
        /^\s*\d{1,2}:\d{2}(:\d{2})?\s*$/.test(commentText) ||
        /Now that you're live|End live video|Dashboard Insights|Interactivity Distribution/i.test(commentText) ||
        /^(Lives in|Studied at|Works at|Followed by|Media & Robotic Team)\b/i.test(commentText) ||
        /^Live dashboard$/i.test(commenterName)
    ) {
        return {
            commentId,
            commenterName,
            commentText,
            isPokUp: false,
            status: 'IGNORED_UI',
            reason: 'Filtered Facebook UI noise'
        };
    }

    // Filter out ancient past comments (e.g. from yesterday's post or >4h ago) — Keep all live stream comments!
    const timeMatch = (commentObj.message || commentObj.text || commentObj.comment || '').match(/[-•·\s]*\b(\d+)\s*([smhdwy])\b/i);
    if (timeMatch && !/just now|now|\b\d+\s*s\b/i.test(commentObj.message || commentObj.text || commentObj.comment || '')) {
        const val = parseInt(timeMatch[1], 10);
        const unit = timeMatch[2].toLowerCase();
        if (unit === 'd' || unit === 'w' || unit === 'y' || (unit === 'h' && val >= 4)) {
            // Drop ancient comment from previous day/stream
            return {
                commentId,
                commenterName,
                commentText,
                isPokUp: false,
                status: 'IGNORED_OLD',
                reason: `Filtered old comment from ${val}${unit} ago`
            };
        }
    }

    // Run Parser
    const parsed = parseCommentText(commentText, catalog, onAirProduct);

    let result = {
        commentId,
        commenterName,
        commentText,
        timestamp: commentObj.created_time || new Date().toISOString(),
        isPokUp: parsed.isPokUp,
        details: parsed
    };

    if (parsed.isPokUp && autoCreateOrder) {
        const pokupResult = await executeAutoPokUp(parsed, commenterName, commentId);
        result.orderResult = pokupResult;
        result.status = pokupResult.status;
    } else if (parsed.isPokUp && !autoCreateOrder) {
        result.status = 'READY_TO_BOOK';
    } else {
        result.status = 'CHAT';
    }

    addRecentComment(result);

    // Broadcast live comment feed item to Cashier
    if (ioInstance) {
        ioInstance.to('live-room').emit('live-comment-received', result);
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Facebook Graph API Background Poller
// ─────────────────────────────────────────────────────────────────────────────

function fetchFacebookComments(videoId, accessToken) {
    return new Promise((resolve, reject) => {
        const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(videoId)}/comments?access_token=${encodeURIComponent(accessToken)}&order=reverse_chronological&limit=25`;

        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        return reject(new Error(parsed.error.message || 'Facebook API Error'));
                    }
                    resolve(parsed.data || []);
                } catch (e) {
                    reject(new Error('Failed to parse Facebook response: ' + e.message));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function runFbPollingCycle() {
    if (!fbPoller.isRunning || !fbPoller.liveVideoId || !fbPoller.accessToken) return;

    try {
        const comments = await fetchFacebookComments(fbPoller.liveVideoId, fbPoller.accessToken);
        fbPoller.lastError = null;

        const catalog = await getProductCatalog();
        const liveSession = await getActiveLiveSession();
        let onAirProduct = null;
        if (liveSession && liveSession.current_product_id) {
            onAirProduct = catalog.find(p => p.id === liveSession.current_product_id);
        }

        // Process new comments in chronological order (oldest to newest among the new batch)
        const newComments = comments.filter(c => !fbPoller.processedCommentIds.has(c.id)).reverse();

        for (const comment of newComments) {
            fbPoller.processedCommentIds.add(comment.id);
            fbPoller.processedCount++;

            // Prevent Set from growing indefinitely
            if (fbPoller.processedCommentIds.size > 2000) {
                const arr = Array.from(fbPoller.processedCommentIds);
                fbPoller.processedCommentIds = new Set(arr.slice(-1000));
            }

            const res = await processIncomingComment(comment, catalog, onAirProduct, true);
            if (res.isPokUp && res.orderResult && res.orderResult.success) {
                fbPoller.pokupCount++;
            }
        }
    } catch (err) {
        fbPoller.lastError = err.message;
        console.error('[FB Poller Error]:', err.message);
        // If token is invalid or missing, stop the loop immediately
        if (err.message && (err.message.includes('access token') || err.message.includes('OAuth'))) {
            fbPoller.isRunning = false;
        }
        if (ioInstance) {
            ioInstance.to('live-room').emit('fb-poller-status', {
                isRunning: fbPoller.isRunning,
                error: err.message
            });
        }
    } finally {
        if (fbPoller.isRunning) {
            fbPoller.timer = setTimeout(runFbPollingCycle, fbPoller.intervalMs);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// 1. Process a stream of incoming comments (batch or single)
router.post('/process-stream', async (req, res) => {
    try {
        const { comments, comment, autoPokup = true } = req.body;
        const catalog = await getProductCatalog();
        const liveSession = await getActiveLiveSession();
        let onAirProduct = null;
        if (liveSession && liveSession.current_product_id) {
            onAirProduct = catalog.find(p => p.id === liveSession.current_product_id);
        }

        let inputList = [];
        if (Array.isArray(comments)) {
            inputList = comments;
        } else if (comment) {
            inputList = [comment];
        } else if (req.body.text || req.body.message) {
            inputList = [req.body];
        }

        if (inputList.length === 0) {
            return res.status(400).json({ success: false, message: 'No comments provided' });
        }

        const results = [];
        for (const c of inputList) {
            const item = typeof c === 'string' ? { text: c } : c;
            const processed = await processIncomingComment(item, catalog, onAirProduct, autoPokup);
            results.push(processed);
        }

        // If received on local server, relay to Render cloud so cashier live.html gets it
        if (!process.env.RENDER && req.headers['x-forwarded-by'] !== 'fb-local-relay') {
            fetch('https://fb-live-shop.onrender.com/api/comments/process-stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-forwarded-by': 'fb-local-relay'
                },
                body: JSON.stringify(req.body)
            }).catch(err => console.warn('Relay to Render failed:', err.message));
        }

        res.json({
            success: true,
            count: results.length,
            pokupCount: results.filter(r => r.isPokUp && r.status === 'CONFIRMED').length,
            results
        });

    } catch (error) {
        console.error('Process stream error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Preview parse a comment without creating an order
router.post('/parse-preview', async (req, res) => {
    try {
        const { text } = req.body;
        const catalog = await getProductCatalog();
        const liveSession = await getActiveLiveSession();
        let onAirProduct = null;
        if (liveSession && liveSession.current_product_id) {
            onAirProduct = catalog.find(p => p.id === liveSession.current_product_id);
        }

        const parsed = parseCommentText(text, catalog, onAirProduct);
        res.json({ success: true, parsed });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 3. Start Facebook Live Polling
router.post('/start-fb-polling', (req, res) => {
    const { liveVideoId, accessToken, intervalMs = 2000 } = req.body;

    if (!liveVideoId) {
        return res.status(400).json({
            success: false,
            message: 'liveVideoId or video URL is required'
        });
    }

    if (!accessToken || accessToken === 'DEMO_TOKEN' || accessToken.length < 25) {
        return res.status(400).json({
            success: false,
            message: 'Facebook Graph API requires a verified Facebook Page Access Token (EAAB...). For personal Facebook streams, use the In-App Desktop Monitor or Browser Extension (zero tokens required).'
        });
    }

    // Clean video ID from any URL format (including Live Producer URLs)
    let cleanVideoId = liveVideoId.trim();
    const urlMatch = cleanVideoId.match(/(?:videos\/|v=|producer\/v\d+\/|\/videos\/|\/)(\d{10,25})/);
    if (urlMatch) {
        cleanVideoId = urlMatch[1];
    } else {
        const anyDigits = cleanVideoId.match(/\b(\d{12,25})\b/);
        if (anyDigits) cleanVideoId = anyDigits[1];
    }

    if (fbPoller.timer) clearTimeout(fbPoller.timer);

    fbPoller.isRunning = true;
    fbPoller.liveVideoId = cleanVideoId;
    fbPoller.accessToken = accessToken.trim();
    fbPoller.intervalMs = Math.max(1000, parseInt(intervalMs, 10) || 2000);
    fbPoller.startedAt = new Date().toISOString();
    fbPoller.lastError = null;

    // Start background cycle
    runFbPollingCycle();

    if (ioInstance) {
        ioInstance.to('live-room').emit('fb-poller-status', {
            isRunning: true,
            liveVideoId: cleanVideoId
        });
    }

    res.json({
        success: true,
        message: 'Facebook Live comment polling started',
        config: {
            liveVideoId: cleanVideoId,
            intervalMs: fbPoller.intervalMs,
            startedAt: fbPoller.startedAt
        }
    });
});

// 4. Stop Facebook Live Polling
router.post('/stop-fb-polling', (req, res) => {
    if (fbPoller.timer) clearTimeout(fbPoller.timer);
    fbPoller.isRunning = false;
    fbPoller.timer = null;

    if (ioInstance) {
        ioInstance.to('live-room').emit('fb-poller-status', {
            isRunning: false
        });
    }

    res.json({
        success: true,
        message: 'Facebook Live comment polling stopped',
        stats: {
            processedCount: fbPoller.processedCount,
            pokupCount: fbPoller.pokupCount
        }
    });
});

let isDesktopTrackingActive = false;

// 4b. Desktop / Extension Tracking Status Sync
router.post('/start-desktop-tracking', (req, res) => {
    const { videoId } = req.body;
    isDesktopTrackingActive = true;
    fbPoller.lastError = null;
    fbPoller.isRunning = true;
    if (videoId) fbPoller.liveVideoId = videoId;

    if (ioInstance) {
        ioInstance.to('live-room').emit('fb-poller-status', {
            isRunning: true,
            inApp: true,
            liveVideoId: fbPoller.liveVideoId
        });
    }
    res.json({ success: true, message: 'Desktop live tracking active' });
});

router.post('/stop-desktop-tracking', (req, res) => {
    isDesktopTrackingActive = false;
    fbPoller.isRunning = false;
    fbPoller.lastError = null;

    if (ioInstance) {
        ioInstance.to('live-room').emit('fb-poller-status', {
            isRunning: false,
            inApp: false
        });
    }
    res.json({ success: true, message: 'Desktop live tracking stopped' });
});

// 4c. Clear Recent Stream Comments
router.post('/clear-comments', (req, res) => {
    recentStreamComments = [];
    if (ioInstance) {
        ioInstance.to('live-room').emit('live-comments-cleared');
    }
    res.json({ success: true, message: 'Recent comments cleared' });
});

// 5. Get Polling & System Status
router.get('/status', (req, res) => {
    res.json({
        success: true,
        fbPoller: {
            isRunning: fbPoller.isRunning || isDesktopTrackingActive,
            inApp: isDesktopTrackingActive,
            liveVideoId: fbPoller.liveVideoId,
            intervalMs: fbPoller.intervalMs,
            processedCount: fbPoller.processedCount,
            pokupCount: fbPoller.pokupCount,
            lastError: null,
            startedAt: fbPoller.startedAt
        },
        recentComments: recentStreamComments.slice(0, 30)
    });
});

// 6. Simulate realistic live comments for 1-click testing
router.post('/simulate', async (req, res) => {
    try {
        const catalog = await getProductCatalog();
        if (catalog.length === 0) {
            return res.status(400).json({ success: false, message: 'No products in database to test' });
        }

        const sampleNames = [
            'Sokha Dara', 'Chan Bopha', 'Vannak Pro', 'Kosal Gaming',
            'Rithy Meng', 'Srey Leak', 'Piseth Shop', 'Chanthou Star'
        ];

        const samplePhones = [
            '012889900', '098765432', '089112233', '077556677', '096334455'
        ];

        const pInStock = catalog.find(p => p.stock > 0) || catalog[0];
        const pOutOfStock = catalog.find(p => p.stock === 0);

        const templates = [
            // Standard order
            { name: sampleNames[0], text: `${pInStock.product_code} 1 ${samplePhones[0]}` },
            // Multiple quantity
            { name: sampleNames[1], text: `CF ${pInStock.product_code} x2 ${samplePhones[1]}` },
            // Khmer text with phone
            { name: sampleNames[2], text: `យក ${pInStock.product_code} 1ដប ${samplePhones[2]}` },
            // Out of stock test
            pOutOfStock ? { name: sampleNames[3], text: `${pOutOfStock.product_code} 1 ${samplePhones[3]}` } : null,
            // Casual chat
            { name: sampleNames[4], text: `Hello streamer! Good evening!` }
        ].filter(Boolean);

        const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
        const result = await processIncomingComment({
            name: randomTemplate.name,
            text: randomTemplate.text
        }, catalog, null, true);

        res.json({
            success: true,
            simulatedComment: randomTemplate,
            result
        });

    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = {
    router,
    setSocketIO,
    processIncomingComment,
    parseCommentText
};
