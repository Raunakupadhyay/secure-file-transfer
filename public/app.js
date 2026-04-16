'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   CONFIGURATION
───────────────────────────────────────────────────────────────────────────── */
const CHUNK_SIZE   = 192 * 1024;   // 192 KB → ~256 KB base64 (under 8 MB limit)
const KDF_ITERS    = 100_000;

/* ─────────────────────────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────────────────────────── */
const socket       = io();
let currentView    = 'home';
let senderPass     = '';
let receiverPass   = '';
let pendingFiles   = [];            // File objects queued for sending
let receivedFiles  = {};            // name → { meta, chunks[], received }
let roomCode       = null;

/* ─────────────────────────────────────────────────────────────────────────────
   VIEW MANAGEMENT
───────────────────────────────────────────────────────────────────────────── */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  currentView = id;
}

function showStep(viewId, stepId) {
  document.querySelectorAll(`#view-${viewId} .step`).forEach(s => s.classList.add('hidden'));
  const el = document.getElementById(stepId);
  if (el) el.classList.remove('hidden');
}

function goHome() {
  pendingFiles  = [];
  receivedFiles = {};
  roomCode      = null;
  showView('home');
}

/* ─────────────────────────────────────────────────────────────────────────────
   CRYPTO UTILITIES  (Web Crypto API — AES-256-GCM with PBKDF2)
───────────────────────────────────────────────────────────────────────────── */
async function deriveKey(password, saltBytes) {
  const raw = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: KDF_ITERS, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(buffer, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(password, salt);
  const enc  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer);
  return { encrypted: new Uint8Array(enc), salt, iv };
}

async function decryptData(encBytes, password, saltB64, ivB64) {
  const salt = b64ToArr(saltB64);
  const iv   = b64ToArr(ivB64);
  const key  = await deriveKey(password, salt);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encBytes);
}

/* ─────────────────────────────────────────────────────────────────────────────
   GENERAL UTILITIES
───────────────────────────────────────────────────────────────────────────── */
function arrToB64(arr) {
  const bytes = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
  let str = '';
  for (let i = 0; i < bytes.length; i += 1024) {
    str += String.fromCharCode(...bytes.subarray(i, i + 1024));
  }
  return btoa(str);
}

function b64ToArr(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function fmtSize(bytes) {
  if (bytes < 1024)         return bytes + ' B';
  if (bytes < 1048576)      return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824)   return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function safeId(name) { return name.replace(/[^a-z0-9]/gi, '_'); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const m = { pdf:'📄', doc:'📝', docx:'📝', txt:'📃', xls:'📊', xlsx:'📊',
               jpg:'🖼', jpeg:'🖼', png:'🖼', gif:'🖼', webp:'🖼', svg:'🖼',
               mp4:'🎬', mkv:'🎬', mov:'🎬', avi:'🎬', webm:'🎬',
               mp3:'🎵', wav:'🎵', flac:'🎵', ogg:'🎵',
               zip:'📦', rar:'📦', '7z':'📦', tar:'📦', gz:'📦',
               exe:'⚙️', msi:'⚙️', dmg:'💿',
               js:'📜', py:'📜', java:'📜', html:'📜', css:'📜', ts:'📜' };
  return m[ext] || '📎';
}

function getMimeType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const m = { pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg',
               png:'image/png', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml',
               txt:'text/plain', html:'text/html', css:'text/css', js:'text/javascript',
               mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime',
               mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg',
               zip:'application/zip' };
  return m[ext] || 'application/octet-stream';
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = '⚠ ' + msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 7000);
}

function hideError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function setProgress(barId, pct) {
  const el = document.getElementById(barId);
  if (el) el.style.width = Math.min(100, pct) + '%';
}

function setStatus(statusId, text, color) {
  const el = document.getElementById(statusId);
  if (!el) return;
  el.textContent = text;
  el.style.color = color || '';
}

function readFileAsBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   SENDER — UI
───────────────────────────────────────────────────────────────────────────── */
function initSender() {
  pendingFiles = [];
  showStep('sender', 'sender-s1');
  renderFileQueue();
  hideError('sender-s1-error');

  // Attach file input listener (only once)
  const fi = document.getElementById('file-input');
  fi.value = '';
  fi.onchange = e => addFiles([...e.target.files]);

  // Drop zone
  const dz = document.getElementById('drop-zone');
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag-over'); };
  dz.ondragleave = ()  => dz.classList.remove('drag-over');
  dz.ondrop = e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    addFiles([...e.dataTransfer.files]);
  };

  // Button listeners
  document.getElementById('btn-create-session').onclick = createSession;
  document.getElementById('btn-send-files').onclick      = startSend;
  document.getElementById('btn-sender-new').onclick      = resetSender;
  document.getElementById('sender-back').onclick         = goHome;
}

function addFiles(files) {
  files.forEach(f => {
    if (f.size === 0) return;
    if (!pendingFiles.some(p => p.name === f.name && p.size === f.size)) {
      pendingFiles.push(f);
    }
  });
  renderFileQueue();
  const sendBtn = document.getElementById('btn-send-files');
  if (sendBtn) sendBtn.disabled = pendingFiles.length === 0;
}

window.removeFile = function(idx) {
  pendingFiles.splice(idx, 1);
  renderFileQueue();
  const sendBtn = document.getElementById('btn-send-files');
  if (sendBtn) sendBtn.disabled = pendingFiles.length === 0;
};

function renderFileQueue() {
  const list = document.getElementById('sender-file-list');
  if (!list) return;
  if (pendingFiles.length === 0) { list.innerHTML = ''; return; }
  list.innerHTML = pendingFiles.map((f, i) => `
    <div class="file-item">
      <span class="file-item-icon">${fileIcon(f.name)}</span>
      <span class="file-item-name" title="${f.name}">${f.name}</span>
      <span class="file-item-size">${fmtSize(f.size)}</span>
      <button class="remove-btn" onclick="removeFile(${i})" title="Remove">✕</button>
    </div>
  `).join('');
}

async function createSession() {
  senderPass = document.getElementById('sender-pass').value.trim();
  if (!senderPass) { showError('sender-s1-error', 'Please enter a password.'); return; }

  const btn = document.getElementById('btn-create-session');
  btn.disabled = true; btn.textContent = 'Creating…';

  socket.emit('create-room', (res) => {
    if (res.error) {
      showError('sender-s1-error', res.error);
      btn.disabled = false; btn.textContent = 'Create Session';
      return;
    }
    roomCode = res.code;
    document.getElementById('display-code').textContent = res.code;
    btn.disabled = false; btn.textContent = 'Create Session';
    showStep('sender', 'sender-s2');
  });
}

window.copyCode = function() {
  if (!roomCode) return;
  navigator.clipboard.writeText(roomCode).then(() => {
    const btn = document.getElementById('copy-btn');
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy', 2000);
  });
};

async function startSend() {
  if (pendingFiles.length === 0) return;

  showStep('sender', 'sender-s4');
  const list = document.getElementById('sender-progress-list');
  list.innerHTML = '';

  pendingFiles.forEach(f => {
    const id = safeId(f.name);
    list.insertAdjacentHTML('beforeend', `
      <div class="transfer-item">
        <div class="transfer-header">
          <span>${fileIcon(f.name)} ${f.name}</span>
          <span class="transfer-size">${fmtSize(f.size)}</span>
        </div>
        <div class="progress-bar-wrap"><div class="progress-bar" id="sbar-${id}"></div></div>
        <div class="transfer-status" id="sstatus-${id}">Preparing…</div>
      </div>
    `);
  });

  for (const file of pendingFiles) {
    try {
      await sendFile(file);
    } catch (err) {
      setStatus('sstatus-' + safeId(file.name), '✘ ' + (err.message || 'Error'), '#ef4444');
    }
  }

  socket.emit('transfer-complete');
  await sleep(600);
  showStep('sender', 'sender-s5');
}

async function sendFile(file) {
  const id = safeId(file.name);
  setStatus('sstatus-' + id, 'Reading…');

  const buffer = await readFileAsBuffer(file);
  setStatus('sstatus-' + id, 'Encrypting…');

  const { encrypted, salt, iv } = await encryptData(buffer, senderPass);
  const totalChunks = Math.ceil(encrypted.length / CHUNK_SIZE);

  socket.emit('file-start', {
    name: file.name,
    originalSize: file.size,
    totalChunks,
    salt: arrToB64(salt),
    iv:   arrToB64(iv)
  });

  setStatus('sstatus-' + id, 'Sending…');

  for (let i = 0; i < totalChunks; i++) {
    const chunk = encrypted.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);

    // Use acknowledgement for natural flow control
    await new Promise(resolve => {
      socket.emit('file-chunk', { name: file.name, index: i, data: arrToB64(chunk) }, resolve);
    });

    const pct = Math.round(((i + 1) / totalChunks) * 100);
    setProgress('sbar-' + id, pct);
    setStatus('sstatus-' + id, `Sending… ${pct}%`);
    if (i % 5 === 4) await sleep(5); // occasional yield
  }

  socket.emit('file-done', { name: file.name });
  setProgress('sbar-' + id, 100);
  setStatus('sstatus-' + id, '✔ Sent', '#34d399');
}

function resetSender() {
  pendingFiles = [];
  senderPass   = '';
  roomCode     = null;
  document.getElementById('sender-pass').value = '';
  showStep('sender', 'sender-s1');
  renderFileQueue();
}

/* ─────────────────────────────────────────────────────────────────────────────
   RECEIVER — UI
───────────────────────────────────────────────────────────────────────────── */
function initReceiver() {
  receivedFiles = {};
  showStep('receiver', 'receiver-s1');
  hideError('receiver-s1-error');
  document.getElementById('receiver-code').value = '';
  document.getElementById('receiver-pass').value = '';

  // Auto-format code input
  document.getElementById('receiver-code').oninput = e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  };

  document.getElementById('btn-join-session').onclick = joinSession;
  document.getElementById('receiver-back').onclick    = goHome;
}

async function joinSession() {
  const code = document.getElementById('receiver-code').value.trim().toUpperCase();
  receiverPass = document.getElementById('receiver-pass').value.trim();

  if (code.length !== 6)  return showError('receiver-s1-error', 'Session code must be 6 characters.');
  if (!receiverPass)      return showError('receiver-s1-error', 'Please enter the decryption password.');

  const btn = document.getElementById('btn-join-session');
  btn.disabled = true; btn.textContent = 'Joining…';

  socket.emit('join-room', code, (res) => {
    btn.disabled = false; btn.textContent = 'Join Session';
    if (res.error) { showError('receiver-s1-error', res.error); return; }
    showStep('receiver', 'receiver-s2');
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   RECEIVER — FILE EVENTS
───────────────────────────────────────────────────────────────────────────── */
socket.on('file-start', (meta) => {
  receivedFiles[meta.name] = {
    meta,
    chunks:   new Array(meta.totalChunks).fill(null),
    received: 0
  };

  showStep('receiver', 'receiver-s3');
  const list = document.getElementById('receiver-file-list');
  const id   = safeId(meta.name);

  list.insertAdjacentHTML('beforeend', `
    <div class="transfer-item">
      <div class="transfer-header">
        <span>${fileIcon(meta.name)} ${meta.name}</span>
        <span class="transfer-size">${fmtSize(meta.originalSize)}</span>
      </div>
      <div class="progress-bar-wrap"><div class="progress-bar" id="rbar-${id}"></div></div>
      <div class="transfer-status" id="rstatus-${id}">Receiving…</div>
    </div>
  `);
});

socket.on('file-chunk', ({ name, index, data }) => {
  const entry = receivedFiles[name];
  if (!entry) return;
  entry.chunks[index] = b64ToArr(data);
  entry.received++;
  const pct = Math.round((entry.received / entry.meta.totalChunks) * 100);
  setProgress('rbar-' + safeId(name), pct);
  setStatus('rstatus-' + safeId(name), `Receiving… ${pct}%`);
});

socket.on('file-done', async ({ name }) => {
  const entry = receivedFiles[name];
  if (!entry) return;

  setStatus('rstatus-' + safeId(name), 'Decrypting…');

  // Reassemble
  const totalLen = entry.chunks.reduce((s, c) => s + (c ? c.length : 0), 0);
  const full = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of entry.chunks) {
    if (chunk) { full.set(chunk, offset); offset += chunk.length; }
  }

  // Decrypt
  try {
    const plain = await decryptData(full, receiverPass, entry.meta.salt, entry.meta.iv);
    const blob  = new Blob([plain], { type: getMimeType(name) });
    const url   = URL.createObjectURL(blob);
    setProgress('rbar-' + safeId(name), 100);
    const statusEl = document.getElementById('rstatus-' + safeId(name));
    if (statusEl) {
      statusEl.style.color = '#34d399';
      statusEl.innerHTML = `✔ Received!&nbsp;
        <a href="${url}" download="${name}" class="download-link">⬇ Download ${name}</a>`;
    }
  } catch {
    setStatus('rstatus-' + safeId(name), '✘ Decryption failed — wrong password?', '#ef4444');
  }
});

socket.on('transfer-complete', () => {
  const list = document.getElementById('receiver-file-list');
  if (list) {
    list.insertAdjacentHTML('beforeend', '<div class="complete-banner">✅ All files received!</div>');
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   SOCKET — PEER / CONNECTION EVENTS
───────────────────────────────────────────────────────────────────────────── */
socket.on('receiver-joined', () => {
  // Sender: advance to file-drop step
  showStep('sender', 'sender-s3');
  document.getElementById('sender-s2-status').textContent = 'Receiver joined!';
  renderFileQueue();
  const sendBtn = document.getElementById('btn-send-files');
  if (sendBtn) sendBtn.disabled = pendingFiles.length === 0;
});

socket.on('peer-disconnected', () => {
  const msg = currentView === 'sender'
    ? 'The receiver disconnected. Transfer cancelled.'
    : 'The sender disconnected. Transfer ended.';
  alert('⚠ ' + msg);
  goHome();
});

socket.on('connect_error', () => {
  console.warn('Socket connection error — retrying…');
});

/* ─────────────────────────────────────────────────────────────────────────────
   EYE TOGGLE (password visibility)
───────────────────────────────────────────────────────────────────────────── */
document.querySelectorAll('.eye-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁' : '🙈';
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   ENTRY POINTS (home card clicks)
───────────────────────────────────────────────────────────────────────────── */
document.getElementById('btn-go-send').addEventListener('click', () => {
  showView('sender');
  initSender();
});

document.getElementById('btn-go-receive').addEventListener('click', () => {
  showView('receiver');
  initReceiver();
});

// Expose helpers used by inline HTML attributes
window.goHome    = goHome;
window.copyCode  = copyCode;
