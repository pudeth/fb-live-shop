const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// ── Helpers to persist QR config back into .env ──────────────────────────────
const ENV_PATH = path.join(__dirname, '.env');

function readEnvFile() {
    try { return fs.readFileSync(ENV_PATH, 'utf8'); }
    catch { return ''; }
}

function writeEnvValue(key, value) {
    // In production (Fly.io) env vars come from fly secrets — skip file writes
    if (process.env.NODE_ENV === 'production') return;
    let content = readEnvFile();
    const safeVal = (value === null || value === undefined) ? '' : String(value);
    const regex = new RegExp(`^(${key}=).*$`, 'm');
    if (regex.test(content)) {
        content = content.replace(regex, `$1${safeVal}`);
    } else {
        content += `\n${key}=${safeVal}`;
    }
    try { fs.writeFileSync(ENV_PATH, content, 'utf8'); } catch { /* read-only fs in container */ }
}
// ─────────────────────────────────────────────────────────────────────────────

const { testConnection } = require('./config/database');
const authRoutes = require('./routes/auth');
const productsRoutes = require('./routes/products');
const ordersRoutes = require('./routes/orders');
const liveRoutes = require('./routes/live');
const categoriesRoutes = require('./routes/categories');
const { setupLiveSocket } = require('./routes/socket-live');

const app = express();
const server = http.createServer(app);

// Socket.IO setup for real-time updates
const io = socketIo(server, {
    cors: {
        origin: '*',   // allow all origins for LAN access
        methods: ['GET', 'POST']
    }
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false
}));

// CORS — allow all origins so phones on the same WiFi can connect
app.use(cors({ origin: '*', credentials: false }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: { success: false, message: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', limiter);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes - Must come BEFORE static file serving
app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/categories', categoriesRoutes);

// Serve uploaded product images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/admin',    express.static(path.join(__dirname, '../frontend/admin')));
app.use('/cashier',  express.static(path.join(__dirname, '../frontend/cashier')));
app.use('/customer', express.static(path.join(__dirname, '../frontend/customer')));
app.use('/overlay',  express.static(path.join(__dirname, '../frontend/overlay')));
app.use('/public',   express.static(path.join(__dirname, '../frontend/public')));

// ── QR config — loaded from .env so it survives restarts ─────────────────────
// publicUrl  — optional custom URL set by the cashier (e.g. ngrok / domain)
// qrMode     — 'lan' | 'public'  (which URL to bake into QR codes)
const qrConfig = {
    publicUrl: process.env.PUBLIC_URL || null,
    qrMode:    (process.env.QR_MODE === 'public') ? 'public' : 'lan',
};
// ─────────────────────────────────────────────────────────────────────────────

// ── Server info — returns LAN IP + public URL so frontend can build QR codes ──
app.get('/api/server-info', (req, res) => {
    const os   = require('os');
    const nets = os.networkInterfaces();
    let lanIP  = null;
    for (const iface of Object.values(nets)) {
        for (const net of iface) {
            if (net.family === 'IPv4' && !net.internal) {
                lanIP = net.address;
                break;
            }
        }
        if (lanIP) break;
    }
    const port   = process.env.PORT || 3000;
    const lanUrl = lanIP ? `http://${lanIP}:${port}` : null;

    // activeUrl is what QR codes should actually encode
    const activeUrl =
        qrConfig.qrMode === 'public' && qrConfig.publicUrl
            ? qrConfig.publicUrl
            : lanUrl;

    res.json({
        success:    true,
        lanIP:      lanIP,
        port:       port,
        lanUrl:     lanUrl,
        publicUrl:  qrConfig.publicUrl,
        qrMode:     qrConfig.qrMode,
        baseUrl:    activeUrl,   // ← used by overlay & cashier for QR generation
    });
});

// ── Update QR config (set public URL and/or switch mode) ──
app.post('/api/server-info/qr-config', (req, res) => {
    const { publicUrl, qrMode } = req.body;

    if (qrMode !== undefined) {
        if (!['lan', 'public'].includes(qrMode)) {
            return res.status(400).json({ success: false, message: 'qrMode must be "lan" or "public"' });
        }
        qrConfig.qrMode = qrMode;
        writeEnvValue('QR_MODE', qrMode);           // ← persist
    }

    if (publicUrl !== undefined) {
        if (publicUrl === null || publicUrl === '') {
            qrConfig.publicUrl = null;
            writeEnvValue('PUBLIC_URL', '');         // ← persist (empty = none)
        } else {
            // Basic URL validation
            try {
                const u = new URL(publicUrl);
                if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
                // Warn if the URL does not look like a tunnel or self-hosted endpoint.
                // Block well-known third-party sites that are definitely not this server.
                const hostname = u.hostname.toLowerCase();
                const knownWrongDomains = [
                    'qr.gov.kh', 'facebook.com', 'google.com', 'github.com',
                    'youtube.com', 'instagram.com', 'tiktok.com', 'twitter.com',
                    'x.com', 'amazon.com', 'shopify.com',
                ];
                if (knownWrongDomains.some(d => hostname === d || hostname.endsWith('.' + d))) {
                    return res.status(400).json({
                        success: false,
                        message: `"${hostname}" is not a valid tunnel URL for this server. Use an ngrok / Cloudflare tunnel URL that points to this machine (e.g. https://xxxx.ngrok.io).`,
                    });
                }
                // Strip trailing slash for consistency
                qrConfig.publicUrl = publicUrl.replace(/\/$/, '');
                writeEnvValue('PUBLIC_URL', qrConfig.publicUrl); // ← persist
            } catch {
                return res.status(400).json({ success: false, message: 'Invalid URL — must start with http:// or https://' });
            }
        }
    }

    const port   = process.env.PORT || 3000;
    const os     = require('os');
    const nets   = os.networkInterfaces();
    let lanIP    = null;
    for (const iface of Object.values(nets)) {
        for (const net of iface) {
            if (net.family === 'IPv4' && !net.internal) { lanIP = net.address; break; }
        }
        if (lanIP) break;
    }
    const lanUrl    = lanIP ? `http://${lanIP}:${port}` : null;
    const activeUrl = qrConfig.qrMode === 'public' && qrConfig.publicUrl ? qrConfig.publicUrl : lanUrl;

    res.json({
        success:    true,
        message:    'QR config updated',
        lanUrl,
        publicUrl:  qrConfig.publicUrl,
        qrMode:     qrConfig.qrMode,
        baseUrl:    activeUrl,
    });

    // Broadcast to all connected overlay/cashier clients so they re-render QR instantly
    const io = req.app.get('io');
    if (io) io.emit('qr-config-updated', { baseUrl: activeUrl, qrMode: qrConfig.qrMode });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        success:   true,
        message:   'Server is running',
        timestamp: new Date().toISOString()
    });
});

// 404 handler - only for non-static files
app.use((req, res) => {
    // If it's an API request, send JSON
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ 
            success: false, 
            message: 'Route not found' 
        });
    } else {
        // For other requests, send HTML 404
        res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>404 - Page Not Found</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    h1 { color: #e74c3c; }
                    a { color: #3498db; text-decoration: none; }
                </style>
            </head>
            <body>
                <h1>404 - Page Not Found</h1>
                <p>The page you're looking for doesn't exist.</p>
                <p><a href="/admin/login.html">Go to Admin Login</a></p>
            </body>
            </html>
        `);
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ 
        success: false, 
        message: 'Internal server error' 
    });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('📱 Client connected:', socket.id);

    // Join live room
    socket.on('join-live', () => {
        socket.join('live-room');
        console.log('Client joined live-room');
    });

    // Leave live room
    socket.on('leave-live', () => {
        socket.leave('live-room');
        console.log('Client left live-room');
    });

    // Set up live socket handlers (show-product, hide-product, etc.)
    setupLiveSocket(io, socket);

    socket.on('disconnect', () => {
        console.log('📱 Client disconnected:', socket.id);
    });
});

// Make io accessible to routes
app.set('io', io);

// Start server
const PORT = process.env.PORT || 3000;

// Auto-migrate on startup in production (creates tables if they don't exist)
async function autoMigrate() {
    if (process.env.NODE_ENV !== 'production') return;
    try {
        console.log('🔄 Running auto-migration…');
        const fs   = require('fs');
        const path = require('path');
        const schemaPath = path.join(__dirname, '../database/schema.sql');
        const raw  = fs.readFileSync(schemaPath, 'utf8');
        const { pool } = require('./config/database');

        const statements = raw
            .split(/;\s*\n/)
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .filter(s => !/^(DROP DATABASE|CREATE DATABASE|USE )\b/i.test(s));

        let ok = 0, skipped = 0;
        for (const stmt of statements) {
            try {
                await pool.execute(stmt);
                ok++;
            } catch (e) {
                if (['ER_TABLE_EXISTS_ERROR','ER_DUP_ENTRY','ER_DUP_KEYNAME'].includes(e.code)) {
                    skipped++;
                } else {
                    console.warn('  Migration warning:', e.message.substring(0, 80));
                }
            }
        }
        console.log(`✅ Auto-migration: ${ok} statements run, ${skipped} skipped.`);

        // Fix default user passwords (correct bcrypt hashes for admin123 / cashier123)
        try {
            await pool.execute(
                `UPDATE users SET password='$2a$10$IIT2wtG0iDCwEksRQfpUY.fsfwpyk3hrzsxx5dgjM29eclYHvqjcq' WHERE username='admin' AND role='admin'`
            );
            await pool.execute(
                `UPDATE users SET password='$2a$10$Hv/ut6yZVPfoS3XRHBRR9.zend2PB7W7m2XCnG3NJZWAAanqOKR4S' WHERE username='cashier' AND role='cashier'`
            );
            console.log('✅ Default user passwords verified.');
        } catch(e) { /* non-fatal */ }
    } catch (err) {
        console.error('⚠️  Auto-migration error (non-fatal):', err.message);
    }
}

const startServer = async () => {
    try {
        const dbConnected = await testConnection();
        if (!dbConnected) {
            console.error('❌ Failed to connect to database. Please check your database configuration.');
            process.exit(1);
        }

        // Run schema migration automatically on first deploy
        await autoMigrate();

        // Bind to 0.0.0.0 so phones on the same WiFi can reach the server
        server.listen(PORT, '0.0.0.0', () => {
            // Get LAN IP for QR code display
            const os = require('os');
            const nets = os.networkInterfaces();
            let lanIP = 'YOUR_PC_IP';
            for (const iface of Object.values(nets)) {
                for (const net of iface) {
                    if (net.family === 'IPv4' && !net.internal) {
                        lanIP = net.address;
                        break;
                    }
                }
            }
            console.log('\n🚀 ===============================================');
            console.log('🚀 Facebook Live Product System - Backend Server');
            console.log('🚀 ===============================================');
            console.log(`🌐 Local:    http://localhost:${PORT}`);
            console.log(`📱 Network:  http://${lanIP}:${PORT}   ← use this on phone`);
            console.log(`🔗 API:      http://localhost:${PORT}/api`);
            console.log(`📷 OBS QR URL will use: http://${lanIP}:${PORT}`);
            console.log('🚀 ===============================================\n');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

// Export io for use in routes
module.exports = { io };
