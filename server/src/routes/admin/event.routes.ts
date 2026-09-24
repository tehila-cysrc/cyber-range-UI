import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getActiveEventRunId,
  createFreshEventRun,
  DEFAULT_INSTRUCTOR_USERNAME,
  DEFAULT_INSTRUCTOR_PASSWORD,
} from '../../db/seed.js';
import { endActiveSessions, revokeAllShareableLinks, setRemoteAccessFrozen, type EnvironmentRevocation } from '../../services/accessBroker/accessBroker.service.js';
import { writeAudit } from '../../services/audit.service.js';
import { buildEventExport, buildEventExportCsv } from '../../services/eventExport.service.js';

const router = Router();
// Public (token-less) job-status route — mounted separately in app.ts at /api/event-reset-jobs, since
// every router under /api/admin applies requireAuth to all requests that pass through it.
export const resetJobsPublicRouter = Router();

const CONFIRMATION_PHRASE = 'RESET EVENT';

// How long the reset job waits out a busy Bastion host. Every link create/delete leaves the host in
// "Updating" for a while, and after a burst (a whole class connecting) that was observed live to last
// 8+ minutes — far past an HTTP request's lifetime, hence a background job instead of a long request.
const RESET_BUSY_BUDGET_MS = 15 * 60_000;

interface RemoteAccessResult {
  ok: boolean;
  environments: EnvironmentRevocation[];
}

interface ResetJob {
  id: string;
  state: 'running' | 'refused' | 'done' | 'failed';
  phase: string;
  startedAt: string;
  finishedAt: string | null;
  endedSessions: number;
  remoteAccess: RemoteAccessResult | null;
  error: string | null;
  newInstructor: { username: string; password: string } | null;
}

// In-memory on purpose: the destructive step (the wipe) is the LAST thing a job does, so a server
// restart mid-job simply loses the job with nothing wiped — the instructor starts it again.
const jobs = new Map<string, ResetJob>();
let runningJobId: string | null = null;

// Wipes every RUN table (teams, users, auth_tokens, progress, documentation, scores, help_requests,
// access_sessions) by deleting the active event_runs row — ON DELETE CASCADE does the rest — then
// creates a fresh empty run with one instructor account (registration closed). CONFIG tables are never
// touched; see CLAUDE/invariants.md.
//
// Remote access comes first: the cascade removes access_sessions rows but can't touch Azure, and a
// previous cohort's student already saw the VM credential ("Show"), so any surviving Bastion shareable
// link would be a working way back into the range. The job ends every active session, revokes EVERY
// link on every registered environment's VMs, and re-reads Bastion to verify none is left. If that
// can't be verified, NOTHING is wiped (state 'refused') unless the instructor explicitly started the
// job with `allowUnverifiedRemoteAccess: true` — a deliberate, audited override, never silent.
async function runResetJob(job: ResetJob, actor: string, allowUnverifiedRemoteAccess: boolean) {
  setRemoteAccessFrozen(true);
  try {
    job.phase = 'Ending active remote sessions';
    job.endedSessions = endActiveSessions({ all: true, skipLinkCleanup: true }, 'force_closed', actor, 'event_reset');

    job.phase = 'Revoking and verifying Azure Bastion links (waits for Bastion to finish earlier operations)';
    const remoteAccess = await revokeAllShareableLinks({ busyBudgetMs: RESET_BUSY_BUDGET_MS });
    job.remoteAccess = remoteAccess;
    writeAudit(actor, 'event.remote_access_revoked', 'event_run', getActiveEventRunId(), {
      endedSessions: job.endedSessions,
      verified: remoteAccess.ok,
      environments: remoteAccess.environments.map((e) => ({ id: e.environmentId, vms: e.vmCount, remaining: e.remaining, error: e.error })),
    });

    if (!remoteAccess.ok && !allowUnverifiedRemoteAccess) {
      job.state = 'refused';
      job.phase = 'Not reset — remote access could not be verified as revoked';
      return;
    }

    job.phase = 'Wiping the event';
    const activeRunId = getActiveEventRunId();
    db.exec('BEGIN');
    let newRunId: number;
    try {
      if (activeRunId !== null) db.prepare('DELETE FROM event_runs WHERE id = ?').run(activeRunId);
      newRunId = createFreshEventRun();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    if (!remoteAccess.ok) {
      writeAudit(actor, 'event.reset_with_unverified_remote_access', 'event_run', newRunId, {
        remaining: remoteAccess.environments.flatMap((e) => e.remaining),
      });
    }
    job.newInstructor = { username: DEFAULT_INSTRUCTOR_USERNAME, password: DEFAULT_INSTRUCTOR_PASSWORD };
    job.state = 'done';
    job.phase = 'Event reset complete';
  } catch (err) {
    console.error('[event-reset] job failed:', (err as Error).message);
    job.state = 'failed';
    job.error = 'the reset failed unexpectedly — nothing after the last completed step was changed; try again';
  } finally {
    job.finishedAt = new Date().toISOString();
    runningJobId = null;
    setRemoteAccessFrozen(false);
  }
}

// Job status by its unguessable id. Deliberately NOT behind requireAuth: the reset deletes the very
// instructor account (and token) that started it, so the page must still be able to read the outcome
// afterwards. It exposes only job progress plus the fixed, documented default instructor login.
resetJobsPublicRouter.get('/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'unknown reset job' });
    return;
  }
  res.json({ job });
});

router.use(requireAuth, requireRole('instructor'));

// Results archive to keep before a reset wipes the RUN tables (UX audit UX-05). ?format=csv gives a
// one-row-per-team×scenario summary; default is the full JSON (timelines, canvas, scores).
router.get('/event/export', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cyber-range-results-${stamp}.csv"`);
    // BOM so Excel opens UTF-8 (Hebrew names, em dashes) correctly.
    res.send('﻿' + buildEventExportCsv());
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="cyber-range-results-${stamp}.json"`);
  res.json(buildEventExport());
});

router.post('/event/reset', (req, res) => {
  const { confirm, allowUnverifiedRemoteAccess } = req.body ?? {};
  if (confirm !== CONFIRMATION_PHRASE) {
    res.status(400).json({ error: `confirm must be exactly "${CONFIRMATION_PHRASE}"` });
    return;
  }
  if (runningJobId) {
    res.status(409).json({ error: 'an event reset is already in progress', jobId: runningJobId });
    return;
  }

  const job: ResetJob = {
    id: crypto.randomBytes(16).toString('hex'),
    state: 'running',
    phase: 'Starting',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    endedSessions: 0,
    remoteAccess: null,
    error: null,
    newInstructor: null,
  };
  jobs.set(job.id, job);
  runningJobId = job.id;
  void runResetJob(job, req.user!.username, allowUnverifiedRemoteAccess === true);
  res.status(202).json({ jobId: job.id });
});

// Instructor can re-run the revoke on its own at any time (e.g. before handing the range to a new
// group) — same code path as the reset job's first step, with the normal interactive budget.
router.post('/remote-access/revoke-all', async (req, res) => {
  const endedSessions = endActiveSessions({ all: true, skipLinkCleanup: true }, 'force_closed', req.user!.username, 'manual_revoke_all');
  const remoteAccess = await revokeAllShareableLinks();
  writeAudit(req.user!.username, 'event.remote_access_revoked', 'event_run', getActiveEventRunId(), {
    endedSessions,
    verified: remoteAccess.ok,
    manual: true,
  });
  res.status(remoteAccess.ok ? 200 : 502).json({ ok: remoteAccess.ok, endedSessions, remoteAccess });
});

export default router;
