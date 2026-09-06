/**
 * clean-categories.js
 * Removes duplicate categories from the database,
 * updates any products linked to duplicate categories to point to the canonical ID,
 * and adds a UNIQUE constraint to categories.name to prevent future duplicates.
 */

const { pool } = require('./config/database');

async function cleanCategories() {
    console.log('Starting category cleanup...');

    // 1. Get canonical categories (first ID for each name)
    const [canonicalList] = await pool.execute('SELECT MIN(id) as id, name FROM categories GROUP BY name');
    console.log('Canonical categories to keep:');
    console.table(canonicalList);

    const canonicalIds = canonicalList.map(c => c.id);
    const mapNameToId = {};
    canonicalList.forEach(c => { mapNameToId[c.name] = c.id; });

    // 2. Fetch all products and update any product pointing to duplicate category
    const [products] = await pool.execute('SELECT p.id, p.name, p.category_id, c.name as cat_name FROM products p LEFT JOIN categories c ON p.category_id = c.id');
    for (const prod of products) {
        if (prod.cat_name && mapNameToId[prod.cat_name] && prod.category_id !== mapNameToId[prod.cat_name]) {
            const newCatId = mapNameToId[prod.cat_name];
            console.log(`Updating product ${prod.id} (${prod.name}): category_id ${prod.category_id} -> ${newCatId}`);
            await pool.execute('UPDATE products SET category_id = ? WHERE id = ?', [newCatId, prod.id]);
        }
    }

    // 3. Delete duplicate categories
    const placeholders = canonicalIds.map(() => '?').join(',');
    const [delResult] = await pool.execute(`DELETE FROM categories WHERE id NOT IN (${placeholders})`, canonicalIds);
    console.log(`✅ Deleted ${delResult.affectedRows} duplicate categories.`);

    // 4. Add unique index if not exists
    try {
        await pool.execute('ALTER TABLE categories ADD UNIQUE INDEX idx_category_name_unique (name)');
        console.log('✅ Added UNIQUE index idx_category_name_unique on categories(name).');
    } catch (e) {
        if (e.code === 'ER_DUP_KEYNAME') {
            console.log('ℹ️ UNIQUE index already exists.');
        } else {
            console.warn('⚠️ Index note:', e.message);
        }
    }

    // 5. Verify results
    const [remaining] = await pool.execute('SELECT id, name, description, status FROM categories ORDER BY id ASC');
    console.log('\nRemaining categories in database:');
    console.table(remaining);

    const [updatedProducts] = await pool.execute('SELECT p.id, p.name, p.product_code, p.category_id, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id');
    console.log('\nProducts after cleanup:');
    console.table(updatedProducts);

    console.log('\n🎉 Category cleanup completed successfully!');
    process.exit(0);
}

cleanCategories().catch(err => {
    console.error('❌ Error during cleanup:', err);
    process.exit(1);
});
