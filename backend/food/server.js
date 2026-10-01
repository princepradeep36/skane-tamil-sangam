require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const pool = require("./db");
const initializeDatabase = require("./init-db");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type"]
}));

app.use(bodyParser.json());

app.get("/health", (req, res) => res.json({ status: "ok", service: "food-backend" }));

/* ================= AUTHENTICATION ROUTES ================= */

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
    if (user.rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

    // In a real app, use bcrypt.compare here
    if (user.rows[0].password !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const { role, vendor_id } = user.rows[0];
    res.json({ role, vendor_id });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/admin/users", async (req, res) => {
  const { username, password, role, vendor_id } = req.body;
  try {
    await pool.query(
      "INSERT INTO users(username, password, role, vendor_id) VALUES($1, $2, $3, $4)",
      [username, password, role, vendor_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================= ADMIN ROUTES (Crucial - Do not remove) ================= */

app.post("/admin/vendor", async (req, res) => {
  const { name, phone, swish } = req.body;
  try {
    await pool.query("INSERT INTO vendors(name, phone, swish) VALUES($1,$2,$3)", [name, phone, swish]);
    res.send("Vendor created");
  } catch (err) { res.status(500).send(err.message); }
});

app.post("/admin/vendor-full", async (req, res) => {
  const { name, phone, swish } = req.body;
  try {
    // 1. Create Vendor
    const vendorRes = await pool.query(
      "INSERT INTO vendors(name, phone, swish) VALUES($1,$2,$3) RETURNING id",
      [name, phone, swish]
    );
    const vendorId = vendorRes.rows[0].id;

    // 2. Generate Credentials
    const cleanName = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const username = `${cleanName}${randomSuffix}`;
    const password = Math.random().toString(36).slice(-6);

    // 3. Create User
    await pool.query(
      "INSERT INTO users(username, password, role, vendor_id) VALUES($1, $2, 'vendor', $3)",
      [username, password, vendorId]
    );

    res.json({ success: true, username, password });
  } catch (err) { res.status(500).send(err.message); }
});

app.post("/admin/menu", async (req, res) => {
  const { vendor_id, item_name, price, max_quantity } = req.body;
  try {
    await pool.query("INSERT INTO menu_items(vendor_id,item_name,price,max_quantity) VALUES($1,$2,$3,$4)",
      [vendor_id, item_name, price, max_quantity]);
    res.send("Menu item added");
  } catch (err) { res.status(500).send(err.message); }
});

app.get("/vendors", async (req, res) => {
  const vendors = await pool.query(`
    SELECT 
      v.id, 
      v.name, 
      v.phone, 
      v.swish,
      COALESCE(
        json_agg(
          json_build_object(
            'id', m.id, 
            'item_name', m.item_name, 
            'price', m.price, 
            'max_quantity', m.max_quantity,
            'sold_quantity', COALESCE(sold.qty, 0)
          ) ORDER BY m.id
        ) FILTER (WHERE m.id IS NOT NULL AND m.is_active = TRUE), 
        '[]'
      ) AS menu
    FROM vendors v 
    LEFT JOIN menu_items m ON v.id = m.vendor_id
    LEFT JOIN (
      SELECT menu_item_id, SUM(quantity) as qty
      FROM order_items
      GROUP BY menu_item_id
    ) sold ON m.id = sold.menu_item_id
    GROUP BY v.id 
    ORDER BY v.id
  `);
  res.json(vendors.rows);
});

app.delete("/admin/menu/:id", async (req, res) => {
  // Soft delete to preserve order history constraints
  await pool.query("UPDATE menu_items SET is_active = FALSE WHERE id=$1", [req.params.id]);
  res.send("Deleted (Soft)");
});

app.post("/vendor/menu", async (req, res) => {
  const { vendor_id, item_name, price, max_quantity } = req.body;
  try {
    await pool.query("INSERT INTO menu_items(vendor_id,item_name,price,max_quantity) VALUES($1,$2,$3,$4)",
      [vendor_id, item_name, price, max_quantity]);
    res.json({ success: true });
  } catch (err) { res.status(500).send(err.message); }
});

/* ================= CUSTOMER & ORDER ROUTES ================= */

/* ================= CUSTOMER & ORDER ROUTES ================= */

app.post("/order", async (req, res) => {
  const { name, phone, cart } = req.body;
  let customer = await pool.query("SELECT id FROM customers WHERE phone=$1", [phone]);
  if (customer.rows.length === 0) {
    customer = await pool.query("INSERT INTO customers(name,phone) VALUES($1,$2) RETURNING id", [name, phone]);
  }
  const customerId = customer.rows[0].id;

  for (const vendorId in cart) {
    let total = 0;
    cart[vendorId].items.forEach(i => total += i.price * i.quantity);
    const pStatus = cart[vendorId].paid ? 'PAID' : 'UNPAID';

    const order = await pool.query(
      "INSERT INTO orders(customer_id, vendor_id, total, payment_status, delivery_status) VALUES($1,$2,$3,$4,'Pending') RETURNING id",
      [customerId, vendorId, total, pStatus]
    );

    for (const item of cart[vendorId].items) {
      await pool.query("INSERT INTO order_items(order_id, menu_item_id, quantity) VALUES($1,$2,$3)",
        [order.rows[0].id, item.id, item.quantity]);
    }
  }
  res.json({ success: true });
});

app.get("/orders/:phone", async (req, res) => {
  const data = await pool.query(`
    SELECT o.id, o.total, o.payment_status, o.delivery_status, v.name AS vendor 
    FROM orders o JOIN vendors v ON o.vendor_id = v.id
    JOIN customers c ON o.customer_id = c.id WHERE c.phone=$1`, [req.params.phone]);
  res.json(data.rows);
});

app.get("/order/:id/details", async (req, res) => {
  const data = await pool.query(`
    SELECT oi.id, m.item_name, oi.quantity, m.price FROM order_items oi 
    JOIN menu_items m ON oi.menu_item_id = m.id WHERE oi.order_id=$1`, [req.params.id]);
  res.json(data.rows);
});

app.put("/order/:id/pay", async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE orders SET payment_status = 'PAID' WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).send("Order not found");
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================= VENDOR DASHBOARD ROUTES ================= */

app.get("/vendors-dropdown", async (req, res) => {
  const result = await pool.query("SELECT id, name FROM vendors ORDER BY name");
  res.json(result.rows);
});

app.get("/vendor-orders/:vendorId", async (req, res) => {
  const data = await pool.query(`
    SELECT o.id AS order_id, o.delivery_status, c.name AS customer_name, c.phone AS customer_phone, m.item_name, oi.quantity
    FROM orders o JOIN customers c ON o.customer_id = c.id
    JOIN order_items oi ON o.id = oi.order_id
    JOIN menu_items m ON oi.menu_item_id = m.id
    WHERE o.vendor_id = $1 AND o.payment_status = 'PAID' ORDER BY o.id DESC`, [req.params.vendorId]);
  res.json(data.rows);
});

app.get("/vendor-summary", async (req, res) => {
  const data = await pool.query(`
    SELECT v.name AS vendor_name, v.phone, m.item_name, SUM(oi.quantity) AS total_quantity, SUM(oi.quantity * m.price) AS total_amount
    FROM orders o JOIN vendors v ON o.vendor_id = v.id
    JOIN order_items oi ON o.id = oi.order_id
    JOIN menu_items m ON oi.menu_item_id = m.id
    WHERE o.payment_status = 'PAID'
    GROUP BY v.id, v.name, v.phone, m.item_name`);
  res.json(data.rows);
});

app.put("/order/:id/delivery", async (req, res) => {
  const { status } = req.body;
  // If status is provided, use it. Otherwise toggle for backward compatibility if needed (though we will use explicit status now)
  if (status) {
    await pool.query("UPDATE orders SET delivery_status = $1 WHERE id = $2", [status, req.params.id]);
  } else {
    // Fallback toggle logic (Pending <-> Delivered) - strictly speaking we might not need this if frontend sends status
    // But for safety let's just error or require status.
    return res.status(400).json({ error: "Status is required" });
  }
  res.json({ success: true });
});

app.put("/change-password", async (req, res) => {
  const { vendorId, oldPassword, newPassword } = req.body;
  try {
    // Verify old password
    const userRes = await pool.query("SELECT * FROM users WHERE vendor_id = $1 AND role = 'vendor'", [vendorId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const user = userRes.rows[0];
    if (user.password !== oldPassword) {
       return res.status(401).json({ error: "Incorrect old password" });
    }

    // Update password
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [newPassword, user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================= EVENT REGISTRATION ROUTES ================= */

// Central event prices in SEK. Always calculate on the server, never trust client totals.
const EVENT_ADULT_PRICE = 100;
const EVENT_CHILD_6_12_PRICE = 60;
function eventTotal(adults, children) {
  return adults * EVENT_ADULT_PRICE + children * EVENT_CHILD_6_12_PRICE;
}
function validCount(value) {
  return Number.isInteger(value) && value >= 0;
}
function validTenDigitPhone(value) {
  return typeof value === "string" && /^\d{10}$/.test(value.trim());
}

// Migration-safe lifecycle fields. This runs on every backend start, so existing Docker
// volumes are upgraded without requiring `docker compose down -v`.
async function ensureEventRegistrationLifecycle() {
  await pool.query(`ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS registration_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'`);
  await pool.query(`ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL`);
  await pool.query(`UPDATE event_registrations SET registration_status='ACTIVE' WHERE registration_status IS NULL`);
}


async function allocateSwishAccount(client, amount, excludeRegistrationId = null) {
  const accounts = await client.query(`SELECT id,label,swish_number,limit_amount,priority FROM event_swish_accounts WHERE active=TRUE ORDER BY priority,id FOR UPDATE`);
  for (const a of accounts.rows) {
    const used = await client.query(`SELECT COALESCE(SUM(total_amount),0)::int AS allocated_amount FROM event_registrations WHERE swish_account_id=$1 AND registration_status <> 'CANCELLED' AND id IS DISTINCT FROM $2`, [a.id, excludeRegistrationId]);
    a.allocated_amount = used.rows[0].allocated_amount;
    if (Number(a.allocated_amount) + Number(amount) <= Number(a.limit_amount)) return a;
  }
  return null;
}

async function registrationWithSwish(client, id) {
  const q = await client.query(`SELECT r.*, a.swish_number, a.label AS swish_label, a.limit_amount AS swish_limit
    FROM event_registrations r LEFT JOIN event_swish_accounts a ON a.id=r.swish_account_id WHERE r.id=$1`, [id]);
  return q.rows[0];
}

// Route older unpaid registrations after an admin adds or increases a Swish account.
async function assignPendingUnroutedRegistrations(client) {
  const pending = await client.query(`SELECT id,total_amount FROM event_registrations WHERE registration_status <> 'CANCELLED' AND payment_status <> 'PAID' AND swish_account_id IS NULL ORDER BY created_at,id FOR UPDATE`);
  let assigned = 0;
  for (const registration of pending.rows) {
    if (Number(registration.total_amount) <= 0) continue;
    const swish = await allocateSwishAccount(client, Number(registration.total_amount), Number(registration.id));
    if (!swish) continue;
    await client.query(`UPDATE event_registrations SET swish_account_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [swish.id, registration.id]);
    assigned++;
  }
  return assigned;
}

app.post("/event/register", async (req, res) => {
  const { firstName, lastName, email, phone, whatsapp, adultsCount, kids6to12Count,
    kidsBelow6Count, volunteerInterest, culturalInterest, photoConsent } = req.body;
  if (!firstName || !lastName || !email || !validTenDigitPhone(phone) || !validTenDigitPhone(whatsapp) || !photoConsent ||
      !validCount(adultsCount) || !validCount(kids6to12Count) || !validCount(kidsBelow6Count) ||
      adultsCount + kids6to12Count + kidsBelow6Count < 1) {
    return res.status(400).json({ error: "Please complete all mandatory fields, use exactly 10 digits for phone and WhatsApp numbers, accept the consent, and register at least one participant." });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const amount = eventTotal(adultsCount, kids6to12Count);
    const existing = await client.query(`SELECT id,registration_status FROM event_registrations WHERE phone=$1 FOR UPDATE`, [phone.trim()]);
    const swish = await allocateSwishAccount(client, amount, existing.rows[0]?.id || null);
    if (existing.rows.length && existing.rows[0].registration_status === 'CANCELLED') {
      const revived = await client.query(`UPDATE event_registrations SET
        first_name=$1,last_name=$2,email=$3,phone=$4,whatsapp=$5,adults_count=$6,kids_6_12_count=$7,kids_below_6_count=$8,
        volunteer_interest=$9,cultural_interest=$10,photo_consent=$11,total_amount=$12,swish_account_id=$13,
        payment_status='PENDING',registration_status='ACTIVE',cancelled_at=NULL,created_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=$14 RETURNING id`,
        [firstName.trim(),lastName.trim(),email.trim(),phone.trim(),whatsapp.trim(),adultsCount,kids6to12Count,kidsBelow6Count,!!volunteerInterest,!!culturalInterest,!!photoConsent,amount,swish?.id || null,existing.rows[0].id]);
      const saved = await registrationWithSwish(client, revived.rows[0].id);
      await client.query('COMMIT');
      return res.status(201).json(saved);
    }
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: "A registration already exists for this phone number. Use Find Booking to modify it." });
    }
    const result = await client.query(`INSERT INTO event_registrations
      (first_name,last_name,email,phone,whatsapp,adults_count,kids_6_12_count,kids_below_6_count,volunteer_interest,cultural_interest,photo_consent,total_amount,swish_account_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [firstName.trim(),lastName.trim(),email.trim(),phone.trim(),whatsapp.trim(),adultsCount,kids6to12Count,kidsBelow6Count,!!volunteerInterest,!!culturalInterest,!!photoConsent,amount,swish?.id || null]);
    const saved = await registrationWithSwish(client, result.rows[0].id);
    await client.query('COMMIT');
    res.status(201).json(saved);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: "A registration already exists for this phone number. Use Find Booking to modify it." });
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.get("/event/registration/:phone", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(`SELECT id,total_amount,payment_status,swish_account_id
      FROM event_registrations WHERE phone=$1 AND registration_status <> 'CANCELLED' FOR UPDATE`, [req.params.phone.trim()]);
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Registration not found" });
    }

    const registration = found.rows[0];
    // A registration may have been created before the admin configured a Swish account.
    // When an unpaid booking is reopened, try the routing rules again so it can receive
    // a newly configured Swish number without forcing the user to edit the booking first.
    if (registration.payment_status !== 'PAID' && !registration.swish_account_id) {
      const swish = await allocateSwishAccount(client, Number(registration.total_amount), Number(registration.id));
      if (swish) {
        await client.query(`UPDATE event_registrations
          SET swish_account_id=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
          [swish.id, registration.id]);
      }
    }

    const saved = await registrationWithSwish(client, registration.id);
    await client.query('COMMIT');
    res.json(saved);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.put("/event/registration/:id", async (req, res) => {
  const { firstName, lastName, email, phone, whatsapp, adultsCount, kids6to12Count, kidsBelow6Count, volunteerInterest, culturalInterest, photoConsent } = req.body;
  if (!firstName || !lastName || !email || !validTenDigitPhone(phone) || !validTenDigitPhone(whatsapp) || !photoConsent || !validCount(adultsCount) || !validCount(kids6to12Count) || !validCount(kidsBelow6Count) || adultsCount + kids6to12Count + kidsBelow6Count < 1)
    return res.status(400).json({ error: "Please complete all mandatory fields, use exactly 10 digits for phone and WhatsApp numbers, accept the consent, and register at least one participant." });
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const amount=eventTotal(adultsCount,kids6to12Count);
    const swish=await allocateSwishAccount(client, amount, Number(req.params.id));
    const result=await client.query(`UPDATE event_registrations SET first_name=$1,last_name=$2,email=$3,phone=$4,whatsapp=$5,adults_count=$6,kids_6_12_count=$7,kids_below_6_count=$8,volunteer_interest=$9,cultural_interest=$10,photo_consent=$11,total_amount=$12,swish_account_id=$13,
      payment_status=CASE WHEN adults_count<>$6 OR kids_6_12_count<>$7 OR kids_below_6_count<>$8 THEN 'PENDING' ELSE payment_status END,registration_status='ACTIVE',cancelled_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$14 AND registration_status <> 'CANCELLED' RETURNING id`,
      [firstName.trim(),lastName.trim(),email.trim(),phone.trim(),whatsapp.trim(),adultsCount,kids6to12Count,kidsBelow6Count,!!volunteerInterest,!!culturalInterest,!!photoConsent,amount,swish?.id || null,req.params.id]);
    if(!result.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Registration not found'});}
    const saved=await registrationWithSwish(client,result.rows[0].id); await client.query('COMMIT'); res.json(saved);
  } catch(err){await client.query('ROLLBACK'); if(err.code==='23505') return res.status(409).json({error:'That phone number is already used by another registration.'}); res.status(500).json({error:err.message});}
  finally{client.release();}
});

// Customer payment confirmation, matching the existing Click2Eat food-payment flow.
// This records the customer's confirmation; it is not a bank-side Swish verification.
app.put("/event/registration/:id/pay", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE event_registrations
       SET payment_status='PAID', updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND registration_status <> 'CANCELLED' RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Registration not found" });
    const saved = await registrationWithSwish(pool, result.rows[0].id);
    res.json({ success: true, registration: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/event/registration/:id", async (req, res) => {
  try {
    // Keep the row for audit/history, but immediately remove it from all live totals
    // and release its Swish allocation.
    const result = await pool.query(`UPDATE event_registrations
      SET registration_status='CANCELLED', cancelled_at=CURRENT_TIMESTAMP,
          swish_account_id=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND registration_status <> 'CANCELLED'
      RETURNING id,payment_status,total_amount`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Registration not found or already cancelled" });
    res.json({ success: true, registration_status: 'CANCELLED', payment_status: result.rows[0].payment_status, total_amount: result.rows[0].total_amount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/admin/event-registrations", async (req, res) => {
  try {
    const result = await pool.query(`SELECT r.*, a.swish_number, a.label AS swish_label, (r.adults_count+r.kids_6_12_count+r.kids_below_6_count) AS total_participants
      FROM event_registrations r LEFT JOIN event_swish_accounts a ON a.id=r.swish_account_id ORDER BY r.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/admin/event-registration-summary", async (req, res) => {
  try {
    const result = await pool.query(`SELECT COUNT(*)::int AS total_registrations,
      COALESCE(SUM(adults_count),0)::int AS total_adults,
      COALESCE(SUM(kids_6_12_count),0)::int AS total_kids_6_12,
      COALESCE(SUM(kids_below_6_count),0)::int AS total_kids_below_6,
      COALESCE(SUM(adults_count + kids_6_12_count + kids_below_6_count),0)::int AS total_participants,
      COUNT(*) FILTER (WHERE volunteer_interest)::int AS volunteer_families,
      COUNT(*) FILTER (WHERE cultural_interest)::int AS cultural_interest_families,
      COALESCE(SUM(total_amount),0)::int AS total_registration_value,
      COALESCE(SUM(total_amount) FILTER (WHERE payment_status='PAID'),0)::int AS total_amount_collected,
      COALESCE(SUM(total_amount) FILTER (WHERE payment_status='PENDING'),0)::int AS total_amount_pending
      FROM event_registrations
      WHERE registration_status <> 'CANCELLED'`);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/admin/event-registration/:id/payment", async (req, res) => {
  const { status } = req.body;
  if (!['PENDING','PAID'].includes(status)) return res.status(400).json({ error: "Invalid payment status" });
  try {
    const result = await pool.query("UPDATE event_registrations SET payment_status=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND registration_status <> 'CANCELLED' RETURNING *", [status, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Registration not found" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


/* ================= EVENT SWISH ADMIN ================= */
app.get('/admin/event-swish-accounts', async (req,res)=>{try{const q=await pool.query(`SELECT a.*,
  COALESCE(SUM(r.total_amount),0)::int allocated_amount,
  COALESCE(SUM(r.total_amount) FILTER(WHERE r.payment_status='PAID'),0)::int paid_amount
  FROM event_swish_accounts a LEFT JOIN event_registrations r ON r.swish_account_id=a.id AND r.registration_status <> 'CANCELLED'
  GROUP BY a.id ORDER BY a.priority,a.id`);res.json(q.rows)}catch(e){res.status(500).json({error:e.message})}});
app.post('/admin/event-swish-accounts', async (req,res)=>{
  const {label,swishNumber,limitAmount,priority=1,active=true}=req.body;
  if(!/^\d{10}$/.test(String(swishNumber||''))||Number(limitAmount)<=0) return res.status(400).json({error:'Swish number must be 10 digits and limit must be greater than 0.'});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const q=await client.query(`INSERT INTO event_swish_accounts(label,swish_number,limit_amount,priority,active) VALUES($1,$2,$3,$4,$5) RETURNING *`,[label||'',swishNumber,Number(limitAmount),Number(priority)||1,!!active]);
    const assigned=await assignPendingUnroutedRegistrations(client);
    await client.query('COMMIT');
    res.status(201).json({...q.rows[0],pending_registrations_assigned:assigned});
  } catch(e) { await client.query('ROLLBACK'); res.status(e.code==='23505'?409:500).json({error:e.message}); } finally { client.release(); }
});
app.put('/admin/event-swish-accounts/:id', async (req,res)=>{
  const {label,swishNumber,limitAmount,priority=1,active=true}=req.body;
  if(!/^\d{10}$/.test(String(swishNumber||''))||Number(limitAmount)<=0) return res.status(400).json({error:'Swish number must be 10 digits and limit must be greater than 0.'});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const q=await client.query(`UPDATE event_swish_accounts SET label=$1,swish_number=$2,limit_amount=$3,priority=$4,active=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$6 RETURNING *`,[label||'',swishNumber,Number(limitAmount),Number(priority)||1,!!active,req.params.id]);
    if(!q.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Swish account not found'});}
    const assigned=await assignPendingUnroutedRegistrations(client);
    await client.query('COMMIT');
    res.json({...q.rows[0],pending_registrations_assigned:assigned});
  } catch(e) { await client.query('ROLLBACK'); res.status(e.code==='23505'?409:500).json({error:e.message}); } finally { client.release(); }
});
app.delete('/admin/event-swish-accounts/:id', async (req,res)=>{try{const used=await pool.query("SELECT COUNT(*)::int c FROM event_registrations WHERE swish_account_id=$1 AND registration_status <> 'CANCELLED'",[req.params.id]);if(used.rows[0].c>0)return res.status(409).json({error:'This Swish number is already assigned to registrations. Deactivate it instead.'});await pool.query('DELETE FROM event_swish_accounts WHERE id=$1',[req.params.id]);res.json({success:true})}catch(e){res.status(500).json({error:e.message})}});

const PORT = process.env.PORT || 3000;

/* ================= ADMIN ORDER MANAGEMENT ================= */

// Helper to recalculate order total
async function recalcOrderTotal(orderId) {
  const res = await pool.query(`
    SELECT SUM(oi.quantity * m.price) as new_total
    FROM order_items oi
    JOIN menu_items m ON oi.menu_item_id = m.id
    WHERE oi.order_id = $1
  `, [orderId]);

  const newTotal = res.rows[0].new_total || 0;
  await pool.query("UPDATE orders SET total = $1 WHERE id = $2", [newTotal, orderId]);
}

app.get("/admin/orders", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id, o.total, o.payment_status, o.delivery_status, o.created_at,
             v.name AS vendor_name, c.name AS customer_name, c.phone AS customer_phone
      FROM orders o
      JOIN vendors v ON o.vendor_id = v.id
      JOIN customers c ON o.customer_id = c.id
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).send(err.message); }
});

app.delete("/admin/order/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM orders WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).send(err.message); }
});

app.delete("/admin/order-item/:id", async (req, res) => {
  try {
    const del = await pool.query("DELETE FROM order_items WHERE id=$1 RETURNING order_id", [req.params.id]);
    if (del.rows.length > 0) {
      await recalcOrderTotal(del.rows[0].order_id);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Item not found" });
    }
  } catch (err) { res.status(500).send(err.message); }
});

app.put("/admin/order-item/:id", async (req, res) => {
  const { quantity } = req.body;
  if (quantity < 1) return res.status(400).send("Qty must be positive");
  try {
    const update = await pool.query("UPDATE order_items SET quantity=$1 WHERE id=$2 RETURNING order_id", [quantity, req.params.id]);
    if (update.rows.length > 0) {
      await recalcOrderTotal(update.rows[0].order_id);
      res.json({ success: true });
    } else {
      res.status(404).send("Item not found");
    }
  } catch (err) { res.status(500).send(err.message); }
});

app.put("/admin/order/:id/payment", async (req, res) => {
  const { status } = req.body; // 'PAID' or 'UNPAID'
  if (!['PAID', 'UNPAID'].includes(status)) return res.status(400).send("Invalid status");
  
  try {
    await pool.query("UPDATE orders SET payment_status=$1 WHERE id=$2", [status, req.params.id]);
    res.json({ success: true, status });
  } catch (err) { res.status(500).send(err.message); }
});

// Reuse existing details endpoint for fetching items of an order
// app.get("/order/:id/details") is already available and public

initializeDatabase()
  .then(() => ensureEventRegistrationLifecycle())
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`)))
  .catch(err => { console.error('Failed to initialize event registration lifecycle:', err); process.exit(1); });