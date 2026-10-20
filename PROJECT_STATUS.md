# PROJECT_STATUS.md — Real-Time Development State

**Current Phase:** Phase 4.7 — Production Deployment Readiness & Guided Hosting  
**Latest Verified Commit:** `194854f` (`fix(deploy): enable telnyx-first startup validation and flexible vercel cors`)  
**Backend Automated Tests:** **391 / 391 Passing (17 Test Suites)**  
**Typecheck & Build:** 0 TypeScript Errors, Clean NestJS & Next.js Builds

---

## 1. Feature Completion Matrix

| Module / Feature | Status | Verification Evidence |
| :--- | :--- | :--- |
| **Deepgram Nova-3 STT** | ✅ **COMPLETE** | Live streaming WebSocket and REST fallback tested with real speech audio (`deepgram.service.spec.ts`). |
| **Smallest.ai Lightning V3.1 TTS** | ✅ **COMPLETE** | High-speed streaming synthesis with audio transcoding to 8kHz mu-law (`smallest.service.spec.ts`). |
| **Sarvam Bulbul Fallback TTS** | ✅ **COMPLETE** | Tested seamless automatic fallback if Smallest.ai encounters error or network timeout. |
| **Telnyx Call Control v2 Webhooks** | ✅ **COMPLETE** | `POST /voice/webhook` handles `call.initiated`, `call.answered`, `call.hangup`, `playback.ended` idempotently. |
| **Bidirectional Media Streaming** | ✅ **COMPLETE** | WebSocket gateway at `/voice/stream` with G.711 mu-law transcoding and dual `streamSid`/`stream_id` framing. |
| **Barge-in / Playback Interruption** | ✅ **COMPLETE** | `clearAudioBuffer` dispatches `event: 'clear'` to carrier socket immediately upon caller speech detection. |
| **Document-Only Grounded RAG** | ✅ **COMPLETE** | Strict tenant-isolated pgvector retrieval. Locked fallback returned on irrelevant queries (`verify_rag_grounding.ts`). |
| **Atomic Minute Deduction** | ✅ **COMPLETE** | Tested with PostgreSQL RPC `deduct_minutes` (`FOR UPDATE` locking). Idempotent hangup prevents double-deductions. |
| **Guardrails & Supervisor Timers** | ✅ **COMPLETE** | 10-minute max call duration, 3-minute remaining warning, 3-frame empty prompt, 5-frame empty hangup. |
| **Secret Redaction in Logs** | ✅ **COMPLETE** | Regex-based redaction of Bearer tokens, JWTs, OpenAI keys, and Telnyx API keys (`KEY...`). |
| **Railway & Render Deployment Readiness**| ✅ **COMPLETE** | Host bound to `0.0.0.0`, port dynamic from environment, `app.enableShutdownHooks()`, `GET /health` root check. |
| **Vercel Frontend Readiness** | ✅ **COMPLETE** | Next.js 16 build clean, `.vercel.app` allowed in backend CORS, environment variables documented. |
| **Live Phone Test on Real Carrier** | ⏳ **PENDING DEPLOYMENT** | Awaiting public hosted domain (Render/Railway) to connect Telnyx Call Control Webhook URL. |

---

## 2. Working Verification Baselines

* **Backend Unit & Integration Tests:**
  ```text
  Test Suites: 17 passed, 17 total
  Tests:       391 passed, 391 total
  Snapshots:   0 total
  Time:        ~4.6s
  ```
* **Linting:** `oxlint src/ test/` reports 0 errors.
* **TypeScript Compilation:** `npx tsc --noEmit` reports 0 errors.
* **Production Build:**
  * Backend: `nest build` outputs optimized bundle in `backend/dist/`.
  * Frontend: `next build` outputs compiled static and dynamic routes in `frontend/.next/`.

---

## 3. Known Blockers & Next Immediate Step

1. **Deploy Backend to Render or Railway:**
   * Enter Root Directory = `backend`.
   * Configure environment variables (copied to clipboard in Phase 4.7).
   * Verify `https://<YOUR_RENDER_URL>/health` returns `{"status":"ok"}`.
2. **Deploy Frontend to Vercel:**
   * Enter Root Directory = `frontend`.
   * Set `NEXT_PUBLIC_BACKEND_URL` to your Render/Railway domain.
3. **Configure Telnyx Call Control App:**
   * Set Webhook URL to `https://<BACKEND_HOST>/voice/webhook` (Method: POST, API v2).
   * Assign voice number to app and update Supabase `profiles.telnyx_number`.
4. **Execute Controlled Live Phone Call Acceptance Test (Phase 4.8).**
