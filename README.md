# MKTR Platform: Enterprise AdTech & Operation OS

**The Operating System for decentralized Digital Out of Home (DOOH) advertising and fleet operations.**

MKTR is a comprehensive platform managing a fleet of Android tablets installed in Private Hire Vehicles (PHVs). It combines a high-performance **Tablet AdTech** engine, a **Self-Hosted APK Infrastructure**, and a **Resilient Backend** to deliver location-aware advertising and streamlining driver fleet operations.

---

## 🚀 Key Highlights

### 1. Decentralized AdTech Engine
- **Sequential Playback**: Custom ExoPlayer engine that runs independently on each device.
- **Time-Quantized Loop (TQL)**: Proprietary sync strategy using cellular NTP to align playback across multiple tablets without direct peer-to-peer connection.
- **Offline-First**: Tablets download manifests and media for fully autonomous operation during network dropouts.
- **Intent-Based Campaigns**: Distinguishes between "Brand Awareness" (Loop) and "Lead Generation" (Interactive) campaigns.

### 2. Enterprise Fleet Management
- **QR Provisioning**: Secure, one-step device onboarding and vehicle assignment.
- **Transactional Reassignment**: "Hot-swap" vehicles and drivers while preserving playback analytics.
- **Live Telemetry**: Real-time WebSocket/SSE status dashboards for connection health and sync status.

### 3. Custom APK Infrastructure
- **Self-Hosted OTA**: Custom `Android Updater` utility that bypasses Play Store limitations.
- **Silent Root Updates**: Uses `su` privileges for seamless background updates without user intervention.
- **Resilient Sideloading**: "Latest Only" distribution architecture with binary-direct checks.

### 4. Modern Marketing Ops
- **Visual Campaign Designer**: Drag-and-drop landing page builder with immediate live preview.
- **Integrated Lead Capture**: Unified flow from Interactive Ad -> QR Scan -> Landing Page -> Twilio OTP Verification -> CRM.
- **Agent Management**: Commission tracking, owed leads calculation, and hierarchical assignment.

---

## 🛠 Tech Stack

### Frontend & Dashboard
- **Framework**: React 18, Vite 6
- **UI System**: Tailwind CSS, Radix UI, "Modern SaaS" Design Language (Glassmorphism, Dense Tables)
- **State/Data**: React Query (TanStack Query), custom API Client with "Double /api" protection

### Backend Core
- **Runtime**: Node.js, Express
- **Database**: Postgres (Production) / SQLite (Dev) with Sequelize ORM
- **Resilience**:
  - **SafeSync Boot**: Defensive startup sequence that prevents crash loops.
  - **Shell Mode**: Remote diagnostic mode for inspecting crashes via HTTP.
  - **Multi-Tenancy**: Strict `tenant_id` isolation logic.

### Android / Hardware
- **App**: Native Android (Kotlin), Jetpack Compose
- **Media**: ExoPlayer, Custom Caching Layer
- **Updates**: `DownloadManager`, Root-based `pm install`

### Integrations
- **Auth**: JWT + Google OAuth
- **Messaging**: Twilio Verify (SMS), Meta Graph API (WhatsApp)
- **Storage**: Local Disk (Dev) / Cloud Storage (Prod)

---

## 📂 Monorepo Structure

```text
/
├── backend/                 # Node.js/Express API & Orchestration
│   ├── src/models/         # Sequelize Definitions (User, Device, Campaign)
│   ├── src/routes/         # API Endpoints
│   └── uploads/            # Static Asset Storage
├── src/                     # React Frontend Admin Dashboard
│   ├── components/         # Radix UI + Custom Design System
│   ├── pages/              # Admin & Public Landing Pages
│   └── api/                # Robust API Client
├── tablet-app/              # Native Android Player Codebase
│   ├── app/src/main/       # Kotlin Source
│   └── architecture/       # TQL & Sync Logic
└── infra/                   # Deployment & Container Configs
```

---

## ⚡️ Quick Start

### Prerequisites
- Node.js 18+ & npm
- Postgres (or use default SQLite for dev)
- Android Studio (for tablet app development)

### 1. Installation
```bash
git clone https://github.com/slzwei/mktr-platform.git
cd mktr-platform

# Install Frontend
npm install

# Install Backend
cd backend && npm install && cd ..
```

### 2. Configuration
Copy `.env.example` to `.env` in both root and `backend/` directories.

**Backend `.env` Critical Keys:**
```bash
PORT=3001
JWT_SECRET=secure_random_string
# Twilio (Required for OTP)
TWILIO_ACCOUNT_SID=...
TWILIO_VERIFY_SERVICE_SID=...
```

### 3. Run Development Environment
```bash
# Terminal 1: Backend
cd backend
npm run dev      # Standard boot
# OR
npm run safe     # SafeSync boot (resilient mode)

# Terminal 2: Frontend
npm run dev
```

Dashboard: `http://localhost:5173`
API Health: `http://localhost:3001/health`

---

## 🧩 Architecture Constraints & Patterns

### Verification & Safety
- **"HTML 404" vs "JSON 404"**: The client distinguishes between app crashes (HTML response) and missing data (JSON response) to prevent confusing error states.
- **Double /api Protection**: The client automatically strips accidental double prefixes to ensure reliable routing.

### Campaign Management
- **Brand vs Lead Gen**: Brand campaigns are video-heavy and loop-based. Lead Gen campaigns are static/interactive and interrupt-based.
- **Design Editor**: What you see is **exactly** what the user sees (Triple-Surface Sync: Admin/Preview/Public).

---

## 🤝 Contribution

Please verify all changes.
- **Frontend Changes**: Check against the "Modern SaaS" visual standards.
- **Backend Changes**: Verify `tenant_id` isolation and run the FMEA checks for migration safety.

---

*(c) 2024-2026 MKTR Platform. Proprietary & Confidential.*
