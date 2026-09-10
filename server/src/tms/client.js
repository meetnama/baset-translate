const { TMS_FILE_EXTENSIONS, FALLBACK_LANGUAGES } = require('./formats');
const { decodeMultipartFilename } = require('../util/filenames');

/**
 * Live TMS client. Credentials stay on the server only.
 * Public product UI must never mention the TMS vendor.
 *
 * Supports platform access tokens (exchanged for a short-lived JWT)
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
      'User-Agent': 'LingoTrust Translate',
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
    return [...TMS_FILE_EXTENSIONS];
  }

  async listMachineTranslateSettings() {
    const data = await this._request(
      'GET',
      '/api2/v1/machineTranslateSettings?pageNumber=0&pageSize=50'
    );
    const list = Array.isArray(data) ? data : data?.content || [];
    return list.map((e) => ({
      // preTranslate / mtSettingsPerLanguage resolve by numeric id, not uid.
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
    // Language AI only accepts machineTranslateSettings.id (uid is ignored).
    return engine.id || engine.uid || null;
  }

  async createProject({ name, sourceLang, targetLangs, mtUid, templateUid }) {
    const tpl = templateUid != null && templateUid !== undefined
      ? String(templateUid).trim()
      : (this.projectTemplateUid || '');
    const payload = {
      name,
      sourceLang,
      targetLangs,
    };

    // Prefer project template so TMS settings / MT / workflow steps come from the template.
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
    const pageSize = 50;
    const all = [];
    for (let page = 0; page < 20; page += 1) {
      let apiPath = `/api2/v2/projects/${projectUid}/jobs?pageNumber=${page}&pageSize=${pageSize}`;
      if (workflowLevel != null) apiPath += `&workflowLevel=${workflowLevel}`;
      const data = await this._request('GET', apiPath);
      const list = Array.isArray(data) ? data : data?.content || data?.jobs || [];
      if (!list.length) break;
      all.push(...list);
      if (list.length < pageSize) break;
    }
    return all;
  }

  async getJob(projectUid, jobUid) {
    const pUid = String(projectUid || '').trim();
    const jUid = String(jobUid || '').trim();
    if (!pUid || !jUid) throw new Error('projectUid and jobUid required');
    return this._request('GET', `/api2/v1/projects/${pUid}/jobs/${jUid}`);
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
        // TMS may ignore sibling fields when useProjectPreTranslateSettings is true,
        // but overwrite must still be requested for later workflow levels.
        if (overwrite) {
          body.preTranslateSettings = {
            overwriteExistingTranslations: true,
          };
        }
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

  analyseRefOf(row) {
    return row?.uid || row?.id || row?.analyse?.uid || row?.analyse?.id || null;
  }

  analysisParts(analysis) {
    // Phrase returns analyseLanguageParts (British spelling).
    return (
      analysis?.analyseLanguageParts ||
      analysis?.analyzeLanguageParts ||
      analysis?.analyseLanguagePartDtos ||
      []
    );
  }

  /** Parse TMS analysis v3 — Summary file count + All-row word total. */
  parseAnalysisSummary(analysis) {
    const parts = this.analysisParts(analysis);
    const jobKeys = new Set();
    const fileNames = new Set();
    let totalWords = 0;

    for (const part of parts) {
      const words =
        part?.data?.all?.words ??
        part?.data?.All?.words ??
        part?.all?.words;
      if (words != null) totalWords += Number(words) || 0;
      for (const job of part?.jobs || []) {
        if (job?.jobUid) jobKeys.add(job.jobUid);
        else if (job?.uid) jobKeys.add(job.uid);
        if (job?.filename) fileNames.add(job.filename);
      }
    }

    const fileCount = jobKeys.size || fileNames.size || (parts.length ? 1 : 0);
    return {
      fileCount,
      totalWords: Math.round(totalWords),
    };
  }

  async listProjectAnalyses(projectUid) {
    const uid = String(projectUid || '').trim();
    if (!uid) return [];
    const paths = [
      `/api2/v3/projects/${uid}/analyses?pageNumber=0&pageSize=50&sort=DATE_CREATED&order=desc`,
      `/api2/v3/analyses?projectUid=${encodeURIComponent(uid)}&pageNumber=0&pageSize=50`,
      `/api2/v2/projects/${uid}/analyses?pageNumber=0&pageSize=50`,
      `/api2/v1/projects/${uid}/analyses?pageNumber=0&pageSize=50`,
    ];
    let lastErr = null;
    for (const apiPath of paths) {
      try {
        const data = await this._request('GET', apiPath);
        const list = Array.isArray(data)
          ? data
          : data?.content || data?.analyses || data?.analyseReferences || [];
        if (!Array.isArray(list)) return [];
        // Prefer newest when API does not sort.
        return [...list].sort((a, b) => {
          const ta = Date.parse(a?.dateCreated || a?.createdAt || '') || 0;
          const tb = Date.parse(b?.dateCreated || b?.createdAt || '') || 0;
          return tb - ta;
        });
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  }

  async getAnalysis(analyseRef) {
    return this._request('GET', `/api2/v3/analyses/${analyseRef}`);
  }

  /**
   * Prefer a project analysis if one exists (e.g. UI/APC).
   * API imports usually create none — then fall back to each job's detail
   * wordsCount (list jobs omits that field). Do not create a second analysis.
   * Returns { fileCount, totalWords }.
   */
  async runProjectWordAnalysis({
    projectUid,
    timeoutMs = 45 * 1000,
    intervalMs = 2000,
  } = {}) {
    const uid = String(projectUid || '').trim();
    if (!uid) throw new Error('projectUid required for word analysis');

    const start = Date.now();
    let lastSummary = { fileCount: 0, totalWords: 0 };
    let sawAnalysis = false;
    let emptyPolls = 0;

    while (Date.now() - start < timeoutMs) {
      const rows = await this.listProjectAnalyses(uid);
      if (rows.length) {
        sawAnalysis = true;
        emptyPolls = 0;
        const newest = rows[0];
        const ref = this.analyseRefOf(newest);
        if (ref) {
          const analysis = await this.getAnalysis(ref);
          lastSummary = this.parseAnalysisSummary(analysis);
          const parts = this.analysisParts(analysis);
          const ready = parts.some((p) => p?.data?.all != null || p?.data?.available === true);
          if (ready || lastSummary.totalWords > 0) return lastSummary;
        }
      } else {
        emptyPolls += 1;
        // Normal API jobs usually never get an analysis. Do not stall the run.
        if (emptyPolls >= 2) {
          const fromJobs = await this.wordSummaryFromJobs(uid);
          if (fromJobs.totalWords > 0 || fromJobs.fileCount > 0) return fromJobs;
        }
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    if (sawAnalysis && lastSummary.totalWords > 0) return lastSummary;

    // Fallback: job detail wordsCount (list endpoint has no words field).
    const fromJobs = await this.wordSummaryFromJobs(uid);
    if (fromJobs.totalWords > 0 || fromJobs.fileCount > 0) {
      if (!sawAnalysis) {
        console.warn(
          '[tms] no project analysis; using job detail wordsCount instead'
        );
      }
      return fromJobs;
    }

    if (!sawAnalysis) {
      throw new Error('Template analysis did not appear on the project in time');
    }
    return lastSummary;
  }

  /**
   * Source word total from imported jobs. Job list often omits wordsCount —
   * hydrate each job via getJob. Multi-target: max words per filename.
   */
  async wordSummaryFromJobs(projectUid) {
    const jobs = await this.listProjectJobs(projectUid, { workflowLevel: 1 });
    const list = Array.isArray(jobs) ? jobs : [];
    const byFile = new Map();

    for (const job of list) {
      const jobUid = job?.uid || job?.jobUid;
      let words = job?.wordsCount ?? job?.wordCount ?? job?.sourceWords;
      let filename = job?.filename;
      if ((words == null || words === '') && jobUid) {
        try {
          const detail = await this.getJob(projectUid, jobUid);
          words = detail?.wordsCount ?? detail?.wordCount ?? detail?.sourceWords;
          filename = filename || detail?.filename;
        } catch (err) {
          console.warn('[tms] job detail wordsCount failed:', err.message);
        }
      }
      const key = filename || jobUid || '_';
      const n = Number(words) || 0;
      byFile.set(key, Math.max(byFile.get(key) || 0, n));
    }

    const totalWords = [...byFile.values()].reduce((a, b) => a + b, 0);
    return {
      fileCount: byFile.size || (list.length ? 1 : 0),
      totalWords: Math.round(totalWords),
    };
  }
}

function bufferFromResponse(res, jobPartUid) {
  return res.arrayBuffer().then((ab) => {
    const buf = Buffer.from(ab);
    const cd = res.headers.get('content-disposition') || '';
    const star = /filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\s]+)/i.exec(cd);
    let fileName = null;
    if (star) {
      try {
        fileName = decodeURIComponent(star[1].replace(/["']/g, ''));
      } catch {
        fileName = null;
      }
    }
    if (!fileName) {
      const match = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;\s]+)/i.exec(cd);
      const raw = match ? (match[1] || match[2] || '').trim() : '';
      fileName = raw
        ? decodeMultipartFilename(raw)
        : `translated-${jobPartUid}`;
    }
    return { buffer: buf, fileName };
  });
}

module.exports = { LiveTmsClient };

