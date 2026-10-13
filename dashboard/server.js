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

async function getDockerStatus() {
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

  const hostIp = getLocalIP();
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
      description: 'Galeria inteligente de fotos com linha do tempo, IA e reconhecimento facial'
    },
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
      <div style="font-family:sans-serif;padding:30px;background:#0a0e17;color:#fff;min-height:100vh;">
        <h2 style="color:#f43f5e;">Erro ao conectar ao iCloud Sync Engine</h2>
        <p>Não foi possível contactar o container do iCloud em ${ICLOUD_HOST}:${ICLOUD_PORT}: ${err.message}</p>
        <p><a href="/" style="color:#38bdf8;">&larr; Voltar para o iOpDash</a></p>
      </div>
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
      const status = await getDockerStatus();
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
        const immichContainers = ['immich_server', 'immich_machine_learning', 'immich_postgres', 'immich_redis'];
        cmd = `docker ${action} ${immichContainers.join(' ')}`;
      } else if (service === 'all') {
        cmd = `docker ${action} icloud immich_server immich_machine_learning immich_postgres immich_redis samba`;
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
