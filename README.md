# Remix TBX Finance Assistant

> **Deterministic Financial Query Compiler & Natural-Language Analytics Engine**  
> Powered by in-memory **DuckDB OLAP**, **Google Gemini AI** semantic intent compilation, and **Multi-Domain Automatic Schema Understanding**.

---

## 📖 Table of Contents

- [Overview](#overview)
- [Core Architecture](#core-architecture)
- [Key Features](#key-features)
- [Prerequisites](#prerequisites)
- [Environment Variables (.env)](#environment-variables-env)
- [Installation & Quick Start](#installation--quick-start)
- [Available Scripts](#available-scripts)
- [Data Ingestion & Multi-File Support](#data-ingestion--multi-file-support)
- [DuckDB & Financial Ontology](#duckdb--financial-ontology)
- [API Endpoints Reference](#api-endpoints-reference)
- [Project Structure](#project-structure)
- [Troubleshooting & FAQ](#troubleshooting--faq)

---

## Overview

Traditional LLMs hallucinate when performing numerical calculations on enterprise financial data. **Remix TBX Finance Assistant** solves this through a **two-phase deterministic pipeline**:

1. **Semantic Compilation (Gemini)**: Translates natural-language questions (e.g., *"What is our total spend on AWS in Q2?"*) into structured financial intents and filter criteria.
2. **Deterministic Computation (DuckDB)**: Executes parameterized, vectorized SQL queries directly against an in-memory DuckDB OLAP database.
3. **Audit Trail & Evidence**: Every response is mathematically bound to a specific dataset version, execution formula, and exportable supporting row list.

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React 19 Bento UI                        │
│   (Query Bar, Metric Cards, Evidence Drawer, SQL Console)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON / REST
┌──────────────────────────────▼──────────────────────────────┐
│                    Express Full-Stack Server                │
│                         (server.ts)                         │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
┌──────────────▼─────────────┐ ┌──────────────▼───────────────┐
│     Google Gemini API      │ │     In-Memory DuckDB OLAP    │
│  Intent Extraction & Logic │ │  Zero-Hallucination SQL Exec │
│      (@google/genai)       │ │  active_dataset / snapshots  │
└────────────────────────────┘ └──────────────────────────────┘
               │                              │
┌──────────────▼──────────────────────────────▼───────────────┐
│     Multi-Domain Schema Intelligence Engine                 │
│  - Vendor Payouts & Disbursements                           │
│  - Bank & Gateway Reconciliation                            │
│  - General Ledger & Operational Transactions                │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Features

- **In-Memory DuckDB OLAP Engine**: Sub-millisecond aggregation and analytics without round-trip database latency.
- **Multi-File Simultaneous Upload**: Drag and drop or browse multiple CSV, XLS, or XLSX spreadsheets at once.
- **Automatic Schema & Domain Understanding**:
  - Automatically classifies files into **Vendor Payouts**, **Reconciliation**, or **Transactions**.
  - Maps polymorphic column headers (`paid_amount`, `supplier_name`, `match_date`, `recon_status`) into canonical ontology fields.
- **Immutable Dataset Versioning**: Supports `Create New`, `Append Records`, or `Replace Dataset` with automatic snapshot history (`active_dataset_v1`, `v2`, etc.).
- **Interactive DuckDB SQL Console**: Execute raw SQL queries directly against the in-memory engine from the browser.
- **100% Mathematical Audit Evidence**: Click **Audit Evidence** on any calculation to inspect the exact dataset version, row count, calculation formula, and export the proof to CSV or Excel.

---

## Prerequisites

Before running the project locally, ensure you have:

- **Node.js**: `v20.x` or higher (Node 22 recommended)
- **npm**: `v9.x` or higher
- **Gemini API Key**: Obtainable from [Google AI Studio](https://aistudio.google.com/)

---

## Environment Variables (.env)

Create a `.env` file in the root directory by copying the example configuration:

```bash
cp .env.example .env
```

### Required Configuration

| Variable | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `GEMINI_API_KEY` | **Yes** | Google Gemini API key for natural language intent parsing. | `AIzaSy...` |
| `PORT` | No | Server port (default is `3000`). | `3000` |
| `NODE_ENV` | No | Node environment (`development` or `production`). | `development` |

> ⚠️ **Security Notice**: Never commit your `.env` file containing actual secrets to version control. The `.gitignore` file already excludes `.env`.

---

## Installation & Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd remix-tbx-finance-assistant
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

```bash
# Create .env from template
cp .env.example .env

# Edit .env and insert your Gemini API key
nano .env   # or code .env
```

Ensure your `.env` has:
```env
GEMINI_API_KEY="your_actual_gemini_api_key_here"
```

### 4. Start the Development Server

```bash
npm run dev
```

The application will start on:
👉 **`http://localhost:3000`**

- The Express backend boots and initializes DuckDB in-memory.
- Vite middleware serves the React client with hot-reloading.
- Seed data (`bvp_finance_demo` v1) is registered and ready for queries immediately.

---

## Available Scripts

In the project root, you can run:

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the full-stack server in development mode using `tsx server.ts` with Vite middleware. |
| `npm run build` | Builds the client application using Vite and bundles `server.ts` into `dist/server.cjs` via esbuild. |
| `npm run start` | Runs the compiled production server (`node dist/server.cjs`). |
| `npm run lint` | Runs the TypeScript compiler check (`tsc --noEmit`) to validate type safety. |
| `npm run clean` | Removes build artifacts (`dist/` folder). |

---

## Production Build & Deployment

To build and run the production-optimized application:

```bash
# 1. Compile client assets and server bundle
npm run build

# 2. Start the production server
npm run start
```

---

## Data Ingestion & Multi-File Support

You can upload your own financial datasets using the **Upload Dataset** button in the header.

### Supported File Types
- `.csv` (Comma-Separated Values, UTF-8)
- `.xlsx` (Microsoft Excel OpenXML)
- `.xls` (Legacy Microsoft Excel)

### Ingestion Modes
1. **Create New Dataset**: Creates a new isolated dataset entity and makes it the active DuckDB table.
2. **Append Records**: Adds new rows into the active dataset and increments the version counter (`v1` $\rightarrow$ `v2`).
3. **Replace Dataset**: Replaces all existing records with the new upload under an updated version tag.

### Multi-File Processing Flow
- Drag and drop 1 or 20 files simultaneously.
- The background inspector (`/dataset/detect-schema`) profiles headers and sample rows in parallel.
- Shows domain classification badges (**Vendor Payouts**, **Reconciliation**, **Transactions**) and detected column mappings before confirmation.
- DuckDB registers all rows with `source_file` and `domain` metadata columns.

---

## DuckDB & Financial Ontology

All queries operate on canonical columns while preserving original properties:

| Canonical Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `VARCHAR` | Unique record identifier (e.g., `row-1` or `file_row_12`). |
| `vendor` | `VARCHAR` | Payee, supplier, merchant, or beneficiary entity name. |
| `amount` | `DOUBLE` | Cleaned numerical transaction value. |
| `transaction_date` | `VARCHAR` | Normalized ISO date (`YYYY-MM-DD`). |
| `category` | `VARCHAR` | Expense category, department, or cost center. |
| `status` | `VARCHAR` | Reconciliation state (`Reconciled`, `Unreconciled`, `Pending`, `Settled`). |
| `domain` | `VARCHAR` | Inferred domain (`vendor_payouts`, `reconciliation`, `transactions`). |
| `source_file` | `VARCHAR` | Originating spreadsheet or CSV file name. |

---

## API Endpoints Reference

### Core Endpoints

- **`GET /health`**  
  Returns system status, active dataset metadata, record count, DuckDB status, and Gemini connectivity.

- **`POST /chat`** (or `/api/chat`)  
  Submits a natural-language query.  
  *Request body*: `{"message": "What is our highest vendor payout?", "conversation_id": "optional_id"}`  
  *Response*: JSON response with answer, exact calculation metadata, DuckDB breakdown, and `query_id`.

- **`GET /evidence/:query_id`** (or `/api/evidence/:query_id`)  
  Retrieves complete mathematical audit evidence, applied filters, formula, and row snapshots.

- **`GET /export/csv?query_id=:id`**  
  Downloads supporting rows for a specific query calculation as a CSV file.

- **`GET /export/excel?query_id=:id`**  
  Downloads supporting rows as a styled `.xlsx` workbook.

### DuckDB & Dataset Endpoints

- **`POST /api/duckdb/query`**  
  Executes a raw SQL statement against active DuckDB tables.  
  *Request body*: `{"sql": "SELECT vendor, SUM(amount) AS total FROM active_dataset GROUP BY vendor ORDER BY total DESC LIMIT 5"}`

- **`POST /dataset/detect-schema`**  
  Accepts multiple files in `FormData` and returns auto-detected domain classifications, confidence ratings, and mapped headers without saving.

- **`POST /dataset/upload`**  
  Ingests multiple files into a new dataset. Accepts `files` in `FormData`, `dataset_id`, and `name`.

- **`POST /dataset/:id/add`**  
  Appends multiple files to an existing dataset.

- **`POST /dataset/:id/replace`**  
  Replaces an existing dataset with rows from the uploaded files.

---

## Project Structure

```
.
├── .env.example                     # Environment variables template
├── package.json                     # Project manifest and dependencies
├── server.ts                        # Express server entry point & API routes
├── server/
│   ├── dataset.ts                   # Dataset version store & BVP demo data
│   ├── duckdb.ts                    # In-memory DuckDB OLAP database manager
│   ├── export.ts                    # CSV & Excel export formatters
│   ├── gemini.ts                    # Gemini intent parser (@google/genai)
│   ├── schema_detector.ts           # Multi-file schema & domain intelligence
│   └── types.ts                     # Backend data types and interfaces
├── src/
│   ├── main.tsx                     # React client bootstrap
│   ├── App.tsx                      # Bento Grid application container
│   ├── index.css                    # Tailwind CSS entry point
│   ├── types.ts                     # Frontend interfaces
│   └── components/
│       ├── Header.tsx               # Navigation, dataset indicator, actions
│       ├── ChatInput.tsx            # Natural language query input & prompts
│       ├── ChatMessageItem.tsx      # High-contrast metric message cards
│       ├── AuditEvidenceModal.tsx   # Mathematical evidence drawer
│       ├── DatasetUploadModal.tsx   # Multi-file upload & schema modal
│       └── DuckDBSqlModal.tsx       # In-browser DuckDB SQL console
├── vite.config.ts                   # Vite configuration
├── metadata.json                    # Application metadata
└── tsconfig.json                    # TypeScript compiler options
```

---

## Troubleshooting & FAQ

### 1. `Gemini API Key detected: NO` in server console
- Verify that your `.env` file exists at the root of the project.
- Check that the key is named `GEMINI_API_KEY` (without `VITE_` prefix).
- Restart the server after editing `.env` (`npm run dev`).

### 2. DuckDB native binding errors on Windows/Linux
- Ensure you have standard C++ build tools installed if building from source, or use standard Node.js LTS (20.x or 22.x) where pre-compiled DuckDB binaries are installed automatically by npm.

### 3. "No valid records found" on CSV upload
- Ensure your CSV is encoded in standard UTF-8.
- Verify that the first row contains column headers (e.g. `Vendor`, `Amount`, `Date`).

---

## License

MIT License. Designed for enterprise-grade financial analytics and zero-hallucination computational audits.
