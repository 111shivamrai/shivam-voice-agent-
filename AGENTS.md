# AGENTS.md — Permanent Guidelines for AI Coding Agents

> **CRITICAL NOTICE FOR ALL AI AGENTS & LLMs:**  
> This file establishes permanent, binding engineering rules for the **Shivam Voice Agent** codebase.  
> Read this document completely **BEFORE** inspecting or editing any files. Do not deviate from these architectural patterns, security controls, or product constraints under any circumstances.

---

## 1. Prime Directives & Architectural Invariants

### 1.1 Locked Technology Stack
The technology stack for this platform is strictly locked:
* **Backend:** NestJS 12, TypeScript, Express, native WebSockets (`ws`).
* **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS v4, TypeScript.
* **Database & Auth:** Supabase PostgreSQL, `pgvector`, Supabase Auth, Storage.
* **Telephony:** Telnyx Call Control API v2 only. Do NOT introduce Twilio or other SIP trunking providers.
* **STT Engine:** Deepgram Nova-3 (Live WebSocket streaming for telephony; REST fallback).
* **Primary TTS:** Smallest.ai Lightning V3.1 (`/api/v1/lightning/get_speech`).
* **Fallback TTS:** Sarvam Bulbul v3 (`hi-IN` / `en-IN`).
* **LLM Engine:** OpenAI GPT-4o-mini with streaming sentence chunking.
* **Embeddings:** OpenAI `text-embedding-3-small` (1536 dimensions).
* **Production Deployment:** Render / Railway (Backend container with persistent WebSockets) + Vercel (Frontend Next.js edge).

### 1.2 Strict Document Grounding (Zero Hallucination Rule)
* The voice agent **MUST answer questions exclusively from the client's uploaded documents**.
* If the user asks a question not covered in the client's documents, or if retrieval similarity is insufficient, the agent **MUST NEVER** answer using general training knowledge.
* Instead, it **MUST IMMEDIATELY return the exact configured fallback sentence**:
  * **Hindi:** `इस बारे में मुझे अभी जानकारी नहीं है। मैं आपका नंबर ले सकता हूँ और हमारी टीम संपर्क करेगी।`
  * **English:** `I don't have that information right now. Can I take your number so our team can get back to you?`
* Do NOT rephrase, embellish, or translate this locked fallback sentence.

### 1.3 Conversational Output Constraints
* **Sentence Limit:** Maximum **two short sentences** per agent turn (`enforceMaxSentences(text, 2)`).
* **Language Support:** English, Hindi, and Hinglish. Detect caller language dynamically from caller input and reply in the matching tongue.

### 1.4 Call Lifecycle & Guardrails
* **Pre-call Balance Verification:** Verify `token_balance > 0` before answering any incoming call. If balance is 0, play an insufficient balance prompt and hang up.
* **Maximum Duration Limit:** Enforce a hard **10-minute (600s)** maximum call duration supervisor timer (`MAX_CALL_DURATION_SECONDS`).
* **3-Minute Remaining Warning:** At **7 minutes elapsed (420s)**, play the warning notice combined with the agent's response, strictly limited to <= 2 short sentences total.
* **Empty / Silent STT Handling:**
  * 3 consecutive empty/silent STT frames: prompt the user with "Are you still there?".
  * 5 consecutive empty/silent STT frames: play a goodbye message and hang up gracefully.
* **Barge-in / Interruption Protection:** When caller speech is detected during agent playback, immediately:
  1. Increment conversation `turn_sequence_id`.
  2. Send a `clear` event to the carrier WebSocket (`clearAudioBuffer`).
  3. Abort downstream synthesis and discard stale audio buffers.

### 1.5 Billing & Atomicity
* Minutes are billed as **ceiling minutes** (minimum 1 minute if connected).
* Minute deduction must **ONLY** occur through the atomic Supabase RPC `deduct_minutes` with `FOR UPDATE` row-level locking.
* Both `handleCallInitiated` and `handleCallHangup` must be **strictly idempotent** to prevent double-charging or duplicate call records from retried webhooks.

### 1.6 Secret Redaction & Logging Safety
* **NEVER** log raw audio buffers, JWTs, Supabase service keys, OpenAI keys (`sk_...`), Bearer tokens, or Telnyx API keys (`KEY...`).
* Use `VoiceController.sanitizeErrorMessage()` or regex replacement to sanitize any error message before logging or returning to clients.

---

## 2. Directory Structure & Key Files

| Directory / File | Description & Agent Rules |
| :--- | :--- |
| `backend/src/config/configuration.ts` | Central environment validation and config mapping. Supports Telnyx-first startup. |
| `backend/src/voice/calls.service.ts` | Core call orchestrator (answering, hangup, billing, RAG invocation, supervisor timers). |
| `backend/src/voice/voice.controller.ts` | Telnyx webhook router (`POST /voice/webhook`), audio streaming endpoints, and error sanitization. |
| `backend/src/voice/media-stream.gateway.ts` | WebSocket upgrade handler for `/voice/stream` and `/voice/media-stream`. |
| `backend/src/voice/media-stream.service.ts` | G.711 mu-law decoding/encoding, VAD, 20ms audio chunking, barge-in buffer flush. |
| `backend/src/voice/conversation.service.ts`| Document RAG, vector retrieval via pgvector, streaming GPT-4o-mini generation. |
| `backend/src/deepgram/deepgram.service.ts` | Deepgram Nova-3 Live WebSocket and REST integration. |
| `backend/src/smallest/smallest.service.ts` | Smallest.ai Lightning V3.1 TTS client with WAV/PCM decoding. |
| `backend/src/sarvam/sarvam.service.ts` | Sarvam Saaras STT and Bulbul v3 fallback TTS client. |
| `frontend/src/` | Next.js 16 client dashboard, billing, and document management. |
| `frontend/supabase/` | SQL schemas (`schema.sql`, `phase4_calls_schema.sql`, `phase3_...`). |

---

## 3. Workflow for Making Changes

When asked to implement new features or modify existing code:
1. **Inspect First:** Check Git status, recent commits, and existing tests before modifying code.
2. **Preserve Established Patterns:** Match existing NestJS dependency injection patterns and service boundaries.
3. **Write / Update Tests:** Every change to telephony, billing, RAG, or streaming must have corresponding unit tests in `.spec.ts`.
4. **Run Verification:**
   ```bash
   cd backend
   npm test               # All tests MUST pass (currently 391/391)
   npm run lint           # 0 errors
   npx tsc --noEmit       # 0 type errors
   npm run build          # Clean NestJS build
   ```
5. **Never Commit Secrets:** Ensure `.env` and `.env.local` are strictly gitignored.
