const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, validationRules } = require('../middleware/validator');

// Get all orders (admin/cashier only)
router.get('/', authenticate, authorize('admin', 'cashier'), async (req, res) => {
    try {
        const { status, payment_status, search } = req.query;
        let query = 'SELECT * FROM orders WHERE 1=1';
        const params = [];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        if (payment_status) {
            query += ' AND payment_status = ?';
            params.push(payment_status);
        }

        if (search) {
            query += ' AND (order_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        query += ' ORDER BY created_at DESC';

        const [orders] = await pool.query(query, params);

        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get order by ID with items (admin/cashier only)
router.get('/:id', authenticate, authorize('admin', 'cashier'), async (req, res) => {
    try {
        const { id } = req.params;

        let order = null;

        // Try primary query with user PIN join
        try {
            const [orders] = await pool.query(
                `SELECT o.*, u.raw_pin, u.username as account_username
                 FROM orders o 
                 LEFT JOIN users u ON (u.phone = o.customer_phone OR u.username = o.customer_phone)
                 WHERE o.id = ?
                 LIMIT 1`,
                [id]
            );
            if (orders.length > 0) {
                order = orders[0];
            }
        } catch (queryErr) {
            console.warn('Join query failed, falling back to simple query:', queryErr.message);
            const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
            if (orders.length > 0) {
                order = orders[0];
            }
        }

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }

        order.customer_pin = order.customer_pin || order.raw_pin || null;

        // If order doesn't have a customer_pin yet, check for existing customer PIN first
        if (!order.customer_pin) {
            try {
                const cleanPhone = (order.customer_phone || '').trim().replace(/[^0-9+]/g, '');
                const cleanDigits = (order.customer_phone || '').replace(/[^0-9]/g, '');
                const coreDigits = cleanDigits.length >= 8 ? cleanDigits.slice(-8) : cleanDigits;

                let existing = null;
                if (coreDigits) {
                    const [u] = await pool.query(
                        `SELECT id, username, raw_pin, password FROM users 
                         WHERE username = ? OR phone = ? OR username = ? OR phone = ? OR username LIKE ? OR phone LIKE ?
                         ORDER BY id ASC LIMIT 1`,
                        [order.customer_phone, order.customer_phone, cleanPhone, cleanDigits, `%${coreDigits}%`, `%${coreDigits}%`]
                    );
                    if (u.length > 0) existing = u[0];
                }

                if (existing && existing.raw_pin) {
                    order.customer_pin = existing.raw_pin;
                    await pool.query('UPDATE orders SET customer_pin = ? WHERE id = ?', [existing.raw_pin, id]);
                } else if (!existing) {
                    const pin = Math.floor(100000 + Math.random() * 900000).toString();
                    order.customer_pin = pin;
                    const hashed = await bcrypt.hash(pin, 10);
                    await pool.query('UPDATE orders SET customer_pin = ? WHERE id = ?', [pin, id]);
                    if (cleanPhone) {
                        await pool.query(
                            `INSERT INTO users (username, password, raw_pin, full_name, email, phone, address, role, status)
                             VALUES (?, ?, ?, ?, ?, ?, ?, 'customer', 'active')`,
                            [cleanPhone, hashed, pin, order.customer_name, order.customer_email || null, order.customer_phone, order.customer_address || null]
                        );
                    }
                }
            } catch(e) {
                console.warn('Auto-checking PIN error:', e.message);
            }
        }

        try {
            const [items] = await pool.query(
                `SELECT oi.*, p.image as product_image, p.images as product_images, p.description as product_description, p.stock as product_stock, c.name as category_name
                 FROM order_items oi
                 LEFT JOIN products p ON oi.product_id = p.id
                 LEFT JOIN categories c ON p.category_id = c.id
                 WHERE oi.order_id = ?`,
                [id]
            );
            order.items = items || [];
        } catch (itemsErr) {
            console.warn('Failed to load items for order', id, itemsErr.message);
            order.items = [];
        }

        res.json({
            success: true,
            data: order
        });
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error: ' + error.message 
        });
    }
});

// Reset / generate fresh customer PIN (admin/cashier only)
router.post('/:id/reset-pin', authenticate, authorize('admin', 'cashier'), async (req, res) => {
    try {
        const { id } = req.params;
        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        const order = orders[0];
        const newPin = Math.floor(100000 + Math.random() * 900000).toString();
        const hashed = await bcrypt.hash(newPin, 10);

        try {
            await pool.query('UPDATE orders SET customer_pin = ? WHERE id = ?', [newPin, id]);
            const cleanPhone = (order.customer_phone || '').trim().replace(/[^0-9+]/g, '');
            if (cleanPhone) {
                const [u] = await pool.query('SELECT id FROM users WHERE username = ? OR phone = ? LIMIT 1', [cleanPhone, order.customer_phone]);
                if (u.length > 0) {
                    await pool.query('UPDATE users SET password = ?, raw_pin = ? WHERE id = ?', [hashed, newPin, u[0].id]);
                } else {
                    await pool.query(
                        `INSERT INTO users (username, password, raw_pin, full_name, email, phone, address, role, status)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'customer', 'active')`,
                        [cleanPhone, hashed, newPin, order.customer_name, order.customer_email || null, order.customer_phone, order.customer_address || null]
                    );
                }
            }
        } catch(e) {
            console.warn('Reset PIN DB update error:', e.message);
        }

        res.json({
            success: true,
            message: 'Customer PIN updated successfully',
            pin: newPin,
            username: (order.customer_phone || '').trim().replace(/[^0-9+]/g, '') || order.customer_phone
        });
    } catch (err) {
        console.error('Reset PIN error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Create order (public - for customers; cashier orders also use this endpoint)
router.post('/', validationRules.createOrder, validate, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();

        const {
            customer_name,
            customer_email,
            customer_phone,
            customer_address,
            items,
            notes,
            live_session_id,
            payment_method,
            payment_status,
            amount_tendered
        } = req.body;

        // Validate payment method
        const validPaymentMethods = ['cash', 'gcash', 'bank_transfer', 'cod', 'credit_card'];
        const resolvedPaymentMethod = validPaymentMethods.includes(payment_method)
            ? payment_method
            : 'cod';

        // Validate payment status
        const validPaymentStatuses = ['unpaid', 'paid', 'partial'];
        const resolvedPaymentStatus = validPaymentStatuses.includes(payment_status)
            ? payment_status
            : 'unpaid';

        // Generate order number
        const orderNumber = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();

        // Calculate total and validate items
        let totalAmount = 0;
        const orderItems = [];

        for (const item of items) {
            const [products] = await connection.query(
                'SELECT * FROM products WHERE id = ? AND status = ?',
                [item.product_id, 'active']
            );

            if (products.length === 0) {
                throw new Error(`Product with ID ${item.product_id} not found or inactive`);
            }

            const product = products[0];

            if (product.stock < item.quantity) {
                throw new Error(`Insufficient stock for "${product.name}". Available: ${product.stock}, Requested: ${item.quantity}`);
            }

            const subtotal = product.price * item.quantity;
            totalAmount += subtotal;

            orderItems.push({
                product_id: product.id,
                product_code: product.product_code,
                product_name: product.name,
                price: product.price,
                quantity: item.quantity,
                selected_options: item.selected_options || null,
                subtotal
            });

            await connection.query(
                'UPDATE products SET stock = stock - ? WHERE id = ?',
                [item.quantity, product.id]
            );
        }

        // Calculate change (only meaningful for cash payments)
        const tendered = parseFloat(amount_tendered) || null;
        const change = (resolvedPaymentMethod === 'cash' && tendered !== null)
            ? Math.max(0, tendered - totalAmount)
            : null;

        // Insert order with payment fields
        const [orderResult] = await connection.query(
            `INSERT INTO orders
                (order_number, customer_name, customer_email, customer_phone,
                 customer_address, total_amount, notes, status, live_session_id,
                 payment_method, payment_status, amount_tendered, change_amount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                orderNumber,
                customer_name,
                customer_email || null,
                customer_phone,
                customer_address,
                totalAmount,
                notes || null,
                'pending',
                live_session_id || null,
                resolvedPaymentMethod,
                resolvedPaymentStatus,
                tendered,
                change
            ]
        );

        const orderId = orderResult.insertId;

        for (const item of orderItems) {
            await connection.query(
                `INSERT INTO order_items
                    (order_id, product_id, product_code, product_name,
                     price, quantity, selected_options, subtotal)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    item.product_id,
                    item.product_code,
                    item.product_name,
                    item.price,
                    item.quantity,
                    item.selected_options ? JSON.stringify(item.selected_options) : null,
                    item.subtotal
                ]
            );
        }

        await connection.commit();

        // ── Auto Customer Account Generation (Single Account Policy) ──
        let customerAccount = null;
        let customerToken = null;
        let plainPassword = '';

        try {
            const rawPhone = (customer_phone || '').trim();
            const cleanPhone = rawPhone.replace(/[^0-9+]/g, '');
            const cleanDigits = rawPhone.replace(/[^0-9]/g, '');
            const coreDigits = cleanDigits.length >= 8 ? cleanDigits.slice(-8) : cleanDigits;

            let existing = null;
            if (coreDigits) {
                const [existingUsers] = await pool.query(
                    `SELECT id, username, role, full_name, phone, raw_pin, password, address 
                     FROM users 
                     WHERE (username = ? OR phone = ? OR username = ? OR phone = ? OR username LIKE ? OR phone LIKE ?)
                     ORDER BY id ASC LIMIT 1`,
                    [rawPhone, rawPhone, cleanPhone, cleanDigits, `%${coreDigits}%`, `%${coreDigits}%`]
                );
                if (existingUsers.length > 0) {
                    existing = existingUsers[0];
                }
            }

            if (!existing) {
                // Brand new customer: generate 6-digit PIN once
                plainPassword = Math.floor(100000 + Math.random() * 900000).toString();
                const hashedPassword = await bcrypt.hash(plainPassword, 10);
                const customerUsername = cleanDigits || cleanPhone || ('cust_' + Date.now());

                const [userRes] = await pool.query(
                    `INSERT INTO users (username, password, raw_pin, full_name, email, phone, address, role, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'customer', 'active')`,
                    [
                        customerUsername,
                        hashedPassword,
                        plainPassword,
                        customer_name,
                        customer_email || null,
                        cleanDigits || rawPhone,
                        customer_address || null
                    ]
                );

                // Also update the order record with customer_pin
                await pool.query('UPDATE orders SET customer_pin = ? WHERE id = ?', [plainPassword, orderId]);

                customerAccount = {
                    id: userRes.insertId,
                    username: customerUsername,
                    password: plainPassword,
                    full_name: customer_name,
                    is_new: true
                };
            } else {
                // EXISTING CUSTOMER: DO NOT GENERATE A NEW PIN! REUSE EXISTING ACCOUNT & PIN!
                const activePin = existing.raw_pin || null;

                if (activePin) {
                    await pool.query('UPDATE orders SET customer_pin = ? WHERE id = ?', [activePin, orderId]);
                }

                // If customer provided address and user didn't have one, update address without touching credentials
                if (customer_address && !existing.address) {
                    await pool.query('UPDATE users SET address = ? WHERE id = ?', [customer_address, existing.id]);
                }

                customerAccount = {
                    id: existing.id,
                    username: existing.username,
                    password: activePin,
                    full_name: existing.full_name || customer_name,
                    is_new: false // Existing customer!
                };
            }

            if (customerAccount && process.env.JWT_SECRET) {
                customerToken = jwt.sign(
                    { id: customerAccount.id, username: customerAccount.username, role: 'customer' },
                    process.env.JWT_SECRET,
                    { expiresIn: '30d' }
                );
            }
        } catch (accErr) {
            console.warn('Customer auto-account creation warning:', accErr.message);
        }

        res.status(201).json({
            success: true,
            message: 'Order created successfully',
            data: {
                order_id: orderId,
                order_number: orderNumber,
                total_amount: totalAmount,
                payment_method: resolvedPaymentMethod,
                payment_status: resolvedPaymentStatus,
                amount_tendered: tendered,
                change_amount: change,
                customer_account: customerAccount,
                customer_token: customerToken
            }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Create order error:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message || 'Server error' 
        });
    } finally {
        connection.release();
    }
});

// Helper to compute order progress steps
function getOrderTimeline(order) {
    const isCompleted = order.status === 'completed';
    const isShipping = ['shipping', 'completed'].includes(order.status);
    const isProcessing = ['processing', 'shipping', 'completed'].includes(order.status) || order.payment_status === 'paid';

    return [
        { key: 'placed', title: 'Order Placed', desc: 'Order received & confirmed', icon: '📝', done: true, time: order.created_at },
        { key: 'processing', title: 'Processing & Packed', desc: 'Item prepared by shop', icon: '📦', done: isProcessing },
        { key: 'shipping', title: 'Out for Delivery', desc: 'Package with courier rider', icon: '🚚', done: isShipping },
        { key: 'completed', title: 'Delivered', desc: 'Order successfully received', icon: '✅', done: isCompleted }
    ];
}

// Public Order Tracking by Order Number OR Phone + Password
router.post('/track', async (req, res) => {
    try {
        const { order_number, phone, password } = req.body;

        // Mode 1: Track by Order Number
        if (order_number) {
            const [orders] = await pool.query(
                'SELECT * FROM orders WHERE order_number = ?',
                [order_number.trim()]
            );

            if (orders.length === 0) {
                return res.status(404).json({ success: false, message: 'Order not found' });
            }

            const order = orders[0];
            const [items] = await pool.query(
                `SELECT oi.*, p.image as product_image, p.images as product_images, p.description as product_description, p.stock as product_stock
                 FROM order_items oi
                 LEFT JOIN products p ON oi.product_id = p.id
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            order.items = items;

            return res.json({
                success: true,
                data: {
                    order,
                    timeline: getOrderTimeline(order)
                }
            });
        }

        // Mode 2: Track by Customer Phone + Password
        if (phone && password) {
            const rawPhone = phone.trim();
            const cleanPhone = rawPhone.replace(/[^0-9+]/g, '');
            const cleanDigits = rawPhone.replace(/[^0-9]/g, '');
            const coreDigits = cleanDigits.length >= 8 ? cleanDigits.slice(-8) : cleanDigits;

            const [users] = await pool.query(
                `SELECT * FROM users 
                 WHERE (username = ? OR phone = ? OR username = ? OR phone = ? OR username LIKE ? OR phone LIKE ?) AND status = ?
                 ORDER BY id ASC LIMIT 1`,
                [rawPhone, rawPhone, cleanPhone, cleanDigits, `%${coreDigits}%`, `%${coreDigits}%`, 'active']
            );

            if (users.length === 0) {
                return res.status(401).json({ success: false, message: 'Customer account not found' });
            }

            const user = users[0];
            const isValid = await bcrypt.compare(password.trim(), user.password);
            if (!isValid) {
                return res.status(401).json({ success: false, message: 'Invalid password or PIN' });
            }

            const [orders] = await pool.query(
                `SELECT * FROM orders 
                 WHERE customer_phone = ? OR customer_phone = ? OR customer_phone = ? OR customer_phone LIKE ? OR customer_name = ? 
                 ORDER BY created_at DESC`,
                [user.phone || phone, cleanPhone, cleanDigits, `%${coreDigits}%`, user.full_name]
            );

            for (const o of orders) {
                const [items] = await pool.query(
                    `SELECT oi.*, p.image as product_image, p.images as product_images, p.description as product_description, p.stock as product_stock
                     FROM order_items oi
                     LEFT JOIN products p ON oi.product_id = p.id
                     WHERE oi.order_id = ?`,
                    [o.id]
                );
                o.items = items;
                o.timeline = getOrderTimeline(o);
            }

            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role },
                process.env.JWT_SECRET || 'secret',
                { expiresIn: '30d' }
            );

            delete user.password;

            return res.json({
                success: true,
                data: {
                    user,
                    token,
                    orders
                }
            });
        }

        res.status(400).json({ success: false, message: 'Please provide order number or phone and password' });
    } catch (err) {
        console.error('Order tracking error:', err);
        res.status(500).json({ success: false, message: 'Failed to track order' });
    }
});

// Update order status (admin/cashier only)
router.patch('/:id/status', authenticate, authorize('admin', 'cashier'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid status' 
            });
        }

        const [result] = await pool.query(
            'UPDATE orders SET status = ? WHERE id = ?',
            [status, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }

        res.json({
            success: true,
            message: 'Order status updated successfully'
        });
    } catch (error) {
        console.error('Update order status error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Update payment status (admin/cashier only)
router.patch('/:id/payment', authenticate, authorize('admin', 'cashier'), async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_status, payment_method, amount_tendered } = req.body;

        const validPaymentStatuses = ['unpaid', 'paid', 'partial'];
        if (payment_status && !validPaymentStatuses.includes(payment_status)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid payment status' 
            });
        }

        const validPaymentMethods = ['cash', 'gcash', 'bank_transfer', 'cod', 'credit_card'];
        if (payment_method && !validPaymentMethods.includes(payment_method)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid payment method' 
            });
        }

        // Fetch current order to compute change
        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        const order = orders[0];

        const tendered = parseFloat(amount_tendered) || order.amount_tendered || null;
        const resolvedMethod = payment_method || order.payment_method;
        const change = (resolvedMethod === 'cash' && tendered !== null)
            ? Math.max(0, tendered - parseFloat(order.total_amount))
            : null;

        const fields = [];
        const params = [];

        if (payment_status) { fields.push('payment_status = ?'); params.push(payment_status); }
        if (payment_method) { fields.push('payment_method = ?'); params.push(payment_method); }
        if (tendered !== null) {
            fields.push('amount_tendered = ?');
            params.push(tendered);
            fields.push('change_amount = ?');
            params.push(change);
        }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        params.push(id);
        await pool.query(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, params);

        res.json({
            success: true,
            message: 'Payment updated successfully',
            data: {
                payment_status: payment_status || order.payment_status,
                payment_method: resolvedMethod,
                amount_tendered: tendered,
                change_amount: change
            }
        });
    } catch (error) {
        console.error('Update payment error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

module.exports = router;
