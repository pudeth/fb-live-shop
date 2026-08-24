const { body, param, validationResult } = require('express-validator');

// Handle validation errors
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            success: false, 
            errors: errors.array() 
        });
    }
    next();
};

// Validation rules for different routes
const validationRules = {
    // Product validation
    createProduct: [
        body('product_code').trim().notEmpty().withMessage('Product code is required'),
        body('name').trim().notEmpty().withMessage('Product name is required'),
        body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
        body('stock').isInt({ min: 0 }).withMessage('Stock must be a non-negative integer')
    ],
    
    updateProduct: [
        param('id').isInt().withMessage('Invalid product ID'),
        body('name').optional().trim().notEmpty().withMessage('Product name cannot be empty'),
        body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
        body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be a non-negative integer')
    ],

    // Order validation
    createOrder: [
        body('customer_name').trim().notEmpty().withMessage('Customer name is required'),
        body('customer_phone').trim().notEmpty().withMessage('Customer phone is required'),
        body('customer_address').trim().notEmpty().withMessage('Customer address is required'),
        body('items').isArray({ min: 1 }).withMessage('Order must have at least one item'),
        body('items.*.product_id').isInt().withMessage('Invalid product ID'),
        body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
    ],

    // Auth validation
    login: [
        body('username').trim().notEmpty().withMessage('Username is required'),
        body('password').notEmpty().withMessage('Password is required')
    ],

    register: [
        body('username').trim().notEmpty().withMessage('Username is required')
            .isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
        body('email').isEmail().withMessage('Valid email is required'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
        body('full_name').trim().notEmpty().withMessage('Full name is required')
    ]
};

module.exports = { validate, validationRules };
