# PORTABLE_LLM_HANDOVER.md — Zero-Context AI Session Resumption Guide

> **HOW TO USE THIS DOCUMENT:**  
> When starting a completely new Anti-Gravity session or transferring this project to any new LLM, **copy and paste the prompt in Section 1 into the chat**.  
> This provides the new agent with 100% of the architecture, decisions, constraints, current state, and exact next steps without needing prior conversation memory.

---

## 1. Copy-and-Paste Resumption Prompt for New AI Sessions

```text
You are taking over the existing "Shivam Voice Agent" repository from a previous development session. The original chat history is not available, so treat this repository and its documentation as the sole source of truth.

REPOSITORY URL: https://github.com/111shivamrai/shivam-voice-agent-.git
BRANCH: main

INSPECTION PROTOCOL:
1. First, inspect the repository files: read `AGENTS.md`, `PROJECT_STATUS.md`, `DEVELOPMENT_LOG.md`, `README.md`, and `docs/ARCHITECTURE.md`.
2. Review the codebase:
   - Backend: NestJS 12 in `backend/` (Telephony, WebSockets, RAG, Billing)
   - Frontend: Next.js 16 in `frontend/` (Dashboard, Documents, Auth)
   - Database: Supabase PostgreSQL with pgvector in `frontend/supabase/`
3. Verify the current build and tests:
   - `cd backend && npm test` (all 391 tests must pass)
   - `npm run lint` and `npx tsc --noEmit`

LOCKED PRODUCT RULES & INVARIANTS:
- Telephony: Telnyx Call Control v2 only (NO Twilio).
- STT: Deepgram Nova-3 (Live WebSocket on `/voice/stream`).
- TTS: Smallest.ai Lightning V3.1 (Primary) + Sarvam Bulbul v3 (Fallback).
- LLM: OpenAI GPT-4o-mini (Streaming sentence extraction, max 2 sentences/turn).
- Zero Hallucination: The agent MUST answer exclusively from the client's uploaded documents. If irrelevant, return the exact locked fallback:
  - Hindi: "इस बारे में मुझे अभी जानकारी नहीं है। मैं आपका नंबर ले सकता हूँ और हमारी टीम संपर्क करेगी।"
  - English: "I don't have that information right now. Can I take your number so our team can get back to you?"
- Call Limits: 10-minute maximum call duration, 3-minute remaining warning, 3-frame empty prompt, 5-frame empty hangup.
- Billing: Atomic ceiling minute deduction via Supabase RPC `deduct_minutes` on hangup with `FOR UPDATE` locking. Idempotent webhook handling.
- Barge-in: Caller speech immediately cancels old audio and flushes carrier buffer (`clearAudioBuffer`).

CURRENT STATE & IMMEDIATE GOAL:
- The backend is ready to be hosted on Render or Railway with Root Directory = `backend`.
- The frontend is ready to be hosted on Vercel with Root Directory = `frontend`.
- Next task: Verify public deployment URLs, wire Telnyx Call Control Webhook (`https://<BACKEND>/voice/webhook`), and execute the controlled live phone call test (Phase 4.8).

Explain your understanding of the architecture and current progress, and ask me for the current deployment URLs or next action!
```

---

## 2. Executive Summary of What Has Been Built

1. **Dual Ingestion Webhook Gateway (`backend/src/voice/voice.controller.ts`):**
   * Handles Telnyx v2 Call Control events (`call.initiated`, `call.answered`, `call.hangup`, `call.playback.ended`).
   * Verifies tenant mapping in Supabase (`profiles.telnyx_number = calleeNumber`).
   * Validates client token balance > 0 before issuing `answer` action.
   * Fully idempotent: duplicate events are safely ignored without re-answering or double-billing.

2. **Bidirectional Media Streaming Gateway (`backend/src/voice/media-stream.gateway.ts` & `media-stream.service.ts`):**
   * Upgrades incoming HTTP connections at `/voice/stream`.
   * Ingests 20ms G.711 mu-law 8kHz audio frames, converts to Linear PCM16 for Energy VAD, and streams raw audio to Deepgram Nova-3.
   * Dispatches synthesized audio from Smallest.ai / Sarvam as 20ms mu-law frames with dual provider formatting (`streamSid` and `stream_id`).
   * Detects barge-in speech and immediately sends `event: 'clear'` to carrier socket to abort stale playback.

3. **Document-Grounded RAG Engine (`backend/src/voice/conversation.service.ts`):**
   * Chunks tenant documents (PDFs parsed via OCR/pdf-parse) and generates 1536-dimensional embeddings (`text-embedding-3-small`).
   * Performs cosine similarity search via Supabase pgvector RPC `match_documents`.
   * Enforces strict multi-tenant boundary checks (cross-tenant chunks trigger immediate drops).
   * Generates streaming answers via GPT-4o-mini conditioned strictly on retrieved context, chunked into short sentence buffers.
   * Returns exact locked fallback sentence whenever context is insufficient or irrelevant.

4. **Atomic Billing & Supervisor Timers (`backend/src/voice/calls.service.ts`):**
   * Hard 10-minute timeout supervisor timer (`MAX_CALL_DURATION_SECONDS = 600`).
   * 3-minute remaining warning notice combined with speech response at 7 minutes elapsed (`WARNING_TRIGGER_ELAPSED_SECONDS = 420`).
   * Empty STT protection: 3 frames prompt caller; 5 frames gracefully terminate call.
   * Calculates call duration and deducts ceiling minutes atomically via `deduct_minutes` stored procedure on hangup.
   * Idempotent hangup ensures active call state is purged prior to deduction, eliminating race conditions.

5. **Client & Admin Web Dashboard (`frontend/src/`):**
   * Built with Next.js 16 (App Router), Tailwind CSS v4, and Supabase SSR Auth.
   * Features document upload (with size/type validation), document search testing, call logs table with audio transcripts, and PhonePe QR payment request workflow with admin approval.

---

## 3. Environment Variables Reference

### Backend (`backend/.env`)
```env
PORT=3001
BACKEND_URL=https://shivam-voice-backend.onrender.com   # Public domain for webhooks/streaming
FRONTEND_URL=https://shivam-voice-agent.vercel.app      # Vercel domain for CORS
ADMIN_PASSWORD=<secure_password>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=eyJ...                             # Service role secret key
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=<deepgram_token>
SMALLEST_API_KEY=<smallest_token>
SARVAM_API_KEY=<sarvam_token>
TELNYX_API_KEY=KEY01A0B074EEE7CC832A798D1FAF46BFA0_your_telnyx_api_key_here
TELNYX_PHONE_NUMBER=+1XXXXXXXXXX                        # Assigned Telnyx voice number
TELNYX_CONNECTION_ID=<call_control_app_id>
```

### Frontend (`frontend/.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...                   # Browser-safe public anon key
NEXT_PUBLIC_BACKEND_URL=https://shivam-voice-backend.onrender.com
NEXT_PUBLIC_API_URL=https://shivam-voice-backend.onrender.com
```

---

## 4. Verification Checkpoints

When resuming this repository in a fresh environment, run:
```bash
# 1. Backend tests and compilation
cd backend
npm install
npm test             # Expect: 17 passed, 391 passed
npm run lint         # Expect: 0 errors
npx tsc --noEmit     # Expect: 0 errors
npm run build        # Expect: clean nest build into dist/

# 2. Frontend compilation
cd ../frontend
npm install
npm run build        # Expect: clean Next.js 16 build into .next/
```
