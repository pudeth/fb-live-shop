const { pool } = require('../config/database');

// Socket.IO event handlers for live product updates
const setupLiveSocket = (io, socket) => {
    
    // Show product on live (triggered by cashier)
    socket.on('show-product', async (data) => {
        try {
            const { product_id, session_id } = data;

            // Get product details
            const [products] = await pool.query(
                'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?',
                [product_id]
            );

            if (products.length === 0) {
                socket.emit('error', { message: 'Product not found' });
                return;
            }

            const product = products[0];
            if (product.options && typeof product.options === 'string') {
                try {
                    product.options = JSON.parse(product.options);
                } catch (e) {
                    console.error('Error parsing product options:', e);
                }
            }

            // Update live session with current product
            if (session_id) {
                await pool.query(
                    'UPDATE live_sessions SET current_product_id = ? WHERE id = ? AND status = ?',
                    [product_id, session_id, 'active']
                );

                // Add to history
                await pool.query(
                    'INSERT INTO live_product_history (live_session_id, product_id) VALUES (?, ?)',
                    [session_id, product_id]
                );
            }

            // Broadcast to all clients in live-room
            io.to('live-room').emit('product-shown', {
                product,
                timestamp: new Date().toISOString()
            });

            console.log('✅ Product shown on live:', product.product_code);
        } catch (error) {
            console.error('Show product error:', error);
            socket.emit('error', { message: 'Failed to show product' });
        }
    });

    // Hide product from live
    socket.on('hide-product', async (data) => {
        try {
            const { session_id } = data;

            if (session_id) {
                // Update live session to clear current product
                await pool.query(
                    'UPDATE live_sessions SET current_product_id = NULL WHERE id = ? AND status = ?',
                    [session_id, 'active']
                );

                // Update history
                await pool.query(
                    'UPDATE live_product_history SET hidden_at = NOW() WHERE live_session_id = ? AND hidden_at IS NULL',
                    [session_id]
                );
            }

            // Broadcast to all clients in live-room
            io.to('live-room').emit('product-hidden', {
                timestamp: new Date().toISOString()
            });

            console.log('✅ Product hidden from live');
        } catch (error) {
            console.error('Hide product error:', error);
            socket.emit('error', { message: 'Failed to hide product' });
        }
    });

    // Update live session status
    socket.on('update-live-status', async (data) => {
        try {
            const { session_id, status } = data;

            await pool.query(
                'UPDATE live_sessions SET status = ? WHERE id = ?',
                [status, session_id]
            );

            io.to('live-room').emit('live-status-updated', {
                status,
                timestamp: new Date().toISOString()
            });

            console.log('✅ Live status updated:', status);
        } catch (error) {
            console.error('Update live status error:', error);
            socket.emit('error', { message: 'Failed to update live status' });
        }
    });

    // Send caption to overlay
    socket.on('send-caption', (data) => {
        const { text, style, target } = data;
        io.to('live-room').emit('caption-shown', {
            text: text || '',
            style: style || 'default',
            target: target || 'product-show',
            timestamp: new Date().toISOString()
        });
        console.log('✅ Caption sent:', text, '→ target:', target || 'product-show');
    });

    // Clear caption from overlay
    socket.on('clear-caption', () => {
        io.to('live-room').emit('caption-hidden', {
            timestamp: new Date().toISOString()
        });
        console.log('✅ Caption cleared');
    });

    // Show the overlay interface (force-visible regardless of product state)
    socket.on('show-overlay', (data) => {
        io.to('live-room').emit('overlay-show', {
            target: (data && data.target) ? data.target : 'product-show',
            timestamp: new Date().toISOString()
        });
        console.log('✅ Overlay interface shown, target:', (data && data.target) || 'product-show');
    });

    // Hide the overlay interface (force-hide everything)
    socket.on('hide-overlay', (data) => {
        io.to('live-room').emit('overlay-hide', {
            target: (data && data.target) ? data.target : 'product-show',
            timestamp: new Date().toISOString()
        });
        console.log('✅ Overlay interface hidden, target:', (data && data.target) || 'product-show');
    });

    // Notify new order
    socket.on('new-order', (orderData) => {
        io.to('live-room').emit('order-notification', orderData);
        console.log('✅ New order notification sent');
    });
};

module.exports = { setupLiveSocket };
