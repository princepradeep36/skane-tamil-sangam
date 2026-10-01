-- Create the Members Table
CREATE TABLE members (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(150) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    category VARCHAR(50), -- Student, Primary
    dob DATE,
    role VARCHAR(20) DEFAULT 'member', -- 'admin' or 'member'
    reset_token TEXT,
    reset_token_expiry TIMESTAMP
);

-- Create the Events Table
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    event_name VARCHAR(200),
    event_date DATE
);

-- Create the Registrations Table (Links Members/Guests to Events)
CREATE TABLE event_registrations (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(150),
    phone VARCHAR(20),
    whatsapp VARCHAR(20),
    adults_count INT DEFAULT 0,
    kids_6_12_count INT DEFAULT 0,
    kids_below_6_count INT DEFAULT 0,
    volunteer_interest BOOLEAN DEFAULT FALSE,
    cultural_interest BOOLEAN DEFAULT FALSE,
    photo_consent BOOLEAN DEFAULT FALSE,
    is_member BOOLEAN DEFAULT FALSE,
    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Create the Page Content Table
CREATE TABLE page_content (
    id SERIAL PRIMARY KEY,
    page_key VARCHAR(50) NOT NULL,
    section_key VARCHAR(50) NOT NULL,
    content TEXT,
    content_type VARCHAR(20) DEFAULT 'text', -- 'text', 'html', or 'image'
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_key, section_key)
);

-- Create the Event Expenses Table
CREATE TABLE event_expenses (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    category VARCHAR(100), -- Food, Venue, Marketing, etc.
    expense_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create the Event Tasks Table
CREATE TABLE event_tasks (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    task_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending', -- Pending, In Progress, Completed
    due_date DATE,
    priority VARCHAR(20) DEFAULT 'Medium', -- Low, Medium, High
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

