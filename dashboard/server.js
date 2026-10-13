const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT = process.env.PORT || 8000;
const HOST_PORT = process.env.HOST_PORT || PORT;
const ICLOUD_HOST = process.env.ICLOUD_HOST || (fs.existsSync('/.dockerenv') ? 'icloud' : '127.0.0.1');
const ICLOUD_PORT = process.env.ICLOUD_PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SAMBA_CONF_FILE = path.join(DATA_DIR, 'samba_users.conf');
const CONFIG_YAML_FILE = process.env.CONFIG_FILE_PATH || (fs.existsSync('/config/config.yaml') ? '/config/config.yaml' : path.join(__dirname, '..', 'config', 'config.yaml'));
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Garante que o arquivo de configuração do iCloud exista e tenha permissões adequadas
function ensureConfigFile() {
  const configDir = '/config';
  const targetConfig = path.join(configDir, 'config.yaml');
  const bundledExample = path.join(__dirname, '..', 'config', 'config.example.yaml');
  const bundledConfig = path.join(__dirname, '..', 'config', 'config.yaml');

  try {
    if (fs.existsSync(configDir)) {
      try { fs.chmodSync(configDir, 0o777); } catch (_) {}

      let created = false;
      if (!fs.existsSync(targetConfig)) {
        console.log('[iOpDash] /config/config.yaml não encontrado. Provisionando modelo inicial...');
        const src = fs.existsSync(bundledConfig) ? bundledConfig : bundledExample;
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, targetConfig);
          console.log(`[iOpDash] Criado ${targetConfig} com sucesso!`);
          created = true;
        }
      }

      if (fs.existsSync(targetConfig)) {
        try { fs.chmodSync(targetConfig, 0o666); } catch (_) {}
      }

      if (created) {
        runCmd('docker restart icloud').then(() => {
          console.log('[iOpDash] Container icloud reiniciado após provisionar config.yaml.');
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[iOpDash] Erro ao garantir config.yaml:', err.message);
  }
}
ensureConfigFile();

// In-memory active sessions: token -> { username, expiresAt }
const activeSessions = new Map();

// Helper to hash passwords using PBKDF2 (SHA-512)
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const verify = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return verify === hash;
}

function getStoredAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading auth.json:', e);
  }
  return null;
}

function saveStoredAuth(authData) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2), 'utf8');
}

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies['srv_session'] || (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }
  return session;
}

function isAuthenticated(req) {
  return !!getSession(req);
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
  activeSessions.set(token, { username, expiresAt });
  return token;
}

// Shell command helper
function runCmd(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: 20000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: error.message, stdout: stdout || '', stderr: stderr || '', code: error.code });
      } else {
        resolve({ error: null, stdout: stdout.trim(), stderr: stderr.trim(), code: 0 });
      }
    });
  });
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (!iface.address.startsWith('169.254.') && !iface.address.startsWith('127.')) {
          return iface.address;
        }
      }
    }
  }
  return '127.0.0.1';
}

function getHostIP(req = null) {
  if (process.env.HOST_IP) {
    return process.env.HOST_IP;
  }
  if (req && req.headers) {
    const forwarded = req.headers['x-forwarded-host'] || req.headers['x-forwarded-for'];
    const hostHeader = (forwarded || req.headers.host || '').split(',')[0].trim();
    if (hostHeader) {
      const cleanHost = hostHeader.replace(/:\d+$/, '').trim();
      if (cleanHost && cleanHost !== 'localhost' && !cleanHost.startsWith('127.')) {
        return cleanHost;
      }
    }
  }
  return getLocalIP();
}

function getUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading users.json:', e);
  }
  return [];
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  const lines = ['# Gerado automaticamente pelo iOpDash - Orquestrador iOpenbackup'];
  users.forEach((u, idx) => {
    const uid = 1000 + idx;
    const user = u.samba_user || 'user';
    const pass = u.samba_pass || 'secret';
    lines.push(`${user}:${uid}:smb:1000:${pass}:/shared`);
  });
  fs.writeFileSync(SAMBA_CONF_FILE, lines.join('\n') + '\n', 'utf8');
}

function evaluateHardware() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const totalMemGB = +(totalMem / (1024 ** 3)).toFixed(1);
  const freeMemGB = +(freeMem / (1024 ** 3)).toFixed(1);
  const cpuCores = os.cpus()?.length || 1;

  // IA Pesada do Immich (CLIP + Face recognition) consome ~1.5GB a 2GB de RAM
  // Recomendamos mínimo de 3.8GB (4GB) de RAM total e 0.8GB de RAM livre
  const isSupported = totalMemGB >= 3.8;
  const isHealthyFree = freeMemGB >= 0.8;
  const canEnableAi = isSupported && isHealthyFree;

  let message = '';
  if (!isSupported) {
    message = `Hardware limitado (${totalMemGB}GB RAM). IA desabilitada para evitar travamento do servidor.`;
  } else if (!isHealthyFree) {
    message = `RAM livre baixa (${freeMemGB}GB de ${totalMemGB}GB). Risco de sobrecarga ao carregar IA.`;
  } else {
    message = `Hardware apto (${totalMemGB}GB RAM, ${cpuCores} núcleos). Suporta IA.`;
  }

  return {
    totalMemGB,
    freeMemGB,
    totalMemMB: Math.round(totalMem / (1024 ** 2)),
    freeMemMB: Math.round(freeMem / (1024 ** 2)),
    cpuCores,
    canEnableAi,
    isSupported,
    message
  };
}

async function getDockerStatus(req = null) {
  const res = await runCmd('docker ps -a --format "{{json .}}"');
  const containers = [];
  if (res.stdout) {
    const lines = res.stdout.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        containers.push(JSON.parse(line));
      } catch (err) {}
    }
  }

  const findContainer = (name) => {
    return containers.find(c => (c.Names || '').includes(name)) || null;
  };

  const hostIp = getHostIP(req);
  const hardware = evaluateHardware();
  const icloudCont = findContainer('icloud');
  const immichServer = findContainer('immich_server');
  const immichMl = findContainer('immich_machine_learning');
  const immichDb = findContainer('immich_postgres');
  const immichRedis = findContainer('immich_redis');
  const sambaCont = findContainer('samba');

  const parseState = (c) => {
    if (!c) return { status: 'offline', running: false, text: 'Parado / Não criado', health: 'none' };
    const isRunning = c.State === 'running';
    return {
      status: isRunning ? 'online' : 'offline',
      running: isRunning,
      text: c.Status || (isRunning ? 'Em execução' : 'Parado'),
      health: c.HealthStatus || 'none',
      id: c.ID,
      created: c.CreatedAt
    };
  };

  return {
    orchestrator: {
      name: 'iOpDash',
      role: 'Módulo Orquestrador Central & Gateway de Autenticação',
      version: '1.0.0',
      status: 'online',
      running: true,
      port: HOST_PORT,
      url: `http://${hostIp}:${HOST_PORT}`
    },
    icloud: {
      name: 'iCloud Sync',
      container: 'icloud',
      ...parseState(icloudCont),
      port: 8080,
      url: `/icloud-proxy/`,
      authUrl: `/icloud-proxy/auth`,
      protected: true,
      description: 'Sincronizador contínuo do iCloud Drive e Fotos (Protegido por Senha)'
    },
    immich: {
      name: 'Immich Photos & AI',
      container: 'immich_server',
      ...parseState(immichServer),
      port: 2283,
      url: `http://${hostIp}:2283`,
      localUrl: 'http://localhost:2283',
      subservices: {
        server: parseState(immichServer),
        ml: parseState(immichMl),
        database: parseState(immichDb),
        redis: parseState(immichRedis)
      },
      aiModule: {
        running: !!(immichMl && immichMl.State === 'running'),
        supported: hardware.canEnableAi,
        reason: hardware.message
      },
      description: 'Galeria inteligente de fotos com linha do tempo e IA sob demanda'
    },
    hardware,
    samba: {
      name: 'Samba SMB (iPhone Files)',
      container: 'samba',
      ...parseState(sambaCont),
      port: 4445,
      smbUrl: `smb://${hostIp}:4445`,
      shareName: 'iCloud-Backup',
      description: 'Servidor de arquivos SMB para conexão nativa do app Arquivos do iOS'
    },
    network: {
      hostIp: hostIp,
      hostname: os.hostname(),
      ports: {
        dashboard: HOST_PORT,
        icloudProxy: HOST_PORT,
        immich: 2283,
        samba: 4445
      }
    },
    system: {
      platform: os.platform(),
      release: os.release(),
      uptime: Math.floor(os.uptime()),
      totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMB: Math.round(os.freemem() / 1024 / 1024)
    }
  };
}

// Reverse Proxy for iCloud Sync Engine (Protected by iOpDash Auth)
function proxyToIcloud(req, res, targetPath, search) {
  const headers = { ...req.headers };
  headers['host'] = `${ICLOUD_HOST}:${ICLOUD_PORT}`;

  const options = {
    hostname: ICLOUD_HOST,
    port: ICLOUD_PORT,
    path: targetPath + (search || ''),
    method: req.method,
    headers: headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="refresh" content="5">
        <title>iCloud Sync Engine - Conectando...</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #090d16;
            color: #f1f5f9;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
          }
          .card {
            background: #111827;
            border: 1px solid #1f2937;
            border-radius: 16px;
            max-width: 540px;
            width: 100%;
            padding: 32px;
            box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
            text-align: center;
          }
          .icon-spin {
            width: 48px;
            height: 48px;
            border: 4px solid #1e293b;
            border-top-color: #38bdf8;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          h2 { font-size: 1.35rem; font-weight: 700; color: #38bdf8; margin-bottom: 12px; }
          p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin-bottom: 16px; }
          .error-badge {
            background: rgba(244, 63, 94, 0.1);
            border: 1px solid rgba(244, 63, 94, 0.25);
            color: #f43f5e;
            padding: 10px 14px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 0.82rem;
            margin-bottom: 20px;
            word-break: break-all;
          }
          .countdown {
            font-size: 0.85rem;
            color: #64748b;
            margin-bottom: 24px;
          }
          .actions {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
          }
          .btn {
            display: inline-block;
            padding: 10px 20px;
            border-radius: 8px;
            text-decoration: none;
            font-size: 0.9rem;
            font-weight: 600;
            transition: all 0.2s;
            cursor: pointer;
            border: none;
          }
          .btn-primary { background: #0284c7; color: #fff; }
          .btn-primary:hover { background: #0369a1; }
          .btn-secondary { background: #1e293b; color: #cbd5e1; }
          .btn-secondary:hover { background: #334155; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-spin"></div>
          <h2>iCloud Sync Engine — Conectando...</h2>
          <p>O container do iCloud está iniciando o serviço Web UI ou carregando as configurações. A conexão será restabelecida automaticamente em instantes.</p>
          <div class="error-badge">
            Destino: ${ICLOUD_HOST}:${ICLOUD_PORT} &bull; ${err.code || err.message}
          </div>
          <div class="countdown">
            Recarregando automaticamente a cada 5 segundos...
          </div>
          <div class="actions">
            <button class="btn btn-primary" onclick="window.location.reload()">Reconectar Agora</button>
            <a class="btn btn-secondary" href="/">&larr; Voltar para o iOpDash</a>
          </div>
        </div>
      </body>
      </html>
    `);
  });

  if (['GET', 'HEAD'].includes(req.method)) {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // --- AUTHENTICATION API ROUTES ---

  // GET /api/auth/status
  if (pathname === '/api/auth/status' && method === 'GET') {
    const authData = getStoredAuth();
    const session = getSession(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      initialized: !!authData,
      authenticated: !!session,
      username: session ? session.username : null
    }));
  }

  // POST /api/auth/setup (Primeiro Acesso)
  if (pathname === '/api/auth/setup' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const existingAuth = getStoredAuth();
        if (existingAuth) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'O sistema já possui usuário mestre configurado.' }));
        }

        const payload = JSON.parse(body || '{}');
        const username = (payload.username || '').trim();
        const password = (payload.password || '').trim();

        if (!username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Usuário e senha são obrigatórios.' }));
        }

        if (password.length < 6) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'A senha deve conter no mínimo 6 caracteres.' }));
        }

        const { hash, salt } = hashPassword(password);
        saveStoredAuth({
          username,
          passwordHash: hash,
          salt,
          createdAt: new Date().toISOString()
        });

        // Log the user in immediately
        const token = createSession(username);
        res.setHeader('Set-Cookie', `srv_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Usuário administrador configurado com sucesso!', username }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // POST /api/auth/login
  if (pathname === '/api/auth/login' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const authData = getStoredAuth();
        if (!authData) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Sistema não configurado. Realize o primeiro acesso.' }));
        }

        const payload = JSON.parse(body || '{}');
        const username = (payload.username || '').trim();
        const password = (payload.password || '').trim();

        if (username !== authData.username || !verifyPassword(password, authData.passwordHash, authData.salt)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Usuário ou senha incorretos.' }));
        }

        const token = createSession(username);
        res.setHeader('Set-Cookie', `srv_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Login realizado com sucesso!', username }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // POST /api/auth/logout
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const cookies = parseCookies(req);
    const token = cookies['srv_session'];
    if (token) activeSessions.delete(token);

    res.setHeader('Set-Cookie', 'srv_session=; Path=/; HttpOnly; Max-Age=0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, message: 'Sessão encerrada.' }));
  }

  // --- PROTECTED ICLOUD PROXY ROUTES ---
  // /icloud-proxy/*
  if (pathname.startsWith('/icloud-proxy')) {
    if (!isAuthenticated(req)) {
      res.writeHead(302, { Location: '/?auth_required=true' });
      return res.end();
    }
    const targetPath = pathname.replace(/^\/icloud-proxy/, '') || '/';
    proxyToIcloud(req, res, targetPath, urlObj.search);
    return;
  }

  // Proxy actions called directly from iCloud pages (e.g. /auth, /api/sync)
  if (pathname.startsWith('/auth') || (pathname === '/api/sync' && method === 'POST')) {
    if (!isAuthenticated(req)) {
      res.writeHead(302, { Location: '/?auth_required=true' });
      return res.end();
    }
    proxyToIcloud(req, res, pathname, urlObj.search);
    return;
  }

  // --- PROTECTED DASHBOARD API ROUTES ---
  if (pathname.startsWith('/api/')) {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Autenticação necessária', code: 'UNAUTHORIZED' }));
    }

    // GET /api/status
    if (pathname === '/api/status' && method === 'GET') {
      const status = await getDockerStatus(req);
      const users = getUsers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, ...status, usersCount: users.length }));
    }

    // GET /api/users
    if (pathname === '/api/users' && method === 'GET') {
      const users = getUsers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, users }));
    }

    // POST /api/users
    if (pathname === '/api/users' && method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const users = getUsers();

          if (payload.id) {
            const index = users.findIndex(u => u.id === payload.id);
            if (index !== -1) {
              users[index] = { ...users[index], ...payload, updatedAt: new Date().toISOString() };
            } else {
              users.push({ ...payload, updatedAt: new Date().toISOString() });
            }
          } else {
            const newUser = {
              id: 'usr-' + Date.now(),
              name: payload.name || 'Novo Usuário',
              device: payload.device || 'iPhone',
              icloud_email: payload.icloud_email || '',
              immich_email: payload.immich_email || payload.icloud_email || '',
              immich_user: payload.immich_user || payload.samba_user || 'usuario',
              samba_user: (payload.samba_user || 'user').toLowerCase().replace(/[^a-z0-9_-]/g, ''),
              samba_pass: payload.samba_pass || 'senha123',
              samba_share: payload.samba_share || 'iCloud-Backup',
              folder_path: payload.folder_path || '/icloud',
              status: 'aligned',
              createdAt: new Date().toISOString()
            };
            users.push(newUser);
          }

          saveUsers(users);

          if (payload.apply_to_icloud && payload.icloud_email) {
            try {
              if (fs.existsSync(CONFIG_YAML_FILE)) {
                let yamlContent = fs.readFileSync(CONFIG_YAML_FILE, 'utf8');
                yamlContent = yamlContent.replace(/username:\s*".*?"/, `username: "${payload.icloud_email}"`);
                fs.writeFileSync(CONFIG_YAML_FILE, yamlContent, 'utf8');
                if (!CONFIG_YAML_FILE.startsWith('/config')) {
                  await runCmd(`docker cp "${CONFIG_YAML_FILE}" icloud:/config/config.yaml`);
                }
              }
            } catch (e) {
              console.error('Failed to auto-update config.yaml:', e);
            }
          }

          await runCmd('docker restart samba');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Usuário unificado salvo e sincronizado com sucesso!' }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }

    // DELETE /api/users/:id
    if (pathname.startsWith('/api/users/') && method === 'DELETE') {
      const id = pathname.replace('/api/users/', '');
      let users = getUsers();
      users = users.filter(u => u.id !== id);
      saveUsers(users);
      await runCmd('docker restart samba');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Usuário removido!' }));
    }

    // POST /api/services/:service/:action
    if (pathname.startsWith('/api/services/') && method === 'POST') {
      const parts = pathname.split('/');
      const service = parts[3];
      const action = parts[4];

      if (!['start', 'stop', 'restart'].includes(action)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Ação inválida' }));
      }

      let cmd = '';
      if (service === 'icloud') {
        cmd = `docker ${action} icloud`;
      } else if (service === 'samba') {
        cmd = `docker ${action} samba`;
      } else if (service === 'immich') {
        if (action === 'start') {
          cmd = 'docker compose up -d immich-server immich-postgres immich-redis || docker start immich_server immich_postgres immich_redis';
        } else if (action === 'stop') {
          cmd = 'docker stop immich_server immich_postgres immich_redis immich_machine_learning';
        } else {
          cmd = 'docker restart immich_server immich_postgres immich_redis';
        }
      } else if (service === 'immich-ai' || service === 'immich-ml') {
        const hw = evaluateHardware();
        if (action === 'start') {
          if (!hw.isSupported) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ 
              success: false, 
              error: `Hardware insuficiente (${hw.totalMemGB}GB RAM detectados). O módulo de IA requer no mínimo 4GB de RAM para evitar travamento do servidor.` 
            }));
          }
          cmd = 'docker compose --profile ml up -d immich-machine-learning || docker start immich_machine_learning';
        } else if (action === 'stop') {
          cmd = 'docker stop immich_machine_learning';
        } else {
          cmd = 'docker restart immich_machine_learning';
        }
      } else if (service === 'all') {
        cmd = 'docker restart icloud samba immich_server immich_postgres immich_redis';
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Serviço desconhecido' }));
      }

      const execRes = await runCmd(cmd);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ 
        success: execRes.code === 0, 
        output: execRes.stdout || execRes.stderr,
        error: execRes.error 
      }));
    }

    // GET /api/logs/:container
    if (pathname.startsWith('/api/logs/') && method === 'GET') {
      const container = pathname.replace('/api/logs/', '');
      const valid = ['icloud', 'immich_server', 'immich_machine_learning', 'immich_postgres', 'immich_redis', 'samba'];
      if (!valid.includes(container)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Container inválido para logs' }));
      }
      const logRes = await runCmd(`docker logs --tail 100 ${container}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ 
        success: true, 
        container,
        logs: logRes.stdout || logRes.stderr || 'Nenhum log registrado.' 
      }));
    }

    // POST /api/icloud/sync
    if (pathname === '/api/icloud/sync' && method === 'POST') {
      const syncRes = await runCmd('docker exec icloud icloud --dry-run || docker restart icloud');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Sincronização acionada com sucesso!', output: syncRes.stdout }));
    }
  }

  // --- STATIC FILE SERVING ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Acesso Negado');
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Página não encontrada (404)');
      } else {
        res.writeHead(500);
        res.end(`Erro no servidor: ${err.code}`);
      }
    } else {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIP();
  console.log(`====================================================`);
  console.log(`iOpDash - Orquestrador Central & Auth Gateway`);
  console.log(`Plataforma iOpenbackup`);
  console.log(`Painel Protegido disponível em:`);
  console.log(`  Local:   http://localhost:${HOST_PORT}`);
  console.log(`  Na Rede: http://${localIp}:${HOST_PORT}`);
  console.log(`  Proxy iCloud: http://${localIp}:${HOST_PORT}/icloud-proxy/ (Host: ${ICLOUD_HOST}:${ICLOUD_PORT})`);
  console.log(`====================================================`);
});
