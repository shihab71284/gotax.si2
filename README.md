# GoTax.SI

**Understand your IRS notice in minutes, in your own language.**

GoTax.SI is an AI-assisted US tax-help service. It decodes IRS notices, explains them in plain
language **in English and the visitor's own language side by side**, and prepares draft responses
and tax-return packages that are reviewed and signed by a licensed CPA/EA partner.

> GoTax.SI provides AI-assisted explanations and document preparation support. It is not a law firm
> or a government agency and is not affiliated with the IRS. Information is general and not legal or
> tax advice. Prepared returns are reviewed and signed by a licensed US preparer.

---

## 1. Quick start (front end only — no build step, no dependencies)

The delivered site is **static and zero-dependency**: plain HTML/CSS/JS with a localStorage-backed
mock API. There is nothing to install.

```bash
cd gotax
python3 -m http.server 8000 --bind 0.0.0.0 --directory .
# open http://localhost:8000/
```

Any static server works (`nginx`, `caddy`, Netlify, Cloudflare Pages, S3 + CloudFront).
`file://` also mostly works, except for `fetch()` of `data/*.json`, which browsers block on the
file protocol — use a server.

### Optional: rebuild the pages

Pages are generated from templates by a stdlib-only Python script (Python 3.9+):

```bash
python3 build.py            # writes 24 .html pages + data/samples.js + sitemap.xml + robots.txt
python3 build.py --check    # build + report, write nothing
```

Edit **`build/pages/**`** and **`build/partials/**`**, never the generated `.html` files at the repo
root — those are overwritten on every build.

### Demo walkthrough

| Page | Try this |
| --- | --- |
| `/decoder.html` | Tick the consent box → click a sample notice (e.g. **CP2000**) → confirm the redaction → read the 7-section bilingual explanation. **CP504** and **LTR3219C** trigger the high-risk "talk to a licensed professional" banner. |
| `/decoder.html?lang=hi` | Same flow with the Hindi pane beside the authoritative English pane. Try `?lang=ar` for RTL. |
| `/returns.html` | Six-step resumable intake; autosaves to `localStorage`. |
| `/pricing.html` | Fixed prices in USD + BTC at the live demo rate. |
| `/checkout.html?service=notice-explain` | Create an invoice → QR code, 15-minute timer, address → use the **Simulate payment (demo)** buttons for `detected` → `confirmed`, or `underpaid` / `expired` to see exception handling. |
| `/receipts.html`, `/account.html`, `/admin.html` | Receipt list, customer dashboard, and the placeholder admin console (sign in with the **admin** or **reviewer** demo buttons). |

---

## 2. Repository layout

```
index.html … admin.html        24 generated pages (root = site root)
legal/                         privacy, terms, disclaimer, refunds, retention (+ index)
notices/                       SEO pages per notice type (CP2000, CP14, CP11, CP501, CP504,
                               LTR3219C, LTR5071C, LTR569C) + library index
assets/css/styles.css          design system (tokens → layout → components → addendum)
assets/css/print.css           print / Save-as-PDF stylesheet (bilingual panes, receipts, legal)
assets/js/app.js               App + API core: config, store, auth/RBAC, invoices, audit, toasts,
                               modals, 32 inline SVG icons, language switcher, cookie bar
assets/js/i18n.js              I18N runtime: t(), apply(), locale detection, money/btc/date
assets/js/i18n/*.js            12 dictionaries (689 keys each)
assets/js/extract.js           Decode: OCR ingest → redaction → field extraction → bilingual
                               explanation → draft letter → PDF export
assets/js/qrcode.js            QR encoder (byte mode, EC level M, v1–10) — no dependency
assets/js/pdf.js               Minimal PDF writer (A4, Helvetica/Courier, xref-correct)
assets/js/{decoder,returns,checkout,receipt,receipts,account,admin,home,pricing,contact,
           notices,notice-page}.js   page controllers
data/notices.json              knowledge base: 8 notice types × 7 sections, per-locale content,
                               risk tags, typical deadlines, related notices
data/services.json             fixed prices, entitlements, FAQ ids, crypto/card configuration
data/samples.js                generated from samples/*.txt — fictional OCR text for the demos
samples/*.txt                  11 fictional documents (8 notices + W-2 + 1099-NEC + 1099-K)
build/                         page templates, partials, i18n content batches
tools/merge_keys.py            merges build/content/keys_*.py into all 12 dictionaries
tests/                         engine, flow, smoke and i18n audits (see §6)
backend/openapi.yaml           API contract (30 paths) — the mock API maps 1:1 onto it
backend/.env.example           every environment variable the real backend needs
```

---

## 3. How the bilingual engine works

1. **Input** — JPG/PNG/PDF up to 15 MB, or pasted text, or a built-in sample.
2. **OCR** — `Decode.ingest()` (mock in the static build; cloud OCR in production) reports page
   count, OCR confidence and notes such as "skew corrected".
3. **Redaction** — `Decode.redact()` masks SSN/ITIN, bank account and routing numbers, EINs and
   long account strings. The findings list shows **masked values only** (`XXX-XX-6789`); the raw
   number is never rendered, stored or logged. IRS phone numbers are preserved so the visitor can
   call. The user must confirm before anything is analysed.
4. **Extraction** — `Decode.extract()` classifies the notice (scored candidates: labelled header
   hits and hits near the top beat body mentions, plus alias lookup `LT11 → LTR3219C`), then reads
   type, tax year, notice date, amount owed, refund, response deadline, what changed, requested
   actions and IRS contact details. Every field carries a **quote** from the source text and a
   confidence. Anything not found is `null` and rendered as
   *"Not found, please check the original notice."* — the pipeline never invents a value.
5. **Confidence + risk** — overall confidence blends OCR quality, classification strength and field
   coverage. High-risk tags (audit, levy, lien, fraud, identity theft) or low confidence raise the
   "Talk to a licensed professional" banner with a human-review offer.
6. **Explanation** — seven sections: what this notice is · what the IRS is asking · deadline and
   consequence · your options · documents you may need · recommended next steps · questions to ask a
   tax professional. English is always shown and authoritative; the second pane shows the chosen
   language, with a machine-translation note: *"Translations are machine-assisted. The English
   version controls."*
7. **Export** — bilingual PDF (client-side), or the browser's Print → Save as PDF for non-Latin
   scripts (see §7 limitations).

Curated translations live in `data/notices.json` (`sections.<locale>.sec1..sec7`); unrecognised
documents fall back to a generic, still-localized seven-section explanation
(`decoder.gen1 … decoder.gen7`).

### Languages

`en` (default), `hi`, `bn`, `ar` (RTL), `sw`, `es`, `de`, `ko`, `tl`, `fr`, `zh-CN`, `zh-TW`.

Detection order: `localStorage['gotax.lang']` → `?lang=` → `navigator.languages` → `en`. The
switcher is in the header on every page and the choice persists across pages. Fonts are loaded from
Google Fonts (Sora, Inter, Noto Sans Devanagari/Bengali/Arabic/SC/TC/KR) with system fallbacks, so
long translations never break the layout (fluid type scale, `overflow-wrap:anywhere`, RTL-aware
logical properties).

---

## 4. Environment variables

The static front end needs **none**. For the real backend, copy the template and fill in every
placeholder:

```bash
cp backend/.env.example backend/.env
```

`backend/.env.example` contains the full annotated list. The variables that matter most:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL`, `CORS_ORIGINS` | — | Canonical origin (HTTPS only) and allowed API origins |
| `SESSION_SECRET`, `JWT_TTL_MINUTES`, `FIELD_ENCRYPTION_KEY` | — | Session/JWT signing and encryption of sensitive fields at rest |
| `DATABASE_URL`, `DATABASE_SSL` | — | PostgreSQL connection |
| `STORAGE_BUCKET`, `STORAGE_*`, `SIGNED_URL_MINUTES` | `5` | Private object storage; signed URLs only, never public buckets |
| `MAX_UPLOAD_MB`, `ALLOWED_UPLOAD_TYPES` | `15`, jpeg/png/pdf | Upload validation (mirrored client-side in `App.CONFIG`) |
| `MALWARE_SCAN_URL` | ClamAV | Scan every upload before processing |
| `RETENTION_DAYS`, `RETENTION_CRON` | `90`, daily 03:00 | Auto-delete; user-initiated deletion is always immediate |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `REDIS_URL` | `6` / `60000` | Throttling of analysis and auth endpoints |
| `OCR_PROVIDER` + provider keys | `google` | Cloud OCR with manual-correction fallback |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_TEMPERATURE`, `LLM_REQUIRE_QUOTES` | `0.1`, `true` | Prompts forbid invented facts; unquoted values are dropped |
| `BTCPAY_URL`, `BTCPAY_STORE_ID`, `BTCPAY_API_KEY`, `BTCPAY_WEBHOOK_SECRET` | — | Bitcoin payments via a self-hosted processor. **No private keys on the website.** |
| `BTC_REQUIRED_CONFIRMATIONS`, `BTC_INVOICE_EXPIRY_MINUTES` | `2`, `15` | Delivery only after N confirmations; expiry handling |
| `BTC_LIGHTNING_ENABLED` | `true` | On-chain + Lightning |
| `RATE_SOURCE`, `RATE_FALLBACK_USD`, `RATE_CACHE_SECONDS` | `btcpay:BTC_USD`, `118450`, `60` | USD↔BTC rate shown at checkout and stored on every invoice/receipt |
| `CARD_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `true` | Secondary card/bank option |
| `REFUND_WINDOW_DAYS`, `REFUND_APPROVAL_ROLE`, `REFUND_POLICY_URL` | `7`, `admin` | Refund handling (see `legal/refunds.html`) |
| `EMAIL_VERIFICATION_REQUIRED`, `TWO_FACTOR_ENABLED`, `SMTP_*` | `true`, `true` | Email verification + optional TOTP 2FA |
| `REVIEW_AUTO_FLAG_CONFIDENCE`, `REVIEW_AUTO_FLAG_RISKS`, `REVIEW_SLA_HOURS` | `0.60`, high-risk tags, `24` | Human-review queue routing |
| `BUSINESS_LEGAL_NAME`, `BUSINESS_ADDRESS`, `BUSINESS_EMAIL`, `BUSINESS_PHONE`, `BUSINESS_TAX_ID` | placeholders | Shown on receipts and legal pages |
| `PARTNER_FIRM_NAME`, `PARTNER_FIRM_PTIN` | placeholders | The licensed CPA/EA who reviews and signs returns |
| `DATA_PROTECTION_CONTACT` | placeholder | Privacy/retention contact |
| `ANALYTICS_PROVIDER`, `ANALYTICS_PII` | `plausible`, `false` | Cookie-less analytics; no personal data is ever sent |
| `HSTS_MAX_AGE`, `CSP_ENABLED`, `CSP_EXTRA_STYLE`, `CSP_EXTRA_FONT` | — | Transport security and Content-Security-Policy (Google Fonts origins) |

### Overriding config in the front end

`assets/js/app.js` reads `App.CONFIG`; any value can be overridden before the page scripts run:

```html
<script>window.__GOTAX_CONFIG__ = { btcRateUsd: 97000, retentionDays: 30, requiredConfirmations: 3 };</script>
```

When the real API exists, point the front end at it with `apiBase: '/api/v1'` and replace the bodies
of the `API.*` functions in `assets/js/app.js` with `fetch()` calls — the shapes already match
`backend/openapi.yaml`.

---

## 5. Backend setup (production)

1. **Database** — create PostgreSQL, run migrations, enable TLS (`DATABASE_SSL=require`).
2. **Object storage** — create a **private** bucket, an IAM user scoped to that prefix, enable
   server-side encryption and a lifecycle rule matching `RETENTION_DAYS`.
3. **BTCPay Server** — deploy (Docker), create a store + wallet, generate an API key, register the
   webhook pointing at `POST /api/v1/webhooks/btcpay` and copy its secret. Never export private keys
   to the web tier.
4. **OCR** — configure the chosen provider; keep the manual-correction path enabled for
   low-confidence scans.
5. **LLM** — set the key/model; deploy the system prompt at `LLM_SYSTEM_PROMPT_PATH` that forbids
   invented amounts/deadlines and requires every extracted value to quote an OCR field.
6. **Mail + 2FA** — SMTP for verification, receipts and review notifications; TOTP enrolment.
7. **API** — implement `backend/openapi.yaml` (any Node/Python stack), mount it at `/api/v1`,
   enable rate limiting, RBAC (`customer` / `reviewer` / `admin`) and the audit log.
8. **Static site** — deploy this directory to a CDN or web server behind HTTPS with HSTS, CSP,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and
   `Permissions-Policy` restrictions.
9. **Fill in the placeholders** — see §8.

---

## 6. Tests

```bash
node tests/engine.test.js        # 120 checks: QR, PDF, redaction, extraction, explanation, dictionaries
node tests/check_i18n_keys.js    # every t('…') key exists in en.js (+ dynamic-prefix report)
python3 build.py --check         # templates build cleanly, no leftover tokens

# The two suites below need a running static server and jsdom:
npm install jsdom                # dev dependency, tests only
python3 -m http.server 8000 --bind 0.0.0.0 --directory . &
node tests/smoke.js              # all 17 representative pages hydrate with no runtime errors
node tests/flows.test.js         # 111 checks: decoder, bilingual/RTL, checkout→receipt, intake,
                                 # account RBAC, admin console, language persistence
node tests/check_links.js        # internal links, hreflang, canonical, sitemap consistency
```

Optional, deeper QR verification (needs Python packages, not shipped with the site):

```bash
pip install opencv-python-headless segno
python3 tests/qr_decode_check.py   # decodes the generated matrices with OpenCV
```

---

## 7. Known limitations of the static demo

* **OCR and the LLM are simulated.** `Decode.ingest()` reads the bundled sample text (or pasted
  text) and reports a synthetic OCR confidence; explanations come from the curated knowledge base in
  `data/notices.json`. Wiring in the real providers means implementing `POST /documents/{id}/
  redaction-preview` and `POST /decode/analyze` from `backend/openapi.yaml`.
* **Payments are simulated.** Invoices, QR codes, addresses, txids and confirmations are generated
  locally; the `[data-sim]` buttons stand in for BTCPay webhooks. No private keys are involved.
* **Client-side PDFs embed base-14 Latin fonts only.** `PDF.isLatinSafe()` detects Devanagari,
  Bangla, Arabic and CJK text and routes those locales to the browser's Print → Save as PDF
  (`assets/css/print.css`) instead of producing a PDF with missing glyphs. Server-side PDFs should
  embed Noto fonts.
* **Auth is a demo gate.** `API.signIn()` accepts any valid-looking email/password and can switch to
  the `admin`/`reviewer` demo identities. Replace with real sessions + RBAC before launch, and hide
  the demo buttons.
* **Storage is `localStorage`.** Everything stays in the visitor's browser; nothing is uploaded.

---

## 8. Placeholders you must fill in before launch

| Where | What |
| --- | --- |
| `assets/js/app.js` → `CONFIG.business` | legal name, address, support email/phone, tax id, partner firm |
| `legal/privacy.html`, `legal/terms.html`, `legal/disclaimer.html` | company details, jurisdiction, DPO contact |
| `legal/refunds.html` | refund windows and the case-by-case rows marked `[placeholder]` |
| `legal/retention.html` | retention period (default 90 days) and deletion guarantees |
| `notices/*.html`, `data/notices.json` | review the plain-language content with a licensed professional |
| `backend/.env.example` | every `[PLACEHOLDER]` value (see §4) |
| `sitemap.xml`, `robots.txt`, `<link rel="canonical">` | your real domain (`build.py` uses `SITE` at the top of the file) |

---

## 9. Security and privacy posture

* HTTPS everywhere; HSTS; strict CSP (Google Fonts origins allowlisted).
* Encryption in transit (TLS) and at rest (object-storage SSE + `FIELD_ENCRYPTION_KEY` for
  sensitive columns).
* Documents live in a **private** bucket and are only ever exposed through short-lived signed URLs
  (5 minutes by default).
* RBAC: `customer`, `reviewer`, `admin`. The admin console refuses other roles; reviewers see the
  queue but not refunds or configuration.
* Explicit consent checkbox before any upload, recorded with a timestamp; audit log of file views,
  status changes and admin actions.
* **No SSNs, ITINs, account numbers or full document contents in logs.** UI values are masked.
* Auto-delete after `RETENTION_DAYS` (default 90) plus immediate user-initiated deletion
  (`DELETE /me/data`).
* Rate limiting, file-type validation (extension + content sniffing), size caps and malware scanning
  on upload.
* Nothing is ever sent to the IRS by this service; draft letters are returned to the user.
* Analytics collect no personal data (no cookies, no IPs stored).

---

## 10. Design notes

Calm blue/green fintech palette, high contrast (WCAG AA), fluid type scale, generous spacing,
mobile-first breakpoints at 560 / 760 / 1040 / 1280 px, visible focus rings, skip link, semantic
landmarks, `aria-*` on tabs/modals/progress, RTL support via logical properties, and an offline-safe
font stack. Branding: **GoTax.SI** — the *SI* is the accent ("Smart Intelligence for taxes"); body
copy says "AI".
