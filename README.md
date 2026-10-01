
## V7.3 event payment confirmation
Event registration now follows the Click2Eat payment-status pattern: pending registrations show Swish/QR plus a **Mark as Paid** action. Once confirmed, reopening the booking shows **Payment completed / already paid** and hides payment actions. The admin can still change payment status from Event Registrations.

# Skåne Tamil Sangam + Click2Eat

Clean two-project layout:

- **frontend/** — all browser-facing pages/assets (main Sangam site, Diwali registration, Click2Eat, vendor/admin pages).
- **backend/** — all Node.js backend services and PostgreSQL initialization.

For local development, run from this repository root:

```powershell
docker compose up --build -d
docker compose ps
```

Open `http://localhost:8080`.

The frontend proxies `/api/` to the Sangam site backend and `/food-api/` to the Click2Eat backend. See `PROJECT-STRUCTURE.md` for details.


## V7.1 event Swish behavior
- New registrations receive the first active Swish account with enough remaining configured capacity.
- Existing unpaid registrations that were created before a Swish account was configured are assigned automatically when the booking is reopened, if an account has enough remaining capacity.
- If no eligible Swish account exists, the registration page shows: **Payment link will be shared soon.**
- Unpaid registrations with an assigned Swish account show the exact amount, Swish number, mobile Swish action, and desktop QR action.
- Updating participant counts recalculates the amount and reruns Swish routing.
- A Swish account collection limit must be at least large enough for the full registration amount plus its already allocated amount.


## V7.2 event Swish fix
Adding or increasing an active Event Swish account immediately routes eligible older unpaid registrations. Reopening an unpaid booking also retries routing. When routed, the event page automatically displays a Swish QR containing the assigned number and exact registration amount. If no eligible route exists, it displays “Payment link will be shared soon.”

## V7.4 cancellation behavior
Event cancellations are now soft-cancelled for audit history. Cancelled registrations are excluded from the live Registration Summary and from Swish allocation/paid totals. Cancelling also releases the assigned Swish capacity. Existing Docker volumes are migrated automatically when the food backend starts; do not delete the volume.
