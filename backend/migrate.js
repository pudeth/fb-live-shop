/**
 * migrate.js — Run once after first Fly.io deploy to create the database schema.
 * Usage:  flyctl ssh console -C "node /app/backend/migrate.js"
 */
const fs   = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const schemaPath = path.join(__dirname, '../database/schema.sql');

async function migrate() {
    // Parse schema — split on statement delimiter but skip CREATE DATABASE / DROP / USE
    const raw = fs.readFileSync(schemaPath, 'utf8');

    // Connect without a database first so we can create it
    const rootConn = await mysql.createConnection({
        host:     process.env.DB_HOST,
        port:     parseInt(process.env.DB_PORT || '3306'),
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        multipleStatements: false,
    });

    const dbName = process.env.DB_NAME || 'facebook_live_products';
    console.log(`Creating database "${dbName}" if not exists…`);
    await rootConn.execute(
        `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await rootConn.end();

    // Reconnect with target database
    const conn = await mysql.createConnection({
        host:               process.env.DB_HOST,
        port:               parseInt(process.env.DB_PORT || '3306'),
        user:               process.env.DB_USER,
        password:           process.env.DB_PASSWORD,
        database:           dbName,
        multipleStatements: false,
    });

    // Filter out DROP DATABASE / CREATE DATABASE / USE statements
    const statements = raw
        .split(/;\s*\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .filter(s => !/^(DROP DATABASE|CREATE DATABASE|USE )/i.test(s));

    let ok = 0, skip = 0;
    for (const stmt of statements) {
        try {
            await conn.execute(stmt);
            ok++;
        } catch (e) {
            // Ignore "already exists" errors — safe to re-run
            if (e.code === 'ER_TABLE_EXISTS_ERROR' || e.code === 'ER_DUP_ENTRY') {
                skip++;
            } else {
                console.error('  ✗', e.message, '\n  SQL:', stmt.substring(0, 80));
            }
        }
    }

    await conn.end();
    console.log(`✅ Migration complete — ${ok} statements run, ${skip} skipped (already exist).`);
}

migrate().catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
