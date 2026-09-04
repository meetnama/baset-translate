import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function extOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

function checkUploadFiles(list, allowedExts) {
  const allowed = new Set((allowedExts || []).map((e) => String(e).toLowerCase()));
  const next = [];
  const skipped = [];
  for (const file of Array.from(list || [])) {
    const ext = extOf(file.name);
    const hasDot = String(file.name || '').includes('.');
    if (!file.size) skipped.push(`${file.name}: empty file`);
    else if (!hasDot || !ext) skipped.push(`${file.name}: missing file type`);
    else if (allowed.size && !allowed.has(ext)) skipped.push(`${file.name}: .${ext} is not supported`);
    else {
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        size: file.size,
        file,
      });
    }
  }
  return { next, skipped };
}

async function api(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  return res;
}

function BrandLogo({ className = 'logo' }) {
  return (
    <img
      src="/lingotrust-logo.png"
      alt="LingoTrust"
      className={className}
      width={300}
      height={59}
      decoding="async"
    />
  );
}

function useSmoothProgress(serverProgress, { active, done } = {}) {
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const serverRef = useRef(0);

  useEffect(() => {
    serverRef.current = Number(serverProgress) || 0;
  }, [serverProgress]);

  useEffect(() => {
    if (!active && !done) {
      displayRef.current = 0;
      setDisplay(0);
      return undefined;
    }

    let frame = 0;
    const tick = () => {
      const server = done ? 100 : serverRef.current;
      let cur = displayRef.current;
      let target;

      if (done) {
        target = 100;
      } else if (active) {
        if (cur < server - 0.5) {
          target = server;
        } else if (server < 100) {
          const creepCap = Math.min(96, server + (server === 0 ? 18 : 36));
          target = Math.max(server, Math.min(creepCap, cur + 0.2));
        } else {
          target = server;
        }
      } else {
        target = server;
      }

      const diff = target - cur;
      if (Math.abs(diff) <= 0.12) cur = target;
      else cur += diff * 0.06;

      if (done && cur >= 99.2) cur = 100;

      displayRef.current = cur;
      setDisplay(Math.round(cur));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, done]);

  return display;
}

function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t sign in.');
      onLoggedIn({ user: data.user, isAdmin: !!data.isAdmin });
    } catch (err) {
      setError(err.message || 'Couldn’t sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-shell">
        <aside className="login-aside" aria-hidden="true">
          <div>
            <BrandLogo />
            <h1>Translate</h1>
            <p>Upload a file. Get it translated. Download the result.</p>
          </div>
          <div className="login-aside-meta">
            <span>Multi-language</span>
            <span>Secure sign-in</span>
            <span>Download ready</span>
          </div>
        </aside>

        <div className="login-main">
          <section className="card login-card">
            <h2>Sign in</h2>
            <p className="sub">Use the username and password provided to you.</p>
            {error && <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>}
            <form className="login-form" onSubmit={submit}>
              <label className="field">
                <span>Username</span>
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                  required
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  required
                />
              </label>
              <div className="actions" style={{ marginTop: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={busy || !username || !password}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      <p className="footer-note">LingoTrust Translate</p>
    </div>
  );
}

function processIdFromUser(user) {
  if (!Array.isArray(user?.allowedCustomerIds)) return 'all';
  return user.allowedCustomerIds[0] || 'none';
}

function allowedIdsFromProcess(processId) {
  if (!processId || processId === 'all') return null;
  if (processId === 'none') return [];
  return [processId];
}

function processLabel(user, customers) {
  if (user.role === 'admin') return 'All processes';
  const id = processIdFromUser(user);
  if (id === 'all') return 'All processes';
  if (id === 'none') return 'No processes assigned';
  const c = customers.find((x) => x.id === id);
  if (c) return c.mode === 'workflow' ? `${c.name} (three-step)` : `${c.name} (one pass)`;
  return id;
}

function userSummaryLine(user, customers) {
  if (user.role === 'admin') return 'Admin · all processes · unlimited words';
  return `${processLabel(user, customers)} · ${quotaLabel(user)}`;
}

function UserEditorDialog({
  open,
  mode,
  user,
  customers,
  busy,
  onClose,
  onSave,
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [processId, setProcessId] = useState('all');
  const [wordQuota, setWordQuota] = useState('');

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && user) {
      setUsername(user.username);
      setPassword('');
      setRole(user.role);
      setProcessId(processIdFromUser(user));
      setWordQuota(user.wordQuota ?? '');
    } else {
      setUsername('');
      setPassword('');
      setRole('user');
      setProcessId('all');
      setWordQuota('');
    }
  }, [open, mode, user]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    onSave({
      username: username.trim(),
      password,
      role,
      processId,
      wordQuota: String(wordQuota).trim() ? Number(wordQuota) : null,
    });
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="user-editor-title">{mode === 'edit' ? `Edit ${user?.username || 'user'}` : 'Add user'}</h3>
        <form className="user-editor-form" onSubmit={submit}>
          <label className="field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy || mode === 'edit'}
              required
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>{mode === 'edit' ? 'New password (optional)' : 'Password'}</span>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required={mode === 'add'}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {role !== 'admin' && (
            <>
              <label className="field">
                <span>Process</span>
                <select value={processId} onChange={(e) => setProcessId(e.target.value)} disabled={busy}>
                  <option value="all">All processes</option>
                  <option value="none">No processes assigned</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.mode === 'workflow' ? 'three-step' : 'one pass'})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Word quota</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Unlimited"
                  value={wordQuota}
                  onChange={(e) => setWordQuota(e.target.value)}
                  disabled={busy}
                  autoComplete="off"
                />
              </label>
            </>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !username || (mode === 'add' && !password)}
            >
              {mode === 'edit' ? 'Save changes' : 'Add user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ManageUsers() {
  const [users, setUsers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState('add');
  const [editingUser, setEditingUser] = useState(null);

  const load = useCallback(async () => {
    const [usersRes, custRes] = await Promise.all([api('/api/users'), api('/api/customers')]);
    const usersData = await usersRes.json().catch(() => ({}));
    const custData = await custRes.json().catch(() => ({}));
    if (!usersRes.ok) throw new Error(usersData.error || 'Couldn’t load users.');
    if (!custRes.ok) throw new Error(custData.error || 'Couldn’t load customers.');
    setUsers(usersData.users || []);
    setCustomers(custData.customers || []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message || 'Couldn’t load users.'));
  }, [load]);

  const openAdd = () => {
    setEditingUser(null);
    setDialogMode('add');
    setDialogOpen(true);
    setError('');
  };

  const openEdit = (u) => {
    setEditingUser(u);
    setDialogMode('edit');
    setDialogOpen(true);
    setError('');
  };

  const closeDialog = () => {
    if (busy) return;
    setDialogOpen(false);
    setEditingUser(null);
  };

  const saveUser = async ({ username, password, role, processId, wordQuota }) => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (dialogMode === 'add') {
        const res = await api('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            password,
            role,
            allowedCustomerIds: role === 'admin' ? null : allowedIdsFromProcess(processId),
            wordQuota: role === 'admin' ? null : wordQuota,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Couldn’t add user.');
        setInfo(`Added ${data.username}.`);
      } else {
        const payload = {
          role,
          allowedCustomerIds: role === 'admin' ? null : allowedIdsFromProcess(processId),
          wordQuota: role === 'admin' ? null : wordQuota,
        };
        if (password) payload.password = password;
        const res = await api(`/api/users/${encodeURIComponent(editingUser.username)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Couldn’t update user.');
        setInfo(`Updated ${editingUser.username}.`);
      }
      setDialogOpen(false);
      setEditingUser(null);
      await load();
    } catch (err) {
      setError(err.message || 'Couldn’t save user.');
    } finally {
      setBusy(false);
    }
  };

  const removeUser = async (name) => {
    if (!window.confirm(`Remove user “${name}”?`)) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await api(`/api/users/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t remove user.');
      setInfo(`Removed ${name}.`);
      await load();
    } catch (err) {
      setError(err.message || 'Couldn’t remove user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head-row">
        <div>
          <h2>Manage users</h2>
          <p className="sub">Add accounts or edit role, process, and word quota in one place.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={openAdd}>
          Add user
        </button>
      </div>
      {error && <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>}
      {info && <p className="sub" style={{ color: 'var(--ok)', marginBottom: 14 }}>{info}</p>}

      <div className="files" style={{ marginTop: 8 }}>
        {users.map((u) => (
          <div key={u.username} className="file-row">
            <div className="file-ic">{u.role === 'admin' ? 'ADM' : 'USR'}</div>
            <div className="file-meta">
              <div className="nm">{u.username}</div>
              <div className="mt">{userSummaryLine(u, customers)}</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '8px 12px' }}
              disabled={busy}
              onClick={() => openEdit(u)}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '8px 12px' }}
              disabled={busy}
              onClick={() => removeUser(u.username)}
            >
              Remove
            </button>
          </div>
        ))}
        {!users.length && <p className="sub">No users yet.</p>}
      </div>

      <UserEditorDialog
        open={dialogOpen}
        mode={dialogMode}
        user={editingUser}
        customers={customers}
        busy={busy}
        onClose={closeDialog}
        onSave={saveUser}
      />
    </section>
  );
}

function quotaLabel(user) {
  if (user.role === 'admin' || user.wordQuota == null) return 'Unlimited words';
  const used = user.wordsUsed ?? 0;
  const left = user.wordsRemaining ?? Math.max(0, user.wordQuota - used);
  return `${used.toLocaleString()} / ${user.wordQuota.toLocaleString()} words · ${left.toLocaleString()} left`;
}

function ManageCustomers() {
  const empty = { name: '', hint: '', templateUid: '', mode: 'single' };
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = useCallback(async () => {
    const res = await api('/api/customers');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Couldn’t load customers.');
    setCustomers(data.customers || []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message || 'Couldn’t load customers.'));
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const url = editId ? `/api/customers/${encodeURIComponent(editId)}` : '/api/customers';
      const res = await api(url, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t save customer.');
      setForm(empty);
      setEditId('');
      setInfo(editId ? `Updated ${data.name}.` : `Added ${data.name}.`);
      await load();
    } catch (err) {
      setError(err.message || 'Couldn’t save customer.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (c) => {
    setEditId(c.id);
    setForm({
      name: c.name || '',
      hint: c.hint || '',
      templateUid: c.templateUid || '',
      mode: c.mode === 'workflow' ? 'workflow' : 'single',
    });
    setInfo('');
    setError('');
  };

  const removeCustomer = async (c) => {
    if (!window.confirm(`Remove customer “${c.name}”?`)) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await api(`/api/customers/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t remove customer.');
      if (editId === c.id) {
        setEditId('');
        setForm(empty);
      }
      setInfo(`Removed ${c.name}.`);
      await load();
    } catch (err) {
      setError(err.message || 'Couldn’t remove customer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Customers</h2>
      <p className="sub">
        Name shown on screen, plus which translation template to run. Set memory, terms, and writing rules in your translation setup first, then paste that template ID here.
      </p>
      {error && <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>}
      {info && <p className="sub" style={{ color: 'var(--ok)', marginBottom: 14 }}>{info}</p>}

      <form className="user-admin-form customer-admin-form" onSubmit={save}>
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            disabled={busy}
            required
          />
        </label>
        <label className="field">
          <span>Template ID</span>
          <input
            type="text"
            value={form.templateUid}
            onChange={(e) => setForm((p) => ({ ...p, templateUid: e.target.value }))}
            disabled={busy}
            required
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Process</span>
          <select
            value={form.mode}
            onChange={(e) => setForm((p) => ({ ...p, mode: e.target.value }))}
            disabled={busy}
          >
            <option value="single">One pass</option>
            <option value="workflow">Three-step</option>
          </select>
        </label>
        <div className="field user-admin-actions">
          <span>&nbsp;</span>
          <button type="submit" className="btn btn-primary" disabled={busy || !form.name || !form.templateUid}>
            {editId ? 'Save' : 'Add customer'}
          </button>
        </div>
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Short note (optional)</span>
          <input
            type="text"
            value={form.hint}
            onChange={(e) => setForm((p) => ({ ...p, hint: e.target.value }))}
            disabled={busy}
            placeholder="Shown under the customer name"
          />
        </label>
      </form>
      {editId && (
        <div className="actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => { setEditId(''); setForm(empty); }}
          >
            Cancel edit
          </button>
        </div>
      )}

      <div className="files" style={{ marginTop: 16 }}>
        {customers.map((c) => (
          <div className="file-row" key={c.id}>
            <div className="file-ic">{c.mode === 'workflow' ? '3S' : '1P'}</div>
            <div className="file-meta">
              <div className="nm">{c.name}</div>
              <div className="mt">{c.mode === 'workflow' ? 'Three-step' : 'One pass'} · template {c.templateUid}</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '8px 12px' }}
              disabled={busy}
              onClick={() => startEdit(c)}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '8px 12px' }}
              disabled={busy}
              onClick={() => removeCustomer(c)}
            >
              Remove
            </button>
          </div>
        ))}
        {!customers.length && <p className="sub">No customers yet.</p>}
      </div>
    </section>
  );
}

function formatStatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ManageWordStats() {
  const [summary, setSummary] = useState({ totals: { fileCount: 0, totalWords: 0, jobCount: 0 }, byDate: [] });
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = useCallback(async () => {
    const res = await api('/api/word-stats');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Couldn’t load word counts.');
    setSummary({
      totals: data.totals || { fileCount: 0, totalWords: 0, jobCount: 0 },
      byDate: data.byDate || [],
    });
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message || 'Couldn’t load word counts.'));
  }, [load]);

  const removePeriod = async () => {
    if (!fromDate || !toDate) {
      setError('Pick a start and end date.');
      return;
    }
    if (!window.confirm(`Delete word counts from ${fromDate} through ${toDate}?`)) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const q = `from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`;
      const res = await api(`/api/word-stats?${q}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t delete that period.');
      setSummary({
        totals: data.totals || { fileCount: 0, totalWords: 0, jobCount: 0 },
        byDate: data.byDate || [],
      });
      setInfo(`Removed ${data.removed || 0} record(s).`);
      setFromDate('');
      setToDate('');
    } catch (err) {
      setError(err.message || 'Couldn’t delete that period.');
    } finally {
      setBusy(false);
    }
  };

  const totals = summary.totals || { fileCount: 0, totalWords: 0, jobCount: 0 };

  return (
    <section className="card">
      <h2>Word counts</h2>
      <p className="sub">
        Totals from TMS analysis after each translate job — same numbers as Summary (files) and All → Words.
      </p>
      {error && <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>}
      {info && <div className="info-banner" style={{ marginBottom: 14 }}>{info}</div>}

      <div className="word-stats-totals">
        <div className="word-stat-pill">
          <span className="label">All time · files</span>
          <strong>{totals.fileCount.toLocaleString()}</strong>
        </div>
        <div className="word-stat-pill">
          <span className="label">All time · words</span>
          <strong>{totals.totalWords.toLocaleString()}</strong>
        </div>
        <div className="word-stat-pill">
          <span className="label">Jobs tracked</span>
          <strong>{totals.jobCount.toLocaleString()}</strong>
        </div>
      </div>

      <div className="word-stats-table-wrap">
        <table className="word-stats-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Summary (files)</th>
              <th>Words (All)</th>
            </tr>
          </thead>
          <tbody>
            {summary.byDate.map((row) => (
              <tr key={row.date}>
                <td>{formatStatDate(row.date)}</td>
                <td>{row.fileCount.toLocaleString()}</td>
                <td>{row.totalWords.toLocaleString()}</td>
              </tr>
            ))}
            {!summary.byDate.length && (
              <tr>
                <td colSpan={3} className="sub">No word counts yet. Run a translate job first.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="word-stats-delete">
        <h3>Delete a period</h3>
        <p className="sub">Remove stored counts for jobs created between two dates (inclusive).</p>
        <div className="word-stats-delete-form">
          <label className="field">
            <span>From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={busy} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={busy} />
          </label>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={removePeriod}>
            Delete period
          </button>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [meta, setMeta] = useState({
    languages: [],
    fileExtensions: [],
    maxUploadMb: 50,
    customers: [],
    setups: [],
    defaultCustomer: 'diaab',
    defaultSetup: 'diaab',
  });
  const [customerId, setCustomerId] = useState('diaab');
  const [metaError, setMetaError] = useState('');
  const [fileNote, setFileNote] = useState('');
  const [files, setFiles] = useState([]);
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLangs, setTargetLangs] = useState(['ar']);
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetQuery, setTargetQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const [wordQuota, setWordQuota] = useState(null);
  const inputRef = useRef(null);
  const pollRef = useRef(null);
  const targetDropRef = useRef(null);

  const signedIn = !authRequired || !!user;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api('/api/me');
        const data = await res.json();
        if (cancelled) return;
        setAuthRequired(!!data.authRequired);
        setUser(data.user || null);
        setIsAdmin(!!data.isAdmin);
        setWordQuota(data.wordQuota || null);
      } catch {
        if (!cancelled) setAuthRequired(false);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Local: keep server alive while this tab is open; stop it when the tab/window closes.
  // Grace on the server cancels exit if we come back quickly (refresh / React remount).
  useEffect(() => {
    const ping = () => {
      fetch('/api/heartbeat', { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, 3000);
    const onVis = () => {
      if (document.visibilityState === 'visible') ping();
    };
    document.addEventListener('visibilitychange', onVis);
    const shutdown = () => {
      try {
        navigator.sendBeacon('/api/shutdown');
      } catch {
        fetch('/api/shutdown', { method: 'POST', keepalive: true }).catch(() => {});
      }
    };
    window.addEventListener('pagehide', shutdown);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', shutdown);
    };
  }, []);

  const refreshQuota = useCallback(async () => {
    try {
      const res = await api('/api/me');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.wordQuota) setWordQuota(data.wordQuota);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return undefined;
    let cancelled = false;
    api('/api/meta')
      .then(async (r) => {
        const data = await r.json();
        if (r.status === 401) {
          setUser(null);
          setIsAdmin(false);
          throw new Error('Please sign in.');
        }
        if (data.error) throw new Error(data.error);
        if (cancelled) return;
        setMeta(data);
        if (data.wordQuota) setWordQuota(data.wordQuota);
        const list = data.customers || data.setups || [];
        const nextId = list.some((s) => s.id === (data.defaultCustomer || data.defaultSetup))
          ? (data.defaultCustomer || data.defaultSetup)
          : (list[0]?.id || 'diaab');
        setCustomerId(nextId);
        const codes = (data.languages || []).map((l) => l.code);
        const src = codes.includes('en') ? 'en' : (codes[0] || 'en');
        setSourceLang(src);
        if (codes.includes('ar') && 'ar' !== src) setTargetLangs(['ar']);
        else {
          const fallback = codes.find((c) => c !== src);
          setTargetLangs(fallback ? [fallback] : []);
        }
      })
      .catch(() => {
        if (!cancelled) setMetaError('Couldn’t load language list. Refresh the page.');
      });
    return () => { cancelled = true; };
  }, [signedIn, showAdmin]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    if (!targetOpen) return undefined;
    const onDoc = (e) => {
      if (targetDropRef.current && !targetDropRef.current.contains(e.target)) {
        setTargetOpen(false);
        setTargetQuery('');
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setTargetOpen(false);
        setTargetQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [targetOpen]);

  const accept = useMemo(
    () => (meta.fileExtensions || []).map((e) => `.${e}`).join(','),
    [meta.fileExtensions]
  );

  const previewFormats = useMemo(
    () => (meta.fileExtensions || []).slice(0, 8),
    [meta.fileExtensions]
  );

  const addFiles = useCallback((list) => {
    const { next, skipped } = checkUploadFiles(list, meta.fileExtensions);
    if (skipped.length) {
      setFileNote(`Skipped: ${skipped.join('; ')}`);
    } else {
      setFileNote('');
    }
    if (next.length) setFiles((prev) => [...prev, ...next]);
  }, [meta.fileExtensions]);

  const onDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag');
    if (busy) return;
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const quotaBlocked = wordQuota && !wordQuota.unlimited && wordQuota.exhausted;
  const quotaPct = wordQuota && !wordQuota.unlimited && wordQuota.limit
    ? Math.min(100, Math.round((wordQuota.used / wordQuota.limit) * 100))
    : 0;

  const startTranslate = async () => {
    if (!files.length || busy || quotaBlocked) return;
    const checked = checkUploadFiles(files.map((f) => f.file), meta.fileExtensions);
    if (checked.skipped.length) {
      setFileNote(`Fix these files first: ${checked.skipped.join('; ')}`);
      setFiles(checked.next);
      if (!checked.next.length) return;
    }
    const toSend = checked.next.length ? checked.next : files;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setBusy(true);
    setError('');
    setRun(null);
    try {
      const fd = new FormData();
      toSend.forEach((f) => fd.append('files', f.file));
      fd.append('sourceLang', sourceLang);
      fd.append('targetLangs', JSON.stringify(targetLangs));
      fd.append('setupId', customerId);
      fd.append('customerId', customerId);
      const res = await api('/api/translate', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.status === 401) {
        setUser(null);
        setIsAdmin(false);
        throw new Error('Please sign in.');
      }
      if (!res.ok) {
        if (data.wordQuota) setWordQuota(data.wordQuota);
        throw new Error(data.error || 'Couldn’t start translation.');
      }
      setRun(data);
      pollRef.current = setInterval(async () => {
        try {
          const s = await api(`/api/translate/${data.id}`);
          const body = await s.json();
          if (s.status === 401) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setBusy(false);
            setUser(null);
            setIsAdmin(false);
            return;
          }
          if (!s.ok) throw new Error(body.error || 'Status check failed');
          setRun(body);
          if (body.status === 'completed' || body.status === 'failed') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setBusy(false);
            refreshQuota();
          }
        } catch (err) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setBusy(false);
          setError(err.message || 'Something went wrong.');
        }
      }, 1200);
    } catch (err) {
      setBusy(false);
      setError(err.message || 'Something went wrong.');
    }
  };

  const startNewTranslate = () => {
    setFiles([]);
    setRun(null);
    setError('');
    setFileNote('');
    setBusy(false);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const logout = async () => {
    startNewTranslate();
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setUser(null);
    setIsAdmin(false);
    setShowAdmin(false);
  };

  const translating = busy || (run && run.status === 'processing') || (run && run.status === 'queued');
  const runInProgress = run && (run.status === 'queued' || run.status === 'processing');
  const runCompleted = run?.status === 'completed';
  const smoothProgress = useSmoothProgress(run?.progress, {
    active: !!runInProgress,
    done: runCompleted,
  });

  const targetOptions = useMemo(
    () => (meta.languages || []).filter((l) => l.code !== sourceLang),
    [meta.languages, sourceLang]
  );

  const filteredTargets = useMemo(() => {
    const q = targetQuery.trim().toLowerCase();
    if (!q) return targetOptions;
    return targetOptions.filter(
      (l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)
    );
  }, [targetOptions, targetQuery]);

  const targetSummary = useMemo(() => {
    if (!targetLangs.length) return 'Select languages…';
    const names = targetLangs
      .map((code) => targetOptions.find((l) => l.code === code)?.name || code);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }, [targetLangs, targetOptions]);

  const setSource = (code) => {
    setSourceLang(code);
    setTargetLangs((prev) => prev.filter((c) => c !== code));
    setTargetOpen(false);
    setTargetQuery('');
  };

  const toggleTarget = (code) => {
    setTargetLangs((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  if (!authReady) {
    return (
      <div className="loading-screen" aria-busy="true" aria-label="Loading">
        <div className="loading-skeleton">
          <div className="skel lg" />
          <div className="skel md" />
          <div className="skel sm" />
        </div>
      </div>
    );
  }

  if (authRequired && !user) {
    return (
      <LoginScreen
        onLoggedIn={({ user: u, isAdmin: admin }) => {
          setUser(u);
          setIsAdmin(!!admin);
          setMetaError('');
          setError('');
          api('/api/me')
            .then((r) => r.json())
            .then((data) => {
              if (data.wordQuota) setWordQuota(data.wordQuota);
            })
            .catch(() => {});
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <BrandLogo />
          <div>
            <h1>Translate</h1>
            <p>Upload a file. Get it translated. Download the result.</p>
          </div>
        </div>
        {authRequired && user && (
          <div className="auth-bar">
            <span className="auth-user">{user}{isAdmin ? ' · admin' : ''}</span>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '8px 12px' }}
                onClick={() => setShowAdmin((v) => !v)}
              >
                {showAdmin ? 'Back to translate' : 'Manage'}
              </button>
            )}
            <button type="button" className="btn btn-ghost" style={{ padding: '8px 12px' }} onClick={logout}>
              Sign out
            </button>
          </div>
        )}
      </header>

      {showAdmin && isAdmin ? (
        <>
          <ManageWordStats />
          <ManageCustomers />
          <ManageUsers />
        </>
      ) : (
        <>
      {(error || metaError || fileNote) && (
        <div className="error-banner">{error || metaError || fileNote}</div>
      )}

      {wordQuota && !wordQuota.unlimited && !isAdmin && (
        <section className="card quota-card">
          <h2>Word quota</h2>
          <p className="sub">
            {quotaBlocked
              ? 'You’ve used your word allowance. Contact admin for more.'
              : `${wordQuota.remaining.toLocaleString()} words left of ${wordQuota.limit.toLocaleString()}.`}
          </p>
          <div className="progress-wrap">
            <div className="progress-label">
              <span>Used</span>
              <span>{wordQuota.used.toLocaleString()} / {wordQuota.limit.toLocaleString()}</span>
            </div>
            <div className="progress-bar">
              <i className={quotaBlocked ? 'quota-full' : ''} style={{ width: `${quotaPct}%` }} />
            </div>
          </div>
        </section>
      )}

      {(meta.customers || meta.setups || []).length > 0 && (
        <section className="card">
          <h2>Customer</h2>
          <p className="sub">
            {(meta.customers || meta.setups || []).length === 1
              ? 'This account is set to one customer.'
              : 'Pick the customer for this job. Each one uses its own saved translations and writing rules.'}
          </p>
          <div className="setup-grid">
            {(meta.customers || meta.setups || []).map((s) => {
              const on = customerId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`setup-option${on ? ' on' : ''}`}
                  disabled={translating || (meta.customers || meta.setups || []).length === 1}
                  aria-pressed={on}
                  onClick={() => setCustomerId(s.id)}
                >
                  <strong>{s.name || s.label}</strong>
                  <span>{s.hint}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Languages</h2>
        <p className="sub">Pick the source language and one or more target languages.</p>
        <div className="row langs-row">
          <label className="field">
            <span>From</span>
            <select value={sourceLang} onChange={(e) => setSource(e.target.value)} disabled={translating}>
              {(meta.languages || []).map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </label>
          <div className="field" ref={targetDropRef}>
            <span>To{targetLangs.length ? ` · ${targetLangs.length} selected` : ''}</span>
            <div className={`multi-select${targetOpen ? ' open' : ''}${translating ? ' disabled' : ''}`}>
              <button
                type="button"
                className="multi-select-trigger"
                disabled={translating}
                aria-haspopup="listbox"
                aria-expanded={targetOpen}
                onClick={() => {
                  if (translating) return;
                  setTargetOpen((o) => !o);
                  if (targetOpen) setTargetQuery('');
                }}
              >
                <span className={targetLangs.length ? '' : 'placeholder'}>{targetSummary}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {targetOpen && (
                <div className="multi-select-panel" role="listbox" aria-multiselectable="true">
                  <input
                    className="multi-select-search"
                    type="search"
                    placeholder="Search languages…"
                    value={targetQuery}
                    autoFocus
                    onChange={(e) => setTargetQuery(e.target.value)}
                  />
                  <div className="multi-select-list">
                    {filteredTargets.map((l) => {
                      const checked = targetLangs.includes(l.code);
                      return (
                        <label key={l.code} className={`multi-select-option${checked ? ' on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTarget(l.code)}
                          />
                          <span>{l.name}</span>
                        </label>
                      );
                    })}
                    {!filteredTargets.length && (
                      <p className="lang-empty">No languages match.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Files</h2>
        <p className="sub">
          Supported formats match our translation engine
          {meta.maxUploadMb ? ` · up to ${meta.maxUploadMb} MB each` : ''}.
        </p>
        <div
          className="drop"
          onClick={() => !translating && inputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag'); }}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag'); }}
          onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag'); }}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept={accept}
            disabled={translating}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ margin: '0 auto', color: 'var(--brand)' }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M17 8l-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
          <h3>Drop files here or click to browse</h3>
          <p>Office, bilingual, localization, DTP, and subtitle files</p>
          <div className="formats">
            {previewFormats.map((f) => (
              <span className="fmt" key={f}>{f}</span>
            ))}
            {(meta.fileExtensions || []).length > previewFormats.length && (
              <span className="fmt">+more</span>
            )}
          </div>
        </div>

        {files.length > 0 && (
          <div className="files">
            {files.map((f) => (
              <div className="file-row" key={f.id}>
                <div className="file-ic">{extOf(f.name).slice(0, 4).toUpperCase()}</div>
                <div className="file-meta">
                  <div className="nm">{f.name}</div>
                  <div className="mt">{bytes(f.size)}</div>
                </div>
                {!translating && (
                  <button className="xbtn" type="button" aria-label="Remove" onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!files.length || translating || !targetLangs.length || quotaBlocked || !!(run && (run.status === 'completed' || run.status === 'failed'))}
            onClick={startTranslate}
          >
            {translating ? 'Translating…' : 'Translate'}
          </button>
        </div>
      </section>

      {run && (
        <section className="card">
          <h2>Progress</h2>
          <p className="sub">
            {run.status === 'completed'
              ? 'Done — download your files below.'
              : run.status === 'failed'
                ? 'Some files couldn’t be translated.'
                : 'Working on your files…'}
          </p>
          <div className="progress-wrap">
            <div className="progress-label">
              <span>{run.status === 'completed' ? 'Complete' : 'Translating'}</span>
              <span>{smoothProgress}%</span>
            </div>
            <div className="progress-bar"><i style={{ width: `${smoothProgress}%` }} /></div>
          </div>

          <div className="files" style={{ marginTop: 16 }}>
            {(run.files || []).map((f) => (
              <div key={f.id} style={{ marginBottom: 12 }}>
                <div className="file-row">
                  <div className="file-ic">{extOf(f.name).slice(0, 4).toUpperCase()}</div>
                  <div className="file-meta">
                    <div className="nm">{f.name}</div>
                    <div className="mt">
                      {f.error
                        || (run.singleStep
                          ? (f.downloadName || 'Ready')
                          : (f.downloads?.length
                            ? `${f.downloads.length} ${f.downloads.length === 1 ? 'file' : 'versions'}`
                            : f.downloadName || '—'))}
                    </div>
                  </div>
                  <span className={`status-pill ${f.status}`}>{f.status}</span>
                </div>
                {f.status === 'ready' && (f.downloads?.length > 1 && !run.singleStep ? (
                  <div className="files" style={{ marginTop: 8, marginLeft: 8 }}>
                    {f.downloads.map((d) => (
                      <div className="file-row" key={d.id}>
                        <div className="file-ic">W{d.step}</div>
                        <div className="file-meta">
                          <div className="nm">{d.name}</div>
                          <div className="mt">{d.stepName || `Step ${d.step}`}{d.lang ? ` · ${d.lang}` : ''}</div>
                        </div>
                        <a
                          className="btn btn-ghost"
                          style={{ padding: '8px 12px', textDecoration: 'none' }}
                          href={`/api/translate/${run.id}/files/${f.id}/download?downloadId=${encodeURIComponent(d.id)}`}
                        >
                          Download
                        </a>
                      </div>
                    ))}
                  </div>
                ) : f.status === 'ready' ? (
                  <div className="actions" style={{ marginTop: 8 }}>
                    <a className="btn btn-ghost" style={{ padding: '8px 12px', textDecoration: 'none' }} href={`/api/translate/${run.id}/files/${f.id}/download`}>
                      Download
                    </a>
                  </div>
                ) : null)}
              </div>
            ))}
          </div>

          <div className="actions" style={{ marginTop: 16 }}>
            {run.files?.some((f) => f.status === 'ready') &&
              (run.files.filter((f) => f.status === 'ready').reduce((n, f) => n + Math.max(f.downloads?.length || 0, 1), 0) > 1) && (
              <a className="btn btn-primary" style={{ textDecoration: 'none' }} href={`/api/translate/${run.id}/download-all`}>
                Download all
              </a>
            )}
            {(run.status === 'completed' || run.status === 'failed') && (
              <button type="button" className="btn btn-primary" onClick={startNewTranslate}>
                New translate
              </button>
            )}
          </div>
        </section>
      )}

        </>
      )}

      <p className="footer-note">LingoTrust Translate</p>
    </div>
  );
}
