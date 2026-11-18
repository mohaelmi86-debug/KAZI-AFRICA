# KAZI AFRICA V1.1 — FUNCTIONAL REGRESSION & I18N/PWA REPORT

**Date:** 2026-11-18  
**Scope:** End-to-End Business Journeys (Phase 5) and Multilingual (`FR / EN / PT / AR`), Localization, Currency/Date Formatting, Branding, and PWA Compliance (Phase 6).

---

## 1. End-to-End Functional Regression Matrix

| Journey / Module | Verified Flow | Status |
|---|---|---|
| **Marketplace Lifecycle (Client ↔ Pro)** | Pro registration (non-verified) -> Client creates mission -> Pro sends quote -> 5x concurrent quote accept (`1 × 201`, `4 × 409`) -> Actor-locked booking state machine (`CONFIRMED -> IN_PROGRESS -> AWAITING_CLIENT_VALIDATION -> COMPLETED`) -> Participant messaging (`403` IDOR blocked, `201` allowed) -> Review (`201`, duplicate `409`) -> Payment initiate (`201`, replay `200`) -> Signed webhook (`200 CONFIRMED_SERVER`) -> Admin refund (`200 APPROVED` / `REFUNDED`, double refund `400`) | **Tested and passed** |
| **KAZI Skills & Certification** | Course catalog (`GET /api/skills/courses`), Super Admin course creation (`PT` + `FR` fields), 4x concurrent enrollment (`enrolled_count` strictly `+1`, `201`/`200`), Skill Passport & language backfill | **Tested and passed** |
| **Enterprise B2B Workspace** | Organization creation (`POST /api/enterprise/organizations`), owner/member isolation (`403` on cross-org mission/member injection), duplicate member `409` handling | **Tested and passed** |
| **Admin Governance & Verification** | `LOCAL_ADMIN` country-scoped access vs `SUPER_ADMIN` global access, country activation prerequisite enforcement (`400`), controlled country suspension (`SUSPENDED`), audit log recording | **Tested and passed** |
| **Gemini AI Endpoints (`/api/ai/*`)** | Route authentication, input sanitization, `PT` language support in prompts (`aiMatchProfessionals`, `aiDraftQuote`, `aiAssistProfileAndTranslate`, `aiAnalyzeTrendsAndRisks`), rate limit (`20/min`, `429`) | **Tested and passed** (rate limit & code path); live Gemini LLM response quality `Requires external validation` |
| **Interactive Browser UX / Visual Flows** | TypeScript strict compilation (`tsc --noEmit`), Vite production build (`npm run build`), HTTP serving of HTML entry (`200`) | **Tested and passed** (automated headless browser click-through `Not tested` in this CLI pass; visually inspected earlier in preview screenshots) |

---

## 2. 4-Language Localization (`FR / EN / PT / AR`) Validation

1. **Deep Recursive Dictionary Parity (`src/i18n/translations.ts`):**
   - Automated recursive assertion in `tests/kazi.test.ts` verified **100% identical key structure and zero empty strings** across `TRANSLATIONS.fr`, `TRANSLATIONS.en`, `TRANSLATIONS.pt`, and `TRANSLATIONS.ar` (**Tested and passed**).
2. **PostgreSQL Multilingual Backfill (`languages` + `*_pt` columns):**
   - `languages` table contains `fr` (`ltr`), `en` (`ltr`), `pt` (`ltr`), `ar` (`rtl`).
   - All `54` countries, `7` service categories, `7` skills, `3` training courses, `4` seeded professionals, `3` professional services, and seeded notifications have Portuguese (`*_pt`) fields populated via idempotent `ensurePortugueseSeedBackfill()`.
   - Frontend rendering uses `getLocalizedField(lang, record, baseKey)` across all 7 UI modules plus `AfricaInteractiveMap` tooltips and `DesignSystem` country selector.
3. **Persistence & RTL Directionality (`src/app/AppContext.tsx`):**
   - `kazi_lang` persisted in `localStorage`; authenticated switches trigger `PATCH /api/auth/preferences`; `document.documentElement.lang` updates to `fr | en | pt | ar` and `document.documentElement.dir` dynamically switches to `rtl` for Arabic and `ltr` for `FR/EN/PT`.
   - Currency formatting (`formatLocalCurrency`) supports `fr-FR`, `en-GB`, `pt-PT`, and `ar-EG`.

---

## 3. PWA & Branding Verification

- **PWA Manifest (`dist/manifest.webmanifest`):** Verified valid JSON with `name: "KAZI AFRICA"`, `display: "standalone"`, `theme_color: "#022554"`, `background_color: "#F4F7FB"`, and `192x192`, `512x512`, `maskable 512x512` icons (**Tested and passed**).
- **Service Worker Cache Safety (`dist/sw.js`):** Verified Workbox emission includes `navigateFallbackDenylist: [/^\/api\//]` and explicit `NetworkOnly` runtime rule for `/api/(auth|missions|quotes|bookings|payments|messages|notifications|disputes|reviews|enterprise|admin|skills/passport|ai)`, preventing cross-user stale authenticated responses in offline/PWA mode.
- **Sign-Out Cleanup (`AuthContext.tsx`):** `signOut()` resets `activeRole` (`CLIENT`), `adminCountryIso2s` (`[]`), and purges `kazi-api*` runtime caches.
- **Official Brand Assets (`src/config/brand.ts`):** Automated check in `tests/kazi.test.ts` verified existence and non-corruption (`> 500` bytes) of all official derived logo, emblem, and PWA icon files in `public/`.
