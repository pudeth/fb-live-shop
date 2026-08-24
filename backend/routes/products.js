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

// POST /api/products/upload-image — upload a product image (admin only)
router.post('/upload-image', authenticate, authorize('admin'), (req, res) => {
    upload.single('image')(req, res, (err) => {
        if (err) {
            // Multer errors (file type, size, etc.)
            return res.status(400).json({ success: false, message: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file provided' });
        }
        const imageUrl = '/uploads/' + req.file.filename;
        res.json({ success: true, imageUrl });
    });
});

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

        // Parse JSON options
        products.forEach(product => {
            if (product.options && typeof product.options === 'string') {
                try {
                    product.options = JSON.parse(product.options);
                } catch (e) {
                    console.error('Error parsing product options:', e);
                }
            }
        });

        res.json({
            success: true,
            data: products
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

        const product = products[0];
        if (product.options && typeof product.options === 'string') {
            try {
                product.options = JSON.parse(product.options);
            } catch (e) {
                console.error('Error parsing product options:', e);
            }
        }

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

        const product = products[0];
        if (product.options && typeof product.options === 'string') {
            try {
                product.options = JSON.parse(product.options);
            } catch (e) {
                console.error('Error parsing product options:', e);
            }
        }

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
        const { product_code, barcode, name, description, price, stock, category_id, image, options, status } = req.body;

        const [result] = await pool.query(
            'INSERT INTO products (product_code, barcode, name, description, price, stock, category_id, image, options, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [product_code, barcode || null, name, description || null, price, stock, category_id || null, image || null, options ? JSON.stringify(options) : null, status || 'active']
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
        const { product_code, barcode, name, description, price, stock, category_id, image, options, status } = req.body;

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
        if (image !== undefined) {
            updateFields.push('image = ?');
            params.push(image);
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
