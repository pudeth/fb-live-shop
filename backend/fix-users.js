const bcrypt = require('bcryptjs');
const { pool } = require('./config/database');

async function fixUsers() {
    try {
        console.log('Fixing user accounts...');

        // Hash passwords
        const adminPassword = await bcrypt.hash('admin123', 10);
        const cashierPassword = await bcrypt.hash('cashier123', 10);

        // Update or insert admin
        await pool.query(`
            INSERT INTO users (username, email, password, full_name, role, status)
            VALUES ('admin', 'admin@example.com', ?, 'System Administrator', 'admin', 'active')
            ON DUPLICATE KEY UPDATE 
            password = ?,
            status = 'active'
        `, [adminPassword, adminPassword]);

        console.log('✅ Admin account updated: admin / admin123');

        // Update or insert cashier
        await pool.query(`
            INSERT INTO users (username, email, password, full_name, role, status)
            VALUES ('cashier', 'cashier@example.com', ?, 'Main Cashier', 'cashier', 'active')
            ON DUPLICATE KEY UPDATE 
            password = ?,
            status = 'active'
        `, [cashierPassword, cashierPassword]);

        console.log('✅ Cashier account updated: cashier / cashier123');

        // Verify
        const [users] = await pool.query('SELECT username, role, status FROM users WHERE role IN ("admin", "cashier")');
        console.log('\nCurrent users:');
        users.forEach(user => {
            console.log(`  - ${user.username} (${user.role}) - ${user.status}`);
        });

        console.log('\n✅ All done! You can now login.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixUsers();
