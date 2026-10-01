require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const pool = require('./db');
const initializeDatabase = require('./init-db');
const { encryptData, decryptData } = require('./encryption');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// --- Email Configuration ---
// Note: To send real emails, add SMTP credentials to .env
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: process.env.SMTP_PORT || 587,
    auth: {
        user: process.env.SMTP_USER || null,
        pass: process.env.SMTP_PASS || null
    }
});

const sendResetEmail = async (email, token) => {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/reset-password.html?token=${token}`;

    // Log for development if no SMTP user is provided
    if (!process.env.SMTP_USER) {
        console.log("-----------------------------------------");
        console.log(`PASSWORD RESET REQUEST FOR: ${email}`);
        console.log(`LINK: ${resetUrl}`);
        console.log("-----------------------------------------");
        return;
    }

    const mailOptions = {
        from: '"Skåne Tamil Sangam" <noreply@skanetamil.se>',
        to: email,
        subject: 'Password Reset Request',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                <h2 style="color: #002b5c;">Password Reset Request</h2>
                <p>Hello,</p>
                <p>We received a request to reset your password for your Skåne Tamil Sangam account. Click the button below to set a new password:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetUrl}" style="background-color: #002b5c; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
                </div>
                <p>If you didn't request this, you can safely ignore this email. This link will expire in 1 hour.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 12px; color: #777;">Skåne Tamil Sangam - Southern Sweden</p>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error("Email send failed:", error);
    }
};



app.get('/health', (req, res) => res.json({ status: 'ok', service: 'site-backend' }));

// --- ROUTES ---

// 1. Register Member (With Encryption & Hashing)
app.post('/api/register', async (req, res) => {
    const { firstName, lastName, email, phone, password, category, dob } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const encryptedLastName = encryptData(lastName);
        const encryptedPhone = encryptData(phone);

        const query = `INSERT INTO members (first_name, last_name, email, phone, password, category, dob) 
                       VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        await pool.query(query, [firstName, encryptedLastName, email, encryptedPhone, hashedPassword, category, dob]);

        res.status(201).json({ message: "Registration successful and data encrypted!" });
    } catch (err) {
        res.status(400).json({ error: "Email already exists or DB error" });
    }
});

// 1.1 Login (With Role Support)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM members WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        // For simplicity, returning the user role. In a real app, use JWT.
        res.json({
            message: "Login successful",
            role: user.role,
            user: { firstName: user.first_name, lastName: user.last_name, email: user.email }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1.2 Change Password (Secure)
app.post('/api/user/change-password', async (req, res) => {
    const { email, oldPassword, newPassword } = req.body;
    try {
        const result = await pool.query('SELECT password FROM members WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Incorrect current password" });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE members SET password = $1 WHERE email = $2', [hashedNewPassword, email]);

        res.json({ message: "Password updated successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Failed to update password" });
    }
});

// 1.3 Forgot Password (Initiate)
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const result = await pool.query('SELECT * FROM members WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            // Don't reveal if email exists, just say "checked"
            return res.json({ message: "If an account exists, a reset link has been sent." });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + 3600000); // 1 hour from now

        await pool.query('UPDATE members SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3', [token, expiry, email]);

        await sendResetEmail(email, token);

        res.json({ message: "If an account exists, a reset link has been sent." });
    } catch (err) {
        res.status(500).json({ error: "Processing failure" });
    }
});

// 1.4 Reset Password (Complete)
app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    try {
        const result = await pool.query('SELECT * FROM members WHERE reset_token = $1 AND reset_token_expiry > NOW()', [token]);
        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Invalid or expired token" });
        }

        const user = result.rows[0];
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await pool.query('UPDATE members SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2', [hashedPassword, user.id]);

        res.json({ message: "Password reset successful! You can now login." });
    } catch (err) {
        res.status(500).json({ error: "Reset failed" });
    }
});

// 2. Admin: View Decrypted Members
app.get('/api/admin/members', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM members ORDER BY id DESC');
        const decryptedData = result.rows.map(m => ({
            ...m,
            last_name: decryptData(m.last_name),
            phone: decryptData(m.phone)
        }));
        res.json(decryptedData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2.1 Admin: Get all events
app.get('/api/admin/events', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM events ORDER BY event_date DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2.2 Admin: Get registrations for a specific event
app.get('/api/admin/registrations/:eventId', async (req, res) => {
    const { eventId } = req.params;
    try {
        const query = (eventId === 'all' || !eventId)
            ? 'SELECT * FROM event_registrations ORDER BY registration_date DESC'
            : 'SELECT * FROM event_registrations WHERE event_id = $1 ORDER BY registration_date DESC';

        const params = (eventId === 'all' || !eventId) ? [] : [eventId];
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. CMS: Fetch content for a page
app.get('/api/content/:page', async (req, res) => {
    const { page } = req.params;
    try {
        const result = await pool.query('SELECT section_key, content, content_type FROM page_content WHERE page_key = $1', [page]);
        const contentMap = {};
        result.rows.forEach(row => {
            contentMap[row.section_key] = {
                content: row.content,
                type: row.content_type
            };
        });
        res.json(contentMap);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Admin: Update CMS content
app.post('/api/admin/content/update', async (req, res) => {
    const { page_key, section_key, content, content_type } = req.body;
    try {
        const query = `
            INSERT INTO page_content (page_key, section_key, content, content_type)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (page_key, section_key)
            DO UPDATE SET content = EXCLUDED.content, content_type = EXCLUDED.content_type, updated_at = CURRENT_TIMESTAMP
        `;
        await pool.query(query, [page_key, section_key, content, content_type || 'text']);
        res.json({ message: "Content updated successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Event Registration: Submit Registration
app.post('/api/event/register', async (req, res) => {
    const {
        eventId, firstName, lastName, email, phone, whatsapp,
        adultsCount, kids6to12Count, kidsBelow6Count,
        volunteerInterest, culturalInterest, photoConsent
    } = req.body;

    try {
        const query = `
            INSERT INTO event_registrations 
            (event_id, first_name, last_name, email, phone, whatsapp, adults_count, kids_6_12_count, kids_below_6_count, volunteer_interest, cultural_interest, photo_consent) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `;
        await pool.query(query, [
            eventId || null, firstName, lastName, email, phone, whatsapp,
            adultsCount || 0, kids6to12Count || 0, kidsBelow6Count || 0,
            volunteerInterest || false, culturalInterest || false, photoConsent || false
        ]);

        res.status(201).json({ message: "Registration successful!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to submit registration" });
    }
});

// 5.1 Event Registration: Lookup by Phone
app.get('/api/event/registration/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const result = await pool.query('SELECT * FROM event_registrations WHERE phone = $1 OR whatsapp = $1 ORDER BY registration_date DESC LIMIT 1', [phone]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No registration found for this phone number" });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5.2 Event Registration: Update
app.put('/api/event/registration/:id', async (req, res) => {
    const { id } = req.params;
    const {
        firstName, lastName, email, phone, whatsapp,
        adultsCount, kids6to12Count, kidsBelow6Count,
        volunteerInterest, culturalInterest, photoConsent
    } = req.body;

    try {
        const query = `
            UPDATE event_registrations 
            SET first_name = $1, last_name = $2, email = $3, phone = $4, whatsapp = $5, 
                adults_count = $6, kids_6_12_count = $7, kids_below_6_count = $8, 
                volunteer_interest = $9, cultural_interest = $10, photo_consent = $11
            WHERE id = $12
        `;
        await pool.query(query, [
            firstName, lastName, email, phone, whatsapp,
            adultsCount, kids6to12Count, kidsBelow6Count,
            volunteerInterest, culturalInterest, photoConsent,
            id
        ]);
        res.json({ message: "Registration updated successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Failed to update registration" });
    }
});

// 5.3 Event Registration: Cancel
app.delete('/api/event/registration/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM event_registrations WHERE id = $1', [req.params.id]);
        res.json({ message: "Registration cancelled" });
    } catch (err) {
        res.status(500).json({ error: "Failed to cancel registration" });
    }
});


// 6. Admin: Management - Expenses
app.get('/api/admin/expenses/:eventId', async (req, res) => {
    const { eventId } = req.params;
    try {
        const query = (eventId === 'all')
            ? 'SELECT * FROM event_expenses ORDER BY expense_date DESC'
            : 'SELECT * FROM event_expenses WHERE event_id = $1 ORDER BY expense_date DESC';
        const params = (eventId === 'all') ? [] : [eventId];
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/expenses', async (req, res) => {
    const { event_id, description, amount, category, expense_date } = req.body;
    try {
        const query = `INSERT INTO event_expenses (event_id, description, amount, category, expense_date) 
                       VALUES ($1, $2, $3, $4, $5) RETURNING *`;
        const result = await pool.query(query, [event_id, description, amount, category, expense_date || new Date()]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/expenses/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM event_expenses WHERE id = $1', [req.params.id]);
        res.json({ message: "Expense deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Admin: Management - Tasks
app.get('/api/admin/tasks/:eventId', async (req, res) => {
    const { eventId } = req.params;
    try {
        const query = (eventId === 'all')
            ? 'SELECT * FROM event_tasks ORDER BY due_date ASC'
            : 'SELECT * FROM event_tasks WHERE event_id = $1 ORDER BY due_date ASC';
        const params = (eventId === 'all') ? [] : [eventId];
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/tasks', async (req, res) => {
    const { event_id, task_name, due_date, priority } = req.body;
    try {
        const query = `INSERT INTO event_tasks (event_id, task_name, due_date, priority) 
                       VALUES ($1, $2, $3, $4) RETURNING *`;
        const result = await pool.query(query, [event_id, task_name, due_date, priority || 'Medium']);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/admin/tasks/:id', async (req, res) => {
    const { status } = req.body;
    try {
        const result = await pool.query('UPDATE event_tasks SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/tasks/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM event_tasks WHERE id = $1', [req.params.id]);
        res.json({ message: "Task deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


const PORT = process.env.PORT || 3001;
initializeDatabase()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`)))
  .catch(err => { console.error('Failed to initialize database:', err); process.exit(1); });