const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { createTmsClient } = require('../tms');

/** @type {Map<string, object>} */
const runs = new Map();

/** True for 0-byte files and UTF-8 BOM-only (EF BB BF) uploads. */
function isEmptyUploadBuffer(buffer) {
  if (!buffer || buffer.length === 0) return true;
  if (
    buffer.length === 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return true;
  }
  return false;
}

/** Phrase project name: project_YYYY-MM-DD_HH-mm-ss */
function projectDateTimeName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `project_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}



function ensureDirs() {
  fs.mkdirSync(config.runsDir, { recursive: true });
}

function publicRun(run) {
  return {
    id: run.id,
    status: run.status,
    progress: run.progress,
    sourceLang: run.sourceLang,
    targetLangs: run.targetLangs,
    createdAt: run.createdAt,
    files: run.files.map((f) => ({
      id: f.id,
      name: f.name,
      status: f.status,
      error: f.error || undefined,
      downloadName: f.downloadName || undefined,
      downloads: (f.downloads || []).map((d) => ({
        id: d.id,
        name: d.name,
        step: d.step,
        stepName: d.stepName,
        lang: d.lang,
      })),
    })),
  };
}

function setProgress(run) {
  const total = run.files.length || 1;
  const weights = { queued: 0, processing: 0.5, ready: 1, failed: 1 };
  const sum = run.files.reduce((a, f) => a + (weights[f.status] ?? 0), 0);
  run.progress = Math.round((sum / total) * 100);
  if (run.files.every((f) => f.status === 'ready' || f.status === 'failed')) {
    run.status = run.files.some((f) => f.status === 'ready') ? 'completed' : 'failed';
    if (run.status === 'completed' && run.files.every((f) => f.status === 'ready')) {
      run.progress = 100;
    }
  } else if (run.files.some((f) => f.status === 'processing')) {
    run.status = 'processing';
  }
}

async function createRun({ files, sourceLang, targetLangs }) {
  ensureDirs();
  const id = uuidv4();
  const runDir = path.join(config.runsDir, id);
  fs.mkdirSync(runDir, { recursive: true });

  const run = {
    id,
    status: 'queued',
    progress: 0,
    sourceLang,
    targetLangs,
    createdAt: new Date().toISOString(),
    runDir,
    files: files.map((f) => ({
      id: uuidv4(),
      name: f.originalname,
      status: 'queued',
      path: f.path,
      size: f.size,
      error: null,
      downloadPath: null,
      downloadName: null,
      _projectUid: null,
      _jobParts: [],
    })),
  };

  runs.set(id, run);
  processRun(run).catch((err) => {
    console.error(`[run ${id}] fatal`, err.message);
    run.status = 'failed';
    run.files.forEach((f) => {
      if (f.status !== 'ready') {
        f.status = 'failed';
        f.error = 'Couldn’t translate this file. Please try again.';
      }
    });
    setProgress(run);
  });

  return publicRun(run);
}

function getRun(id) {
  const run = runs.get(id);
  return run ? publicRun(run) : null;
}

function getRunInternal(id) {
  return runs.get(id) || null;
}

async function processRun(run) {
  const tms = createTmsClient();
  run.status = 'processing';

  const useTemplate = Boolean(config.tms.projectTemplateUid);

  // When using a project template, keep its MT / pre-translate settings.
  // Otherwise attach the account default MT engine.
  let mtUid = null;
  if (!useTemplate && typeof tms.getDefaultMtUid === 'function') {
    try {
      mtUid = await tms.getDefaultMtUid();
    } catch (err) {
      console.warn('[pipeline] could not load MT engines:', err.message);
    }
  }

  for (const file of run.files) {
    file.status = 'processing';
    setProgress(run);
    try {
      await processFile(tms, run, file, mtUid, useTemplate);
      file.status = 'ready';
      file.error = null;
    } catch (err) {
      console.error(`[run ${run.id}] file ${file.name}:`, err.message, err.detail || '');
      file.status = 'failed';
      file.error =
        err.message === 'File is empty'
          ? 'This file is empty. Add content and try again.'
          : 'Couldn’t translate this file. Check the format and try again.';
    }
    setProgress(run);
  }
}

async function processFile(tms, run, file, mtUid, useTemplate = false) {
  const buffer = fs.readFileSync(file.path);
  if (isEmptyUploadBuffer(buffer)) {
    throw new Error('File is empty');
  }
  const projectName = projectDateTimeName();

  const project = await tms.createProject({
    name: projectName,
    sourceLang: run.sourceLang,
    targetLangs: run.targetLangs,
    mtUid: useTemplate ? undefined : mtUid,
  });
  const projectUid = project.uid || project.id;
  file._projectUid = projectUid;

  if (!useTemplate && mtUid && typeof tms.setProjectMtSettings === 'function') {
    const mtAttached = await tms.setProjectMtSettings({
      projectUid,
      targetLangs: run.targetLangs,
      mtUid,
    });
    const attached = mtAttached?.mtSettingsPerLangList || [];
    const hasEngine = attached.some(
      (row) => row?.machineTranslateSettings?.id || row?.machineTranslateSettings?.uid
    );
    if (!hasEngine) {
      console.warn('[pipeline] MT settings not attached to project', projectUid, mtUid);
    }
  }

  const jobResult = await tms.createJob({
    projectUid,
    fileBuffer: buffer,
    fileName: file.name,
    targetLangs: run.targetLangs,
  });

  const importAsyncId = jobResult?.asyncRequest?.id;
  if (importAsyncId && tms.waitAsync) {
    await tms.waitAsync(importAsyncId);
  }

  // Discover workflow steps from project (template usually has 3).
  let workflowLevels = [1];
  if (typeof tms.getProject === 'function') {
    try {
      const proj = await tms.getProject(projectUid);
      const steps = proj.workflowSteps || [];
      if (steps.length) {
        workflowLevels = [...new Set(steps.map((s) => Number(s.workflowLevel) || 1))].sort(
          (a, b) => a - b
        );
      }
    } catch (err) {
      console.warn('[pipeline] could not read workflow steps:', err.message);
    }
  }
  if (useTemplate && workflowLevels.length < 2) {
    workflowLevels = [1, 2, 3];
  }

  const base = path.parse(file.name).name;
  const ext = path.parse(file.name).ext || '';
  const saved = [];

  for (const level of workflowLevels) {
    let parts = await tms.listProjectJobs(projectUid, { workflowLevel: level });
    parts = (parts || [])
      .map((j) => ({ uid: j.uid || j.id, ...j }))
      .filter((j) => j.uid);
    if (!parts.length) {
      console.warn(`[pipeline] no jobs at workflow level ${level}`);
      continue;
    }

    const stepName =
      parts[0]?.workflowStep?.name ||
      parts[0]?.workflowStep?.abbreviation ||
      `Step ${level}`;
    const isLast = level === workflowLevels[workflowLevels.length - 1];
    const wf3MtId = config.tms.wf3MtId;

    // Step 1: project/template MT. Last step: AI Translation Agent when configured.
    if (isLast && useTemplate && wf3MtId) {
      if (typeof tms.setProjectMtEngine === 'function') {
        await tms.setProjectMtEngine(projectUid, wf3MtId);
      }
      const pre = await tms.preTranslate({
        projectUid,
        jobParts: parts,
        mtUid: wf3MtId,
        overwrite: true,
      });
      if (pre?.asyncRequest?.id && tms.waitAsync) await tms.waitAsync(pre.asyncRequest.id);
    } else {
      const needsPre = parts.some((p) => {
        const s = String(p.status || '').toUpperCase();
        return s !== 'COMPLETED' && s !== 'COMPLETED_BY_LINGUIST' && s !== 'DELIVERED';
      });
      if (needsPre) {
        const pre = await tms.preTranslate({
          projectUid,
          jobParts: parts,
          mtUid: useTemplate ? undefined : mtUid,
          useProjectSettings: useTemplate,
          overwrite: level > 1,
        });
        if (pre?.asyncRequest?.id && tms.waitAsync) await tms.waitAsync(pre.asyncRequest.id);
      }
    }

    for (const part of parts) {
      const lang = part.targetLang || 'xx';
      const downloaded = await tms.downloadTarget({
        projectUid,
        jobPartUid: part.uid,
        fileName: file.name,
      });
      if (!downloaded?.buffer?.length) {
        throw new Error(`Empty download at workflow step ${level}`);
      }
      const outName = `${base}_v${level}_${lang}${ext || path.parse(downloaded.fileName || '').ext || ''}`;
      const outPath = path.join(run.runDir, `${file.id}-${outName}`);
      fs.writeFileSync(outPath, downloaded.buffer);
      saved.push({
        id: uuidv4(),
        name: outName,
        path: outPath,
        step: level,
        stepName,
        lang,
      });
    }

    if (typeof tms.setJobsStatus === 'function') {
      await tms.setJobsStatus({ projectUid, jobParts: parts, status: 'COMPLETED' });
      // Brief pause so next workflow level picks up propagated content.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (!saved.length) {
    throw new Error('No workflow-step downloads produced');
  }

  file.downloads = saved;
  file.downloadPath = saved[0].path;
  file.downloadName = saved[0].name;
  file._extraDownloads = saved.slice(1).map((d) => ({ path: d.path, name: d.name }));
  file._jobParts = [];
}

module.exports = {
  createRun,
  getRun,
  getRunInternal,
  publicRun,
};
