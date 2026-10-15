import { useState } from "react";
import * as api from "./api";
import * as vault from "./crypto";
export default function App() {
  const [mode,setMode]=useState<"login"|"register">("login");
  const [username,setUsername]=useState(""); const [password,setPassword]=useState("");
  const [session,setSession]=useState<api.UserSession|null>(null);
  const [privateKey,setPrivateKey]=useState<CryptoKey|null>(null);
  const [files,setFiles]=useState<api.FileMeta[]>([]);
  const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [status,setStatus]=useState("");
  const [fileId,setFileId]=useState(""); const [recipient,setRecipient]=useState("");
  const [myFingerprint,setMyFingerprint]=useState(""); const [recipientFingerprint,setRecipientFingerprint]=useState("");
  const [verifiedKey,setVerifiedKey]=useState("");
  async function run(action:()=>Promise<void>) { if(busy)return; setBusy(true);setError("");setStatus("");try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);} }
  async function signIn() { await run(async()=>{
    if(mode==="register" && password.length<12) throw new Error("Choose a password of at least 12 characters.");
    const identity=mode==="register"?await vault.createIdentity(password):undefined;
    const next=await api.authenticate(mode,username,await vault.authPassword(username,password),identity);
    const key=await vault.unlockIdentity(next.encryptedPrivateKey,password);
    const entries=await api.listFiles(next.token);
    setPrivateKey(key);setSession(next);setFiles(entries);setPassword("");
    setMyFingerprint(await vault.fingerprint(next.publicKey));
  }); }
  async function upload(file:File) { await run(async()=>{
    if(!session)return;
    if(file.size>25*1024*1024)throw new Error("The MVP supports files up to 25 MiB.");
    const encrypted=await vault.encryptFile(file,session.publicKey);
    await api.uploadEncryptedFile(session.token,file.name,encrypted.ciphertext,encrypted.wrappedKey);
    setFiles(await api.listFiles(session.token));setStatus("File encrypted and uploaded.");
  }); }
  async function download(file:api.FileMeta) { await run(async()=>{
    if(!session||!privateKey)return;
    const data=await api.downloadEncryptedFile(session.token,file.id);
    const plaintext=await vault.decryptFile(data,file.wrappedKey,privateKey);
    const url=URL.createObjectURL(new Blob([plaintext]));const a=document.createElement("a");
    a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setStatus("File decrypted on your device.");
  }); }
  async function checkRecipient() { await run(async()=>{
    if(!session)return;
    const key=await api.publicKey(session.token,recipient);
    setVerifiedKey(key);setRecipientFingerprint(await vault.fingerprint(key));
  }); }
  async function share() { await run(async()=>{
    if(!session||!privateKey||!verifiedKey)return;
    const file=files.find(f=>f.id===fileId);if(!file)throw new Error("Choose a file.");
    const current=await api.publicKey(session.token,recipient);
    if(current!==verifiedKey)throw new Error("Recipient key changed. Verify the fingerprint again.");
    const key=await vault.unwrapFileKey(file.wrappedKey,privateKey);
    await api.grantAccess(session.token,fileId,recipient,await vault.wrapFileKey(key,verifiedKey));
    setStatus("Access granted. The recipient can refresh and download with their own account.");
  }); }
  const owned=files.filter(f=>f.ownerId===session?.userId);
  return <div className="page"><div className="page__bg"/><main className="page__content">
    <header className="header"><div><h1>SecureShare</h1><p>Encrypted on your device. Shared with people you choose.</p></div>
      {session&&<button className="btn btn--ghost" onClick={()=>{setSession(null);setPrivateKey(null);setFiles([]);setVerifiedKey("");setRecipientFingerprint("");setPassword("");setError("");setStatus("");}}>Sign out {session.userId}</button>}</header>
    {!session?<form className="card" onSubmit={e=>{e.preventDefault();void signIn();}}>
      <h2>{mode==="login"?"Sign in":"Create account"}</h2>
      <div className="field"><label htmlFor="username">Username</label><input id="username" autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" value={username} onChange={e=>setUsername(e.target.value)}/></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete={mode==="login"?"current-password":"new-password"} required minLength={mode==="register"?12:1} value={password} onChange={e=>setPassword(e.target.value)}/></div>
      <p className="field__hint">Your password protects your private key. There is no password recovery in this MVP.</p>
      <button className="btn btn--primary" disabled={busy}>{busy?"Opening your vault…":mode==="login"?"Sign in":"Create account"}</button>{" "}
      <button className="btn btn--ghost" type="button" disabled={busy} onClick={()=>setMode(mode==="login"?"register":"login")}>{mode==="login"?"Create account":"Back to sign in"}</button>
    </form>:<div className="dashboard">
      <section className="card dashboard__upload"><h2>Upload a file</h2><p>Up to 25 MiB. Each file gets its own random encryption key.</p>
        <label className="upload-zone" htmlFor="file-upload">Choose a file<input id="file-upload" type="file" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void upload(f);}}/></label></section>
      <section className="card dashboard__files"><div className="card__header"><h2>Your files</h2><button className="btn btn--ghost" disabled={busy} onClick={()=>void run(async()=>setFiles(await api.listFiles(session.token)))}>Refresh</button></div>
        {!files.length&&<p>No files yet. Upload a file or ask someone to share one with you.</p>}
        <div className="file-grid">{files.map(file=><article className="file-item" key={file.id}><div className="file-item__info"><strong>{file.name}</strong><p>{(file.size/1024).toFixed(1)} KiB encrypted · {file.ownerId===session.userId?"Owned by you":"Shared by "+file.ownerId}</p></div>
          <button className="btn btn--primary" disabled={busy} onClick={()=>void download(file)}>Download</button>
          {file.ownerId===session.userId&&<button className="btn btn--ghost" disabled={busy} onClick={()=>{if(window.confirm("Delete "+file.name+" and revoke all access?"))void run(async()=>{await api.deleteFile(session.token,file.id);setFiles(await api.listFiles(session.token));});}}>Delete</button>}</article>)}</div></section>
      <section className="card"><h2>Share or revoke access</h2><p>Recipients use their own account. Verify their key fingerprint with them before sharing.</p>
        <div className="field"><label htmlFor="share-file">File</label><select id="share-file" value={fileId} onChange={e=>setFileId(e.target.value)}><option value="">Choose an owned file</option>{owned.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
        <div className="field"><label htmlFor="recipient">Recipient username</label><input id="recipient" value={recipient} onChange={e=>{setRecipient(e.target.value);setVerifiedKey("");setRecipientFingerprint("");}}/></div>
        <button className="btn btn--ghost" disabled={busy||!recipient} onClick={()=>void checkRecipient()}>Look up recipient key</button>
        {recipientFingerprint&&<p style={{overflowWrap:"anywhere"}}>Recipient SHA-256 fingerprint: {recipientFingerprint}</p>}
        <button className="btn btn--primary" disabled={busy||!fileId||!verifiedKey} onClick={()=>void share()}>Fingerprint matches — share file</button>{" "}
        <button className="btn btn--ghost" disabled={busy||!fileId||!recipient} onClick={()=>void run(async()=>{await api.revokeAccess(session.token,fileId,recipient);setStatus("Access revoked for future downloads. Previously downloaded copies cannot be recalled.");})}>Revoke access</button>
      </section>
      <section className="card"><h2>Your key fingerprint</h2><p style={{overflowWrap:"anywhere"}}>{myFingerprint}</p><p>Send this fingerprint to people who want to share with you. Login passwords and private keys stay on your device.</p></section>
    </div>}
    <div role="status" aria-live="polite">{busy&&<p>Working…</p>}{status&&<p className="info-box">{status}</p>}</div>
    {error&&<p role="alert" className="info-box">Could not complete the operation: {error}</p>}
  </main></div>;
}
