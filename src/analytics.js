// Advanced analytics and predictions
import moment from 'moment';
import { getEntries } from './db.js';

// Returns moving-average predictions for next month
// { salary, expense, net, months_used }
export async function predictNextMonth(phone) {
  const entries = await getEntries(phone);
  const byMonth = new Map();
  entries.forEach(e => {
    const m = moment(e.event_date || e.created_at).format('YYYY-MM');
    if (!byMonth.has(m)) byMonth.set(m, { salary: 0, expense: 0 });
    const rec = byMonth.get(m);
    if (e.type === 'salary') rec.salary += e.amount || 0;
    if (e.type === 'expense') rec.expense += e.amount || 0;
  });
  const months = Array.from(byMonth.keys()).sort();
  if (months.length === 0) return { error: 'Sem dados suficientes para previsão' };
  const window = months.slice(-3);
  const agg = window.reduce((acc, m) => {
    const r = byMonth.get(m);
    acc.salary += r.salary; acc.expense += r.expense; return acc;
  }, { salary: 0, expense: 0 });
  const used = window.length;
  return {
    salary: agg.salary / used,
    expense: agg.expense / used,
    net: (agg.salary - agg.expense) / used,
    months_used: used
  };
}

// Returns array [{ category, total }] optionally filtered by month
export async function getCategoryBreakdown(phone, month = null) {
  const entries = await getEntries(phone);
  let expenses = entries.filter(e => e.type === 'expense' && e.amount);
  if (month) expenses = expenses.filter(e => moment(e.event_date || e.created_at).format('YYYY-MM') === month);
  const map = new Map();
  expenses.forEach(e => {
    const cat = e.category || 'Sem categoria';
    map.set(cat, (map.get(cat) || 0) + (e.amount || 0));
  });
  return Array.from(map.entries()).map(([category, total]) => ({ category, total })).sort((a,b)=>b.total-a.total);
}

// Returns array of { month, salary, expense, net }
export async function getHistoricalData(phone, startMonth, endMonth) {
  const entries = await getEntries(phone);
  const start = moment(startMonth, 'YYYY-MM').startOf('month');
  const end = moment(endMonth, 'YYYY-MM').endOf('month');
  const filtered = entries.filter(e => {
    const d = moment(e.event_date || e.created_at);
    return d.isSameOrAfter(start) && d.isSameOrBefore(end);
  });
  const byMonth = new Map();
  filtered.forEach(e => {
    const m = moment(e.event_date || e.created_at).format('YYYY-MM');
    if (!byMonth.has(m)) byMonth.set(m, { salary: 0, expense: 0 });
    const rec = byMonth.get(m);
    if (e.type === 'salary') rec.salary += e.amount || 0;
    if (e.type === 'expense') rec.expense += e.amount || 0;
  });
  const months = Array.from(byMonth.keys()).sort();
  return months.map(m => {
    const r = byMonth.get(m);
    return { month: m, salary: r.salary, expense: r.expense, net: r.salary - r.expense };
  });
}
