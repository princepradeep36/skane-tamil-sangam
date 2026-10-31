// WhatsApp messages the admin sends by hand: the admin page opens WhatsApp with this text
// already written (https://wa.me/<number>?text=...), and the admin presses Send.
const { amountDue } = require("./mailer");

const SITE_URL = (process.env.SITE_URL || "https://skanetamilsangam.duckdns.org").replace(/\/$/, "");
const REGISTRATION_URL = `${SITE_URL}/event-registration.html`;
const EVENT_LINE = "Sunday 15 November 2026 at Tryckeriet, from 10:00 AM";

function paymentLines(r) {
  const due = amountDue(r);
  if (r.payment_status === "PAID" || due <= 0) return "";
  if (!r.swish_number) return `\nAmount to pay: *${due} kr* (payment details will be shared soon)\n`;
  return `\n*Amount to pay: ${due} kr*\nSwish number: *${r.swish_number}*\nMessage: Diwali 2026 Reg ${r.id}\n\nAfter paying, open ${REGISTRATION_URL}, find your booking with your phone number, upload the Swish screenshot and tap *Mark as Paid*.\n`;
}

const MESSAGES = {
  PAYMENT_OPEN: r => `Vanakkam ${r.first_name} 🙏\n\nPayment for *Skåne Tamil Sangam Diwali 2026* is now open. Please pay your registration fee (registration ${r.id}) by Swish.\n${paymentLines(r)}\nSee you on ${EVENT_LINE}! 🪔\n– Skåne Tamil Sangam`,
  PAYMENT_REMINDER: r => `Vanakkam ${r.first_name} 🙏\n\nA friendly reminder: the payment for your *Diwali 2026* registration (number ${r.id}) is still pending.\n${paymentLines(r)}\nIf you have already paid, please upload your Swish screenshot and tap Mark as Paid on the registration page so we can confirm it.\n\nThank you! 🪔\n– Skåne Tamil Sangam`,
  // Admin-written text. {first_name}, {amount_due} and {registration_id} are filled in per family.
  CUSTOM: (r, custom) => {
    const fill = s => String(s || "").replace(/\{first_name\}/g, r.first_name).replace(/\{amount_due\}/g, String(amountDue(r))).replace(/\{registration_id\}/g, String(r.id));
    return `${fill(custom.body)}\n${custom.includePayment ? paymentLines(r) : ""}\n– Skåne Tamil Sangam`.replace(/\n{3,}/g, "\n\n");
  }
};

// wa.me wants the full international number as digits only.
function whatsappDigits(number) {
  let digits = String(number || "").replace(/\D/g, "");
  if (/^00/.test(digits)) digits = digits.slice(2);
  if (/^0\d{9}$/.test(digits)) digits = "46" + digits.slice(1); // older registrations stored Swedish numbers as 07…
  return digits.length >= 8 ? digits : null;
}

module.exports = { MESSAGES, whatsappDigits };
