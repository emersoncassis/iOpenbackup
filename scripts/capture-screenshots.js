const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function capture() {
  console.log('[*] Iniciando Chrome Headless para capturar prints da plataforma...');
  
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    defaultViewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2
    },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // 1. Tela Inicial de Primeiro Acesso
  console.log('[1/4] Capturando: Tela Inicial / Primeiro Acesso...');
  await page.goto('http://localhost:8000', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));
  
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '01-primeiro-acesso.png')
  });
  console.log('  -> Salvo: docs/screenshots/01-primeiro-acesso.png');

  // 2. Realizar Primeiro Acesso para liberar a Dashboard
  console.log('[*] Preenchendo primeiro acesso para desbloquear o painel...');
  await page.type('#setupUser', 'admin');
  await page.type('#setupPass', 'admin123456');
  await page.type('#setupPassConfirm', 'admin123456');
  await page.click('#btnSetupSubmit');
  
  await page.waitForSelector('#mainAppLayout', { visible: true, timeout: 10000 });
  await new Promise(r => setTimeout(r, 3000)); // Aguarda carregar dados do Docker

  // 2. Dashboard Principal
  console.log('[2/4] Capturando: Dashboard Principal...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '02-dashboard-principal.png')
  });
  console.log('  -> Salvo: docs/screenshots/02-dashboard-principal.png');

  // 3. Guia de Conexão iPhone (Arquivos)
  console.log('[3/4] Capturando: Conexão iPhone (Arquivos)...');
  await page.click('#tabBtnIphone');
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '03-conexao-iphone.png')
  });
  console.log('  -> Salvo: docs/screenshots/03-conexao-iphone.png');

  // 4. Alinhamento de Usuários
  console.log('[4/4] Capturando: Alinhamento de Usuários...');
  await page.click('#tabBtnUsers');
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '04-alinhamento-usuarios.png')
  });
  console.log('  -> Salvo: docs/screenshots/04-alinhamento-usuarios.png');

  await browser.close();
  console.log('[✓] Todos os prints capturados com sucesso em alta resolução (Retina 2x)!');

  // Limpar auth.json para manter o sistema no modo de primeiro acesso
  const authFile = path.join(__dirname, '..', 'dashboard', 'data', 'auth.json');
  if (fs.existsSync(authFile)) {
    fs.unlinkSync(authFile);
    console.log('[✓] auth.json limpo para manter o sistema no modo de primeiro acesso!');
  }
}

capture().catch(err => {
  console.error('[!] Erro ao capturar screenshots:', err);
  process.exit(1);
});
