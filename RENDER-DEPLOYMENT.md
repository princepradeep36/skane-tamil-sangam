# Render deployment - V7.5

This package is prepared for Render Blueprint deployment.

## Production topology
- `skane-tamil-sangam`: public Nginx frontend
- `skane-site-backend`: private Node/Express service
- `skane-food-backend`: private Node/Express service
- `skane-tamil-db`: one managed Render PostgreSQL instance

The two backend apps share the PostgreSQL instance safely by using separate PostgreSQL schemas: `site` and `food`.

## Required values during first Blueprint creation
Render will prompt for variables marked `sync: false`:
- `FRONTEND_URL`: initially enter the Render frontend URL after it is known, or a temporary placeholder such as `https://example.com`; update it after deployment. This is used for password-reset links.
- `ADMIN_USERNAME`: choose a production Click2Eat admin username.
- `ADMIN_PASSWORD`: choose a strong production Click2Eat admin password.

Never commit real passwords to Git.

## Deploy
1. Create a new GitHub repository.
2. Put the CONTENTS of this folder at the repository root (so `render.yaml` is at the root).
3. Commit and push to `main`.
4. In Render Dashboard choose New -> Blueprint.
5. Connect the GitHub repository.
6. Render detects `render.yaml`. Review and deploy it.
7. Supply the prompted secret values.
8. Wait for PostgreSQL, both private backends, and the frontend to become live.
9. Open the public `skane-tamil-sangam` service URL.
10. Update `FRONTEND_URL` on `skane-site-backend` to that exact HTTPS URL and redeploy the site backend.

## Database initialization
On the first backend start, each backend creates its own PostgreSQL schema and tables automatically. Subsequent deploys do not recreate the base tables. Existing lifecycle migrations in the food backend still run normally.

## Local Docker
Local Docker remains supported. Run `docker compose up --build -d`. Local Docker continues using the two local logical databases (`skane_site` and `click2eat`), while Render uses one managed database with two schemas.

## Important production note
The Blueprint intentionally uses paid compute for the frontend/private services and the smallest paid PostgreSQL plan. Render free web services cannot receive private-network traffic, and free Postgres expires after 30 days. This layout keeps both API services private and exposes only the frontend.
