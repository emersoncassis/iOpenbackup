// iOpenbackup Unified Dashboard Frontend Logic with Master Authentication

let currentStatus = null;
let pollTimer = null;
let logTimer = null;
let currentHostIp = '127.0.0.1';

document.addEventListener('DOMContentLoaded', () => {
  // Pre-set detected host immediately from browser URL
  const initialHost = getEffectiveHostIp(null);
  currentHostIp = initialHost;
  const ipBadge = document.getElementById('hostIpText');
  if (ipBadge) ipBadge.innerText = `IP: ${initialHost}`;
  const smbUrl = `smb://${initialHost}:4445`;
  const smbEl = document.getElementById('smbUrlText');
  if (smbEl) smbEl.innerText = smbUrl;
  const guideSmb = document.getElementById('guideSmbAddress');
  if (guideSmb) guideSmb.innerText = smbUrl;
  const stepSmb = document.getElementById('stepSmbUrl');
  if (stepSmb) stepSmb.innerText = smbUrl;
  const qrCap = document.getElementById('qrCaption');
  if (qrCap) qrCap.innerText = smbUrl;
  renderQRCode('qrCanvas', smbUrl);

  initTabs();
  initDialogFallback();
  initControls();
  
  // Check auth first
  checkAuthStatus();
});

// Check authentication state
async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();

    const overlay = document.getElementById('authOverlay');
    const appLayout = document.getElementById('mainAppLayout');
    const setupForm = document.getElementById('setupForm');
    const loginForm = document.getElementById('loginForm');
    const authTitle = document.getElementById('authTitle');
    const authSubtitle = document.getElementById('authSubtitle');
    const authError = document.getElementById('authErrorMsg');

    if (authError) authError.style.display = 'none';

    if (!data.initialized) {
      // First access setup
      overlay.style.display = 'flex';
      appLayout.style.display = 'none';
      setupForm.style.display = 'flex';
      loginForm.style.display = 'none';
      authTitle.innerText = 'Configuração do Primeiro Acesso (iOpDash)';
      authSubtitle.innerText = 'Defina a senha mestra do iOpDash para proteger a plataforma e o iCloud Sync Engine.';
      return;
    }

    if (!data.authenticated) {
      // Login required
      overlay.style.display = 'flex';
      appLayout.style.display = 'none';
      setupForm.style.display = 'none';
      loginForm.style.display = 'flex';
      authTitle.innerText = 'iOpDash — Orquestrador';
      authSubtitle.innerText = 'Acesso restrito. Digite suas credenciais para gerenciar a stack.';
      return;
    }

    // Authenticated!
    overlay.style.display = 'none';
    appLayout.style.display = 'block';
    document.getElementById('sessionUsername').innerText = data.username || 'admin';

    // Start data polling
    refreshAll();
    if (!pollTimer) {
      pollTimer = setInterval(fetchStatus, 4000);
    }
    if (!logTimer) {
      logTimer = setInterval(() => {
        const chk = document.getElementById('chkAutoRefresh');
        const logsTab = document.getElementById('tab-logs');
        if (chk && chk.checked && logsTab.classList.contains('active')) {
          fetchLogs();
        }
      }, 5000);
    }

  } catch (err) {
    console.error('Failed to check auth status:', err);
  }
}

// Handle Setup Submit (Primeiro Acesso)
async function handleSetupSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('setupUser').value.trim();
  const pass = document.getElementById('setupPass').value;
  const passConfirm = document.getElementById('setupPassConfirm').value;
  const errorEl = document.getElementById('authErrorMsg');

  if (pass !== passConfirm) {
    errorEl.innerText = 'As senhas informadas não coincidem.';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: pass })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Administrador configurado com sucesso! Plataforma protegida.', 'success');
      checkAuthStatus();
    } else {
      errorEl.innerText = data.error || 'Erro ao configurar administrador.';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.innerText = `Erro de conexão: ${err.message}`;
    errorEl.style.display = 'block';
  }
}

// Handle Login Submit
async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const errorEl = document.getElementById('authErrorMsg');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: pass })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Bem-vindo, ${username}!`, 'success');
      checkAuthStatus();
    } else {
      errorEl.innerText = data.error || 'Usuário ou senha incorretos.';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.innerText = `Erro de conexão: ${err.message}`;
    errorEl.style.display = 'block';
  }
}

// Handle Logout
async function handleLogout() {
  if (!confirm('Deseja realmente sair da Central?')) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    showToast('Sessão encerrada.', 'info');
    if (pollTimer) clearInterval(pollTimer);
    if (logTimer) clearInterval(logTimer);
    pollTimer = null;
    logTimer = null;
    checkAuthStatus();
  } catch (e) {
    console.error('Logout error:', e);
  }
}

// Tab Navigation
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      switchTab(targetId);
    });
  });
}

function switchTab(targetId) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const isTarget = b.getAttribute('data-tab') === targetId;
    b.classList.toggle('active', isTarget);
    b.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === targetId);
  });

  if (targetId === 'tab-logs') {
    fetchLogs();
  }
}

// Light-Dismiss Fallback for <dialog> as per modern-web-guidance
function initDialogFallback() {
  const dialog = document.getElementById('userDialog');
  if (dialog && !('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isInside = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );
      if (!isInside) dialog.close();
    });
  }
}

function initControls() {
  const btnRestartAll = document.getElementById('btnRestartAll');
  if (btnRestartAll) {
    btnRestartAll.addEventListener('click', () => {
      if (confirm('Deseja reiniciar toda a stack (iCloud, Immich e Samba)?')) {
        controlService('all', 'restart');
      }
    });
  }
}

// Refresh status and users
async function refreshAll() {
  await fetchStatus();
  await fetchUsers();
}

// Fetch Docker services status
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.status === 401) {
      checkAuthStatus();
      return;
    }
    const data = await res.json();
    if (!data.success) return;

    currentStatus = data;
    currentHostIp = getEffectiveHostIp(data);

    // Update IP badges and URLs
    updateNetworkInfo(data, currentHostIp);

    // Update Service Cards
    updateServiceCard('icloud', data.icloud);
    updateServiceCard('immich', data.immich);
    updateServiceCard('samba', data.samba);

    // Update Stats
    let onlineCount = 0;
    if (data.icloud?.running) onlineCount++;
    if (data.immich?.running) onlineCount++;
    if (data.samba?.running) onlineCount++;
    
    document.getElementById('statActiveServices').innerText = `${onlineCount}/3`;

    // Immich Subservices breakdown
    if (data.immich?.subservices) {
      updateSubserviceBadge('sub-server', data.immich.subservices.server?.running);
      updateSubserviceBadge('sub-ml', data.immich.subservices.ml?.running);
      updateSubserviceBadge('sub-db', data.immich.subservices.database?.running);
      updateSubserviceBadge('sub-redis', data.immich.subservices.redis?.running);
    }
  } catch (err) {
    console.error('Failed to poll status:', err);
  }
}

function updateSubserviceBadge(id, isRunning) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.toggle('sub-ok', !!isRunning);
  }
}

function getEffectiveHostIp(data) {
  const browserHost = window.location.hostname;
  const isBrowserValid = browserHost && browserHost !== 'localhost' && !browserHost.startsWith('127.');
  
  const apiIp = data?.network?.hostIp;
  const isApiInternal = !apiIp || apiIp.startsWith('172.') || apiIp.startsWith('127.') || apiIp === 'localhost';

  // Se o navegador está acessando por um IP real (ex: 192.168.15.81), esse é o IP acessível do host
  if (isBrowserValid) {
    return browserHost;
  }
  // Se o servidor retornou um IP que não é bridge docker interna
  if (apiIp && !isApiInternal) {
    return apiIp;
  }
  return browserHost || apiIp || '127.0.0.1';
}

function updateNetworkInfo(data, effectiveHost) {
  const hostIp = effectiveHost || getEffectiveHostIp(data);
  currentHostIp = hostIp;

  document.getElementById('hostIpText').innerText = `IP: ${hostIp}`;

  const smbUrl = `smb://${hostIp}:4445`;
  const smbUrlText = document.getElementById('smbUrlText');
  if (smbUrlText) smbUrlText.innerText = smbUrl;

  const guideSmb = document.getElementById('guideSmbAddress');
  if (guideSmb) guideSmb.innerText = smbUrl;

  const stepSmb = document.getElementById('stepSmbUrl');
  if (stepSmb) stepSmb.innerText = smbUrl;

  const qrCaption = document.getElementById('qrCaption');
  if (qrCaption) qrCaption.innerText = smbUrl;

  renderQRCode('qrCanvas', smbUrl);
}

function updateServiceCard(name, serviceData) {
  const pill = document.getElementById(`pill-${name}`);
  const statusText = document.getElementById(`statusText-${name}`);

  if (!serviceData || !serviceData.running) {
    if (pill) {
      pill.className = 'status-pill status-offline';
      pill.innerText = 'Offline';
    }
    if (statusText) statusText.innerText = serviceData?.text || 'Parado';
  } else {
    if (pill) {
      pill.className = 'status-pill status-online';
      pill.innerText = serviceData.health === 'healthy' ? 'Online (Saudável)' : 'Online';
    }
    if (statusText) statusText.innerText = serviceData.text || 'Em execução';
  }
}

// Service Controls (start, stop, restart)
async function controlService(service, action) {
  showToast(`Enviando comando: ${action} em ${service}...`, 'info');
  try {
    const res = await fetch(`/api/services/${service}/${action}`, { method: 'POST' });
    if (res.status === 401) {
      checkAuthStatus();
      return;
    }
    const data = await res.json();
    if (data.success) {
      showToast(`Serviço ${service} executou ${action} com sucesso!`, 'success');
      setTimeout(fetchStatus, 1500);
    } else {
      showToast(`Erro ao controlar ${service}: ${data.error || 'Falha'}`, 'error');
    }
  } catch (e) {
    showToast(`Erro de comunicação com o servidor: ${e.message}`, 'error');
  }
}

// Trigger manual iCloud Sync
async function triggerIcloudSync() {
  showToast('Iniciando ciclo de sincronização do iCloud...', 'info');
  try {
    const res = await fetch('/api/icloud/sync', { method: 'POST' });
    if (res.status === 401) {
      checkAuthStatus();
      return;
    }
    const data = await res.json();
    if (data.success) {
      showToast('Sincronização iniciada com sucesso!', 'success');
    } else {
      showToast('Não foi possível sincronizar o iCloud.', 'error');
    }
  } catch (e) {
    showToast(`Erro ao disparar sincronização: ${e.message}`, 'error');
  }
}

// Fetch Unified Users
async function fetchUsers() {
  try {
    const res = await fetch('/api/users');
    if (res.status === 401) {
      checkAuthStatus();
      return;
    }
    const data = await res.json();
    if (!data.success) return;

    renderUsersList(data.users || []);
    document.getElementById('statUsersCount').innerText = (data.users || []).length;
  } catch (e) {
    console.error('Failed to fetch users:', e);
  }
}

function renderUsersList(users) {
  const container = document.getElementById('usersList');
  if (!container) return;

  if (users.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 40px; text-align: center; color: var(--text-muted);">
        <p>Nenhum usuário alinhado cadastrado ainda.</p>
        <button class="btn btn-primary btn-sm mt-4" onclick="openUserModal()">Cadastrar Primeiro Usuário</button>
      </div>
    `;
    return;
  }

  container.innerHTML = users.map(u => {
    const initial = (u.name || 'U').charAt(0).toUpperCase();
    return `
      <div class="user-card" id="user-${u.id}">
        <div class="user-card-head">
          <div class="user-main-info">
            <div class="user-avatar">${initial}</div>
            <div class="user-name-wrap">
              <h3>${escapeHtml(u.name)}</h3>
              <span class="user-device-badge">${escapeHtml(u.device || 'iPhone')}</span>
            </div>
          </div>
          <div class="user-card-actions">
            <button class="btn btn-secondary btn-sm" onclick="triggerIcloudSync()">
              Sincronizar iCloud
            </button>
            <button class="btn btn-secondary btn-sm" onclick='editUser(${JSON.stringify(u)})'>
              Editar
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">
              Excluir
            </button>
          </div>
        </div>

        <!-- 3-Way Alignment Grid -->
        <div class="alignment-grid">
          <!-- 1. iCloud -->
          <div class="align-box">
            <span class="align-title icloud-t">Backup iCloud</span>
            <span class="align-val">${escapeHtml(u.icloud_email || 'Não configurado')}</span>
            <span class="align-sub">Sincroniza Fotos & Drive</span>
          </div>

          <!-- 2. Immich -->
          <div class="align-box">
            <span class="align-title immich-t">Galeria Immich</span>
            <span class="align-val">${escapeHtml(u.immich_email || u.icloud_email || 'Mesmo do iCloud')}</span>
            <span class="align-sub">Usuário: ${escapeHtml(u.immich_user || 'usuario')}</span>
          </div>

          <!-- 3. Samba -->
          <div class="align-box">
            <span class="align-title samba-t">Acesso Samba (SMB)</span>
            <span class="align-val">${escapeHtml(u.samba_user || 'usuario')}</span>
            <span class="align-sub">Pasta: ${escapeHtml(u.samba_share || 'iCloud-Backup')} (/shared)</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// User Modal Management
function openUserModal(user = null) {
  const dialog = document.getElementById('userDialog');
  const title = document.getElementById('dialogTitle');
  const form = document.getElementById('userForm');

  form.reset();
  if (user) {
    title.innerText = 'Editar Usuário Alinhado';
    document.getElementById('userId').value = user.id;
    document.getElementById('userName').value = user.name || '';
    document.getElementById('userDevice').value = user.device || '';
    document.getElementById('userIcloudEmail').value = user.icloud_email || '';
    document.getElementById('userImmichEmail').value = user.immich_email || '';
    document.getElementById('userImmichUser').value = user.immich_user || '';
    document.getElementById('userSambaUser').value = user.samba_user || '';
    document.getElementById('userSambaPass').value = user.samba_pass || '';
    document.getElementById('userSambaShare').value = user.samba_share || 'iCloud-Backup';
  } else {
    title.innerText = 'Alinhar Novo Usuário';
    document.getElementById('userId').value = '';
    document.getElementById('userSambaShare').value = 'iCloud-Backup';
  }

  dialog.showModal();
}

function closeUserModal() {
  const dialog = document.getElementById('userDialog');
  dialog.close();
}

function editUser(user) {
  openUserModal(user);
}

async function handleUserSubmit(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const payload = Object.fromEntries(formData.entries());

  payload.apply_to_icloud = document.getElementById('userApplyIcloud').checked;

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.status === 401) {
      checkAuthStatus();
      return;
    }
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Usuário salvo com sucesso!', 'success');
      closeUserModal();
      fetchUsers();
    } else {
      showToast(`Erro ao salvar: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro na requisição: ${err.message}`, 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('Tem certeza que deseja remover este usuário alinhado?')) return;
  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (res.status === 401) {
      checkAuthStatus();
      return;
    }
    const data = await res.json();
    if (data.success) {
      showToast('Usuário removido com sucesso!', 'success');
      fetchUsers();
    } else {
      showToast(`Erro ao excluir: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast(`Erro: ${e.message}`, 'error');
  }
}

// Fetch Logs
async function fetchLogs() {
  const select = document.getElementById('selectLogContainer');
  const container = select.value;
  const terminal = document.getElementById('terminalLogs');

  try {
    const res = await fetch(`/api/logs/${container}`);
    if (res.status === 401) {
      checkAuthStatus();
      return;
    }
    const data = await res.json();
    if (data.success) {
      terminal.innerText = data.logs || 'Nenhum log disponível.';
      terminal.scrollTop = terminal.scrollHeight;
    } else {
      terminal.innerText = `Erro ao carregar logs: ${data.error}`;
    }
  } catch (e) {
    terminal.innerText = `Erro de conexão: ${e.message}`;
  }
}

// Clipboard Helper
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copiado para a área de transferência!', 'success');
  }).catch(() => {
    showToast('Falha ao copiar automaticamente.', 'error');
  });
}

function copySmbUrl() {
  const text = `smb://${currentHostIp}:4445`;
  copyText(text);
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Lightweight Stylized QR-Code Generator Canvas
function renderQRCode(canvasId, text) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Pseudo-random deterministic matrix based on text hash
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }

  const cells = 21;
  const cellSize = size / cells;

  ctx.fillStyle = '#0f172a';

  // Corner markers (Finder patterns)
  function drawFinderPattern(row, col) {
    ctx.fillRect(col * cellSize, row * cellSize, 7 * cellSize, 7 * cellSize);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect((col + 1) * cellSize, (row + 1) * cellSize, 5 * cellSize, 5 * cellSize);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect((col + 2) * cellSize, (row + 2) * cellSize, 3 * cellSize, 3 * cellSize);
  }

  drawFinderPattern(0, 0);
  drawFinderPattern(0, cells - 7);
  drawFinderPattern(cells - 7, 0);

  // Grid data filling
  let prng = Math.abs(hash);
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if ((r < 8 && c < 8) || (r < 8 && c >= cells - 8) || (r >= cells - 8 && c < 8)) {
        continue;
      }
      prng = (prng * 9301 + 49297) % 233280;
      if (prng / 233280 > 0.52) {
        ctx.fillRect(c * cellSize + 0.5, r * cellSize + 0.5, cellSize - 1, cellSize - 1);
      }
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
