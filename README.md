# Locaitra Translate

Personal file translation tool: upload → translate → download.

## Quick start (demo / mock)

```bash
cd locaitra-translate
cp .env.example .env
# TRANSLATION_MODE=mock is the default — no API key needed
npm install
npm run dev
```

- UI (Vite): http://localhost:5173  
- API: http://localhost:8787  

Or production-style (build UI into server):

```bash
npm run build
npm start
# open http://localhost:8787
```

## Live translation backend

1. Create a **Platform access token** in Phrase (Profile → Access tokens), scoped for TMS.
2. Put it in `.env` (server only):

```env
TRANSLATION_MODE=live
PHRASE_API_TOKEN=your_platform_access_token
PHRASE_AUTH_MODE=platform
PHRASE_OAUTH_URL=https://eu.phrase.com/idm/oauth/token
PHRASE_BASE_URL=https://cloud.memsource.com/web
```

The server exchanges the access token for a short-lived JWT automatically (never sent to the browser).

- EU (default): `eu.phrase.com` + `cloud.memsource.com`
- US: `https://us.phrase.com/idm/oauth/token` and `https://us.cloud.memsource.com/web`

3. Restart the server. Languages come from the live account.

**Never commit `.env` or paste the token into the UI / public repos.**

## Docker (for internet hosting later)

```bash
cp .env.example .env
# set TRANSLATION_MODE=live and PHRASE_API_TOKEN
docker compose up --build -d
```

App listens on port **8787**. Put HTTPS (nginx / Cloudflare / Render) in front when you publish.

## What the user sees

- Upload files (types limited to what the engine supports)
- Choose source / target language
- **Translate**
- Simple progress + download

All import / conversion / machine translation / export work runs on the server and is not shown as technical steps.

## API (for integrations)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/meta` | languages + fileExtensions |
| POST | `/api/translate` | multipart `files`, `sourceLang`, `targetLangs` |
| GET | `/api/translate/:id` | progress |
| GET | `/api/translate/:id/files/:fileId/download` | one file |
| GET | `/api/translate/:id/download-all` | zip |

## License

Private — LocHere / Locaitra.
