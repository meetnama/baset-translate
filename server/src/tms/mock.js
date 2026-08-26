const { TMS_FILE_EXTENSIONS, FALLBACK_LANGUAGES } = require('./formats');

/**
 * Mock TMS for local UI demos — same interface as LiveTmsClient.
 * Simulates import + translate delay; returns a simple translated text/binary stub.
 */
class MockTmsClient {
  async ping() {
    return true;
  }

  async listLanguages() {
    return FALLBACK_LANGUAGES;
  }

  async listFileExtensions() {
    return [...TMS_FILE_EXTENSIONS];
  }

  async listMachineTranslateSettings() {
    return [{ id: 'mock-mt', uid: 'mock-mt', name: 'Mock MT', type: 'MOCK', default: true }];
  }

  async getDefaultMtUid() {
    return 'mock-mt';
  }

  async createProject({ name, sourceLang, targetLangs, templateUid, setupId, singleStep }) {
    this._singleStep = Boolean(singleStep) || (setupId !== 'workflow' && setupId !== undefined);
    if (singleStep === false) this._singleStep = false;
    this._setupId = this._singleStep ? (setupId || 'diaab') : 'workflow';
    return {
      uid: `mock-proj-${Date.now()}`,
      name,
      sourceLang,
      targetLangs,
      templateUid: templateUid || null,
      setupId: this._setupId,
    };
  }

  async setProjectMtSettings() {
    return null;
  }

  async createJob({ fileName, targetLangs }) {
    await sleep(400);
    this._lastTargets = targetLangs || ['xx'];
    this._lastFileName = fileName;
    const parts = this._lastTargets.map((lang, i) => ({
      uid: `mock-job-l1-${Date.now()}-${i}`,
      targetLang: lang,
      filename: fileName,
      status: 'COMPLETED',
      workflowStep: { name: this._setupId === 'workflow' ? 'Machine Translation' : 'AI translation' },
      innerId: '1',
    }));
    this._jobsByLevel = { 1: parts };
    if (!this._singleStep) {
      this._jobsByLevel[2] = this._lastTargets.map((lang, i) => ({
        uid: `mock-job-l2-${Date.now()}-${i}`,
        targetLang: lang,
        filename: fileName,
        status: 'NEW',
        workflowStep: { name: 'MT Optimize' },
        innerId: '1',
      }));
      this._jobsByLevel[3] = this._lastTargets.map((lang, i) => ({
        uid: `mock-job-l3-${Date.now()}-${i}`,
        targetLang: lang,
        filename: fileName,
        status: 'NEW',
        workflowStep: { name: 'AI Translate' },
        innerId: '1',
      }));
    }
    return {
      asyncRequest: { id: `mock-async-import-${Date.now()}` },
      jobs: parts,
    };
  }

  async getProject() {
    if (!this._singleStep) {
      return {
        workflowSteps: [
          { workflowLevel: 1, name: 'Machine Translation', abbreviation: 'MT' },
          { workflowLevel: 2, name: 'MT Optimize', abbreviation: 'OP' },
          { workflowLevel: 3, name: 'AI Translate', abbreviation: 'AI' },
        ],
      };
    }
    return {
      workflowSteps: [{ workflowLevel: 1, name: 'AI translation', abbreviation: 'AI' }],
    };
  }

  async listProjectJobs(_projectUid, { workflowLevel } = {}) {
    const level = workflowLevel || 1;
    return this._jobsByLevel?.[level] || [];
  }

  async setProjectMtEngine() {
    return null;
  }

  async waitAsync() {
    await sleep(200);
    return { status: 'COMPLETED', asyncResponse: {} };
  }

  async preTranslate() {
    await sleep(300);
    return { asyncRequest: { id: `mock-async-mt-${Date.now()}` } };
  }

  async setJobsStatus() {
    return null;
  }

  async downloadTarget({ jobPartUid, fileName }) {
    await sleep(150);
    const base = fileName || `translated-${jobPartUid}`;
    const step = String(jobPartUid).includes('-l2-')
      ? 'wf2'
      : String(jobPartUid).includes('-l3-')
        ? 'wf3'
        : 'wf1';
    const content = `Translated by LingoTrust Translate (${step})\nSource file: ${base}\nGenerated: ${new Date().toISOString()}\n`;
    return {
      buffer: Buffer.from(content, 'utf8'),
      fileName: withTranslatedSuffix(base),
    };
  }

  parseAnalysisSummary(analysis) {
    const parts = analysis?.analyseLanguageParts || [];
    let totalWords = 0;
    const fileNames = new Set();
    for (const part of parts) {
      totalWords += Number(part?.data?.all?.words) || 0;
      for (const job of part?.jobs || []) {
        if (job?.filename) fileNames.add(job.filename);
      }
    }
    return {
      fileCount: fileNames.size || 1,
      totalWords: Math.round(totalWords),
    };
  }

  async createAnalysis({ jobs, name = 'Default analysis' }) {
    return {
      analyses: [{ analyse: { uid: `mock-analyse-${Date.now()}` }, asyncRequest: { id: `mock-async-analyse-${Date.now()}` } }],
    };
  }

  async getAnalysis() {
    const fileName = this._lastFileName || 'sample.txt';
    const targets = this._lastTargets || ['ar'];
    return {
      analyseLanguageParts: targets.map((targetLang) => ({
        targetLang,
        jobs: [{ filename: fileName, jobUid: `mock-job-${fileName}` }],
        data: {
          all: {
            words: Math.max(120, Math.round((this._mockWordEstimate || 850) / targets.length)),
          },
        },
      })),
    };
  }

  async listProjectAnalyses(_projectUid) {
    // Templates create analysis on import; mock returns one ready row.
    return [{ uid: `mock-analyse-${Date.now()}`, dateCreated: new Date().toISOString() }];
  }

  async wordSummaryFromJobs(_projectUid) {
    return {
      fileCount: 1,
      totalWords: Math.round(this._mockWordEstimate || 850),
    };
  }

  async runProjectWordAnalysis({ projectUid, fileName } = {}) {
    this._mockWordEstimate = Math.max(
      120,
      String(fileName || projectUid || 'sample').length * 47
    );
    const rows = await this.listProjectAnalyses(projectUid);
    if (rows.length) {
      const analysis = await this.getAnalysis(rows[0]?.uid);
      return this.parseAnalysisSummary(analysis);
    }
    return this.wordSummaryFromJobs(projectUid);
  }
}

function withTranslatedSuffix(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return `${name}.translated.txt`;
  return `${name.slice(0, i)}.translated${name.slice(i)}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { MockTmsClient };
