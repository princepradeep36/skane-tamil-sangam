// Event emails: registration and payment confirmations, plus admin group emails.
// Needs SMTP_HOST, SMTP_USER and SMTP_PASS (SMTP_PORT defaults to 587, MAIL_FROM to SMTP_USER).
// Without them nothing is sent and every attempt is logged as SKIPPED.
const nodemailer = require("nodemailer");
const pool = require("./db");
const { bookingUrl } = require("./booking-link");

const EVENT_LINE = "Sunday 15 November 2026 at Tryckeriet, from 10:00 AM";

let transporter = null;
function configured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
function fromAddress() {
  return process.env.MAIL_FROM || (process.env.SMTP_USER ? `Skåne Tamil Sangam <${process.env.SMTP_USER}>` : "");
}
function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transporter;
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function amountDue(r) {
  return r.amount_due != null ? Number(r.amount_due) : Math.max(Number(r.total_amount) - Number(r.paid_amount || 0), 0);
}

// One festive layout for every email. bodyHtml must already be escaped.
function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#fdfaf6;font-family:Arial,Helvetica,sans-serif;color:#1c1c1e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #f4e2b8">
<tr><td style="background:#0056b3;color:#fff;padding:22px 26px">
<div style="font-size:13px;letter-spacing:2px;color:#ffc107;font-weight:bold">SKÅNE TAMIL SANGAM</div>
<div style="font-size:22px;font-weight:bold;margin-top:6px">🪔 ${esc(title)}</div></td></tr>
<tr><td style="padding:24px 26px;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td style="padding:16px 26px;background:#fff8e6;color:#6b5b2e;font-size:12px;line-height:1.5">
Diwali Celebration 2026 · ${esc(EVENT_LINE)}<br>You are receiving this because you registered for this event. Reply to this email if you have questions.<br>Found this in Spam or Junk? Please mark it as "Not spam" so our next emails reach your inbox.</td></tr>
</table></td></tr></table></body></html>`;
}

function button(label, url) {
  return `<p style="margin:22px 0"><a href="${esc(url)}" style="background:#0056b3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;display:inline-block">${esc(label)}</a></p>`;
}

function participants(r) {
  const parts = [`${r.adults_count} adult${r.adults_count == 1 ? "" : "s"}`];
  if (Number(r.kids_6_12_count)) parts.push(`${r.kids_6_12_count} child${r.kids_6_12_count == 1 ? "" : "ren"} (6–12)`);
  if (Number(r.kids_below_6_count)) parts.push(`${r.kids_below_6_count} child${r.kids_below_6_count == 1 ? "" : "ren"} under 6`);
  return parts.join(", ");
}

function paymentBlock(r) {
  const due = amountDue(r);
  if (r.payment_status === "PAID" || due <= 0) return "";
  if (!r.swish_number) return `<p><b>Payment:</b> ${due} kr. The payment details will be shared soon.</p>`;
  return `<p style="background:#fff8e6;border:1px solid #f4d48a;border-radius:12px;padding:12px 14px"><b>Amount to pay: ${due} kr</b><br>Swish number: <b>${esc(r.swish_number)}</b><br>Message: Diwali 2026 Reg ${esc(r.id)}</p>
<p>After paying, open <a href="${esc(bookingUrl(r))}">your booking</a>, upload the Swish screenshot and tap <b>Mark as Paid</b>.</p>`;
}

const TEMPLATES = {
  REGISTRATION: r => ({
    subject: "Your Diwali 2026 registration is confirmed",
    html: layout("Registration confirmed", `<p>Vanakkam ${esc(r.first_name)},</p>
<p>Thank you for registering for <b>Skåne Tamil Sangam Diwali 2026</b>. Here are your details:</p>
<p><b>Registration number:</b> ${esc(r.id)}<br><b>Participants:</b> ${esc(participants(r))}<br><b>Registration fee:</b> ${esc(r.total_amount)} kr</p>
${paymentBlock(r)}
<p>You can view or change your booking at any time with this button.</p>${button("Open my registration", bookingUrl(r))}
<p>See you on ${esc(EVENT_LINE)}!</p>`)
  }),
  PAYMENT_RECEIVED: r => ({
    subject: "Payment received – Diwali 2026",
    html: layout("Payment received", `<p>Vanakkam ${esc(r.first_name)},</p>
<p>We have received your payment confirmation for registration <b>${esc(r.id)}</b>. Your registration for <b>Skåne Tamil Sangam Diwali 2026</b> is complete. Thank you!</p>
<p><b>Participants:</b> ${esc(participants(r))}<br><b>Paid:</b> ${esc(Math.min(Number(r.paid_amount || r.total_amount), Number(r.total_amount)))} kr</p>
<p>See you on ${esc(EVENT_LINE)}!</p>`)
  }),
  PAYMENT_OPEN: r => ({
    subject: "Payment is now open – Diwali 2026",
    html: layout("Payment is now open", `<p>Vanakkam ${esc(r.first_name)},</p>
<p>Payment for <b>Skåne Tamil Sangam Diwali 2026</b> is now open. Please pay your registration fee by Swish.</p>
${paymentBlock(r)}${button("Pay for my registration", bookingUrl(r))}`)
  }),
  PAYMENT_REMINDER: r => ({
    subject: "Reminder: please complete your Diwali 2026 payment",
    html: layout("Payment reminder", `<p>Vanakkam ${esc(r.first_name)},</p>
<p>This is a friendly reminder that the payment for your Diwali 2026 registration (number <b>${esc(r.id)}</b>) is still pending.</p>
${paymentBlock(r)}${button("Pay now", bookingUrl(r))}
<p>If you have already paid, please upload your Swish screenshot and tap Mark as Paid on the registration page so we can confirm it.</p>`)
  }),
  // Admin-written message. {first_name}, {amount_due} and {registration_id} are filled in per person.
  CUSTOM: (r, custom) => {
    const fill = s => String(s || "").replace(/\{first_name\}/g, r.first_name).replace(/\{amount_due\}/g, String(amountDue(r))).replace(/\{registration_id\}/g, String(r.id));
    const body = esc(fill(custom.body)).replace(/\n/g, "<br>");
    return {
      subject: fill(custom.subject).slice(0, 200),
      html: layout(fill(custom.subject).slice(0, 120), `<p>${body}</p>${custom.includePayment ? paymentBlock(r) : ""}${button("Open my registration", bookingUrl(r))}`)
    };
  }
};

function plainText(html) {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2: $1")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

async function ensureEmailLog() {
  await pool.query(`CREATE TABLE IF NOT EXISTS event_email_log (
    id SERIAL PRIMARY KEY,
    registration_id INTEGER NULL REFERENCES event_registrations(id) ON DELETE SET NULL,
    kind VARCHAR(30) NOT NULL,
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(10) NOT NULL,
    error VARCHAR(500) NULL,
    batch_id VARCHAR(40) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  // WhatsApp messages sent by hand from the admin page are logged here too.
  await pool.query(`ALTER TABLE event_email_log ADD COLUMN IF NOT EXISTS channel VARCHAR(10) NOT NULL DEFAULT 'EMAIL'`);
}

async function log(entry) {
  await pool.query(`INSERT INTO event_email_log(registration_id,kind,to_email,subject,status,error,batch_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [entry.registration_id || null, entry.kind, String(entry.to).slice(0, 255), String(entry.subject).slice(0, 255), entry.status, entry.error ? String(entry.error).slice(0, 500) : null, entry.batch_id || null]).catch(err => console.error("email log failed:", err.message));
}

async function sendRaw(to, subject, html) {
  await getTransporter().sendMail({ from: fromAddress(), to, subject, html, text: plainText(html) });
}

// Sends one templated email to a registration and records the result. Never throws.
async function sendToRegistration(r, kind, custom, batchId) {
  const { subject, html } = TEMPLATES[kind](r, custom || {});
  const base = { registration_id: r.id, kind, to: r.email || "", subject, batch_id: batchId };
  if (!r.email) return log({ ...base, status: "FAILED", error: "No email address" }).then(() => false);
  if (!configured()) return log({ ...base, status: "SKIPPED", error: "Email sending is not set up (SMTP settings missing)" }).then(() => false);
  try {
    lastErrorWasLimit = false;
    await sendRaw(r.email, subject, html);
    await log({ ...base, status: "SENT" });
    return true;
  } catch (err) {
    lastErrorWasLimit = isSendingLimit(err.message);
    await log({ ...base, status: "FAILED", error: err.message });
    return false;
  }
}

// Gmail and other providers answer 550 5.4.5 / 4.7.x when the daily sending limit is reached.
let lastErrorWasLimit = false;
function isSendingLimit(message) {
  return /5\.4\.5|4\.7\.0|sending limit|limit exceeded|rate limit|too many/i.test(String(message || ""));
}

module.exports = { hitSendingLimit: () => lastErrorWasLimit, configured, fromAddress, TEMPLATES, ensureEmailLog, sendToRegistration, sendRaw, layout, amountDue };
