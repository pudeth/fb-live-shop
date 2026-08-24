const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Get all categories (public)
router.get('/', async (req, res) => {
    try {
        const { status } = req.query;
        let query = 'SELECT * FROM categories WHERE 1=1';
        const params = [];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        } else {
            query += ' AND status = ?';
            params.push('active');
        }

        query += ' ORDER BY name ASC';

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
        const { name, description, status } = req.body;

        if (!name) {
            return res.status(400).json({ 
                success: false, 
                message: 'Category name is required' 
            });
        }

        const [result] = await pool.query(
            'INSERT INTO categories (name, description, status) VALUES (?, ?, ?)',
            [name, description || null, status || 'active']
        );

        res.status(201).json({
            success: true,
            message: 'Category created successfully',
            data: { id: result.insertId }
        });
    } catch (error) {
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
        const { name, description, status } = req.body;

        const updateFields = [];
        const params = [];

        if (name !== undefined) {
            updateFields.push('name = ?');
            params.push(name);
        }
        if (description !== undefined) {
            updateFields.push('description = ?');
            params.push(description);
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
