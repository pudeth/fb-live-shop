const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Get active live session
router.get('/active', async (req, res) => {
    try {
        const [sessions] = await pool.query(
            'SELECT * FROM live_sessions WHERE status = ? ORDER BY started_at DESC LIMIT 1',
            ['active']
        );

        if (sessions.length === 0) {
            return res.json({
                success: true,
                data: null,
                message: 'No active live session'
            });
        }

        res.json({
            success: true,
            data: sessions[0]
        });
    } catch (error) {
        console.error('Get active session error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get current product in live session
router.get('/current-product', async (req, res) => {
    try {
        const [sessions] = await pool.query(
            'SELECT current_product_id FROM live_sessions WHERE status = ? ORDER BY started_at DESC LIMIT 1',
            ['active']
        );

        if (sessions.length === 0 || !sessions[0].current_product_id) {
            return res.json({
                success: true,
                data: null,
                message: 'No product currently shown'
            });
        }

        const [products] = await pool.query(
            'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?',
            [sessions[0].current_product_id]
        );

        if (products.length === 0) {
            return res.json({
                success: true,
                data: null
            });
        }

        const product = products[0];
        if (product.options && typeof product.options === 'string') {
            try { product.options = JSON.parse(product.options); } catch (e) { product.options = null; }
        }

        res.json({
            success: true,
            data: product
        });
    } catch (error) {
        console.error('Get current product error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Create live session (cashier/admin only)
router.post('/', authenticate, authorize('admin', 'cashier'), async (req, res) => {
    try {
        const { title, description } = req.body;
        const cashier_id = req.user.id;

        // Generate session code
        const sessionCode = 'LIVE-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

        const [result] = await pool.query(
            'INSERT INTO live_sessions (session_code, title, description, cashier_id, status) VALUES (?, ?, ?, ?, ?)',
            [sessionCode, title, description || null, cashier_id, 'active']
        );

        res.status(201).json({
            success: true,
            message: 'Live session created successfully',
            data: {
                id: result.insertId,
                session_code: sessionCode
            }
        });
    } catch (error) {
        console.error('Create live session error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// End live session (cashier/admin only)
router.patch('/:id/end', authenticate, authorize('admin', 'cashier'), async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await pool.query(
            'UPDATE live_sessions SET status = ?, ended_at = NOW(), current_product_id = NULL WHERE id = ?',
            ['ended', id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Live session not found' 
            });
        }

        res.json({
            success: true,
            message: 'Live session ended successfully'
        });
    } catch (error) {
        console.error('End live session error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

module.exports = router;
