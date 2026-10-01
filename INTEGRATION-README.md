
## V7.3 event payment confirmation
Event registration now follows the Click2Eat payment-status pattern: pending registrations show Swish/QR plus a **Mark as Paid** action. Once confirmed, reopening the booking shows **Payment completed / already paid** and hides payment actions. The admin can still change payment status from Event Registrations.

# Skåne Tamil Sangam + Diwali Registration + Click2Eat

## Run locally
```powershell
docker compose down -v
docker compose up --build -d
```
Open http://localhost:8080

The `-v` is required the first time you switch to this integrated build because it creates two databases (`skane_site` and `click2eat`) and the new Swish routing table.

## Main URLs
- Website: http://localhost:8080/
- Events: http://localhost:8080/events.html
- Diwali registration: http://localhost:8080/event-registration.html
- Click2Eat login: http://localhost:8080/food/login.html
- Click2Eat admin: http://localhost:8080/food/admin.html?admin=true
- Event registrations: http://localhost:8080/food/admin-event-registrations.html?admin=true
- Event summary: http://localhost:8080/food/admin-event-summary.html?admin=true
- Event Swish routing: http://localhost:8080/food/admin-event-swish.html?admin=true

Local Click2Eat admin seed: admin / admin123

## Event Swish routing
Admins add multiple 10-digit Swish numbers, a collection limit in SEK, and priority. Registration amount is calculated server-side (adult 100 kr, child 6–12 60 kr, under 6 free). A registration is assigned to the first active Swish number whose allocated registration total will stay within its limit. When that number is full, the next priority number is used. Updating participant counts recalculates the amount and can reassign the registration. If no configured number has enough remaining capacity, registration is still saved but payment is shown as temporarily unavailable until an admin adds/raises a Swish route.
