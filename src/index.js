import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { initDb } from './db.js';
import { dispatchCommand } from './commands.js';
import whatsapp from 'whatsapp-web.js';
const { MessageMedia, Client, LocalAuth } = whatsapp;
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
// Client and LocalAuth imported from whatsapp default export above
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inicializa DB
import { onUpdate } from './events.js';
import { getAllUsersTotals, initDbMonthly } from './db.js';
import { initScheduler } from './scheduler.js';
initDb();
initDbMonthly();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

let latestQr = null;
let clientReady = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '..', 'data', 'auth') }),
  restartOnAuthFail: true,
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-features=TranslateUI'
    ],
    executablePath: process.env.CHROME_PATH || undefined,
    timeout: 120000
  }
});

client.on('qr', async (qr) => {
  // Print ASCII QR in terminal
  try { qrcodeTerminal.generate(qr, { small: true }); } catch {}
  // Save PNG for download
  try {
    await qrcode.toFile(path.join(__dirname, '..', 'public', 'qr.png'), qr, { type: 'png', width: 320, margin: 2 });
    console.log('QR salvo em /public/qr.png (acesse /qr.png)');
  } catch (e) {
    console.warn('Falha ao salvar QR.png:', e?.message || e);
  }
  latestQr = await qrcode.toDataURL(qr);
  clientReady = false;
  console.log('QR atualizado. Acesse /qr para escanear.');
});

client.on('ready', () => {
  clientReady = true;
  console.log('Bot conectado e pronto!');
  initScheduler(client);
  console.log('Agendador de notificações iniciado.');
});

client.on('disconnected', (reason) => {
  clientReady = false;
  console.warn('Cliente desconectado:', reason, 'reinicializando...');
  setTimeout(() => client.initialize(), 2000);
});

client.on('auth_failure', (msg) => {
  console.error('Falha de autenticação:', msg);
});

client.on('message', async msg => {
  try {
    const phone = msg.from.split('@')[0];
    const body = msg.body.trim();
    if (body.startsWith('!')) {
      const response = await dispatchCommand(phone, body);
      if (typeof response === 'string') {
        await msg.reply(response);
      } else if (response && response.media) {
        const media = new MessageMedia(response.mimetype, response.data, response.filename);
        await msg.reply(media, undefined, { caption: response.caption });
      } else {
        await msg.reply('⚠️ Resposta desconhecida.');
      }
    }
  } catch (e) {
    console.error('Erro ao processar mensagem', e);
    msg.reply('⚠️ Ocorreu um erro interno. Tente novamente.');
  }
});

client.initialize();

app.get('/api/qr', (req, res) => {
  if (clientReady) return res.json({ status: 'ready' });
  if (!latestQr) return res.json({ status: 'pending' });
  res.json({ status: 'scan', dataUrl: latestQr });
});

app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'qr.html'));
});

app.get('/', (req, res) => {
  res.send('<h1>WhatsApp Bot Giulia</h1><p>Acesse <a href="/qr">/qr</a> para conectar.</p>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor ativo em http://localhost:${PORT}`));
app.get('/api/stats', async (req, res) => {
  try {
    const rows = await getAllUsersTotals();
    const mapped = rows.map(r => {
      const salary = r.salary || 0;
      const expense = r.expense || 0;
      const overtime = r.overtime_hours || 0;
      const leave = r.leave_hours || 0;
      const workday = r.workday_hours || 0;
      const hourlyRate = salary ? salary / 220 : 0;
      const overtimeValue = overtime * hourlyRate;
      const net = salary + overtimeValue - expense;
      const expensePct = salary ? (expense / salary) * 100 : 0;
      const leaveBank = (workday) - (leave);
      return {
        phone: r.phone,
        salary,
        expense,
        overtime,
        leave,
        workday,
        leaveBank,
        net,
        expensePct: parseFloat(expensePct.toFixed(1)),
        target_income: r.target_income || 0,
        max_expense_percent: r.max_expense_percent || 0,
        max_expense_value: r.max_expense_value || 0
      };
    });
    res.json({ data: mapped });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao coletar estatísticas' });
  }
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

onUpdate(async ({ phone }) => {
  try {
    const rows = await getAllUsersTotals();
    io.emit('stats', rows);
  } catch (e) {
    // silenciar
  }
});

io.on('connection', async socket => {
  try {
    const rows = await getAllUsersTotals();
    socket.emit('stats', rows);
  } catch (e) {}
});

const basePort = Number(process.env.PORT) || 3000;
function listenWithFallback(port) {
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      const next = port + 1;
      console.warn(`Porta ${port} em uso. Tentando ${next}...`);
      listenWithFallback(next);
    } else {
      console.error('Erro ao iniciar servidor:', err);
    }
  });
  server.listen(port, () => console.log(`Servidor ativo em http://localhost:${port}`));
}
listenWithFallback(basePort);
