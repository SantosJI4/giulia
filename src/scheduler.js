// Notification & scheduling module
import cron from 'node-cron';
import moment from 'moment';
import { getAllUsersTotals, getTotals, getGoal, getLeaveBank } from './db.js';

let whatsappClient = null;

export function initScheduler(client) {
  whatsappClient = client;
  
  // Daily notification at 8 AM
  cron.schedule('0 8 * * *', async () => {
    console.log('Running daily notifications...');
    await sendDailyNotifications();
  });

  // Weekly notification every Monday at 9 AM
  cron.schedule('0 9 * * 1', async () => {
    console.log('Running weekly notifications...');
    await sendWeeklyNotifications();
  });
}

async function sendDailyNotifications() {
  if (!whatsappClient) return;
  try {
    const users = await getAllUsersTotals();
    for (const user of users) {
      if (!user.notify_daily) continue;
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
        'Ótimo dia! 💪'
      ].join('\n');
      await whatsappClient.sendMessage(phone, msg);
    }
  } catch (e) {
    console.error('Erro em notificações diárias:', e);
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
    }
  } catch (e) {
    console.error('Erro em notificações semanais:', e);
  }
}
