import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'data', 'botdata.sqlite');

function getDb() {
  const db = new sqlite3.Database(dbPath);
  return db;
}

export function initDb() {
  const db = getDb();
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      phone TEXT PRIMARY KEY,
      last_salary REAL DEFAULT 0,
      last_salary_date TEXT,
      target_income REAL DEFAULT 0,
      max_expense_percent REAL DEFAULT 0,
      max_expense_value REAL DEFAULT 0,
      notify_daily INTEGER DEFAULT 0,
      notify_weekly INTEGER DEFAULT 0,
      sheets_id TEXT,
      language TEXT DEFAULT 'pt',
      timezone TEXT DEFAULT 'America/Sao_Paulo',
      notify_hour INTEGER DEFAULT 8,
      insight_enabled INTEGER DEFAULT 1,
      last_daily_sent TEXT,
      last_insight_sent TEXT,
      morning_brief_enabled INTEGER DEFAULT 0,
      morning_brief_hour INTEGER DEFAULT 8,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      type TEXT, -- salary|expense|overtime|leave|workday
      amount REAL,
      hours REAL,
      description TEXT,
      category TEXT,
      event_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS category_limits (
      phone TEXT,
      category TEXT,
      limit_value REAL,
      PRIMARY KEY (phone, category)
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_entries_phone ON entries(phone)`);
    db.run('ALTER TABLE users ADD COLUMN target_income REAL DEFAULT 0', err => {});
    db.run('ALTER TABLE users ADD COLUMN max_expense_percent REAL DEFAULT 0', err => {});
    db.run('ALTER TABLE users ADD COLUMN max_expense_value REAL DEFAULT 0', err => {});
    db.run('ALTER TABLE users ADD COLUMN notify_daily INTEGER DEFAULT 0', err => {});
    db.run('ALTER TABLE users ADD COLUMN notify_weekly INTEGER DEFAULT 0', err => {});
    db.run('ALTER TABLE users ADD COLUMN sheets_id TEXT', err => {});
    db.run("ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'pt'", err => {});
    db.run("ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'America/Sao_Paulo'", err => {});
    db.run('ALTER TABLE users ADD COLUMN notify_hour INTEGER DEFAULT 8', err => {});
    db.run('ALTER TABLE users ADD COLUMN insight_enabled INTEGER DEFAULT 1', err => {});
    db.run('ALTER TABLE users ADD COLUMN last_daily_sent TEXT', err => {});
    db.run('ALTER TABLE users ADD COLUMN last_insight_sent TEXT', err => {});
    db.run('ALTER TABLE users ADD COLUMN morning_brief_enabled INTEGER DEFAULT 0', err => {});
    db.run('ALTER TABLE users ADD COLUMN morning_brief_hour INTEGER DEFAULT 8', err => {});
    db.run(`CREATE TABLE IF NOT EXISTS user_crypto_watchlist (
      phone TEXT,
      symbol TEXT,
      PRIMARY KEY (phone, symbol)
    )`);
    // Backfill for older DBs
    db.run('ALTER TABLE entries ADD COLUMN event_date TEXT', err => {});
    db.run('ALTER TABLE entries ADD COLUMN category TEXT', err => {});
  });
  return db;
}

export function getUser(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, row) => {
      if (err) reject(err); else resolve(row);
      db.close();
    });
  });
}

export function setUserPrefs(phone, { language, timezone, notify_hour, insight_enabled }) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    const fields = [];
    const values = [];
    if (language) { fields.push('language=?'); values.push(language); }
    if (timezone) { fields.push('timezone=?'); values.push(timezone); }
    if (typeof notify_hour === 'number') { fields.push('notify_hour=?'); values.push(notify_hour); }
    if (typeof insight_enabled === 'number') { fields.push('insight_enabled=?'); values.push(insight_enabled); }
    if (typeof notify_hour === 'number' && (notify_hour < 0 || notify_hour > 23)) {
      db.close();
      return reject(new Error('notify_hour inválido'));
    }
    if (!fields.length) { db.close(); return resolve(); }
    values.push(phone);
    db.run(`UPDATE users SET ${fields.join(', ')} WHERE phone=?`, values, err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function setMorningBriefPrefs(phone, { enabled, hour }) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    const fields = [];
    const values = [];
    if (typeof enabled === 'number') { fields.push('morning_brief_enabled=?'); values.push(enabled); }
    if (typeof hour === 'number') {
      if (hour < 0 || hour > 23) { db.close(); return reject(new Error('hora inválida')); }
      fields.push('morning_brief_hour=?'); values.push(hour);
    }
    if (!fields.length) { db.close(); return resolve(); }
    values.push(phone);
    db.run(`UPDATE users SET ${fields.join(', ')} WHERE phone=?`, values, err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function getMorningBriefPrefs(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get('SELECT morning_brief_enabled, morning_brief_hour FROM users WHERE phone=?', [phone], (err, row) => {
      if (err) reject(err); else resolve(row || { morning_brief_enabled: 0, morning_brief_hour: 8 });
      db.close();
    });
  });
}

export function addCryptoSymbol(phone, symbol) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('INSERT OR IGNORE INTO user_crypto_watchlist(phone,symbol) VALUES(?,?)', [phone, symbol.toUpperCase()], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function removeCryptoSymbol(phone, symbol) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM user_crypto_watchlist WHERE phone=? AND symbol=?', [phone, symbol.toUpperCase()], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function getCryptoWatchlist(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all('SELECT symbol FROM user_crypto_watchlist WHERE phone=? ORDER BY symbol', [phone], (err, rows) => {
      if (err) reject(err); else resolve(rows.map(r => r.symbol));
      db.close();
    });
  });
}

export function getUserPrefs(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get('SELECT language, timezone, notify_hour, insight_enabled FROM users WHERE phone=?', [phone], (err, row) => {
      if (err) reject(err); else resolve(row || { language: 'pt', timezone: 'America/Sao_Paulo', notify_hour: 8, insight_enabled: 1 });
      db.close();
    });
  });
}

export function markDailySent(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET last_daily_sent = DATE("now") WHERE phone=?', [phone], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function markInsightSent(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET last_insight_sent = DATE("now") WHERE phone=?', [phone], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function ensureUser(phone) {
  return new Promise(async (resolve, reject) => {
    const existing = await getUser(phone).catch(reject);
    if (existing) return resolve(existing);
    const db = getDb();
    db.run('INSERT INTO users(phone) VALUES(?)', [phone], err => {
      if (err) reject(err); else resolve({ phone, last_salary: 0 });
      db.close();
    });
  });
}

export function addEntry({ phone, type, amount = null, hours = null, description = null, event_date = null, category = null }) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO entries(phone,type,amount,hours,description,event_date,category) VALUES(?,?,?,?,?,?,?)', [phone, type, amount, hours, description, event_date, category], function (err) {
      if (err) reject(err); else resolve(this.lastID);
      db.close();
    });
  });
}

export function updateSalary(phone, salary) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET last_salary = ?, last_salary_date = CURRENT_TIMESTAMP WHERE phone = ?', [salary, phone], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function getTotals(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all('SELECT type, SUM(amount) AS total_amount, SUM(hours) AS total_hours FROM entries WHERE phone = ? GROUP BY type', [phone], (err, rows) => {
      if (err) { reject(err); db.close(); return; }
      const totals = { salary: 0, expense: 0, overtime_hours: 0, leave: 0 };
      rows.forEach(r => {
        if (r.type === 'salary') totals.salary = r.total_amount || 0;
        if (r.type === 'expense') totals.expense = r.total_amount || 0;
        if (r.type === 'overtime') totals.overtime_hours = r.total_hours || 0;
        if (r.type === 'leave') totals.leave = r.total_hours || 0; // using hours as count for leaves if needed
      });
      db.close();
      resolve(totals);
    });
  });
}

export function getTotalsRange(phone, startDateISO, endDateISO) {
  // Datas inclusivas, formato YYYY-MM-DD
  const db = getDb();
  return new Promise((resolve, reject) => {
    const sql = `SELECT type, SUM(amount) AS total_amount, SUM(hours) AS total_hours
                 FROM entries
                 WHERE phone=? AND DATE(COALESCE(event_date, created_at)) BETWEEN DATE(?) AND DATE(?)
                 GROUP BY type`;
    db.all(sql, [phone, startDateISO, endDateISO], (err, rows) => {
      if (err) { reject(err); db.close(); return; }
      const totals = { salary: 0, expense: 0, overtime_hours: 0, leave: 0 };
      rows.forEach(r => {
        if (r.type === 'salary') totals.salary = r.total_amount || 0;
        if (r.type === 'expense') totals.expense = r.total_amount || 0;
        if (r.type === 'overtime') totals.overtime_hours = r.total_hours || 0;
        if (r.type === 'leave') totals.leave = r.total_hours || 0;
      });
      db.close();
      resolve(totals);
    });
  });
}

export function getLastTwoSalaries(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all('SELECT amount, created_at FROM entries WHERE phone = ? AND type = "salary" ORDER BY created_at DESC LIMIT 2', [phone], (err, rows) => {
      if (err) reject(err); else resolve(rows);
      db.close();
    });
  });
}

export function setGoal(phone, value) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET target_income = ? WHERE phone = ?', [value, phone], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function getGoal(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get('SELECT target_income FROM users WHERE phone = ?', [phone], (err, row) => {
      if (err) reject(err); else resolve(row ? row.target_income : 0);
      db.close();
    });
  });
}

export function getEntries(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all('SELECT id, type, amount, hours, description, event_date, created_at FROM entries WHERE phone = ? ORDER BY COALESCE(event_date, created_at) ASC', [phone], (err, rows) => {
      if (err) reject(err); else resolve(rows);
      db.close();
    });
  });
}

export function getMonthlyTotals(phone, month) {
  // month formato YYYY-MM
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all('SELECT type, SUM(amount) AS total_amount, SUM(hours) AS total_hours FROM entries WHERE phone = ? AND strftime("%Y-%m", COALESCE(event_date, created_at)) = ? GROUP BY type', [phone, month], (err, rows) => {
      if (err) { reject(err); db.close(); return; }
      const totals = { salary: 0, expense: 0, overtime_hours: 0, leave: 0 };
      rows.forEach(r => {
        if (r.type === 'salary') totals.salary = r.total_amount || 0;
        if (r.type === 'expense') totals.expense = r.total_amount || 0;
        if (r.type === 'overtime') totals.overtime_hours = r.total_hours || 0;
        if (r.type === 'leave') totals.leave = r.total_hours || 0;
      });
      db.close();
      resolve(totals);
    });
  });
}

// Monthly salary table
export function initDbMonthly() {
  const db = getDb();
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS salaries_monthly (
      phone TEXT,
      month TEXT, -- YYYY-MM
      amount REAL,
      PRIMARY KEY (phone, month)
    )`);
  });
  db.close();
}

export function setMonthlySalary(phone, month, amount) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO salaries_monthly(phone,month,amount) VALUES(?,?,?) ON CONFLICT(phone,month) DO UPDATE SET amount=excluded.amount', [phone, month, amount], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function getMonthlySalary(phone, month) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get('SELECT amount FROM salaries_monthly WHERE phone = ? AND month = ?', [phone, month], (err, row) => {
      if (err) reject(err); else resolve(row ? row.amount : 0);
      db.close();
    });
  });
}

export function getMonthlyOvertimeByDay(phone, month) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    const sql = `SELECT COALESCE(event_date, DATE(created_at)) AS d, SUM(hours) AS h
                 FROM entries WHERE phone=? AND type='overtime' AND strftime('%Y-%m', COALESCE(event_date, created_at))=?
                 GROUP BY d ORDER BY d ASC`;
    db.all(sql, [phone, month], (err, rows) => {
      if (err) reject(err); else resolve(rows);
      db.close();
    });
  });
}

export function getMonthlyLeaves(phone, month) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    const sql = `SELECT COALESCE(event_date, DATE(created_at)) AS d, COUNT(*) AS n
                 FROM entries WHERE phone=? AND type='leave' AND strftime('%Y-%m', COALESCE(event_date, created_at))=?
                 GROUP BY d ORDER BY d ASC`;
    db.all(sql, [phone, month], (err, rows) => {
      if (err) reject(err); else resolve(rows);
      db.close();
    });
  });
}

export function setExpensePercent(phone, value) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET max_expense_percent = ? WHERE phone = ?', [value, phone], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function setExpenseValue(phone, value) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET max_expense_value = ? WHERE phone = ?', [value, phone], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function getAlertConfig(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get('SELECT max_expense_percent, max_expense_value FROM users WHERE phone = ?', [phone], (err, row) => {
      if (err) reject(err); else resolve(row || { max_expense_percent: 0, max_expense_value: 0 });
      db.close();
    });
  });
}

export function getAllUsersTotals() {
  const db = getDb();
  return new Promise((resolve, reject) => {
    const sql = `SELECT u.phone, u.target_income, u.max_expense_percent, u.max_expense_value,
      u.notify_daily, u.notify_weekly,
      (SELECT SUM(amount) FROM entries e1 WHERE e1.phone=u.phone AND e1.type='salary') AS salary,
      (SELECT SUM(amount) FROM entries e2 WHERE e2.phone=u.phone AND e2.type='expense') AS expense,
      (SELECT SUM(hours) FROM entries e3 WHERE e3.phone=u.phone AND e3.type='overtime') AS overtime_hours,
      (SELECT SUM(hours) FROM entries e4 WHERE e4.phone=u.phone AND e4.type='leave') AS leave_hours,
      (SELECT SUM(hours) FROM entries e5 WHERE e5.phone=u.phone AND e5.type='workday') AS workday_hours
      FROM users u`;
    db.all(sql, [], (err, rows) => {
      if (err) reject(err); else resolve(rows);
      db.close();
    });
  });
}

export function addWorkedDay(phone, event_date) {
  return addEntry({ phone, type: 'workday', hours: 1, description: `Dia trabalhado ${event_date||''}`.trim(), event_date: event_date || null });
}

export function getLeaveBank(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    const sql = `SELECT 
      (SELECT COALESCE(SUM(hours),0) FROM entries WHERE phone=? AND type='workday') AS credit,
      (SELECT COALESCE(SUM(hours),0) FROM entries WHERE phone=? AND type='leave') AS debit`;
    db.get(sql, [phone, phone], (err, row) => {
      if (err) reject(err); else resolve({ credit: row.credit || 0, debit: row.debit || 0, balance: (row.credit||0) - (row.debit||0) });
      db.close();
    });
  });
}

export function getMonthlyWorkdays(phone, month) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    const sql = `SELECT COALESCE(event_date, DATE(created_at)) AS d, SUM(hours) AS n
                 FROM entries WHERE phone=? AND type='workday' AND strftime('%Y-%m', COALESCE(event_date, created_at))=?
                 GROUP BY d ORDER BY d ASC`;
    db.all(sql, [phone, month], (err, rows) => {
      if (err) reject(err); else resolve(rows);
      db.close();
    });
  });
}

export function setCategoryLimit(phone, category, limit_value) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('INSERT OR REPLACE INTO category_limits(phone, category, limit_value) VALUES(?,?,?)', [phone, category, limit_value], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function getCategoryLimit(phone, category) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get('SELECT limit_value FROM category_limits WHERE phone=? AND category=?', [phone, category], (err, row) => {
      if (err) reject(err); else resolve(row ? row.limit_value : null);
      db.close();
    });
  });
}

export function getAllCategoryLimits(phone) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all('SELECT category, limit_value FROM category_limits WHERE phone=? ORDER BY category', [phone], (err, rows) => {
      if (err) reject(err); else resolve(rows || []);
      db.close();
    });
  });
}

export function setNotifications(phone, daily, weekly) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET notify_daily=?, notify_weekly=? WHERE phone=?', [daily ? 1 : 0, weekly ? 1 : 0, phone], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function setSheetsId(phone, sheetsId) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET sheets_id=? WHERE phone=?', [sheetsId, phone], err => {
      if (err) reject(err); else resolve();
      db.close();
    });
  });
}

export function getAllUsers() {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM users', [], (err, rows) => {
      if (err) reject(err); else resolve(rows || []);
      db.close();
    });
  });
}
