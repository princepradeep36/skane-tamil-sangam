# WhatsApp message templates

Automatic WhatsApp messages use Meta's WhatsApp Business API, which only lets a business
start a chat with templates approved in **WhatsApp Manager → Message templates**.
Create these four templates exactly as below.

For each one: **Create template → Category: Utility → Name: (as below) → Language: English**,
paste the body text, fill in the sample values Meta asks for, and submit.
Approval usually takes minutes to a day.

The `{{1}}`, `{{2}}` … placeholders are filled in by the website in this order.

---

## 1. `stsangam_registration_confirmed`

Sent automatically when a family registers.
`{{1}}` first name · `{{2}}` registration number · `{{3}}` number of people · `{{4}}` fee in kr

```
Vanakkam {{1}}! Your registration for Skåne Tamil Sangam Diwali 2026 is confirmed.

Registration number: {{2}}
Participants: {{3}}
Registration fee: {{4}} kr

You can view your booking, pay and upload your Swish screenshot at https://skanetamilsangam.duckdns.org/event-registration.html using your phone number.

See you on Sunday 15 November 2026 at Tryckeriet, from 10:00 AM.
```

Sample values: `Anu`, `12`, `3`, `260`

## 2. `stsangam_payment_received`

Sent automatically when a family marks their payment as paid.
`{{1}}` first name · `{{2}}` registration number · `{{3}}` amount paid in kr

```
Vanakkam {{1}}! We have received your payment for Skåne Tamil Sangam Diwali 2026, registration {{2}}.

Amount paid: {{3}} kr

Your registration is complete. Thank you, and see you on Sunday 15 November 2026 at Tryckeriet, from 10:00 AM.
```

Sample values: `Anu`, `12`, `260`

## 3. `stsangam_payment_reminder`

Sent with the "Send to all on WhatsApp" button.
`{{1}}` first name · `{{2}}` registration number · `{{3}}` amount due in kr · `{{4}}` Swish number

```
Vanakkam {{1}}, a friendly reminder that the payment for your Skåne Tamil Sangam Diwali 2026 registration {{2}} is still pending.

Amount to pay: {{3}} kr
Swish number: {{4}}

Please write your registration number in the Swish message. After paying, open https://skanetamilsangam.duckdns.org/event-registration.html, find your booking with your phone number, upload the Swish screenshot and tap Mark as Paid.

If you have already paid, please upload your screenshot so we can confirm it. Thank you!
```

Sample values: `Anu`, `12`, `260`, `1234567890`

## 4. `stsangam_payment_open`

Sent with the "Send to all on WhatsApp" button.
`{{1}}` first name · `{{2}}` registration number · `{{3}}` amount due in kr · `{{4}}` Swish number

```
Vanakkam {{1}}! Payment for Skåne Tamil Sangam Diwali 2026 is now open. Please pay the fee for your registration {{2}} by Swish.

Amount to pay: {{3}} kr
Swish number: {{4}}

Please write your registration number in the Swish message. After paying, open https://skanetamilsangam.duckdns.org/event-registration.html, find your booking with your phone number, upload the Swish screenshot and tap Mark as Paid.
```

Sample values: `Anu`, `12`, `260`, `1234567890`

---

## Server settings (`.env`)

```
WHATSAPP_TOKEN=permanent token of the "website" system user
WHATSAPP_PHONE_NUMBER_ID=Phone number ID from the app's WhatsApp → API Setup
# Optional:
# WHATSAPP_CONFIRMATIONS=off   # stop the automatic registration/payment WhatsApp messages
# WHATSAPP_LANGUAGE=en         # language code the templates were created with
```

Then: `git pull origin main && docker compose up -d --build food-backend frontend`
