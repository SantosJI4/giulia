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
let client = null;

function createClient() {
  const options = {
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '..', 'data', 'auth') }),
    restartOnAuthFail: true,
    // Cache da versão do WhatsApp Web para reduzir quebras em injeção
    webVersionCache: {
      type: 'remote',
      remotePath:
        'https://raw.githubusercontent.com/adiwajshing/whatsapp-web.js/refs/heads/main/src/whatsapp-web-version.json'
    },
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
        '--disable-features=TranslateUI',
        '--hide-scrollbars',
        '--disable-accelerated-2d-canvas'
      ],
      executablePath: process.env.CHROME_PATH || undefined,
      timeout: 120000
    }
  };
  const c = new Client(options);

  // Bind events para o cliente recém criado
  bindClientEvents(c);
  return c;
}

async function recreateClient(delayMs = 2000) {
  clientReady = false;
  try {
    if (client) {
      await client.destroy().catch(() => {});
    }
  } catch {}
  setTimeout(() => {
    try {
      console.log('Recriando cliente WhatsApp...');
      client = createClient();
      client.initialize();
    } catch (e) {
      console.error('Falha ao recriar cliente:', e?.message || e);
    }
  }, delayMs);
}

function bindClientEvents(c) {
  c.on('qr', async (qr) => {
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

  c.on('ready', () => {
    clientReady = true;
    console.log('Bot conectado e pronto!');
    initScheduler(c);
    console.log('Agendador de notificações iniciado.');
  });

  c.on('disconnected', (reason) => {
    clientReady = false;
    console.warn('Cliente desconectado:', reason, 'reciclando cliente...');
    // Reciclar totalmente o cliente para evitar loops com contexto destruído
    recreateClient(2000);
  });

  c.on('auth_failure', (msg) => {
    console.error('Falha de autenticação:', msg);
  });

  // Erros genéricos do cliente (inclui contexto destruído)
  c.on('error', (err) => {
    const msg = err?.message || String(err || 'erro desconhecido');
    console.error('Erro no cliente WhatsApp:', msg);
    clientReady = false;
    // Para erros típicos de Puppeteer, recriar o cliente é mais seguro
    if (/Execution context was destroyed|Target closed|Protocol error/i.test(msg)) {
      recreateClient(3000);
    } else {
      // fallback simples
      setTimeout(() => {
        try {
          console.log('Tentando reinicializar cliente após erro...');
          c.initialize();
        } catch (e) {
          console.error('Falha ao reinicializar cliente:', e?.message || e);
          recreateClient(3000);
        }
      }, 3000);
    }
  });

  c.on('change_state', (state) => {
    console.log('Estado do cliente:', state);
  });
  c.on('loading_screen', (percent, message) => {
    console.log('Carregando WhatsApp Web:', percent, message);
  });
}

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

// Criar e inicializar o primeiro cliente
client = createClient();
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
