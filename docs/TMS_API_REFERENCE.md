# TMS API reference notes (operators only)

Internal notes for the translation management system (TMS) wired behind LingoTrust Translate.  
**Do not surface the TMS vendor name in the product UI.**

Primary docs (vendor Help Center + Developer Hub — open from your TMS admin account):
- Platform authentication / token exchange
- TMS APIs (projects, jobs, pre-translate, download)
- Language AI / MT engine settings

## Products we care about

| Area | Role for this app |
|---|---|
| **Platform auth** | Access tokens → JWT for API calls |
| **TMS** | Projects, jobs, import/conversion, pre-translate, target download |
| **Language AI** | MT engines used inside TMS jobs |
| **Strings** | Key-based product copy (not used by LingoTrust Translate v1) |

## Auth (what our server does)

1. `POST` to `TMS_OAUTH_URL` (IdP token endpoint from your TMS region)  
   grant: token-exchange using the platform access token  
2. Use returned JWT as `Authorization: Bearer …` against `TMS_BASE_URL`

Region tip: EU vs US IdP + TMS host pairs must match. Set both URLs in `.env`.

Legacy TMS-only `ApiToken` header still works if `TMS_AUTH_MODE=apitoken`.

## Env vars (server only)

| Var | Purpose |
|---|---|
| `TMS_API_TOKEN` | Platform access token (or legacy ApiToken) |
| `TMS_AUTH_MODE` | `platform` (default) or `apitoken` |
| `TMS_OAUTH_URL` | IdP token-exchange URL |
| `TMS_BASE_URL` | TMS API root (…/web) |
| `TMS_PROJECT_TEMPLATE_UID` | 3-step Full workflow template |
| `TMS_AI_TEMPLATE_UID` | Path A one-pass template |
| `TMS_WF3_MT_ID` | Optional MT engine numeric id |

## Why TMS (not Strings) for files

LingoTrust Translate v1 stays on **TMS** so file conversion (Office → segments → reconstructed file) is handled by job import.

## How LingoTrust Translate maps to this

- Create project from customer template UID  
- Create jobs (file upload)  
- Pre-translate / Agent per template  
- Download targets  

TM, term bases, and writing rules stay configured in the TMS UI — this app only selects the customer → template.
