# Deploy to Render (free)

This app is a Node/Express server that serves the built UI from `server/public`.

## One-time prep on your PC

1. Create a free GitHub account (if needed): https://github.com/join
2. Create a **new empty** GitHub repo, e.g. `locaitra-translate` (do **not** upload `.env`)
3. In PowerShell:

```powershell
cd D:\Work\Baset_Tools\locaitra-translate
git init
git add .
git commit -m "Prepare Locaitra Translate for Render"
git branch -M main
git remote add origin https://github.com/YOUR_USER/locaitra-translate.git
git push -u origin main
```

## Deploy on Render

1. Open https://dashboard.render.com and sign up (GitHub login is easiest)
2. **New → Blueprint** (uses `render.yaml`) **or** **New → Web Service**
3. Connect the GitHub repo `locaitra-translate`
4. If manual Web Service (not Blueprint), set:
   - **Build Command:** `npm install --include=dev && npm run build`
   - **Start Command:** `npm start`
   - **Instance type:** Free
5. **Environment** → add (from your local `.env`, quote passwords with `#`):

| Key | Example / note |
|---|---|
| `TRANSLATION_MODE` | `live` |
| `PHRASE_API_TOKEN` | your token |
| `PHRASE_AUTH_MODE` | `platform` |
| `PHRASE_OAUTH_URL` | `https://eu.phrase.com/idm/oauth/token` |
| `PHRASE_BASE_URL` | `https://cloud.memsource.com/web` |
| `PHRASE_PROJECT_TEMPLATE_UID` | your template UID |
| `AUTH_ADMIN_USER` | `admin` |
| `AUTH_ADMIN_PASSWORD` | your password (use quotes locally; plain value in Render UI) |
| `AUTH_SECRET` | long random string |
| `AUTH_SECURE_COOKIE` | `true` |
| `HOSTED` | `true` |
| `MAX_UPLOAD_MB` | `50` |

6. Click **Deploy**
7. Open the `https://….onrender.com` URL → sign in as admin

## Notes

- Free tier **sleeps after ~15 minutes** idle; first open can take ~30–60s
- Uploaded files are temporary on free disk (ok for a pilot)
- Never commit `.env` — Render stores secrets in the dashboard
