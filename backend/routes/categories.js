const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

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
        cb(null, 'category-' + unique + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/');
    if (ok) cb(null, true);
    else cb(new Error('Only image files (jpg, png, gif, webp, svg) are allowed'), false);
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5 MB max
});

// POST /api/categories/upload-image (admin only)
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
            const mimeType = req.file.mimetype || 'image/png';
            const base64 = `data:${mimeType};base64,${fileData.toString('base64')}`;
            res.json({ success: true, imageUrl: base64 });
        } catch(e) {
            res.json({ success: true, imageUrl: '/uploads/' + req.file.filename });
        }
    });
});

// Get all categories (public)
router.get('/', async (req, res) => {
    try {
        const { status } = req.query;
        let query = `
            SELECT c.*, COUNT(p.id) AS product_count 
            FROM categories c 
            LEFT JOIN products p ON p.category_id = c.id
        `;
        const params = [];

        if (status && status !== 'all') {
            query += ' WHERE c.status = ?';
            params.push(status);
        }

        query += ' GROUP BY c.id ORDER BY c.name ASC';

        const [categories] = await pool.query(query, params);

        res.json({
            success: true,
            data: categories
        });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Create category (admin only)
router.post('/', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { name, description, status, image, brand } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Category name is required' 
            });
        }

        const [result] = await pool.query(
            'INSERT INTO categories (name, description, status, image, brand) VALUES (?, ?, ?, ?, ?)',
            [name.trim(), description ? description.trim() : null, status || 'active', image || null, brand ? brand.trim() : null]
        );

        res.status(201).json({
            success: true,
            message: 'Category created successfully',
            data: { id: result.insertId }
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                message: 'A category with this name already exists'
            });
        }
        console.error('Create category error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Update category (admin only)
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, status, image, brand } = req.body;

        const updateFields = [];
        const params = [];

        if (name !== undefined) {
            if (!name || !name.trim()) {
                return res.status(400).json({ success: false, message: 'Category name cannot be empty' });
            }
            updateFields.push('name = ?');
            params.push(name.trim());
        }
        if (description !== undefined) {
            updateFields.push('description = ?');
            params.push(description ? description.trim() : null);
        }
        if (status !== undefined) {
            updateFields.push('status = ?');
            params.push(status);
        }
        if (image !== undefined) {
            updateFields.push('image = ?');
            params.push(image || null);
        }
        if (brand !== undefined) {
            updateFields.push('brand = ?');
            params.push(brand ? brand.trim() : null);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No fields to update' 
            });
        }

        params.push(id);

        const [result] = await pool.query(
            `UPDATE categories SET ${updateFields.join(', ')} WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Category not found' 
            });
        }

        res.json({
            success: true,
            message: 'Category updated successfully'
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                message: 'A category with this name already exists'
            });
        }
        console.error('Update category error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Delete category (admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await pool.query('DELETE FROM categories WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Category not found' 
            });
        }

        res.json({
            success: true,
            message: 'Category deleted successfully'
        });
    } catch (error) {
        console.error('Delete category error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

module.exports = router;
