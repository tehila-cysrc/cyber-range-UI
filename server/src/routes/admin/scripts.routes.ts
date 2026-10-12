import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { can } from '../../authz/permissions.js';
import { createScript, deleteScript, getScript, listScripts, updateScript, type ScriptType } from '../../services/scriptExecution.service.js';

const router = Router();

router.use(requireAuth);

const VALID_SCRIPT_TYPES: ScriptType[] = ['powershell', 'bash'];

// The instructor-authored reusable Script Library — see config.sql's `scripts` table for why this is
// a global CONFIG catalog, not scoped to one cyber range.
// Instructors may run library scripts (Admin-authored) but never read their content, and don't see
// which other scenarios use a script as an ATT&CK trigger (that names those scenarios' answer key).
router.get('/scripts', requirePermission('script.read'), (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const scripts = listScripts({ category, search });
  res.json({ scripts: can(req.user!.role, 'script.write') ? scripts : scripts.map(({ usedAsTrigger: _u, ...rest }) => rest) });
});

router.post('/scripts', requirePermission('script.write'), (req, res) => {
  const { name, description, content, scriptType, category } = req.body ?? {};

  if (typeof name !== 'string' || !name.trim() || typeof content !== 'string' || !content.trim() || !VALID_SCRIPT_TYPES.includes(scriptType)) {
    res.status(400).json({ error: `name, content, and scriptType ('powershell'|'bash') are required` });
    return;
  }

  const script = createScript(
    {
      name: name.trim(),
      description: typeof description === 'string' && description.trim() ? description.trim() : null,
      content,
      scriptType,
      category: typeof category === 'string' && category.trim() ? category.trim() : null,
    },
    req.user!.username,
  );
  res.status(201).json({ script });
});

router.get('/scripts/:id', requirePermission('script.read'), (req, res) => {
  const script = getScript(Number(req.params.id));
  if (!script) {
    res.status(404).json({ error: 'script not found' });
    return;
  }
  if (!can(req.user!.role, 'script.write')) {
    const { content: _content, ...summary } = script;
    res.json({ script: summary });
    return;
  }
  res.json({ script });
});

router.patch('/scripts/:id', requirePermission('script.write'), (req, res) => {
  const { name, description, content, scriptType, category } = req.body ?? {};

  if (scriptType !== undefined && !VALID_SCRIPT_TYPES.includes(scriptType)) {
    res.status(400).json({ error: `scriptType must be 'powershell' or 'bash'` });
    return;
  }

  const script = updateScript(
    Number(req.params.id),
    {
      name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
      description: description !== undefined ? (typeof description === 'string' && description.trim() ? description.trim() : null) : undefined,
      content: typeof content === 'string' && content.trim() ? content : undefined,
      scriptType,
      category: category !== undefined ? (typeof category === 'string' && category.trim() ? category.trim() : null) : undefined,
    },
    req.user!.username,
  );

  if (!script) {
    res.status(404).json({ error: 'script not found' });
    return;
  }
  res.json({ script });
});

router.delete('/scripts/:id', requirePermission('script.write'), (req, res) => {
  const ok = deleteScript(Number(req.params.id), req.user!.username);
  if (!ok) {
    res.status(404).json({ error: 'script not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
