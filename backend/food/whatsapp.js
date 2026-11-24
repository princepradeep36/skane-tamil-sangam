// WhatsApp messages the admin sends by hand: the admin page opens WhatsApp with this text
// already written (https://wa.me/<number>?text=...), and the admin presses Send.
const { amountDue } = require("./mailer");
const { bookingUrl, sweetsPassUrl, sweetsStartText } = require("./booking-link");
const FEEDBACK_URL = `${(process.env.SITE_URL || "https://skanetamilsangam.duckdns.org").replace(/\/$/, "")}/feedback.html`;

const events = require("./events");

// Header and footer use the registration's event (Events page): name, emoji, date, time and venue.
const ev = r => events.of(r);
const short = r => ev(r).short_name || ev(r).name || "our event";
const HEADER = r => `${ev(r).emoji || "🎉"} *Skåne Tamil Sangam – ${short(r)}* ${ev(r).emoji || "🎉"}`;
const FOOTER = r => {
  const when = events.instance ? events.instance.shortWhenText(ev(r)) : "";
  return `_ℹ️ Please don't reply to this message._
${when ? `
📅 ${when}` : ""}
Nandri! 🙏
– Skåne Tamil Sangam`;
};

// Amount, Swish details and the personal link that opens the family's booking.
function paymentBlock(r) {
  const due = amountDue(r);
  if (r.payment_status === "PAID" || due <= 0) return "";
  return `💰 *Amount:* ${due} kr
📱 *Swish:* ${r.swish_number || "will be shared soon"}
📝 *Message:* ${short(r)} Reg ${r.id}

👉 *Pay & confirm here:*
${bookingUrl(r)}

After paying, upload your Swish screenshot and tap *Mark as Paid*. ✅`;
}

function message(r, sentence, note) {
  const payment = paymentBlock(r);
  return `${HEADER(r)}

Vanakkam ${r.first_name} 🙏
${sentence}${payment ? `

${payment}` : ""}${note ? `

${note}` : ""}

${FOOTER(r)}`;
}

const ALREADY_PAID_NOTE = "💡 *Already paid?* Please open the link above, upload your payment screenshot on the event registration page and tap *Mark as Paid*, so we can confirm it.";

const MESSAGES = {
  PAYMENT_OPEN: r => message(r, `Payment for ${short(r)} is now open.`),
  PAYMENT_REMINDER: r => message(r, "Just a gentle reminder that your registration payment is still pending.", ALREADY_PAID_NOTE),
  // Welcome message with the family's personal QR code, used at the entrance (check-in) and at the
  // sweets counter (one box per adult).
  SWEETS_PASS: r => {
    const adults = Number(r.adults_count) || 0, kids612 = Number(r.kids_6_12_count) || 0, kidsUnder6 = Number(r.kids_below_6_count) || 0;
    const payment = paymentBlock(r);
    const e = ev(r);
    const sweets = !!e.sweets_enabled;
    const start = sweetsStartText(e);
    const contacts = String(e.contacts_text || "").trim();
    return `${HEADER(r)}

Vanakkam ${r.first_name} 🙏
Thank you for registering for *${short(r)}*! 🎉 We are happy to welcome you.

🎟️ *Your QR code*
${sweetsPassUrl(r)}

👨‍👩‍👧 *Your registration #${r.id}*
Adults: ${adults}
Kids 6–12: ${kids612}
Kids under 6: ${kidsUnder6}
Total: ${adults + kids612 + kidsUnder6} people

${sweets ? `Please use this *one QR code* twice:
1️⃣ *At the entrance:* show it to check in your registration.
2️⃣ *At the sweets counter:* show it again to collect *${adults} sweet box${adults === 1 ? "" : "es"}* (one for each adult).
⚠️ Entrance check-in is mandatory. If you skip it, your QR code will not work at the sweets counter.${start ? `

🕒 *Sweet box distribution starts at ${start.time}* on ${start.day}. Until then the QR code won't work for sweets.` : ""}` : `Please show this QR code *at the entrance* to check in your registration.`}${payment ? `

${payment}` : ""}${contacts ? `

📞 *If you have any queries, please contact:*
${contacts}` : ""}

${FOOTER(r)}`;
  },
  // After the event: ask every family to fill in the feedback form.
  FEEDBACK: r => `${HEADER(r)}

Vanakkam ${r.first_name} 🙏
Thank you for celebrating *${short(r)}* with us! 🎉 It was wonderful to see you.

📝 *Please share your feedback*
It takes about 2 minutes and helps us make our next event even better. You can also rate the food stalls.
👉 ${FEEDBACK_URL}

Looking forward to seeing you at our future events! ${ev(r).emoji || "🎉"}

Nandri! 🙏
– Skåne Tamil Sangam`,
  // Admin-written text. {first_name}, {amount_due} and {registration_id} are filled in per family.
  CUSTOM: (r, custom) => {
    const fill = s => String(s || "").replace(/\{first_name\}/g, r.first_name).replace(/\{amount_due\}/g, String(amountDue(r))).replace(/\{registration_id\}/g, String(r.id));
    const payment = custom.includePayment ? paymentBlock(r) : "";
    return `${HEADER(r)}

${fill(custom.body)}${payment ? `

${payment}` : ""}

${FOOTER(r)}`;
  }
};

// wa.me wants the full international number as digits only.
function whatsappDigits(number) {
  let digits = String(number || "").replace(/\D/g, "");
  if (/^00/.test(digits)) digits = digits.slice(2);
  if (/^0\d{9}$/.test(digits)) digits = "46" + digits.slice(1); // older registrations stored Swedish numbers as 07…
  return digits.length >= 8 ? digits : null;
}

/* ---------- Automatic sending through Meta's WhatsApp Business (Cloud) API ----------
 * Needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID. Businesses may only start a chat with
 * templates approved in WhatsApp Manager, so each message below names a template and fills
 * its {{1}}, {{2}}, … in order. The template texts to create are in WHATSAPP-TEMPLATES.md.
 */
const pool = require("./db");

function apiConfigured() {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}
// Confirmations go out on WhatsApp automatically unless WHATSAPP_CONFIRMATIONS=off.
function confirmationsOn() {
  return apiConfigured() && String(process.env.WHATSAPP_CONFIRMATIONS || "on").toLowerCase() !== "off";
}

function people(r) {
  return Number(r.adults_count || 0) + Number(r.kids_6_12_count || 0) + Number(r.kids_below_6_count || 0);
}
const swishText = r => r.swish_number ? String(r.swish_number) : "shared soon";

const TEMPLATES = {
  REGISTRATION: { name: "stsangam_registration_confirmed", params: r => [r.first_name, r.id, people(r), r.total_amount] },
  PAYMENT_RECEIVED: { name: "stsangam_payment_received", params: r => [r.first_name, r.id, Math.min(Number(r.paid_amount || r.total_amount), Number(r.total_amount))] },
  PAYMENT_REMINDER: { name: "stsangam_payment_reminder", params: r => [r.first_name, r.id, amountDue(r), swishText(r)] },
  PAYMENT_OPEN: { name: "stsangam_payment_open", params: r => [r.first_name, r.id, amountDue(r), swishText(r)] }
};

async function logWhatsapp(r, kind, status, error, batchId) {
  await pool.query(`INSERT INTO event_email_log(registration_id,kind,to_email,subject,status,error,batch_id,channel) VALUES($1,$2,$3,$4,$5,$6,$7,'WHATSAPP')`,
    [r.id, kind, String(r.whatsapp || "").slice(0, 255), `WhatsApp (automatic): ${TEMPLATES[kind].name}`, status, error ? String(error).slice(0, 500) : null, batchId || null])
    .catch(err => console.error("whatsapp log failed:", err.message));
}

// Meta error codes that mean "stop sending for now" (rate or spam limits).
let lastErrorWasLimit = false;
const LIMIT_CODES = new Set([130429, 131048, 131056, 80007, 4]);

// Sends one template message to a registration and logs the result. Never throws.
async function sendTemplate(r, kind, batchId) {
  lastErrorWasLimit = false;
  const t = TEMPLATES[kind];
  const to = whatsappDigits(r.whatsapp);
  if (!to) { await logWhatsapp(r, kind, "FAILED", "No valid WhatsApp number", batchId); return false; }
  if (!apiConfigured()) { await logWhatsapp(r, kind, "SKIPPED", "WhatsApp API is not set up", batchId); return false; }
  try {
    const version = process.env.WHATSAPP_API_VERSION || "v25.0";
    const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: t.name,
          language: { code: process.env.WHATSAPP_LANGUAGE || "en" },
          components: [{ type: "body", parameters: t.params(r).map(v => ({ type: "text", text: String(v ?? "") })) }]
        }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data.error || {};
      lastErrorWasLimit = LIMIT_CODES.has(Number(e.code));
      await logWhatsapp(r, kind, "FAILED", `${e.code || res.status}: ${e.error_user_msg || e.message || "WhatsApp API error"}`, batchId);
      return false;
    }
    await logWhatsapp(r, kind, "SENT", null, batchId);
    return true;
  } catch (err) {
    await logWhatsapp(r, kind, "FAILED", err.message, batchId);
    return false;
  }
}

module.exports = { MESSAGES, whatsappDigits, apiConfigured, confirmationsOn, sendTemplate, hitLimit: () => lastErrorWasLimit, TEMPLATE_NAMES: Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, v.name])) };
