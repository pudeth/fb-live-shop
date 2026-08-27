const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// PlanetScale and most cloud MySQL providers require SSL in production
const isProduction = process.env.NODE_ENV === 'production';
const isCloud = !!(process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1'));

const poolConfig = {
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'facebook_live_products',
    port:     parseInt(process.env.DB_PORT || '3306'),
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
    enableKeepAlive:    true,
    keepAliveInitialDelay: 0,
    connectTimeout: 30000,
};

// Enable SSL for cloud databases (PlanetScale, Render MySQL, etc.)
if (isProduction && isCloud) {
    // Aiven uses a self-signed CA — disable strict verification
    // (connection is still encrypted, just not CA-verified)
    poolConfig.ssl = { rejectUnauthorized: false };
}

// PlanetScale uses a DATABASE_URL connection string — support that too
if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    poolConfig.host     = url.hostname;
    poolConfig.user     = url.username;
    poolConfig.password = url.password;
    poolConfig.database = url.pathname.replace('/', '');
    poolConfig.port     = parseInt(url.port || '3306');
    if (isProduction) poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = mysql.createPool(poolConfig);

const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

module.exports = { pool, testConnection };
