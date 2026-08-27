/**
 * migrate.js
 * Creates all database tables on a fresh cloud MySQL instance.
 *
 * Run via Render Shell or locally:
 *   node backend/migrate.js
 *
 * Or via Render dashboard → Shell tab:
 *   node migrate.js
 */
const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function getConnection(withDb = true) {
    const isProduction = process.env.NODE_ENV === 'production';
    const isCloud = !!(process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1'));
    const ssl = (isProduction && isCloud) ? { rejectUnauthorized: false } : undefined;

    // Support DATABASE_URL (PlanetScale / Render MySQL format)
    if (process.env.DATABASE_URL) {
        const url = new URL(process.env.DATABASE_URL);
        return mysql.createConnection({
            host:     url.hostname,
            user:     url.username,
            password: url.password,
            database: withDb ? url.pathname.replace('/', '') : undefined,
            port:     parseInt(url.port || '3306'),
            ssl,
            multipleStatements: true,
        });
    }

    return mysql.createConnection({
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '3306'),
        user:     process.env.DB_USER     || 'root',
        password: process.env.DB_PASSWORD || '',
        database: withDb ? (process.env.DB_NAME || 'facebook_live_products') : undefined,
        ssl,
        multipleStatements: true,
    });
}

async function migrate() {
    const dbName = process.env.DB_NAME || 'facebook_live_products';

    // Step 1 — create database if it doesn't exist
    if (!process.env.DATABASE_URL) {
        console.log(`Creating database "${dbName}" if not exists…`);
        const root = await getConnection(false);
        await root.query(
            `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        await root.end();
    }

    // Step 2 — run schema statements
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    const raw = fs.readFileSync(schemaPath, 'utf8');

    const conn = await getConnection(true);
    await conn.query(raw);
    await conn.end();
    console.log(`\n✅ Migration completed successfully.`);
}

migrate().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
