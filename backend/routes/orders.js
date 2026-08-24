const express = require('express');
const router = express.Router();
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

// Get order by ID with items
router.get('/:id', authenticate, authorize('admin', 'cashier'), async (req, res) => {
    try {
        const { id } = req.params;

        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);

        if (orders.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }

        const order = orders[0];

        const [items] = await pool.query(
            'SELECT * FROM order_items WHERE order_id = ?',
            [id]
        );

        order.items = items;

        res.json({
            success: true,
            data: order
        });
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
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
                change_amount: change
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
