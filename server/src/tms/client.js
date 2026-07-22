const { PHRASE_FILE_EXTENSIONS, FALLBACK_LANGUAGES } = require('./formats');

/**
 * Live TMS client. Credentials stay on the server only.
 * Public product UI must never mention the vendor.
 *
 * Supports Phrase Platform access tokens (exchanged for a short-lived JWT)
 * and legacy ApiToken strings.
 */
class LiveTmsClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.apiToken = config.token;
    this.authMode = config.authMode || 'platform';
    this.oauthUrl = config.oauthUrl || 'https://eu.phrase.com/idm/oauth/token';
    this.projectTemplateUid = config.projectTemplateUid || '';
    this._jwt = null;
    this._jwtExpiresAt = 0;
    this._languagesCache = null;
    this._languagesCachedAt = 0;
  }

  async _ensureAuthHeader() {
    if (this.authMode === 'apitoken') {
      return `ApiToken ${this.apiToken}`;
    }

    const now = Date.now();
    // Refresh 2 minutes before expiry
    if (this._jwt && now < this._jwtExpiresAt - 120000) {
      return `Bearer ${this._jwt}`;
    }

    const urls = [
      this.oauthUrl,
      this.oauthUrl.includes('eu.phrase.com')
        ? 'https://us.phrase.com/idm/oauth/token'
        : 'https://eu.phrase.com/idm/oauth/token',
    ];
    // de-dupe
    const tried = [...new Set(urls)];

    let lastErr = null;
    for (const oauthUrl of tried) {
      try {
        const body = new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: this.apiToken,
          subject_token_type: 'urn:phrase:params:oauth:token-type:api_token',
          requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        });

        const res = await fetch(oauthUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body,
        });
        const text = await res.text();
        if (!res.ok) {
          lastErr = new Error(`Token exchange failed (${res.status}) at ${oauthUrl}: ${text.slice(0, 200)}`);
          continue;
        }
        const data = JSON.parse(text);
        if (!data.access_token) {
          lastErr = new Error('Token exchange returned no access_token');
          continue;
        }
        this._jwt = data.access_token;
        const ttlSec = Number(data.expires_in) || 14400;
        this._jwtExpiresAt = Date.now() + ttlSec * 1000;
        this.oauthUrl = oauthUrl; // remember working region
        return `Bearer ${this._jwt}`;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Token exchange failed');
  }

  async _headers(extra = {}) {
    const authorization = await this._ensureAuthHeader();
    return {
      Authorization: authorization,
      Accept: 'application/json',
      // Recommended by Phrase TMS API docs
      'User-Agent': 'Locaitra Translate (projects@locaitra.com)',
      ...extra,
    };
  }

  async _request(method, apiPath, { headers = {}, body, raw = false } = {}) {
    const url = `${this.baseUrl}${apiPath}`;
    const res = await fetch(url, {
      method,
      headers: await this._headers(headers),
      body,
    });

    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      const err = new Error(`Upstream request failed (${res.status})`);
      err.status = res.status;
      err.detail = detail;
      throw err;
    }

    if (raw) return res;
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async ping() {
    if (!this.apiToken) throw new Error('API token is not configured');
    await this.listLanguages(true);
    return true;
  }

  async listLanguages(force = false) {
    const now = Date.now();
    if (!force && this._languagesCache && now - this._languagesCachedAt < 60 * 60 * 1000) {
      return this._languagesCache;
    }

    try {
      const data = await this._request('GET', '/api2/v1/languages');
      const list = Array.isArray(data) ? data : data?.languages || data?.content || [];
      const mapped = list
        .map((l) => ({
          code: l.code || l.lang || l.id,
          name: l.name || l.displayName || l.code,
        }))
        .filter((l) => l.code)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (mapped.length) {
        this._languagesCache = mapped;
        this._languagesCachedAt = now;
        return mapped;
      }
    } catch {
      /* fall through */
    }
    return FALLBACK_LANGUAGES;
  }

  async listFileExtensions() {
    return [...PHRASE_FILE_EXTENSIONS];
  }

  async listMachineTranslateSettings() {
    const data = await this._request(
      'GET',
      '/api2/v1/machineTranslateSettings?pageNumber=0&pageSize=50'
    );
    const list = Array.isArray(data) ? data : data?.content || [];
    return list.map((e) => ({
      // Phrase preTranslate / mtSettingsPerLanguage resolve by numeric id, not uid.
      id: e.id != null ? String(e.id) : null,
      uid: e.uid,
      name: e.name,
      type: e.type,
      default: e.default_ === true || e.default === true,
    })).filter((e) => e.id || e.uid);
  }

  async getDefaultMtUid() {
    const engines = await this.listMachineTranslateSettings();
    if (!engines.length) return null;
    const engine = engines.find((e) => e.default) || engines[0];
    // Phrase Language AI only accepts machineTranslateSettings.id (uid is ignored).
    return engine.id || engine.uid || null;
  }

  async createProject({ name, sourceLang, targetLangs, mtUid, templateUid }) {
    const tpl = templateUid || this.projectTemplateUid;
    const payload = {
      name,
      sourceLang,
      targetLangs,
    };

    // Prefer project template so TMS settings / MT / workflow steps come from Phrase.
    if (tpl) {
      return this._request('POST', `/api2/v2/projects/applyTemplate/${tpl}`, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (mtUid) {
      // Create often ignores this; setProjectMtSettings attaches MT reliably.
      payload.mtSettingsPerLangList = targetLangs.map((targetLang) => ({
        targetLang,
        machineTranslateSettings: { id: String(mtUid) },
      }));
    }
    return this._request('POST', '/api2/v1/projects', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async setProjectMtSettings({ projectUid, targetLangs, mtUid }) {
    if (!mtUid) return null;
    const body = {
      mtSettingsPerLangList: targetLangs.map((targetLang) => ({
        targetLang,
        machineTranslateSettings: { id: String(mtUid) },
      })),
    };
    // /mtSettings silently drops the engine; /mtSettingsPerLanguage accepts { id }.
    return this._request('PUT', `/api2/v1/projects/${projectUid}/mtSettingsPerLanguage`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async createJob({ projectUid, fileBuffer, fileName, targetLangs }) {
    const memsource = JSON.stringify({ targetLangs });
    const disposition = `filename*=UTF-8''${encodeURIComponent(fileName)}`;
    return this._request('POST', `/api2/v1/projects/${projectUid}/jobs`, {
      headers: {
        Accept: '*/*',
        Memsource: memsource,
        'Content-Disposition': disposition,
        'Content-Type': 'application/octet-stream',
      },
      body: fileBuffer,
    });
  }

  async getAsync(asyncRequestId) {
    return this._request('GET', `/api2/v1/async/${asyncRequestId}`);
  }

  async waitAsync(asyncRequestId, { timeoutMs = 10 * 60 * 1000, intervalMs = 2000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.getAsync(asyncRequestId);
      const done =
        status?.asyncResponse != null ||
        status?.status === 'COMPLETED' ||
        status?.status === 'FAILED' ||
        status?.status === 'OK';
      if (done) {
        if (status?.asyncResponse?.errorCode || status?.status === 'FAILED') {
          const err = new Error('Processing failed');
          err.detail = status;
          throw err;
        }
        return status;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error('Processing timed out');
  }

  async listProjectJobs(projectUid, { workflowLevel } = {}) {
    let apiPath = `/api2/v2/projects/${projectUid}/jobs?pageNumber=0&pageSize=50`;
    if (workflowLevel != null) apiPath += `&workflowLevel=${workflowLevel}`;
    const data = await this._request('GET', apiPath);
    return Array.isArray(data) ? data : data?.content || data?.jobs || [];
  }

  async getProject(projectUid) {
    return this._request('GET', `/api2/v1/projects/${projectUid}`);
  }

  /** Project-level MT for all languages (targetLang null). */
  async setProjectMtEngine(projectUid, mtId) {
    if (!mtId) return null;
    return this._request('PUT', `/api2/v1/projects/${projectUid}/mtSettings`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machineTranslateSettings: { id: String(mtId) } }),
    });
  }

  async preTranslate({
    projectUid,
    jobParts,
    mtUid,
    useProjectSettings = false,
    overwrite = false,
  }) {
    const jobs = jobParts.map((j) => ({ uid: j.uid }));

    // v3: project settings and/or explicit engine + overwrite (workflow steps).
    if (useProjectSettings || overwrite || mtUid) {
      const body = { jobs };
      if (useProjectSettings && !mtUid) {
        body.useProjectPreTranslateSettings = true;
      } else {
        body.useProjectPreTranslateSettings = false;
        body.preTranslateSettings = {
          overwriteExistingTranslations: Boolean(overwrite),
          machineTranslationSettings: { useMachineTranslation: true },
          translationMemorySettings: { useTranslationMemory: !mtUid },
        };
        if (mtUid) body.machineTranslateSettings = { id: String(mtUid) };
      }
      return this._request('POST', `/api2/v3/projects/${projectUid}/jobs/preTranslate`, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    return this._request('POST', `/api2/v1/projects/${projectUid}/jobs/preTranslate`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobs,
        useTranslationMemory: false,
        useMachineTranslate: true,
        insertMachineTranslationIntoTarget: true,
      }),
    });
  }

  /** Mark job parts completed so target export includes confirmed MT. */
  async setJobsStatus({ projectUid, jobParts, status = 'COMPLETED' }) {
    return this._request('POST', `/api2/v1/projects/${projectUid}/jobs/setStatus`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobs: jobParts.map((j) => ({ uid: j.uid })),
        status,
      }),
    }).catch(() => null);
  }

  /**
   * Official TMS download flow (Using APIs TMS docs):
   * 1) PUT /api2/v2/.../targetFile  → asyncRequest id
   * 2) poll GET /api2/v1/async/{id}
   * 3) GET  /api2/v2/.../downloadTargetFile/{asyncRequestId}
   * Falls back to older GET paths if needed.
   */
  async downloadTarget({ projectUid, jobPartUid }) {
    const binaryHeaders = { Accept: '*/*' };

    try {
      const started = await this._request(
        'PUT',
        `/api2/v2/projects/${projectUid}/jobs/${jobPartUid}/targetFile`,
        { headers: { Accept: 'application/json' } }
      );
      const asyncId = started?.asyncRequest?.id || started?.id;
      if (!asyncId) throw new Error('No async id for target export');
      await this.waitAsync(asyncId);
      const dl = await this._request(
        'GET',
        `/api2/v2/projects/${projectUid}/jobs/${jobPartUid}/downloadTargetFile/${asyncId}`,
        { headers: binaryHeaders, raw: true }
      );
      return bufferFromResponse(dl, jobPartUid);
    } catch (primaryErr) {
      // Fallback: older GET targetFile (may return binary or JSON+async)
      const res = await this._request(
        'GET',
        `/api2/v1/projects/${projectUid}/jobs/${jobPartUid}/targetFile`,
        { headers: binaryHeaders, raw: true }
      ).catch(() => {
        throw primaryErr;
      });

      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json')) {
        const text = await res.text();
        let started = null;
        try {
          started = JSON.parse(text);
        } catch {
          started = null;
        }
        const asyncId = started?.asyncRequest?.id || started?.id;
        if (asyncId) await this.waitAsync(asyncId);
        const dl = await this._request(
          'GET',
          `/api2/v1/projects/${projectUid}/jobs/${jobPartUid}/targetFile/download?asyncRequestId=${asyncId || ''}`,
          { headers: binaryHeaders, raw: true }
        );
        return bufferFromResponse(dl, jobPartUid);
      }
      return bufferFromResponse(res, jobPartUid);
    }
  }
}

function bufferFromResponse(res, jobPartUid) {
  return res.arrayBuffer().then((ab) => {
    const buf = Buffer.from(ab);
    const cd = res.headers.get('content-disposition') || '';
    const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
    const fileName = match ? decodeURIComponent(match[1]) : `translated-${jobPartUid}`;
    return { buffer: buf, fileName };
  });
}

module.exports = { LiveTmsClient };

