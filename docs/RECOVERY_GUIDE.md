# Disaster Recovery & Local Setup Guide

This guide describes how to completely restore and run the **Shivam Voice Agent** platform on a fresh development machine (MacBook / Linux / Windows WSL).

---

## 1. System Requirements

* **Operating System:** macOS (Sonoma/Sequoia), Linux (Ubuntu 22.04+), or Windows 11 with WSL2.
* **Node.js:** `v20.x` or `v22.x` (LTS versions recommended).
* **Package Manager:** `npm` (v10.x+) or `pnpm`.
* **Git:** Version 2.30+.
* **Tesseract OCR (Optional, for scanned PDF OCR):** `brew install tesseract` on macOS, or `apt-get install tesseract-ocr` on Ubuntu.

---

## 2. Cloning the Repository

```bash
git clone https://github.com/111shivamrai/shivam-voice-agent-.git
cd shivam-voice-agent-
```

Verify you are on the `main` branch:
```bash
git checkout main
git status
```

---

## 3. Database & Supabase Restoration

1. Create a new project on [Supabase](https://supabase.com).
2. Open the **SQL Editor** in the Supabase Dashboard and run the migration scripts in the exact order below:
   * **Step A: Schema & pgvector:**
     Copy and execute [`frontend/supabase/schema.sql`](file:///Users/shivamrai/Downloads/shivam%20voice%20agent/frontend/supabase/schema.sql).
   * **Step B: Payments & Approval:**
     Copy and execute [`frontend/supabase/phase3_payment_requests.sql`](file:///Users/shivamrai/Downloads/shivam%20voice%20agent/frontend/supabase/phase3_payment_requests.sql) and [`frontend/supabase/phase3_atomic_approval.sql`](file:///Users/shivamrai/Downloads/shivam%20voice%20agent/frontend/supabase/phase3_atomic_approval.sql).
   * **Step C: Calls & Atomic Minute Deduction:**
     Copy and execute [`frontend/supabase/phase4_calls_schema.sql`](file:///Users/shivamrai/Downloads/shivam%20voice%20agent/frontend/supabase/phase4_calls_schema.sql).
3. Under **Project Settings -> API**, obtain:
   * `Project URL`
   * `anon` public key
   * `service_role` secret key

---

## 4. Backend Environment Setup & Verification

1. Navigate to the backend directory:
   ```bash
   cd backend
   npm install
   ```
2. Create `backend/.env` from template:
   ```bash
   cp .env.example .env
   ```
3. Populate `backend/.env` with your real keys:
   ```env
   PORT=3001
   FRONTEND_URL=http://localhost:3000
   BACKEND_URL=http://localhost:3001
   ADMIN_PASSWORD=your_secure_password
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_KEY=eyJ...
   OPENAI_API_KEY=sk-...
   DEEPGRAM_API_KEY=...
   SMALLEST_API_KEY=...
   SARVAM_API_KEY=...
   TELNYX_API_KEY=KEY01A0B074EEE7CC832A798D1FAF46BFA0_your_telnyx_api_key_here
   TELNYX_PHONE_NUMBER=+18005550199
   TELNYX_CONNECTION_ID=...
   ```
4. Run the automated test suite to verify system integrity:
   ```bash
   npm test
   # Expected output: Test Suites: 17 passed, 17 total | Tests: 391 passed, 391 total
   ```
5. Verify linting and build:
   ```bash
   npm run lint
   npx tsc --noEmit
   npm run build
   ```
6. Start the local backend server:
   ```bash
   npm run start:dev
   # Backend listens on http://localhost:3001
   ```

---

## 5. Frontend Environment Setup & Launch

1. Open a new terminal and navigate to the frontend:
   ```bash
   cd frontend
   npm install
   ```
2. Create `frontend/.env.local` from template:
   ```bash
   cp .env.example .env.local
   ```
3. Populate `frontend/.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```
4. Verify the production build:
   ```bash
   npm run build
   ```
5. Start the frontend development server:
   ```bash
   npm run dev
   # Frontend runs on http://localhost:3000
   ```

---

## 6. Testing Telephony Locally (via ngrok)

Because carrier webhooks require a public HTTPS/WSS URL, use `ngrok` for local testing:

1. Expose backend port 3001:
   ```bash
   ngrok http 3001
   # Yields e.g. https://xxxx-xx-xx-xx.ngrok-free.app
   ```
2. Update `backend/.env`:
   ```env
   BACKEND_URL=https://xxxx-xx-xx-xx.ngrok-free.app
   ```
3. In the Telnyx Mission Control Portal:
   * Point Call Control App Webhook to: `https://xxxx-xx-xx-xx.ngrok-free.app/voice/webhook`
   * Method: `POST`, API version: `v2`.
4. Call your Telnyx phone number from a real phone — your local NestJS server will answer and stream live audio!
