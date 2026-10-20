# Next Session Action Plan — Phase 4.8 & Phase 5

This document is prepared specifically for the **next development session** following machine maintenance. It details the exact sequence of steps to transition from local readiness to verified live-carrier telephony.

---

## 1. Immediate Priority: Phase 4.8 — Controlled Live Phone Acceptance Test

The codebase is 100% prepared and hardened for production deployment. The next immediate goal is executing a real inbound and outbound telephone call.

### Prerequisites to Confirm
- [ ] Backend is deployed and running on Render or Railway.
- [ ] Backend healthcheck returns HTTP 200:
  ```bash
  curl -s https://<YOUR_BACKEND_DOMAIN>/health
  # Response: {"status":"ok","timestamp":"..."}
  ```
- [ ] Frontend is deployed on Vercel and loads without console errors.
- [ ] In Telnyx Mission Control Portal:
  * Voice Number acquired.
  * Call Control Application created with Webhook URL = `https://<YOUR_BACKEND_DOMAIN>/voice/webhook` (Method: `POST`, API version: `v2`).
  * Voice number assigned to Call Control App.
- [ ] In Supabase `profiles` table:
  * Tenant record exists with `token_balance >= 10`.
  * `telnyx_number` matches the acquired Telnyx voice number in E.164 format (e.g. `+1...`).
  * At least one document (FAQ / handbook) uploaded and embedded for this tenant.

---

## 2. Inbound Phone Test Procedure

1. **Place Call:** Using a mobile phone, dial the assigned Telnyx phone number.
2. **Observe Server Logs:**
   * `handleTelnyxWebhook` receives `call.initiated`.
   * Tenant resolved from `profiles` via `telnyx_number`.
   * `answerCall` action executed.
   * `startMediaStreaming` action sends WebSocket stream URL (`wss://.../voice/stream`).
   * Carrier connects WebSocket to `/voice/stream`.
   * Smallest.ai Lightning V3.1 synthesizes initial greeting and dispatches 8kHz mu-law audio frames.
3. **Voice Interaction Checks:**
   * **Supported Inquiry:** Ask a question answered in the uploaded document (e.g. *"What are your business hours?"*). Verify agent answers within 1.2 seconds, strictly based on the document, in <= 2 short sentences.
   * **Unsupported Inquiry:** Ask an unrelated question (e.g. *"Who won the 2022 World Cup?"*). Verify agent delivers the locked fallback sentence without hallucinating.
   * **Barge-in Interruption:** Begin speaking while the agent is answering. Verify the agent stops talking immediately.
4. **Hangup & Billing Checks:**
   * Hang up the phone.
   * Verify `handleCallHangup` clears the active call session.
   * Verify Supabase `profiles.token_balance` deducted the correct ceiling minutes.
   * Verify `calls` table logged duration, minutes used, and complete transcript.

---

## 3. Subsequent Phase: Phase 5 — Campaigns & Multi-Agent Outbound Calling

Once Phase 4.8 passes live acceptance, proceed with Phase 5 development:
1. **Outbound Campaign Orchestration:**
   * Campaign creation dashboard: upload CSV of lead phone numbers.
   * Queue-based auto-dialing worker with configurable concurrent call limits.
   * Automated answering-machine detection (AMD).
2. **Dynamic Lead Personalization:**
   * Injecting lead-specific CRM variables into the agent's greeting.
3. **Call Analytics & Sentiment Dashboard:**
   * Post-call LLM summarization of caller intent, sentiment score, and action items.
