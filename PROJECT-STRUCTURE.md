# Skåne Tamil Sangam — deployment structure

The repository is deliberately split into two application projects:

- `frontend/` — the complete public website, Diwali registration UI, Click2Eat customer UI, vendor UI and admin UI. Nginx serves these static pages and proxies API requests.
- `backend/` — all server-side code and database initialization.
  - `backend/site/` — Skåne Tamil Sangam/CMS backend (port 3001 internally).
  - `backend/food/` — Click2Eat + Diwali registration/payment backend (port 3000 internally).
  - `backend/database/init/` — PostgreSQL initialization scripts for `skane_site` and `click2eat` databases.

`docker-compose.yml` at the repository root is for local/full-stack deployment and starts PostgreSQL, both backend services and the frontend.

## Main user URLs
- `/` — Skåne Tamil Sangam home
- `/events.html` — Events
- `/event-registration.html` — Diwali 2026 registration
- `/food/index.html` — Click2Eat customer hub
- `/food/login.html` — Click2Eat staff login

## API paths through the frontend
- `/api/*` -> site backend
- `/food-api/*` -> Click2Eat backend

This keeps frontend assets in one deployable folder and every backend/database component in one backend folder.
