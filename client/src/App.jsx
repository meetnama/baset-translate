import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function extOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

async function api(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  return res;
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
    <div className="app login-screen">
      <header className="top">
        <div className="brand">
          <div className="logo">L</div>
          <div>
            <h1>Locaitra Translate</h1>
            <p>Sign in to continue.</p>
          </div>
        </div>
      </header>

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

      <p className="footer-note">Locaitra Translate</p>
    </div>
  );
}

function ManageUsers() {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = useCallback(async () => {
    const res = await api('/api/users');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Couldn’t load users.');
    setUsers(data.users || []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message || 'Couldn’t load users.'));
  }, [load]);

  const addUser = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await api('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t add user.');
      setUsername('');
      setPassword('');
      setRole('user');
      setInfo(`Added ${data.username}.`);
      await load();
    } catch (err) {
      setError(err.message || 'Couldn’t add user.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (name) => {
    const next = window.prompt(`New password for ${name}`);
    if (next == null) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await api(`/api/users/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t update password.');
      setInfo(`Password updated for ${name}.`);
    } catch (err) {
      setError(err.message || 'Couldn’t update password.');
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
      <h2>Manage users</h2>
      <p className="sub">Add accounts, reset passwords, or remove access.</p>
      {error && <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>}
      {info && <p className="sub" style={{ color: 'var(--ok)', marginBottom: 14 }}>{info}</p>}

      <form className="user-admin-form" onSubmit={addUser}>
        <label className="field">
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            required
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
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
        <div className="field user-admin-actions">
          <span>&nbsp;</span>
          <button type="submit" className="btn btn-primary" disabled={busy || !username || !password}>
            Add user
          </button>
        </div>
      </form>

      <div className="files" style={{ marginTop: 16 }}>
        {users.map((u) => (
          <div className="file-row" key={u.username}>
            <div className="file-ic">{u.role === 'admin' ? 'ADM' : 'USR'}</div>
            <div className="file-meta">
              <div className="nm">{u.username}</div>
              <div className="mt">{u.role === 'admin' ? 'Admin' : 'User'}</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '8px 12px' }}
              disabled={busy}
              onClick={() => resetPassword(u.username)}
            >
              Reset password
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
    </section>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [meta, setMeta] = useState({ languages: [], fileExtensions: [], maxUploadMb: 50 });
  const [metaError, setMetaError] = useState('');
  const [files, setFiles] = useState([]);
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLangs, setTargetLangs] = useState(['ar']);
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetQuery, setTargetQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
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
      } catch {
        if (!cancelled) setAuthRequired(false);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
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
  }, [signedIn]);

  // Keep server alive while this tab is open; shut it down when the tab/browser closes.
  useEffect(() => {
    if (!signedIn) return undefined;
    const ping = () => {
      api('/api/heartbeat', { method: 'POST', keepalive: true }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, 4000);
    const shutdown = () => {
      try {
        navigator.sendBeacon('/api/shutdown');
      } catch {
        api('/api/shutdown', { method: 'POST', keepalive: true }).catch(() => {});
      }
    };
    window.addEventListener('pagehide', shutdown);
    window.addEventListener('beforeunload', shutdown);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', shutdown);
      window.removeEventListener('beforeunload', shutdown);
    };
  }, [signedIn]);

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
    const next = Array.from(list).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      file,
    }));
    setFiles((prev) => [...prev, ...next]);
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag');
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const startTranslate = async () => {
    if (!files.length || busy) return;
    setBusy(true);
    setError('');
    setRun(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f.file));
      fd.append('sourceLang', sourceLang);
      fd.append('targetLangs', JSON.stringify(targetLangs));
      const res = await api('/api/translate', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.status === 401) {
        setUser(null);
        setIsAdmin(false);
        throw new Error('Please sign in.');
      }
      if (!res.ok) throw new Error(data.error || 'Couldn’t start translation.');
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

  const clearAll = () => {
    setFiles([]);
    setRun(null);
    setError('');
    setBusy(false);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const logout = async () => {
    clearAll();
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setUser(null);
    setIsAdmin(false);
    setShowUsers(false);
  };

  const translating = busy || (run && run.status === 'processing') || (run && run.status === 'queued');

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
      <div className="app">
        <p className="footer-note" style={{ marginTop: 48 }}>Loading…</p>
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
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="logo">L</div>
          <div>
            <h1>Locaitra Translate</h1>
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
                onClick={() => setShowUsers((v) => !v)}
              >
                {showUsers ? 'Hide users' : 'Manage users'}
              </button>
            )}
            <button type="button" className="btn btn-ghost" style={{ padding: '8px 12px' }} onClick={logout}>
              Sign out
            </button>
          </div>
        )}
      </header>

      {showUsers && isAdmin ? (
        <ManageUsers />
      ) : (
        <>
      {(error || metaError) && (
        <div className="error-banner">{error || metaError}</div>
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
          {files.length > 0 && !translating && (
            <button type="button" className="btn btn-ghost" onClick={clearAll}>Clear</button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!files.length || translating || !targetLangs.length}
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
              <span>{run.progress ?? 0}%</span>
            </div>
            <div className="progress-bar"><i style={{ width: `${run.progress ?? 0}%` }} /></div>
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
                        || (f.downloads?.length
                          ? `${f.downloads.length} workflow versions`
                          : f.downloadName || '—')}
                    </div>
                  </div>
                  <span className={`status-pill ${f.status}`}>{f.status}</span>
                </div>
                {f.status === 'ready' && (f.downloads?.length ? (
                  <div className="files" style={{ marginTop: 8, marginLeft: 8 }}>
                    {f.downloads.map((d) => (
                      <div className="file-row" key={d.id}>
                        <div className="file-ic">W{d.step}</div>
                        <div className="file-meta">
                          <div className="nm">{d.name}</div>
                          <div className="mt">{d.stepName || `Workflow step ${d.step}`}{d.lang ? ` · ${d.lang}` : ''}</div>
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
                ) : (
                  <div className="actions" style={{ marginTop: 8 }}>
                    <a className="btn btn-ghost" style={{ padding: '8px 12px', textDecoration: 'none' }} href={`/api/translate/${run.id}/files/${f.id}/download`}>
                      Download
                    </a>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {run.files?.some((f) => f.status === 'ready') && (
            <div className="actions">
              <a className="btn btn-primary" style={{ textDecoration: 'none' }} href={`/api/translate/${run.id}/download-all`}>
                Download all
              </a>
            </div>
          )}
        </section>
      )}

        </>
      )}

      <p className="footer-note">Locaitra Translate</p>
    </div>
  );
}
