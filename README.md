# Voice AI Agent Platform — Shivam Voice Agent

Production-grade, real-time, multi-tenant Voice AI Agent platform designed to automate inbound and outbound phone calls with sub-second latency, document-grounded knowledge retrieval (RAG), bidirectional carrier audio streaming, and atomic billing enforcement.

[![Backend CI / Unit Tests](https://img.shields.io/badge/Backend%20Tests-391%20Passed-brightgreen)](backend/)
[![Frontend](https://img.shields.io/badge/Frontend-Next.js%2016-black)](frontend/)
[![Architecture](https://img.shields.io/badge/Architecture-Clean%20NestJS%20%2B%20Supabase-blue)](docs/ARCHITECTURE.md)
[![Status](https://img.shields.io/badge/Phase%204.7-Deployment%20Ready-success)](PROJECT_STATUS.md)

---

## 🎯 High-Level Overview

Shivam Voice Agent transforms business customer interactions by placing an intelligent, low-latency, empathetic AI agent directly on real phone lines (PSTN/VoIP). The agent answers caller inquiries solely based on documents uploaded by the tenant (PDFs, text files, FAQs) and speaks naturally in English, Hindi, and Hinglish.

### Key Pillars
1. **100% Document-Grounded RAG:** The agent will **never hallucinate** or answer from general LLM knowledge. If client documents do not contain the answer, the agent gracefully delivers the locked fallback message and offers a team callback.
2. **Sub-Second Streaming Pipeline:** Full audio-to-audio turnaround in ~800–1200ms using Deepgram Nova-3 (Live WebSocket STT), token-by-token sentence chunking from OpenAI GPT-4o-mini, and Smallest.ai Lightning V3.1 (low-latency streaming TTS) with Sarvam Bulbul v3 fallback.
3. **Real-Time Bidirectional Telephony:** Direct G.711 mu-law (8kHz PCMU) streaming via Telnyx Call Control v2 WebSockets (`/voice/stream`) with barge-in interruption detection and buffer flushing.
4. **Multi-Tenant Isolation & Security:** Client documents, embeddings, transcripts, balances, and phone routing are strictly partitioned by `client_id` with Supabase PostgreSQL Row Level Security (RLS) and pgvector.
5. **Atomic Minute Accounting:** Real-time balance checks prior to answering, ceiling minute deduction on hangup via ACID PostgreSQL stored procedures (`deduct_minutes` RPC with `FOR UPDATE` locking), and automatic duration enforcement.

---

## 🏗️ Architecture & Technology Stack

| Layer | Technology | Primary Function |
| :--- | :--- | :--- |
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS v4, Lucide Icons | Client self-service portal, document uploads, call logs, analytics, and admin approvals. |
| **Backend** | NestJS 12, TypeScript, Express, `ws` (WebSockets) | Call orchestration, webhook handling, streaming media gateway, RAG pipeline, and billing supervisor. |
| **Database & Vector Store**| Supabase PostgreSQL, `pgvector`, Supabase Auth, Storage | Client profiles, calls history, document text embeddings (`text-embedding-3-small`, 1536 dim), payment requests. |
| **Telephony** | Telnyx Call Control API v2 & Media Streaming | Inbound/outbound carrier SIP trunking, 8kHz bidirectional audio over WSS (`/voice/stream`). |
| **STT (Speech-to-Text)** | Deepgram Nova-3 (Live WebSocket) | Real-time speech recognition, interim transcripts, speech-final endpointing. |
| **LLM & Reasoning** | OpenAI GPT-4o-mini | Document-grounded concise conversational synthesis (max 2 sentences per turn). |
| **TTS (Text-to-Speech)** | Smallest.ai Lightning V3.1 (Primary) + Sarvam Bulbul v3 (Fallback) | Real-time human-like speech synthesis with automatic fallback. |
| **Hosting Targets** | Render / Railway (Backend) & Vercel (Frontend) | Persistent container runtime with WebSocket support + Global edge CDN for Next.js. |

---

## 📂 Repository Directory Structure

```text
shivam-voice-agent/
├── AGENTS.md                  # Permanent instructions and guidelines for AI coding assistants
├── PROJECT_STATUS.md          # Real-time state of all working features, tests, and roadmap
├── DEVELOPMENT_LOG.md         # Chronological log of major architectural milestones
├── PORTABLE_LLM_HANDOVER.md   # Complete standalone snapshot for zero-context LLM session transfers
├── README.md                  # This file
├── backend/                   # NestJS API & Media Streaming Server
│   ├── src/
│   │   ├── config/            # Environment validation & domain configurations
│   │   ├── documents/         # PDF parsing, OCR extraction, chunking, embeddings
│   │   ├── deepgram/          # Deepgram Nova-3 REST and Live WebSocket client
│   │   ├── smallest/          # Smallest.ai Lightning V3.1 TTS client
│   │   ├── sarvam/            # Sarvam Saaras STT & Bulbul v3 fallback TTS
│   │   ├── voice/             # Telnyx Call Control, media stream gateway, RAG conversation
│   │   ├── payments/          # Client payment requests & admin manual approval flows
│   │   ├── supabase/          # Supabase service role client wrapper
│   │   └── main.ts            # Bootstrap, security headers (Helmet), CORS, 0.0.0.0 binding
│   ├── package.json           # Backend dependencies and scripts
│   └── .env.example           # Backend environment template
├── frontend/                  # Next.js 16 Web Dashboard
│   ├── src/
│   │   ├── app/               # Next.js App Router (Dashboard, Auth, Admin, Billing)
│   │   ├── components/        # Reusable UI components
│   │   └── lib/               # Supabase browser clients, API wrappers
│   ├── supabase/              # SQL schemas, RLS policies, and stored procedure migrations
│   ├── package.json           # Frontend dependencies
│   └── .env.example           # Frontend environment template
└── docs/                      # Comprehensive technical architecture & guides
    ├── ARCHITECTURE.md        # Detailed system design, data flow diagrams, and lifecycle
    ├── RECOVERY_GUIDE.md      # Clean clone setup and local restoration guide
    └── NEXT_SESSION_ACTION_PLAN.md # Next immediate tasks for Phase 4.8 / 5
```

---

## ⚡ Quick Start & Local Setup

### 1. Prerequisites
* **Node.js:** `v20.x` or `v22.x` recommended (compatible with `v26.x`)
* **Package Manager:** `npm` (v10+)
* **Supabase Account:** Active project with `pgvector` extension enabled
* **API Credentials:** OpenAI, Deepgram, Smallest.ai, Sarvam AI, and Telnyx

### 2. Database Initialization
In your Supabase project SQL Editor, execute the migration scripts located in `frontend/supabase/`:
1. `schema.sql` (Creates profiles, documents, embeddings, and vector similarity search RPC).
2. `phase3_payment_requests.sql` & `phase3_atomic_approval.sql` (Payment requests & atomic approval RPC).
3. `phase4_calls_schema.sql` (Calls log table and atomic `deduct_minutes` RPC with row locking).

### 3. Backend Setup
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your actual credentials
npm test             # Verify all 391 tests pass
npm run start:dev    # Starts backend on http://localhost:3001
```

### 4. Frontend Setup
```bash
cd ../frontend
npm install
cp .env.example .env.local
# Edit .env.local with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and NEXT_PUBLIC_BACKEND_URL
npm run dev          # Starts frontend on http://localhost:3000
```

---

## 🧪 Testing & Verification

The backend maintains strict test coverage over every critical component (RAG, STT, TTS, WebSockets, Idempotency, and Billing):
```bash
cd backend
npm test               # Run all 17 test suites (391 tests)
npm run lint           # Fast oxlint code quality verification
npx tsc --noEmit       # Strict TypeScript typechecking
npm run build          # Production NestJS build verification
```

---

## 🔒 Security & Privacy Practices
* **Zero Secret Leakage:** Production code and tests use regex-based redaction (`sanitizeErrorMessage`) for Bearer tokens, OpenAI keys (`sk_...`), JWTs, and Telnyx API keys (`KEY...`).
* **Multi-Tenant Protection:** Every vector query and document lookup is strictly isolated by `client_id`. Cross-tenant retrieval attempts immediately trigger alarms and are discarded.
* **Idempotent Webhooks:** All incoming Telnyx/Twilio webhook events are tracked in-memory with TTL to prevent replay attacks, duplicate calls, and double-billing.

---

## 📄 Documentation Index
* **[Architecture & Data Flow](docs/ARCHITECTURE.md)**
* **[Project Status & Working Features](PROJECT_STATUS.md)**
* **[Development History & Changelog](DEVELOPMENT_LOG.md)**
* **[Standalone Portable LLM Handover](PORTABLE_LLM_HANDOVER.md)**
* **[Next Session Action Plan](docs/NEXT_SESSION_ACTION_PLAN.md)**
* **[Local Recovery & Setup Guide](docs/RECOVERY_GUIDE.md)**
* **[Coding Guidelines for AI Agents](AGENTS.md)**