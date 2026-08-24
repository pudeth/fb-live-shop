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
require('dotenv').config();

async function getConnection(withDb = true) {
    const isProduction = process.env.NODE_ENV === 'production';
    const ssl = isProduction ? { rejectUnauthorized: false } : undefined;

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
            multipleStatements: false,
        });
    }

    return mysql.createConnection({
        host:     process.env.DB_HOST,
        port:     parseInt(process.env.DB_PORT || '3306'),
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: withDb ? (process.env.DB_NAME || 'facebook_live_products') : undefined,
        ssl,
        multipleStatements: false,
    });
}

async function migrate() {
    const dbName = process.env.DB_NAME || 'facebook_live_products';

    // Step 1 — create database if it doesn't exist
    // (skip for PlanetScale — database is pre-created)
    if (!process.env.DATABASE_URL) {
        console.log(`Creating database "${dbName}" if not exists…`);
        const root = await getConnection(false);
        await root.execute(
            `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        await root.end();
    }

    // Step 2 — run schema statements
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    const raw = fs.readFileSync(schemaPath, 'utf8');

    const conn = await getConnection(true);

    // Split on semicolons, skip DB-level statements (already handled above)
    const statements = raw
        .split(/;\s*\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .filter(s => !/^(DROP DATABASE|CREATE DATABASE|USE )\b/i.test(s));

    let ok = 0, skipped = 0, errors = 0;
    for (const stmt of statements) {
        try {
            await conn.execute(stmt);
            ok++;
        } catch (e) {
            if (['ER_TABLE_EXISTS_ERROR', 'ER_DUP_ENTRY', 'ER_DUP_KEYNAME'].includes(e.code)) {
                skipped++;
            } else {
                console.error(`  ✗ ${e.message}`);
                console.error(`    SQL: ${stmt.substring(0, 100)}`);
                errors++;
            }
        }
    }

    await conn.end();
    console.log(`\n✅ Migration done — ${ok} ran, ${skipped} skipped, ${errors} errors`);
    if (errors > 0) process.exit(1);
}

migrate().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
