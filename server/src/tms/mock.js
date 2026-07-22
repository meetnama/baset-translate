const { PHRASE_FILE_EXTENSIONS, FALLBACK_LANGUAGES } = require('./formats');

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
    return [...PHRASE_FILE_EXTENSIONS];
  }

  async listMachineTranslateSettings() {
    return [{ id: 'mock-mt', uid: 'mock-mt', name: 'Mock MT', type: 'MOCK', default: true }];
  }

  async getDefaultMtUid() {
    return 'mock-mt';
  }

  async createProject({ name, sourceLang, targetLangs, templateUid }) {
    return {
      uid: `mock-proj-${Date.now()}`,
      name,
      sourceLang,
      targetLangs,
      templateUid: templateUid || null,
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
      workflowStep: { name: 'Machine Translation' },
      innerId: '1',
    }));
    this._jobsByLevel = {
      1: parts,
      2: this._lastTargets.map((lang, i) => ({
        uid: `mock-job-l2-${Date.now()}-${i}`,
        targetLang: lang,
        filename: fileName,
        status: 'NEW',
        workflowStep: { name: 'MT Optimize' },
        innerId: '1',
      })),
      3: this._lastTargets.map((lang, i) => ({
        uid: `mock-job-l3-${Date.now()}-${i}`,
        targetLang: lang,
        filename: fileName,
        status: 'NEW',
        workflowStep: { name: 'AI Translate' },
        innerId: '1',
      })),
    };
    return {
      asyncRequest: { id: `mock-async-import-${Date.now()}` },
      jobs: parts,
    };
  }

  async getProject() {
    return {
      workflowSteps: [
        { workflowLevel: 1, name: 'Machine Translation', abbreviation: 'MT' },
        { workflowLevel: 2, name: 'MT Optimize', abbreviation: 'OP' },
        { workflowLevel: 3, name: 'AI Translate', abbreviation: 'AI' },
      ],
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
    const content = `Translated by Locaitra (${step})\nSource file: ${base}\nGenerated: ${new Date().toISOString()}\n`;
    return {
      buffer: Buffer.from(content, 'utf8'),
      fileName: withTranslatedSuffix(base),
    };
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
