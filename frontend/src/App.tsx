import { useEffect, useRef, useState } from "react";
import {
  downloadEncryptedFile,
  grantAccess,
  listFiles,
  login,
  register,
  uploadEncryptedFile,
  type FileMeta,
  type UserSession,
} from "./api";
import { decryptFile, encryptFile } from "./crypto";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [session, setSession] = useState<UserSession | null>(null);
  const [encryptionPassword, setEncryptionPassword] = useState("");
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [grantFileId, setGrantFileId] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pendingDownload, setPendingDownload] = useState<FileMeta | null>(null);
  const [sharedFilePassword, setSharedFilePassword] = useState("");
  const uploadingRef = useRef(false);

  useEffect(() => {
    if (!session) return;
    listFiles(session.token)
      .then(setFiles)
      .catch((e) => setError(String(e)));
  }, [session]);

  useEffect(() => {
    if (!status && !error) return;
    const timer = setTimeout(() => {
      setStatus("");
      setError("");
    }, 5000);
    return () => clearTimeout(timer);
  }, [status, error]);

  async function handleAuth() {
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const next =
        authMode === "login"
          ? await login(username, password)
          : await register(username, password);
      setSession(next);
      setEncryptionPassword(password);
      setStatus(
        authMode === "login"
          ? `Signed in as ${next.userId}`
          : `Account created. Welcome, ${next.userId}!`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function processUpload(file: File) {
    if (!session || uploadingRef.current) return;
    uploadingRef.current = true;
    setError("");
    setStatus(`Encrypting and uploading ${file.name}…`);
    setBusy(true);
    try {
      const ciphertext = await encryptFile(file, encryptionPassword);
      const meta = await uploadEncryptedFile(session.token, file.name, ciphertext);
      setFiles((prev) => [meta, ...prev]);
      setStatus(`${file.name} uploaded successfully`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      uploadingRef.current = false;
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await processUpload(file);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processUpload(file);
  }

  async function downloadWithPassword(file: FileMeta, filePassword: string) {
    if (!session) return;
    setError("");
    setStatus(`Decrypting ${file.name}…`);
    setBusy(true);
    try {
      const encrypted = await downloadEncryptedFile(session.token, file.id);
      const plaintext = await decryptFile(encrypted, filePassword);
      const blob = new Blob([plaintext]);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(`${file.name} downloaded`);
    } catch {
      setError(
        file.ownerId === session.userId
          ? "Could not decrypt this file. Make sure you're using the same password you signed up with."
          : "Could not decrypt this file. Ask the sender for the password they used when uploading."
      );
    } finally {
      setBusy(false);
    }
  }

  function handleDownload(file: FileMeta) {
    if (!session) return;
    const isShared = file.ownerId !== session.userId;
    if (isShared) {
      setPendingDownload(file);
      setSharedFilePassword("");
      return;
    }
    downloadWithPassword(file, encryptionPassword);
  }

  async function confirmSharedDownload() {
    if (!pendingDownload || !sharedFilePassword) return;
    const file = pendingDownload;
    setPendingDownload(null);
    await downloadWithPassword(file, sharedFilePassword);
    setSharedFilePassword("");
  }

  async function handleGrant() {
    if (!session || !grantFileId || !grantUserId) return;
    setError("");
    setBusy(true);
    try {
      await grantAccess(session.token, grantFileId, grantUserId);
      const fileName = files.find((f) => f.id === grantFileId)?.name ?? "File";
      setStatus(`Shared "${fileName}" with ${grantUserId}`);
      setGrantFileId("");
      setGrantUserId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyFileId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setStatus("File ID copied. Send it to the person you're sharing with.");
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  function handleSignOut() {
    setSession(null);
    setEncryptionPassword("");
    setFiles([]);
    setUsername("");
    setPassword("");
    setStatus("");
    setError("");
    setPendingDownload(null);
  }

  const initials = session?.userId.slice(0, 2) ?? "";
  const myFiles = files.filter((f) => f.ownerId === session?.userId);

  return (
    <div className="page">
      <div className="page__bg" />
      <div className="page__grid" />

      <div className={`page__content${session ? "" : " page__content--auth"}`}>
        {session ? (
          <header className="header">
            <div className="logo logo--app">
              <div className="logo__icon">
                <LockIcon />
              </div>
              <div>
                <div className="logo__text">SecureShare</div>
                <div className="logo__tag">Private file sharing</div>
              </div>
            </div>
            <div className="user-badge">
              <span className="user-badge__name">{session.userId}</span>
              <div className="user-badge__avatar">{initials}</div>
              <button className="btn btn--ghost btn--sm" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </header>
        ) : null}

        {!session ? (
          <div className="auth-portal">
            <div className="auth-portal__ring" aria-hidden="true" />
            <div className="auth-portal__ring auth-portal__ring--inner" aria-hidden="true" />

            <div className="auth-brand">
              <div className="auth-brand__icon">
                <LockIcon />
              </div>
              <h1 className="auth-brand__name">SecureShare</h1>
              <p className="auth-brand__tag">Private file sharing</p>
            </div>

            <div className="auth-panel">
              <p className="auth-panel__lead">
                Share files. <span>Keep them private.</span>
              </p>
              <p className="auth-panel__sub">
                Files lock on your device before upload. Only people you allow can
                download them.
              </p>

              <div className="auth-tabs">
                <button
                  type="button"
                  className={authMode === "login" ? "active" : ""}
                  onClick={() => setAuthMode("login")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={authMode === "register" ? "active" : ""}
                  onClick={() => setAuthMode("register")}
                >
                  Create account
                </button>
              </div>

              <div className="field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  placeholder="Username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                />
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  placeholder="Password"
                  autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                />
                <p className="field__hint">
                  This password locks and unlocks your files. If you forget it,
                  your files cannot be recovered.
                </p>
              </div>

              <button
                type="button"
                className="btn btn--primary btn--full"
                onClick={handleAuth}
                disabled={!username || !password || busy}
              >
                {busy && <span className="spinner" />}
                {authMode === "login" ? "Sign in" : "Create account"}
              </button>
            </div>

            <div className="auth-flow" aria-label="How it works">
              <div className="auth-flow__track" aria-hidden="true" />
              <div className="auth-flow__step">
                <span className="auth-flow__dot">1</span>
                <span className="auth-flow__label">Create account</span>
              </div>
              <div className="auth-flow__step">
                <span className="auth-flow__dot">2</span>
                <span className="auth-flow__label">Upload encrypted</span>
              </div>
              <div className="auth-flow__step">
                <span className="auth-flow__dot">3</span>
                <span className="auth-flow__label">Share access</span>
              </div>
            </div>

            <ul className="auth-trust">
              <li>
                <LockIcon />
                Browser-side encryption
              </li>
              <li>
                <UploadIcon />
                Username-based sharing
              </li>
              <li>
                <FileIcon />
                Scrambled server storage
              </li>
            </ul>
          </div>
        ) : (
          <div className="dashboard">
            <div className="card">
              <div className="card__header">
                <div>
                  <h2 className="card__title">How it works</h2>
                  <p className="card__desc">Three steps to share a file securely</p>
                </div>
              </div>
              <ol className="steps">
                <li className="step">
                  <div className="step__num">1</div>
                  <p className="step__title">Upload</p>
                  <p className="step__text">
                    Pick a file. It is encrypted with your password before uploading.
                  </p>
                </li>
                <li className="step">
                  <div className="step__num">2</div>
                  <p className="step__title">Share access</p>
                  <p className="step__text">
                    Enter their username below to let them download it
                  </p>
                </li>
                <li className="step">
                  <div className="step__num">3</div>
                  <p className="step__title">Send your password</p>
                  <p className="step__text">
                    Tell them your password separately (text, call, etc.) so they can unlock the file
                  </p>
                </li>
              </ol>
            </div>

            <div className="card dashboard__upload">
              <div className="card__header">
                <div>
                  <h2 className="card__title">Upload a file</h2>
                  <p className="card__desc">
                    Drag and drop or click to choose a file from your computer
                  </p>
                </div>
              </div>

              <label
                htmlFor="file-upload"
                className={`upload-zone${dragOver ? " drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <input
                  id="file-upload"
                  className="upload-zone__input"
                  type="file"
                  onChange={handleUpload}
                  disabled={busy}
                />
                <div className="upload-zone__icon">
                  <UploadIcon />
                </div>
                <div className="upload-zone__title">Choose a file or drag it here</div>
                <div className="upload-zone__sub">Any file type works</div>
                <span className="upload-zone__badge">
                  <LockIcon />
                  Encrypted before upload
                </span>
              </label>
            </div>

            <div className="card dashboard__files">
              <div className="card__header">
                <div>
                  <h2 className="card__title">Your files</h2>
                  <p className="card__desc">
                    {files.length === 0
                      ? "Uploaded files show up here"
                      : `${files.length} file${files.length === 1 ? "" : "s"}`}
                  </p>
                </div>
              </div>

              {files.length === 0 ? (
                <div className="empty-state">
                  <FileIcon />
                  <p>No files yet. Upload one above to get started.</p>
                </div>
              ) : (
                <div className="file-grid">
                  {files.map((file) => {
                    const isShared = file.ownerId !== session.userId;
                    return (
                      <div className="file-item" key={file.id}>
                        <div className="file-item__icon">
                          <FileIcon />
                        </div>
                        <div className="file-item__info">
                          <div className="file-item__name">{file.name}</div>
                          <div className="file-item__meta-row">
                            <span className="file-item__meta">
                              {formatBytes(file.size)}
                              {isShared && ` · Shared by ${file.ownerId}`}
                            </span>
                            {isShared && <span className="shared-badge">Shared with you</span>}
                            {!isShared && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--copy"
                                onClick={() => copyFileId(file.id)}
                              >
                                Copy file ID
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="file-item__actions">
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => handleDownload(file)}
                            disabled={busy}
                          >
                            <DownloadIcon />
                            Download
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card__header">
                <div>
                  <h2 className="card__title">Share a file with someone</h2>
                  <p className="card__desc">
                    They must already have a SecureShare account
                  </p>
                </div>
              </div>

              <div className="info-box">
                <strong>Important:</strong> After sharing, tell the other person your
                password separately (by text, call, etc.). They need it to open the file.
              </div>

              {myFiles.length === 0 ? (
                <p className="field__hint field__hint--flush">
                  Upload a file first, then you can share it here.
                </p>
              ) : (
                <div className="share-form">
                  <div className="field">
                    <label htmlFor="grantFile">Which file?</label>
                    <select
                      id="grantFile"
                      value={grantFileId}
                      onChange={(e) => setGrantFileId(e.target.value)}
                    >
                      <option value="">Select a file…</option>
                      {myFiles.map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="grantUser">Their username</label>
                    <input
                      id="grantUser"
                      type="text"
                      placeholder="Username"
                      value={grantUserId}
                      onChange={(e) => setGrantUserId(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleGrant}
                    disabled={!grantFileId || !grantUserId || busy}
                  >
                    Share file
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {pendingDownload && (
        <div className="modal-backdrop" onClick={() => setPendingDownload(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">Enter the sender&apos;s password</h3>
            <p className="modal__text">
              <strong>{pendingDownload.name}</strong> was encrypted by{" "}
              <strong>{pendingDownload.ownerId}</strong>. Ask them for the password
              they use on SecureShare, then enter it below.
            </p>
            <div className="field">
              <label htmlFor="sharedPassword">Sender&apos;s password</label>
              <input
                id="sharedPassword"
                type="password"
                placeholder="Password"
                value={sharedFilePassword}
                onChange={(e) => setSharedFilePassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmSharedDownload()}
                autoFocus
              />
            </div>
            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setPendingDownload(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={confirmSharedDownload}
                disabled={!sharedFilePassword || busy}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-container">
        {status && (
          <div className="toast toast--success">
            <CheckIcon />
            <span>{status}</span>
          </div>
        )}
        {error && (
          <div className="toast toast--error">
            <AlertIcon />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
