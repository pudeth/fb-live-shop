const { pool } = require('./config/database');

async function addColumnSafe(columnName, definition) {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = ?`,
        [columnName]
    );
    if (rows.length === 0) {
        await pool.query(`ALTER TABLE orders ADD COLUMN ${columnName} ${definition}`);
        console.log(`  ✅ Added column: ${columnName}`);
    } else {
        console.log(`  ⏭  Column already exists: ${columnName}`);
    }
}

async function migrate() {
    try {
        console.log('Running payment columns migration…');
        await addColumnSafe('payment_method', "ENUM('cash','gcash','bank_transfer','cod','credit_card') DEFAULT 'cod' AFTER notes");
        await addColumnSafe('payment_status',  "ENUM('unpaid','paid','partial') DEFAULT 'unpaid' AFTER payment_method");
        await addColumnSafe('amount_tendered', 'DECIMAL(10,2) NULL AFTER payment_status');
        await addColumnSafe('change_amount',   'DECIMAL(10,2) NULL AFTER amount_tendered');
        console.log('✅ Migration complete');
    } catch (e) {
        console.error('❌ Migration error:', e.message);
    } finally {
        process.exit(0);
    }
}

migrate();
