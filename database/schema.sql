-- Facebook Live Product System Database Schema
-- Created for Screenshot-Based Facebook Live Product System

-- Drop database if exists and create new one
DROP DATABASE IF EXISTS facebook_live_products;
CREATE DATABASE facebook_live_products CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE facebook_live_products;

-- Categories Table
CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Products Table
CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_code VARCHAR(50) NOT NULL UNIQUE,
    barcode VARCHAR(100) UNIQUE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    category_id INT,
    image VARCHAR(255),
    options JSON COMMENT 'Store colors, sizes, etc. as JSON',
    status ENUM('active', 'inactive', 'out_of_stock') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    INDEX idx_product_code (product_code),
    INDEX idx_barcode (barcode),
    INDEX idx_status (status),
    INDEX idx_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users Table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'cashier', 'customer') NOT NULL DEFAULT 'customer',
    phone VARCHAR(20),
    address TEXT,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Live Sessions Table
CREATE TABLE live_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    current_product_id INT,
    cashier_id INT,
    status ENUM('active', 'paused', 'ended') DEFAULT 'active',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (current_product_id) REFERENCES products(id) ON DELETE SET NULL,
    FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_session_code (session_code),
    INDEX idx_status (status),
    INDEX idx_cashier (cashier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Orders Table
CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_number VARCHAR(50) NOT NULL UNIQUE,
    customer_name VARCHAR(100) NOT NULL,
    customer_email VARCHAR(100),
    customer_phone VARCHAR(20) NOT NULL,
    customer_address TEXT NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    notes TEXT,
    status ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
    live_session_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (live_session_id) REFERENCES live_sessions(id) ON DELETE SET NULL,
    INDEX idx_order_number (order_number),
    INDEX idx_status (status),
    INDEX idx_customer_phone (customer_phone),
    INDEX idx_live_session (live_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Order Items Table
CREATE TABLE order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    product_code VARCHAR(50) NOT NULL,
    product_name VARCHAR(200) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    quantity INT NOT NULL,
    selected_options JSON COMMENT 'Store selected color, size, etc.',
    subtotal DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    INDEX idx_order (order_id),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Live Product History Table (tracks products shown during live sessions)
CREATE TABLE live_product_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    live_session_id INT NOT NULL,
    product_id INT NOT NULL,
    shown_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hidden_at TIMESTAMP NULL,
    FOREIGN KEY (live_session_id) REFERENCES live_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_session (live_session_id),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default categories
INSERT INTO categories (name, description) VALUES
('Clothing', 'T-Shirts, Pants, Jackets, etc.'),
('Electronics', 'Phones, Tablets, Accessories'),
('Home & Living', 'Furniture, Decor, Kitchen Items'),
('Beauty & Health', 'Cosmetics, Skincare, Wellness'),
('Sports & Outdoor', 'Sports Equipment, Outdoor Gear');

-- Insert default admin user (password: admin123)
INSERT INTO users (username, email, password, full_name, role, status) VALUES
('admin', 'admin@example.com', '$2a$10$IIT2wtG0iDCwEksRQfpUY.fsfwpyk3hrzsxx5dgjM29eclYHvqjcq', 'System Administrator', 'admin', 'active');

-- Insert default cashier user (password: cashier123)
INSERT INTO users (username, email, password, full_name, role, status) VALUES
('cashier', 'cashier@example.com', '$2a$10$Hv/ut6yZVPfoS3XRHBRR9.zend2PB7W7m2XCnG3NJZWAAanqOKR4S', 'Main Cashier', 'cashier', 'active');

-- Insert sample products
INSERT INTO products (product_code, barcode, name, description, price, stock, category_id, options, status) VALUES
('P01', '1234567890123', 'Classic White T-Shirt', 'Premium cotton white t-shirt, comfortable and breathable', 12.00, 50, 1, '{"colors": ["White"], "sizes": ["S", "M", "L", "XL"]}', 'active'),
('P02', '1234567890124', 'Blue T-Shirt', 'Stylish blue t-shirt made from high-quality cotton', 15.00, 12, 1, '{"colors": ["Blue", "Black"], "sizes": ["M", "L", "XL"]}', 'active'),
('P03', '1234567890125', 'Wireless Earbuds', 'High-quality wireless earbuds with noise cancellation', 49.99, 30, 2, '{"colors": ["Black", "White"]}', 'active'),
('P04', '1234567890126', 'Smart Watch', 'Fitness tracking smart watch with heart rate monitor', 89.99, 15, 2, '{"colors": ["Black", "Silver", "Gold"]}', 'active'),
('P05', '1234567890127', 'Yoga Mat', 'Non-slip exercise yoga mat, eco-friendly material', 25.00, 40, 5, '{"colors": ["Purple", "Blue", "Pink"]}', 'active');

-- Create a sample live session
INSERT INTO live_sessions (session_code, title, description, cashier_id, status) VALUES
('LIVE001', 'Daily Product Showcase', 'Join us for amazing deals on quality products!', 2, 'active');
