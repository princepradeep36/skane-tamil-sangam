// Diwali 2026 feedback form (public /feedback.html), modelled on the Pongal Vizha 2026 Google Form:
// event success rating, open questions, food stalls / Click2Eat rating, and star ratings per vendor.
// Every submission is kept as it was sent (like a Google Form). Vendors see only their own stall's
// ratings and comments, never the guest's name or phone. Admins see everything.
module.exports = function registerFeedback(app, { pool, requireVendor, requirePerm, vendorScope, normalizePhone }) {
  const text = (v, max = 2000) => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
  const stars = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };

  async function ensureFeedbackTables() {
    await pool.query(`CREATE TABLE IF NOT EXISTS event_feedback (
      id SERIAL PRIMARY KEY,
      success_rating SMALLINT NOT NULL CHECK (success_rating BETWEEN 1 AND 5),
      enjoyed TEXT NULL,
      not_worked TEXT NULL,
      had_problems BOOLEAN NULL,
      problems_prepare TEXT NULL,
      differently TEXT NULL,
      food_rating SMALLINT NULL CHECK (food_rating BETWEEN 1 AND 5),
      food_comment TEXT NULL,
      name VARCHAR(100) NULL,
      phone VARCHAR(30) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NULL REFERENCES vendors(id) ON DELETE CASCADE,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment VARCHAR(1000) NULL,
      name VARCHAR(100) NULL,
      phone VARCHAR(30) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    // Rating for the Diwali sweet boxes handed out at the event.
    await pool.query(`ALTER TABLE event_feedback ADD COLUMN IF NOT EXISTS sweets_rating SMALLINT NULL`);
    await pool.query(`ALTER TABLE event_feedback ADD COLUMN IF NOT EXISTS sweets_comment TEXT NULL`);
    // Vendor ratings belong to one form submission.
    await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS event_feedback_id INTEGER NULL REFERENCES event_feedback(id) ON DELETE CASCADE`);
    await pool.query(`CREATE INDEX IF NOT EXISTS feedback_vendor_idx ON feedback(vendor_id)`);
  }

  app.get("/feedback/vendors", async (req, res) => {
    try { res.json((await pool.query("SELECT id, name FROM vendors ORDER BY name")).rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/feedback", async (req, res) => {
    const b = req.body || {};
    const success = stars(b.successRating);
    if (!success) return res.status(400).json({ error: "Please rate the success of Diwali 2026 (1 to 5 stars)." });
    const phone = text(b.phone, 30) ? normalizePhone(b.phone) : null;
    if (text(b.phone, 30) && !phone) return res.status(400).json({ error: "Please check your phone number, e.g. +46 70 123 45 67, or leave it empty." });
    const hadProblems = b.hadProblems === true || b.hadProblems === "yes" ? true : b.hadProblems === false || b.hadProblems === "no" ? false : null;
    const seen = new Set();
    const vendorRatings = [];
    for (const v of Array.isArray(b.vendors) ? b.vendors.slice(0, 50) : []) {
      const id = Number(v.vendorId), rating = stars(v.rating);
      if (!Number.isInteger(id) || !rating || seen.has(id)) continue;
      seen.add(id);
      vendorRatings.push({ id, rating, comment: text(v.comment, 1000) });
    }
    try {
      const known = new Set((await pool.query("SELECT id FROM vendors")).rows.map(r => r.id));
      const name = text(b.name, 100);
      const ins = await pool.query(`INSERT INTO event_feedback(success_rating, enjoyed, not_worked, had_problems, problems_prepare, differently, food_rating, food_comment, sweets_rating, sweets_comment, name, phone)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [success, text(b.enjoyed), text(b.notWorked), hadProblems, hadProblems ? text(b.problemsPrepare) : null, text(b.differently),
         stars(b.foodRating), text(b.foodComment), stars(b.sweetsRating), text(b.sweetsComment), name, phone]);
      for (const v of vendorRatings.filter(v => known.has(v.id))) {
        await pool.query("INSERT INTO feedback(vendor_id, rating, comment, name, phone, event_feedback_id) VALUES($1,$2,$3,$4,$5,$6)",
          [v.id, v.rating, v.comment, name, phone, ins.rows[0].id]);
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Admin: every answer, the averages and per-vendor averages.
  app.get("/admin/event-feedback", requirePerm("registrations"), async (req, res) => {
    try {
      const subs = (await pool.query("SELECT * FROM event_feedback ORDER BY id DESC")).rows;
      const vr = (await pool.query(`SELECT f.event_feedback_id, f.vendor_id, v.name AS vendor_name, f.rating, f.comment
        FROM feedback f JOIN vendors v ON v.id = f.vendor_id WHERE f.vendor_id IS NOT NULL ORDER BY f.id`)).rows;
      const byForm = {};
      vr.forEach(r => { (byForm[r.event_feedback_id] = byForm[r.event_feedback_id] || []).push(r); });
      const avg = list => list.length ? Math.round(10 * list.reduce((a, b) => a + b, 0) / list.length) / 10 : null;
      const food = subs.map(s => s.food_rating).filter(Boolean);
      const sweets = subs.map(s => s.sweets_rating).filter(Boolean);
      const perVendor = {};
      vr.forEach(r => { const p = perVendor[r.vendor_id] = perVendor[r.vendor_id] || { vendor_id: r.vendor_id, vendor_name: r.vendor_name, ratings: [] }; p.ratings.push(r.rating); });
      res.json({
        summary: {
          count: subs.length,
          successAverage: avg(subs.map(s => s.success_rating)),
          foodAverage: avg(food), foodCount: food.length,
          sweetsAverage: avg(sweets), sweetsCount: sweets.length,
          problemsYes: subs.filter(s => s.had_problems === true).length,
          problemsNo: subs.filter(s => s.had_problems === false).length
        },
        vendors: Object.values(perVendor).map(p => ({ vendor_id: p.vendor_id, vendor_name: p.vendor_name, count: p.ratings.length, average: avg(p.ratings) }))
          .sort((a, b) => b.average - a.average || b.count - a.count),
        submissions: subs.map(s => ({ ...s, vendors: byForm[s.id] || [] }))
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/admin/event-feedback/:id", requirePerm("registrations"), async (req, res) => {
    try { await pool.query("DELETE FROM event_feedback WHERE id = $1", [req.params.id]); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // A vendor's own stall: ratings and comments only, no guest names or phones. Admins pass ?vendorId=.
  app.get("/vendor/feedback", requireVendor, async (req, res) => {
    const vendorId = req.user.role === "admin" ? Number(req.query.vendorId) : vendorScope(req);
    if (!vendorId) return res.status(400).json({ error: "Choose a stall." });
    try {
      const items = (await pool.query(`SELECT rating, comment, created_at FROM feedback
        WHERE vendor_id = $1 ORDER BY created_at DESC`, [vendorId])).rows;
      const counts = [1, 2, 3, 4, 5].map(n => items.filter(i => i.rating === n).length);
      const average = items.length ? Math.round(10 * items.reduce((a, i) => a + i.rating, 0) / items.length) / 10 : null;
      res.json({ count: items.length, average, counts, items });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return ensureFeedbackTables;
};
