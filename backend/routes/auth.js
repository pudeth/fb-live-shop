const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, validationRules } = require('../middleware/validator');

// Login
router.post('/login', validationRules.login, validate, async (req, res) => {
    try {
        const { username, password } = req.body;

        // Find user
        const [users] = await pool.query(
            'SELECT * FROM users WHERE username = ? AND status = ?',
            [username, 'active']
        );

        if (users.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }

        const user = users[0];

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: user.role 
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '7d' }
        );

        // Remove password from response
        delete user.password;

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Register (optional - for creating new users)
router.post('/register', validationRules.register, validate, async (req, res) => {
    try {
        const { username, email, password, full_name, phone, address } = req.body;

        // Check if user already exists
        const [existingUsers] = await pool.query(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username or email already exists' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const [result] = await pool.query(
            'INSERT INTO users (username, email, password, full_name, phone, address, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, email, hashedPassword, full_name, phone || null, address || null, 'customer']
        );

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            userId: result.insertId
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get all users (admin only)
router.get('/users', authenticate, authorize('admin'), async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT id, username, raw_pin, full_name, email, phone, address, role, status, created_at FROM users ORDER BY created_at DESC'
        );
        res.json({ success: true, data: users });
    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
