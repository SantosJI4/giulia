// Notification & scheduling module
import cron from 'node-cron';
import moment from 'moment';
import { getAllUsersTotals, getTotals, getGoal, getLeaveBank, getTotalsRange, getUserPrefs, markDailySent, markInsightSent, getMorningBriefPrefs, getCryptoWatchlist } from './db.js';
import { getCryptoPrices, getMarketNews, getInvestmentSuggestions } from './marketData.js';

let whatsappClient = null;

export function initScheduler(client) {
  whatsappClient = client;
  
  // Daily notification at 8 AM
  // Checagem dinâmica a cada 10 minutos para disparar no horário preferido do usuário
  cron.schedule('*/10 * * * *', async () => {
    await sendDailyNotificationsDynamic();
    await sendMorningBriefs();
  });

  // Weekly notification every Monday at 9 AM
  cron.schedule('0 9 * * 1', async () => {
    console.log('Running weekly notifications...');
    await sendWeeklyNotifications();
  });

  // Insight semanal todo domingo às 19h
  cron.schedule('0 19 * * 0', async () => {
    await sendWeeklyInsights();
  });
}

async function sendDailyNotificationsDynamic() {
  if (!whatsappClient) return;
  try {
    const users = await getAllUsersTotals();
    const now = moment();
    const currentHour = now.hour();
    const todayStr = now.format('YYYY-MM-DD');
    for (const user of users) {
      if (!user.notify_daily) continue;
      const prefs = await getUserPrefs(user.phone);
      if (prefs.notify_hour !== currentHour) continue;
      // Evitar duplicado no mesmo dia
      if (user.last_daily_sent === todayStr) continue;
      const phone = user.phone + '@c.us';
      const totals = await getTotals(user.phone);
      const hourlyRate = totals.salary ? totals.salary / 220 : 0;
      const overtimeValue = totals.overtime_hours * hourlyRate;
      const net = totals.salary + overtimeValue - totals.expense;
      const bank = await getLeaveBank(user.phone);
      const msg = [
        '🌅 Bom dia! Resumo diário:',
        `💰 Saldo: R$ ${net.toFixed(2)}`,
        `💸 Gastos: R$ ${totals.expense.toFixed(2)}`,
        `🏦 Banco folgas: ${bank.balance}d`,
        'Foco e disciplina! 💪'
      ].join('\n');
      await whatsappClient.sendMessage(phone, msg);
      await markDailySent(user.phone);
    }
  } catch (e) {
    console.error('Erro em notificações diárias dinâmicas:', e);
  }
}

async function sendMorningBriefs() {
  if (!whatsappClient) return;
  try {
    const users = await getAllUsersTotals();
    const now = moment();
    const currentHour = now.hour();
    const todayStr = now.format('YYYY-MM-DD');
    for (const user of users) {
      const prefs = await getMorningBriefPrefs(user.phone);
      if (!prefs.morning_brief_enabled) continue;
      if (prefs.morning_brief_hour !== currentHour) continue;
      // Evitar múltiplos envios: reutiliza last_daily_sent para now? Poderíamos ter coluna própria.
      if (user.last_daily_sent === todayStr) continue; // simples proteção para não duplicar se colidir horário
      const phone = user.phone + '@c.us';
      const totals = await getTotals(user.phone);
      const watchlist = await getCryptoWatchlist(user.phone);
      const prices = watchlist.length ? await getCryptoPrices(watchlist) : [];
      const news = await getMarketNews(3);
      const suggestions = getInvestmentSuggestions(totals);
      const priceLines = prices.length ? prices.map(p => p.error ? `${p.id.toUpperCase()}: erro ${p.error}` : `${p.id.toUpperCase()}: $${p.usd?.toFixed(2)} (${(p.change24||0).toFixed(1)}% 24h)`).join('\n') : 'Sem cripto em sua lista. Use !addcripto BTC';
      const newsLines = news.map(n => `• ${n.title.substring(0,120)}`).join('\n');
      const msg = [
        '🌄 Bom dia! Briefing de Mercado:',
        '',
        'Criptos:',
        priceLines,
        '',
        'Notícias:',
        newsLines,
        '',
        'Sugestões:',
        ...suggestions,
        '',
        'Ajustar hora: !hora_notificar HORA | Ativar/Desativar: !briefing sim|nao'
      ].join('\n');
      await whatsappClient.sendMessage(phone, msg);
      await markDailySent(user.phone); // reuso; opcional criar marca específica
    }
  } catch (e) {
    console.error('Erro em morning briefs:', e);
  }
}

async function sendWeeklyNotifications() {
  if (!whatsappClient) return;
  try {
    const users = await getAllUsersTotals();
    for (const user of users) {
      if (!user.notify_weekly) continue;
      const phone = user.phone + '@c.us';
      const totals = await getTotals(user.phone);
      const goal = await getGoal(user.phone);
      const hourlyRate = totals.salary ? totals.salary / 220 : 0;
      const overtimeValue = totals.overtime_hours * hourlyRate;
      const net = totals.salary + overtimeValue - totals.expense;
      const bank = await getLeaveBank(user.phone);
      const goalText = goal > 0 ? `Meta: R$ ${goal.toFixed(2)} (${net >= goal ? '✅' : '⏳ faltam R$ ' + (goal - net).toFixed(2)})` : 'Sem meta';
      const msg = [
        '📊 Resumo Semanal:',
        `Salários: R$ ${totals.salary.toFixed(2)}`,
        `Gastos: R$ ${totals.expense.toFixed(2)}`,
        `Saldo: R$ ${net.toFixed(2)}`,
        goalText,
        `Banco folgas: ${bank.balance}d`,
        'Continue firme! 🚀'
      ].join('\n');
      await whatsappClient.sendMessage(phone, msg);
      await markInsightSent(user.phone);
    }
  } catch (e) {
    console.error('Erro em notificações semanais:', e);
  }
}

async function sendWeeklyInsights() {
  if (!whatsappClient) return;
  try {
    const users = await getAllUsersTotals();
    const today = moment();
    const thisWeekStart = today.clone().startOf('isoWeek');
    const lastWeekStart = thisWeekStart.clone().subtract(1, 'week');
    const lastLastWeekStart = thisWeekStart.clone().subtract(2, 'week');
    const lastWeekEnd = thisWeekStart.clone().subtract(1, 'day');
    const prevWeekEnd = lastWeekStart.clone().subtract(1, 'day');

    for (const user of users) {
      const prefs = await getUserPrefs(user.phone);
      if (!prefs.insight_enabled) continue;
      const phone = user.phone + '@c.us';
      // Totais da semana passada e da semana anterior
      const week2 = await getTotalsRange(user.phone, lastWeekStart.format('YYYY-MM-DD'), lastWeekEnd.format('YYYY-MM-DD'));
      const week1 = await getTotalsRange(user.phone, lastLastWeekStart.format('YYYY-MM-DD'), prevWeekEnd.format('YYYY-MM-DD'));
      const expChange = week1.expense > 0 ? ((week2.expense - week1.expense) / week1.expense) * 100 : 0;
      const otChange = week1.overtime_hours > 0 ? ((week2.overtime_hours - week1.overtime_hours) / week1.overtime_hours) * 100 : 0;
      const hourlyRate = week2.salary ? week2.salary / 220 : 0;
      const overtimeValue = week2.overtime_hours * hourlyRate;
      const net = week2.salary + overtimeValue - week2.expense;

      const tips = [];
      if (expChange > 15) tips.push('⚖️ Gastos subiram bastante; revise categorias com mais peso.');
      if (expChange < -10) tips.push('🎯 Ótimo controle de gastos esta semana, mantenha o ritmo!');
      if (otChange > 20) tips.push('⏱️ Muitas horas extra, verifique risco de sobrecarga.');
      if (!tips.length) tips.push('✅ Semana estável. Foque em otimizar pequenos gastos.');

      const msg = [
        '🧠 Insight Semanal',
        `Gastos semana: R$ ${week2.expense.toFixed(2)} (${expChange>=0?'+':''}${expChange.toFixed(1)}% vs semana anterior)`,
        `Horas extra: ${week2.overtime_hours.toFixed(2)}h (${otChange>=0?'+':''}${otChange.toFixed(1)}%)`,
        `Saldo líquido (estimado): R$ ${net.toFixed(2)}`,
        '',
        ...tips,
        '',
        'Digite !preferencias para ajustar insights.'
      ].join('\n');
      await whatsappClient.sendMessage(phone, msg);
    }
  } catch (e) {
    console.error('Erro em insights semanais:', e);
  }
}
