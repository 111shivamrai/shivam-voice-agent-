# DEVELOPMENT_LOG.md — Chronological Architecture Log

---

### [2026-10-12] — Phase 4.7: Telnyx-First Startup & Production Deployment Preparation
* **Commit:** `194854f` (`fix(deploy): enable telnyx-first startup validation and flexible vercel cors`)
* **Problem:** In `configuration.ts`, startup validation unconditionally required Twilio environment variables (`TWILIO_ACCOUNT_SID`, etc.), failing startup in production containers configured strictly for Telnyx telephony. Also, CORS did not automatically permit dynamically generated Vercel preview URLs (`*.vercel.app`).
* **Implementation:**
  1. Updated `configuration.ts` to require either `TELNYX_API_KEY` (primary provider) or `TWILIO_ACCOUNT_SID`, supplying safe defaults for Twilio fields when running in Telnyx-first mode.
  2. Enhanced `main.ts` CORS logic to normalize trailing slashes and permit all `.vercel.app` origins alongside configured frontend URLs.
* **Verification:** Full test suite passed (391/391), TypeScript clean, production builds verified for both backend and frontend.

---

### [2026-10-12] — Phase 4.6: Live-Call Readiness, Webhook Idempotency & Barge-In
* **Commit:** `128c937` (`fix(phase4.6): harden deployment readiness, webhook idempotency, and media-stream barge-in`)
* **Problem:** Potential risk of double-billing or duplicated call records on retried carrier webhooks (`call.initiated` / `call.hangup`), missing carrier buffer flush (`clear` event) on user speech barge-in, and missing container-level lifecycle handling (`SIGTERM`).
* **Implementation:**
  1. Added `app.enableShutdownHooks()` and explicit `0.0.0.0` host binding in `main.ts`.
  2. Implemented root `GET /health` endpoint returning `{ status: 'ok', timestamp }`.
  3. Added session idempotency in `CallsService.handleCallInitiated` to reject duplicate initiation events for already active calls.
  4. Hardened `CallsService.handleCallHangup` to immediately remove active call state before atomic minute deduction, preventing concurrent double-billing.
  5. Implemented `MediaStreamService.clearAudioBuffer(callControlId)` to send `event: 'clear'` over WebSocket immediately when caller speech starts.
  6. Added `CallsService.stopPlayback(callControlId)` utilizing Telnyx `playback_stop` REST action.
  7. Enhanced `sanitizeErrorMessage` in `VoiceController` to redact Telnyx `KEY...` token patterns.
* **Verification:** Added 6 new unit tests in `calls.service.spec.ts`, `media-stream.service.spec.ts`, and `voice.controller.spec.ts`. All 391 tests passing.

---

### [2026-09-17] — Phase 4.5: Streaming Voice Pipeline (Deepgram + Smallest + Telnyx)
* **Commit:** `6e45c14` (`feat(phase4.5): implement streaming voice pipeline`)
* **Implementation:**
  1. Connected Deepgram Nova-3 Live WebSocket streaming directly to the inbound media stream.
  2. Implemented token-by-token sentence extraction in `ConversationService.generateResponseStream`.
  3. Wired Smallest.ai Lightning V3.1 streaming TTS (`/api/v1/lightning/get_speech`) with automated fallback to Sarvam Bulbul.
  4. Streamed synthesized 8kHz G.711 mu-law audio packets in 20ms frames back to carrier WebSocket.
* **Verification:** Verified end-to-end audio streaming, RAG grounding, and barge-in audio flushing with real audio fixtures.

---

### [2026-09-17] — Phase 4.5: Smallest.ai Lightning V3.1 TTS Integration & Hardening
* **Commits:** `6fda66e`, `48c30b8`
* **Implementation:** Updated Smallest.ai API integration to the official contract (`POST https://waves-api.smallest.ai/api/v1/lightning/get_speech` with `model: lightning`, `voice_id: emily`, `sample_rate: 24000`), added timeout handling, response buffer decoding, and clean fallback to Sarvam.
* **Verification:** Verified real API connectivity and error resilience across unit tests.

---

### [2026-09-17] — Phase 4.5: Deepgram Nova-3 STT Integration
* **Commit:** `5601112` (`fix(phase4.5): harden deepgram stt integration`)
* **Implementation:** Implemented Deepgram Nova-3 client with REST and WebSocket streaming capabilities, configured endpointing, interim results, and dynamic language detection.
