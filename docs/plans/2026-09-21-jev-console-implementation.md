# Jev Chinese Console Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and deploy a public Chinese Jev decision console with anonymous and authenticated daily quotas.

**Architecture:** A single Node.js Express service serves a polished vanilla web app and same-origin JSON API. SQLite stores users, sessions, and quota counters; the server calls TypeSafe Jev with a secret environment variable and Nginx exposes the service over HTTPS.

**Tech Stack:** Node.js 20, Express, TypeSafe JavaScript SDK, SQLite/better-sqlite3, bcryptjs, Zod, vanilla HTML/CSS/JS, Nginx, systemd.

---

### Task 1: Scaffold and configuration

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/config.js`

1. Define runtime dependencies and scripts.
2. Add environment validation without printing secrets.
3. Ignore local databases, dependencies, environment files, logs, and build artifacts.
4. Install dependencies and confirm Node 20 compatibility.

### Task 2: Persistence, authentication, and quota service

**Files:**
- Create: `src/db.js`
- Create: `src/auth.js`
- Create: `src/quota.js`
- Test: `test/quota.test.js`

1. Create parameterized SQLite tables for users, sessions, quota counters, and burst controls.
2. Implement bcrypt password hashing and opaque HttpOnly sessions.
3. Implement Shanghai-day anonymous IP limits of 10 and authenticated account limits of 30.
4. Hash IP identifiers with a server secret and avoid storing raw addresses.
5. Test limit boundaries and daily reset keys.

### Task 3: Jev request validation and API

**Files:**
- Create: `src/jev.js`
- Create: `src/server.js`
- Test: `test/jev.test.js`

1. Validate state, primitive type, instructions, options, and levels with Zod.
2. Convert the form payload into official Noul, Choice, or Score questions.
3. Enforce quota before the external request and return remaining counts.
4. Add register, login, logout, session, quota, health, and evaluation endpoints.
5. Add same-origin checks, security headers, body limits, generic production errors, and request timeouts.

### Task 4: Chinese working interface

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Create: `public/favicon.svg`

1. Build a three-panel desktop workspace and stacked mobile layout.
2. Add primitive tabs and plain-language fields instead of JSON.
3. Add editable Choice options and ordered Score levels.
4. Render probabilities, confidence, quota, loading, empty, success, and error states.
5. Add register/login dialog when anonymous quota is exhausted.
6. Ensure keyboard navigation, labels, focus states, responsive behavior, and safe text rendering.

### Task 5: Verification

**Files:**
- Modify as failures require.

1. Run unit tests and JavaScript syntax checks.
2. Run dependency audit and review OWASP concerns.
3. Start locally with a test database and verify static rendering and health endpoint.
4. Exercise auth and quota boundaries without calling the paid Jev API.
5. Run one real Jev smoke test only after the production secret is configured.

### Task 6: Server deployment

**Files:**
- Create on server: `/opt/jev-console/.env`
- Create on server: `/etc/systemd/system/jev-console.service`
- Create on server: `/etc/nginx/sites-available/jev.lumingzt.cn.conf`

1. Upload the application to an isolated release directory.
2. Install production dependencies and create a persistent data directory.
3. Configure secrets with restrictive permissions.
4. Start the systemd service on loopback and verify `/api/health`.
5. Add and validate the Nginx host, then reload Nginx.
6. Issue a Let’s Encrypt certificate and verify automatic renewal.
7. Verify HTTPS, authentication, limits, and a real Jev response.
