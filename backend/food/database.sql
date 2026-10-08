-- 1. Vendors Table
CREATE TABLE vendors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    swish VARCHAR(50) NOT NULL
);

-- 2. Menu Items Table
CREATE TABLE menu_items (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    max_quantity INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    category VARCHAR(20) NOT NULL DEFAULT 'FOOD',
    description VARCHAR(500),
    ingredients VARCHAR(500)
);

-- 3. Users Table (Authentication)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL, -- In production, hash this!
    role VARCHAR(20) CHECK (role IN ('admin', 'vendor')),
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL
);

-- 4. Customers Table
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) UNIQUE NOT NULL
);

-- 5. Orders Table
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
    total DECIMAL(10, 2) NOT NULL,
    payment_status VARCHAR(20) DEFAULT 'UNPAID', -- Can be 'UNPAID' or 'PAID'
    delivery_status VARCHAR(20) DEFAULT 'Pending', -- Can be 'Pending' or 'Delivered'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Order Items Table
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
);

-- 7. Event Registrations
CREATE TABLE IF NOT EXISTS event_registrations (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(120) NOT NULL,
    last_name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) UNIQUE NOT NULL,
    whatsapp VARCHAR(50) NOT NULL,
    adults_count INTEGER NOT NULL DEFAULT 0 CHECK (adults_count >= 0),
    kids_6_12_count INTEGER NOT NULL DEFAULT 0 CHECK (kids_6_12_count >= 0),
    kids_below_6_count INTEGER NOT NULL DEFAULT 0 CHECK (kids_below_6_count >= 0),
    volunteer_interest BOOLEAN NOT NULL DEFAULT FALSE,
    cultural_interest BOOLEAN NOT NULL DEFAULT FALSE,
    cultural_activity_type VARCHAR(30),
    comments VARCHAR(1000),
    photo_consent BOOLEAN NOT NULL DEFAULT FALSE,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration-safe additions for existing installations (also backfills previous registrations).
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS total_amount INTEGER NOT NULL DEFAULT 0;
UPDATE event_registrations SET total_amount = adults_count * 100 + kids_6_12_count * 60;

-- Event Swish routing: admins can configure multiple receiving numbers and collection limits.
CREATE TABLE IF NOT EXISTS event_swish_accounts (
    id SERIAL PRIMARY KEY,
    label VARCHAR(120) DEFAULT '',
    swish_number VARCHAR(20) UNIQUE NOT NULL,
    limit_amount INTEGER NOT NULL CHECK (limit_amount > 0),
    priority INTEGER NOT NULL DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS swish_account_id INTEGER REFERENCES event_swish_accounts(id) ON DELETE SET NULL;

-- Event registration lifecycle (V7.4): cancelled bookings remain for audit but are excluded from live totals.
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS registration_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS cultural_activity_type VARCHAR(30) NULL;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS comments VARCHAR(1000) NULL;
