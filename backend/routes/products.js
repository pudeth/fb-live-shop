const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, validationRules } = require('../middleware/validator');

// Multer storage config — saves files to backend/uploads/
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'product-' + unique + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) &&
               allowed.test(file.mimetype.split('/')[1]);
    if (ok) cb(null, true);
    else cb(new Error('Only image files (jpg, png, gif, webp) are allowed'), false);
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5 MB max
});

// POST /api/products/upload-image — upload a single product image (admin only)
router.post('/upload-image', authenticate, authorize('admin'), (req, res) => {
    upload.single('image')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file provided' });
        }
        try {
            const fileData = fs.readFileSync(req.file.path);
            const mimeType = req.file.mimetype || 'image/jpeg';
            const base64 = `data:${mimeType};base64,${fileData.toString('base64')}`;
            res.json({ success: true, imageUrl: base64 });
        } catch(e) {
            res.json({ success: true, imageUrl: '/uploads/' + req.file.filename });
        }
    });
});

// POST /api/products/upload-images — upload multiple product images (admin only, up to 10)
router.post('/upload-images', authenticate, authorize('admin'), (req, res) => {
    upload.array('images', 10)(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No image files provided' });
        }
        const imageUrls = req.files.map(f => {
            try {
                const fileData = fs.readFileSync(f.path);
                const mimeType = f.mimetype || 'image/jpeg';
                return `data:${mimeType};base64,${fileData.toString('base64')}`;
            } catch(e) {
                return '/uploads/' + f.filename;
            }
        });
        res.json({ success: true, imageUrls });
    });
});

// Helper to sanitize product object (parsing options and images JSON)
function formatProduct(p) {
    if (p.options && typeof p.options === 'string') {
        try { p.options = JSON.parse(p.options); } catch (e) { p.options = null; }
    }
    if (p.images && typeof p.images === 'string') {
        try { p.images = JSON.parse(p.images); } catch (e) { p.images = []; }
    }
    if (!Array.isArray(p.images) || p.images.length === 0) {
        p.images = p.image ? [p.image] : [];
    }
    return p;
}

// Get all products (public)
router.get('/', async (req, res) => {
    try {
        const { category_id, status, search } = req.query;
        let query = 'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1';
        const params = [];

        if (category_id) {
            query += ' AND p.category_id = ?';
            params.push(category_id);
        }

        if (status) {
            query += ' AND p.status = ?';
            params.push(status);
        } else {
            query += ' AND p.status = ?';
            params.push('active');
        }

        if (search) {
            query += ' AND (p.product_code LIKE ? OR p.name LIKE ? OR p.description LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        query += ' ORDER BY p.created_at DESC';

        const [products] = await pool.query(query, params);
        const formatted = products.map(formatProduct);

        res.json({
            success: true,
            data: formatted
        });
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get product by code or ID (public)
router.get('/:identifier', async (req, res) => {
    try {
        const { identifier } = req.params;
        
        let query = `
            SELECT p.*, c.name as category_name 
            FROM products p 
            LEFT JOIN categories c ON p.category_id = c.id 
            WHERE p.product_code = ? OR p.id = ?
        `;
        
        const [products] = await pool.query(query, [identifier, identifier]);

        if (products.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }

        const product = formatProduct(products[0]);

        res.json({
            success: true,
            data: product
        });
    } catch (error) {
        console.error('Get product error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get product by barcode (for POS scanning)
router.get('/barcode/:barcode', authenticate, authorize('admin', 'cashier'), async (req, res) => {
    try {
        const { barcode } = req.params;
        
        const [products] = await pool.query(
            'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.barcode = ?',
            [barcode]
        );

        if (products.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }

        const product = formatProduct(products[0]);

        res.json({
            success: true,
            data: product
        });
    } catch (error) {
        console.error('Get product by barcode error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Create product (admin only)
router.post('/', authenticate, authorize('admin'), validationRules.createProduct, validate, async (req, res) => {
    try {
        const { product_code, barcode, name, description, price, stock, category_id, image, images, options, status } = req.body;

        const imgs = Array.isArray(images) ? images.filter(Boolean) : (image ? [image] : []);
        const mainImg = image || (imgs.length > 0 ? imgs[0] : null);
        const imagesJson = imgs.length > 0 ? JSON.stringify(imgs) : (mainImg ? JSON.stringify([mainImg]) : null);

        const [result] = await pool.query(
            'INSERT INTO products (product_code, barcode, name, description, price, stock, category_id, image, images, options, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [product_code, barcode || null, name, description || null, price, stock, category_id || null, mainImg || null, imagesJson, options ? JSON.stringify(options) : null, status || 'active']
        );

        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('Create product error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ 
                success: false, 
                message: 'Product code or barcode already exists' 
            });
        }
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Update product (admin only)
router.put('/:id', authenticate, authorize('admin'), validationRules.updateProduct, validate, async (req, res) => {
    try {
        const { id } = req.params;
        const { product_code, barcode, name, description, price, stock, category_id, image, images, options, status } = req.body;

        const updateFields = [];
        const params = [];

        if (product_code !== undefined) {
            updateFields.push('product_code = ?');
            params.push(product_code);
        }
        if (barcode !== undefined) {
            updateFields.push('barcode = ?');
            params.push(barcode);
        }
        if (name !== undefined) {
            updateFields.push('name = ?');
            params.push(name);
        }
        if (description !== undefined) {
            updateFields.push('description = ?');
            params.push(description);
        }
        if (price !== undefined) {
            updateFields.push('price = ?');
            params.push(price);
        }
        if (stock !== undefined) {
            updateFields.push('stock = ?');
            params.push(stock);
        }
        if (category_id !== undefined) {
            updateFields.push('category_id = ?');
            params.push(category_id);
        }
        if (images !== undefined) {
            const imgs = Array.isArray(images) ? images.filter(Boolean) : [];
            updateFields.push('images = ?');
            params.push(imgs.length > 0 ? JSON.stringify(imgs) : null);
            if (image === undefined) {
                updateFields.push('image = ?');
                params.push(imgs.length > 0 ? imgs[0] : null);
            }
        }
        if (image !== undefined) {
            updateFields.push('image = ?');
            params.push(image || null);
        }
        if (options !== undefined) {
            updateFields.push('options = ?');
            params.push(JSON.stringify(options));
        }
        if (status !== undefined) {
            updateFields.push('status = ?');
            params.push(status);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No fields to update' 
            });
        }

        params.push(id);

        const [result] = await pool.query(
            `UPDATE products SET ${updateFields.join(', ')} WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }

        res.json({
            success: true,
            message: 'Product updated successfully'
        });
    } catch (error) {
        console.error('Update product error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ 
                success: false, 
                message: 'Product code or barcode already exists' 
            });
        }
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Delete product (admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await pool.query('DELETE FROM products WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }

        res.json({
            success: true,
            message: 'Product deleted successfully'
        });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

module.exports = router;
