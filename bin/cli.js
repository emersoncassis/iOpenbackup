#!/usr/bin/env node

/**
 * ==============================================================================
 *  iOpenbackup - CLI & NPX Installer
 *  Plataforma Aberta e Unificada para Soberania e Backup Automático de iPhones
 *  Idealizado por Emerson Carvalho (@emersoncassis)
 * ==============================================================================
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

const PKG_ROOT = path.resolve(__dirname, '..');
const CWD = process.cwd();

// ANSI Colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  dim: '\x1b[2m'
};

function banner() {
  console.log(`
${colors.cyan}${colors.bold}  ==============================================================${colors.reset}
${colors.cyan}${colors.bold}            iOpenbackup - CLI & Instalador NPX                  ${colors.reset}
${colors.dim}     Backup Privado & Soberania de Dados para iPhones com IA     ${colors.reset}
${colors.cyan}${colors.bold}  ==============================================================${colors.reset}
`);
}

function runCommand(cmd, cwd = CWD) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 60000 }, (error, stdout, stderr) => {
      resolve({
        success: !error,
        error: error ? error.message : null,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim()
      });
    });
  });
}

function ask(question, defaultValue = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
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

function openBrowser(url) {
  const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${start} ${url}`);
}

async function checkDocker() {
  process.stdout.write(`${colors.blue}[*] Verificando Docker e Docker Compose...${colors.reset} `);
  const dockerVer = await runCommand('docker --version');
  if (!dockerVer.success) {
    console.log(`${colors.red}FALHOU!${colors.reset}`);
    console.error(`\n${colors.yellow}[!] O Docker não foi detectado no sistema.${colors.reset}`);
    console.error(`    Por favor, instale o Docker Desktop (https://www.docker.com/products/docker-desktop/)`);
    console.error(`    ou no Linux execute: curl -fsSL https://get.docker.com | sh\n`);
    return false;
  }

  const composeVer = await runCommand('docker compose version');
  if (!composeVer.success) {
    console.log(`${colors.red}Docker Compose não encontrado!${colors.reset}`);
    return false;
  }

  console.log(`${colors.green}✓ OK! (${dockerVer.stdout})${colors.reset}`);
  return true;
}

// Copy directory recursively
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'icloud', 'session_data'].includes(entry.name)) continue;
      copyDirSync(srcPath, destPath);
    } else {
      if (['auth.json'].includes(entry.name)) continue;
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function cmdInit() {
  banner();

  const hasDocker = await checkDocker();
  if (!hasDocker) {
    process.exit(1);
  }

  // Check if we are inside the repository or installing into a new folder
  const currentHasCompose = fs.existsSync(path.join(CWD, 'docker-compose.yml'));
  let targetDir = CWD;

  if (!currentHasCompose) {
    console.log(`\n${colors.cyan}[?] Onde você deseja instalar o iOpenbackup?${colors.reset}`);
    const choice = await ask(`    1) No diretório atual (${CWD})\n    2) Em uma nova pasta (./iopenbackup)\n    Escolha`, '2');

    if (choice === '2' || choice.toLowerCase() === 'nova') {
      targetDir = path.join(CWD, 'iopenbackup');
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    console.log(`\n${colors.blue}[*] Copiando arquivos essenciais para ${targetDir}...${colors.reset}`);
    copyDirSync(PKG_ROOT, targetDir);
    console.log(`${colors.green}[✓] Arquivos copiados com sucesso!${colors.reset}`);
  }

  // Ensure config files exist
  const cfgFile = path.join(targetDir, 'config', 'config.yaml');
  const cfgExample = path.join(targetDir, 'config', 'config.example.yaml');
  if (!fs.existsSync(cfgFile) && fs.existsSync(cfgExample)) {
    fs.copyFileSync(cfgExample, cfgFile);
  }

  const startNow = await ask(`\n${colors.cyan}[?] Deseja iniciar a stack Docker e o Dashboard agora? (S/n)${colors.reset}`, 'S');
  if (startNow.toLowerCase() === 's' || startNow.toLowerCase() === 'sim' || startNow.toLowerCase() === 'y') {
    await startStack(targetDir);
  } else {
    console.log(`\n${colors.green}[✓] Instalação concluída!${colors.reset}`);
    console.log(`Para iniciar manualmente mais tarde, navegue até a pasta e execute:`);
    console.log(`  ${colors.bold}cd "${targetDir}" && npx iopenbackup start${colors.reset}\n`);
  }
}

async function startStack(targetDir = CWD) {
  console.log(`\n${colors.blue}[*] Verificando e baixando imagens Docker sequencialmente para evitar sobrecarga de rede...${colors.reset}`);
  const images = [
    'mandarons/icloud-drive:latest',
    'docker.io/valkey/valkey:9@sha256:c123e3715db63d06d4ad6964884037aa0d5d4d703939b9929954112889708e1d',
    'ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23',
    'ghcr.io/immich-app/immich-server:release'
  ];
  for (const img of images) {
    console.log(`  [-] Verificando imagem: ${colors.cyan}${img}${colors.reset}`);
    await runCommand(`docker pull ${img}`, targetDir);
  }

  console.log(`\n${colors.blue}[*] Subindo containers Docker (iOpDash Orquestrador, iCloud, Immich AI, Samba)...${colors.reset}`);
  const upRes = await runCommand('docker compose up -d', targetDir);
  if (!upRes.success) {
    console.error(`${colors.red}[!] Erro ao subir os containers Docker:${colors.reset}\n${upRes.stderr || upRes.error}`);
    return;
  }
  console.log(`${colors.green}[OK] Containers iniciados com sucesso!${colors.reset}`);

  const hostIp = getLocalIP();
  const dashboardPath = path.join(targetDir, 'dashboard', 'server.js');

  console.log(`\n${colors.green}${colors.bold}==============================================================${colors.reset}`);
  console.log(`${colors.green}${colors.bold}       [OK] iOpenbackup & iOpDash ONLINE e prontos!           ${colors.reset}`);
  console.log(`${colors.green}${colors.bold}==============================================================${colors.reset}`);
  console.log(`\n${colors.bold}Acessos disponíveis:${colors.reset}`);
  console.log(`  [-] ${colors.cyan}iOpDash (Orquestrador):${colors.reset}   http://localhost:8000  (ou http://${hostIp}:8000)`);
  console.log(`  [-] ${colors.cyan}iCloud 2FA Proxy:${colors.reset}       http://localhost:8000/icloud-proxy/`);
  console.log(`  [-] ${colors.cyan}Immich Photos IA:${colors.reset}       http://localhost:2283  (ou http://${hostIp}:2283)`);
  console.log(`  [-] ${colors.cyan}Samba SMB (iPhone):${colors.reset}     smb://${hostIp}:4445`);
  console.log(`\n${colors.yellow}[*] Abra http://localhost:8000 para definir seu usuário e senha mestra no iOpDash.${colors.reset}\n`);

  // Open browser automatically
  setTimeout(() => {
    openBrowser('http://localhost:8000');
  }, 1000);

  // Check if iOpDash container is already running via docker compose
  const psCheck = await runCommand('docker ps --filter "name=iopdash" --format "{{.Status}}"', targetDir);
  const isIopdashRunningInDocker = psCheck.success && psCheck.stdout.toLowerCase().includes('up');

  if (isIopdashRunningInDocker) {
    console.log(`${colors.green}[✓] iOpDash está ativo dentro do Docker. Para acompanhar logs: docker logs -f iopdash${colors.reset}\n`);
  } else if (fs.existsSync(dashboardPath)) {
    console.log(`${colors.blue}[*] Iniciando iOpDash localmente na porta 8000 (Pressione Ctrl+C para parar)...${colors.reset}\n`);
    const srv = spawn(process.execPath, [dashboardPath], {
      cwd: targetDir,
      stdio: 'inherit'
    });

    process.on('SIGINT', () => {
      srv.kill();
      process.exit();
    });
  }
}

async function stopStack(targetDir = CWD) {
  banner();
  console.log(`${colors.yellow}[*] Parando containers do iOpenbackup...${colors.reset}`);
  const downRes = await runCommand('docker compose down', targetDir);
  if (downRes.success) {
    console.log(`${colors.green}[✓] Containers parados com sucesso!${colors.reset}`);
  } else {
    console.error(`${colors.red}[!] Erro:${colors.reset} ${downRes.stderr || downRes.error}`);
  }
}

async function statusStack(targetDir = CWD) {
  banner();
  console.log(`${colors.blue}[*] Status dos containers Docker:${colors.reset}\n`);
  const psRes = await runCommand('docker compose ps', targetDir);
  console.log(psRes.stdout || 'Nenhum container em execução.');
  const hostIp = getLocalIP();
  console.log(`\n${colors.bold}Coordenadas da Rede:${colors.reset}`);
  console.log(`  IP Local: http://${hostIp}:8000`);
  console.log(`  Samba iPhone: smb://${hostIp}:4445\n`);
}

async function resetPassword(targetDir = CWD) {
  banner();
  const authFile = path.join(targetDir, 'dashboard', 'data', 'auth.json');
  console.log(`${colors.yellow}[!] Reset de Senha Mestra do Administrador${colors.reset}`);
  const confirm = await ask(`Tem certeza que deseja resetar a senha mestra? (s/N)`, 'N');
  if (confirm.toLowerCase() === 's' || confirm.toLowerCase() === 'sim') {
    if (fs.existsSync(authFile)) {
      fs.unlinkSync(authFile);
      console.log(`\n${colors.green}[✓] Senha mestra resetada com sucesso!${colors.reset}`);
    } else {
      console.log(`\n${colors.cyan}[INFO] O sistema já está no modo de primeiro acesso.${colors.reset}`);
    }
    console.log(`Abra http://localhost:8000 para definir seu novo usuário e senha.\n`);
  } else {
    console.log(`Operação cancelada.`);
  }
}

function showHelp() {
  banner();
  console.log(`${colors.bold}USO:${colors.reset}`);
  console.log(`  npx iopenbackup [comando]\n`);
  console.log(`${colors.bold}COMANDOS DISPONÍVEIS:${colors.reset}`);
  console.log(`  ${colors.cyan}npx iopenbackup${colors.reset}              Instala ou inicia a plataforma interativamente`);
  console.log(`  ${colors.cyan}npx iopenbackup start${colors.reset}        Inicia todos os containers e o Dashboard`);
  console.log(`  ${colors.cyan}npx iopenbackup stop${colors.reset}         Para os containers Docker`);
  console.log(`  ${colors.cyan}npx iopenbackup status${colors.reset}       Exibe o status de saúde dos serviços`);
  console.log(`  ${colors.cyan}npx iopenbackup reset${colors.reset}        Reseta a senha mestra para criar uma nova`);
  console.log(`  ${colors.cyan}npx iopenbackup help${colors.reset}         Exibe esta mensagem de ajuda\n`);
  console.log(`${colors.bold}EXEMPLO RÁPIDO:${colors.reset}`);
  console.log(`  npx iopenbackup\n`);
}

async function main() {
  const arg = (process.argv[2] || '').toLowerCase();

  switch (arg) {
    case 'start':
    case 'up':
      banner();
      await checkDocker();
      await startStack(CWD);
      break;
    case 'stop':
    case 'down':
      await stopStack(CWD);
      break;
    case 'status':
    case 'ps':
      await statusStack(CWD);
      break;
    case 'reset':
    case 'reset-password':
      await resetPassword(CWD);
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      await cmdInit();
      break;
  }
}

main().catch(err => {
  console.error(`${colors.red}Erro fatal:${colors.reset}`, err);
  process.exit(1);
});
