import moment from 'moment';
import PDFDocument from 'pdfkit';
import { ensureUser, addEntry, updateSalary, getTotals, getLastTwoSalaries, setGoal, getGoal, getEntries, getMonthlyTotals, setExpensePercent, setExpenseValue, getAlertConfig, setMonthlySalary, getMonthlyOvertimeByDay, getMonthlyLeaves, addWorkedDay, getLeaveBank, getMonthlyWorkdays, setCategoryLimit, getCategoryLimit, getAllCategoryLimits, setNotifications, setSheetsId, getUser, setUserPrefs, getUserPrefs, setMorningBriefPrefs, getMorningBriefPrefs, addCryptoSymbol, removeCryptoSymbol, getCryptoWatchlist } from './db.js';
import { emitUpdate } from './events.js';
import { exportToSheets } from './sheets.js';
import { predictNextMonth, getCategoryBreakdown, getHistoricalData } from './analytics.js';

function formatCurrency(v) {
  return 'R$ ' + (v || 0).toFixed(2);
}

async function handleSalary(phone, parts) {
  const value = parseFloat(parts[1]);
  if (isNaN(value) || value <= 0) return '⚠️ Use: !salario VALOR (ex: !salario 4500)';
  await ensureUser(phone);
  await addEntry({ phone, type: 'salary', amount: value, description: 'Salário registrado' });
  await updateSalary(phone, value);
  const lastTwo = await getLastTwoSalaries(phone);
  let mood = '😎';
  if (lastTwo.length === 2) {
    const diff = lastTwo[0].amount - lastTwo[1].amount;
    if (diff > 0) mood = `🔥 UAU! Subiu ${formatCurrency(diff)}!`; else if (diff < 0) mood = `😔 Caiu ${formatCurrency(Math.abs(diff))}… vamos melhorar!`;
    else mood = '😐 Igual ao anterior. Vamos buscar crescimento!';
  } else {
    mood = '🚀 Primeiro salário registrado! Rumo ao topo!';
  }
  emitUpdate(phone);
  return `${mood}\nSalário atual salvo: ${formatCurrency(value)}`;
}

async function handleExpense(phone, parts) {
  const value = parseFloat(parts[1]);
  if (isNaN(value) || value <= 0) return '⚠️ Use: !gasto VALOR DESCRIÇÃO [#categoria]';
  let rawDescParts = parts.slice(2);
  let category = null;
  if (rawDescParts.length && rawDescParts[rawDescParts.length - 1].startsWith('#')) {
    category = rawDescParts.pop().slice(1);
  }
  const description = rawDescParts.join(' ') || 'Gasto';
  await ensureUser(phone);
  await addEntry({ phone, type: 'expense', amount: value, description, category });
  const totals = await getTotals(phone);
  const alerts = await getAlertConfig(phone);
  let extra = '';
  if (alerts.max_expense_percent > 0 && totals.salary > 0) {
    const pct = (totals.expense / totals.salary) * 100;
    if (pct >= alerts.max_expense_percent) {
      extra += `\n🚨 Alerta! Gastos já em ${pct.toFixed(1)}% do salário (limite ${alerts.max_expense_percent}%).`;
    }
  }
  if (alerts.max_expense_value > 0 && totals.expense >= alerts.max_expense_value) {
    extra += `\n🚨 Alerta! Total de gastos atingiu ${formatCurrency(totals.expense)} (limite ${formatCurrency(alerts.max_expense_value)}).`;
  }
  // Checagem de limite por categoria (mês atual)
  if (category) {
    const limit = await getCategoryLimit(phone, category);
    if (limit != null) {
      const entries = await getEntries(phone);
      const currentMonth = moment().format('YYYY-MM');
      const catTotal = entries
        .filter(e => e.type === 'expense' && e.category === category)
        .filter(e => moment(e.created_at).format('YYYY-MM') === currentMonth)
        .reduce((s, e) => s + (e.amount || 0), 0);
      if (catTotal >= limit) {
        extra += `\n🚨 Limite da categoria "${category}" excedido no mês (${formatCurrency(catTotal)} de ${formatCurrency(limit)}).`;
      }
    }
  }
  emitUpdate(phone);
  return `💸 Gasto registrado: ${formatCurrency(value)} (${description})${category?` [${category}]`:''}${extra}`;
}

async function handleOvertime(phone, parts) {
  const hours = parseFloat(parts[1]);
  const dateStr = parts[2];
  if (isNaN(hours) || hours <= 0) return '⚠️ Use: !horaextra HORAS [AAAA-MM-DD]';
  if (dateStr && !moment(dateStr, 'YYYY-MM-DD', true).isValid()) return '⚠️ Data inválida. Formato AAAA-MM-DD.';
  await ensureUser(phone);
  await addEntry({ phone, type: 'overtime', hours, description: `Horas extras${dateStr?` em ${dateStr}`:''}`, event_date: dateStr || null });
  emitUpdate(phone);
  return `⏱️ Horas extras registradas: ${hours.toFixed(2)}h${dateStr?` em ${dateStr}`:''}`;
}

async function handleLeave(phone, parts) {
  const dateStr = parts[1] || moment().format('YYYY-MM-DD');
  if (!moment(dateStr, 'YYYY-MM-DD', true).isValid()) return '⚠️ Use: !folga [AAAA-MM-DD]';
  await ensureUser(phone);
  await addEntry({ phone, type: 'leave', hours: 1, description: `Folga em ${dateStr}`, event_date: dateStr });
  emitUpdate(phone);
  return `🌴 Folga registrada para ${dateStr}`;
}

async function handleWorked(phone, parts) {
  const dateStr = parts[1] || moment().format('YYYY-MM-DD');
  if (!moment(dateStr, 'YYYY-MM-DD', true).isValid()) return '⚠️ Use: !trabalhei [AAAA-MM-DD]';
  await ensureUser(phone);
  await addWorkedDay(phone, dateStr);
  emitUpdate(phone);
  const bank = await getLeaveBank(phone);
  return `🧱 Dia trabalhado registrado em ${dateStr}. Banco de folgas: crédito ${bank.credit}d, débito ${bank.debit}d, saldo ${bank.balance}d.`;
}

async function handleLeaveBank(phone) {
  await ensureUser(phone);
  const bank = await getLeaveBank(phone);
  return `🏦 Banco de folgas -> Crédito: ${bank.credit}d | Débito: ${bank.debit}d | Saldo: ${bank.balance}d`;
}

async function handleReport(phone) {
  await ensureUser(phone);
  const totals = await getTotals(phone);
  const hourlyRate = totals.salary ? (totals.salary / 220) : 0; // estimativa mensal de 220h
  const overtimeValue = totals.overtime_hours * hourlyRate;
  const net = totals.salary + overtimeValue - totals.expense;
  let mood = '🤓';
  if (net > totals.salary * 0.9) mood = '😁 Ótimo desempenho!';
  if (net < totals.salary * 0.5) mood = '🥲 Precisamos cortar gastos.';
  return [
    '📊 Relatório Financeiro',
    `Salários: ${formatCurrency(totals.salary)}`,
    `Gastos: ${formatCurrency(totals.expense)}`,
    `Horas Extra: ${totals.overtime_hours.toFixed(2)}h (~${formatCurrency(overtimeValue)})`,
    `Folgas: ${totals.leave}`,
    `Saldo Líquido: ${formatCurrency(net)}`,
    mood
  ].join('\n');
}

function handleHelp() {
  return [
    '🧠 Comandos disponíveis:',
    '',
    '💬 Você pode usar linguagem natural, exemplos:',
    '  • "salario 4500"',
    '  • "gastei 25 almoço #refeicao"',
    '  • "hora extra 2 2025-12-01"',
    '  • "folga 2025-12-02"',
    '  • "trabalhei hoje"',
    '  • "meta 6000"',
    '',
    '💰 Finanças (syntaxe clássica):',
    '!salario VALOR',
    '!gasto VALOR DESCRIÇÃO [#categoria]',
    '!horaextra HORAS [AAAA-MM-DD]',
    '!folga [AAAA-MM-DD]',
    '!trabalhei [AAAA-MM-DD]',
    '!meta VALOR',
    '',
    '📊 Relatórios:',
    '!relatorio',
    '!relatoriomes AAAA-MM',
    '!bancofolgas',
    '!categorias',
    '!historico AAAA-MM AAAA-MM',
    '!previsao',
    '',
    '🔔 Configurações:',
    '!salario_mes AAAA-MM VALOR',
    '!alerta pct VALOR',
    '!alerta valor VALOR',
    '!notificar diaria|semanal sim|nao',
    '!limite_categoria CATEGORIA VALOR',
    '!limites',
    '!idioma pt|en',
    '!preferencias',
    '!hora_notificar HORA(0-23)',
    '!insight sim|nao',
    '!briefing sim|nao',
    '!briefing_hora HORA',
    '!addcripto SYMBOL',
    '!rmcripto SYMBOL',
    '!lista_cripto',
    '',
    '📤 Exportação:',
    '!exportcsv',
    '!exportpdf',
    '!exportar_sheets SHEETS_ID',
    '',
    '!ajuda',
    '!menu (versão com botões)',
    '',
    '❓ Se algo não for reconhecido, tente simplificar a frase ou usar o formato clássico.'
  ].join('\n');
}

export async function dispatchCommand(phone, text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  switch (cmd) {
    case '!salario': return handleSalary(phone, parts);
    case '!gasto': return handleExpense(phone, parts);
    case '!horaextra': return handleOvertime(phone, parts);
    case '!folga': return handleLeave(phone, parts);
    case '!trabalhei': return handleWorked(phone, parts);
    case '!relatorio': return handleReport(phone);
    case '!relatoriomes': return handleMonthlyReport(phone, parts);
    case '!salario_mes': return handleMonthlySalary(phone, parts);
    case '!meta': return handleSetGoal(phone, parts);
    case '!alerta': return handleAlertConfig(phone, parts);
    case '!bancofolgas': return handleLeaveBank(phone);
    case '!exportcsv': return handleExportCSV(phone);
    case '!exportpdf': return handleExportPDF(phone);
    case '!notificar': return handleNotifications(phone, parts);
    case '!limite_categoria': return handleCategoryLimit(phone, parts);
    case '!limites': return handleCategoryLimits(phone);
    case '!categorias': return handleCategoryBreakdownCmd(phone);
    case '!previsao': return handlePrediction(phone);
    case '!historico': return handleHistorical(phone, parts);
    case '!exportar_sheets': return handleExportSheets(phone, parts);
    case '!idioma': return handleLanguage(phone, parts);
    case '!preferencias': return handlePrefs(phone);
    case '!hora_notificar': return handleNotifyHour(phone, parts);
    case '!insight': return handleInsightToggle(phone, parts);
    case '!briefing': return handleBriefingToggle(phone, parts);
    case '!briefing_hora': return handleBriefingHour(phone, parts);
    case '!addcripto': return handleAddCrypto(phone, parts);
    case '!rmcripto': return handleRemoveCrypto(phone, parts);
    case '!lista_cripto': return handleListCrypto(phone);
    case '!menu': return handleMenu();
    case '!ajuda': return handleHelp();
    default: return '❓ Comando não reconhecido. Use !ajuda';
  }
}

async function handleSetGoal(phone, parts) {
  const value = parseFloat(parts[1]);
  if (isNaN(value) || value <= 0) return '⚠️ Use: !meta VALOR (ex: !meta 6000)';
  await ensureUser(phone);
  await setGoal(phone, value);
  return `🎯 Meta líquida definida em ${formatCurrency(value)}! Vamos superar!`; 
}

async function handleMonthlyReport(phone, parts) {
  const month = parts[1]; // YYYY-MM
  if (!month || !moment(month, 'YYYY-MM', true).isValid()) return '⚠️ Use: !relatoriomes AAAA-MM';
  await ensureUser(phone);
  const totals = await getMonthlyTotals(phone, month);
  const hourlyRate = totals.salary ? (totals.salary / 220) : 0;
  const overtimeValue = totals.overtime_hours * hourlyRate;
  const net = totals.salary + overtimeValue - totals.expense;
  const goal = await getGoal(phone);
  let goalText = goal > 0 ? `Meta: ${formatCurrency(goal)} (${net >= goal ? '✅ atingida' : '⏳ faltam ' + formatCurrency(goal - net)})` : 'Sem meta definida';
  const byDay = await getMonthlyOvertimeByDay(phone, month);
  const leaves = await getMonthlyLeaves(phone, month);
  const workdays = await getMonthlyWorkdays(phone, month);
  const overtimeLines = byDay.length ? byDay.map(r=>`  • ${r.d}: ${Number(r.h).toFixed(2)}h`).join('\n') : '  • Sem horas extras registradas';
  const leavesLines = leaves.length ? leaves.map(r=>`  • ${r.d} (${r.n} dia)`).join('\n') : '  • Sem folgas registradas';
  const workdayLines = workdays.length ? workdays.map(r=>`  • ${r.d} (+${Number(r.n)}d)`).join('\n') : '  • Sem registros de dias trabalhados';
  const workdaysTotal = workdays.reduce((s,r)=> s + Number(r.n||0), 0);
  const leavesTotal = leaves.reduce((s,r)=> s + Number(r.n||0), 0);
  const bankMonth = workdaysTotal - leavesTotal;
  return [
    `🗓️ Relatório de ${month}`,
    `Salários: ${formatCurrency(totals.salary)}`,
    `Gastos: ${formatCurrency(totals.expense)}`,
    `Horas Extra: ${totals.overtime_hours.toFixed(2)}h (~${formatCurrency(overtimeValue)})`,
    `Saldo Líquido: ${formatCurrency(net)}`,
    goalText,
    '',
    `🏦 Banco de Folgas (mês): crédito ${workdaysTotal}d, débito ${leavesTotal}d, saldo ${bankMonth}d`,
    '',
    '🧱 Dias Trabalhados:',
    workdayLines,
    '',
    '⏱️ Horas Extra por dia:',
    overtimeLines,
    '',
    '🌴 Folgas:',
    leavesLines
  ].join('\n');
}

async function handleMonthlySalary(phone, parts) {
  if (parts.length < 3) return '⚠️ Use: !salario_mes AAAA-MM VALOR';
  const month = parts[1];
  const value = parseFloat(parts[2]);
  if (!moment(month, 'YYYY-MM', true).isValid()) return '⚠️ Mês inválido. Formato AAAA-MM';
  if (isNaN(value) || value <= 0) return '⚠️ Valor inválido.';
  await ensureUser(phone);
  await setMonthlySalary(phone, month, value);
  return `💼 Salário mensal de ${month} definido em ${formatCurrency(value)}.`;
}

async function handleExportCSV(phone) {
  await ensureUser(phone);
  const entries = await getEntries(phone);
  if (!entries.length) return '📂 Nada para exportar ainda.';
  const header = 'id,type,amount,hours,description,category,event_date,created_at';
  const lines = entries.map(e => [
    e.id,
    e.type,
    e.amount || '',
    e.hours || '',
    (e.description||'').replace(/,/g,';'),
    e.category || '',
    e.event_date||'',
    e.created_at
  ].join(','));
  const csv = [header, ...lines].join('\n');
  const base64 = Buffer.from(csv, 'utf8').toString('base64');
  return { media: true, mimetype: 'text/csv', filename: 'relatorio.csv', data: base64, caption: '📄 Exportação CSV' };
}

async function handleExportPDF(phone) {
  await ensureUser(phone);
  const entries = await getEntries(phone);
  if (!entries.length) return '📂 Nada para exportar ainda.';
  const totals = await getTotals(phone);
  const goal = await getGoal(phone);
  const hourlyRate = totals.salary ? (totals.salary / 220) : 0;
  const overtimeValue = totals.overtime_hours * hourlyRate;
  const net = totals.salary + overtimeValue - totals.expense;

  const doc = new PDFDocument({ margin:40 });
  const buffers = [];
  return await new Promise((resolve, reject) => {
    doc.on('data', b => buffers.push(b));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      const base64 = pdfBuffer.toString('base64');
      resolve({ media: true, mimetype: 'application/pdf', filename: 'relatorio.pdf', data: base64, caption: '📊 Relatório PDF' });
    });
    doc.on('error', reject);
    doc.fontSize(18).text('Relatório Financeiro', { align:'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Salários: ${formatCurrency(totals.salary)}`);
    doc.text(`Gastos: ${formatCurrency(totals.expense)}`);
    doc.text(`Horas Extra: ${totals.overtime_hours.toFixed(2)}h (~${formatCurrency(overtimeValue)})`);
    doc.text(`Saldo Líquido: ${formatCurrency(net)}`);
    if (goal > 0) {
      doc.text(`Meta: ${formatCurrency(goal)} (${net >= goal ? 'atingida' : 'faltam ' + formatCurrency(goal - net)})`);
    }
    doc.moveDown();
    doc.fontSize(14).text('Entradas:');
    doc.moveDown(0.5);
    entries.forEach(e => {
      doc.fontSize(10).text(`${e.created_at} | ${e.type} | ${e.amount ?? ''} | ${e.hours ?? ''} | ${e.description}`);
    });
    doc.end();
  });
}

async function handleAlertConfig(phone, parts) {
  if (parts.length < 3) return '⚠️ Use: !alerta pct VALOR | !alerta valor VALOR';
  const kind = parts[1];
  const raw = parseFloat(parts[2]);
  if (isNaN(raw) || raw <= 0) return '⚠️ Valor inválido.';
  await ensureUser(phone);
  if (kind === 'pct') {
    await setExpensePercent(phone, raw);
    return `🔔 Alerta definido: gastos não devem ultrapassar ${raw}% do salário.`;
  } else if (kind === 'valor') {
    await setExpenseValue(phone, raw);
    return `🔔 Alerta definido: gastos não devem ultrapassar ${formatCurrency(raw)}.`;
  }
  return '⚠️ Tipo inválido. Use pct ou valor.';
}

async function handleNotifications(phone, parts) {
  if (parts.length < 3) return '⚠️ Use: !notificar diaria|semanal sim|nao';
  const tipo = parts[1].toLowerCase();
  const ativo = parts[2].toLowerCase() === 'sim';
  await ensureUser(phone);
  const user = await getUser(phone);
  if (tipo === 'diaria') {
    await setNotifications(phone, ativo, user.notify_weekly === 1);
    return ativo ? '🔔 Notificações diárias ativadas! (8h da manhã)' : '🔕 Notificações diárias desativadas.';
  } else if (tipo === 'semanal') {
    await setNotifications(phone, user.notify_daily === 1, ativo);
    return ativo ? '🔔 Notificações semanais ativadas! (Segundas às 9h)' : '🔕 Notificações semanais desativadas.';
  }
  return '⚠️ Tipo inválido. Use diaria ou semanal.';
}

async function handleCategoryLimit(phone, parts) {
  if (parts.length < 3) return '⚠️ Use: !limite_categoria CATEGORIA VALOR';
  const category = parts[1];
  const value = parseFloat(parts[2]);
  if (isNaN(value) || value <= 0) return '⚠️ Valor inválido.';
  await ensureUser(phone);
  await setCategoryLimit(phone, category, value);
  return `📌 Limite de gastos para categoria "${category}" definido em ${formatCurrency(value)}.`;
}

async function handleCategoryLimits(phone) {
  await ensureUser(phone);
  const limits = await getAllCategoryLimits(phone);
  if (!limits.length) return '📂 Nenhum limite de categoria definido ainda.';
  const lines = limits.map(l => `  • ${l.category}: ${formatCurrency(l.limit_value)}`);
  return ['🗂️ Limites por Categoria:', ...lines].join('\n');
}

async function handleCategoryBreakdownCmd(phone) {
  await ensureUser(phone);
  const breakdown = await getCategoryBreakdown(phone);
  if (!breakdown.length) return '📂 Nenhum gasto com categoria registrado ainda.';
  const total = breakdown.reduce((s, c) => s + c.total, 0);
  const lines = breakdown.map(c => {
    const pct = total > 0 ? ((c.total / total) * 100).toFixed(1) : 0;
    return `  • ${c.category}: ${formatCurrency(c.total)} (${pct}%)`;
  });
  return ['📊 Gastos por Categoria:', ...lines, '', `Total: ${formatCurrency(total)}`].join('\n');
}

async function handlePrediction(phone) {
  await ensureUser(phone);
  const prediction = await predictNextMonth(phone);
  if (prediction.error) return `⚠️ ${prediction.error}`;
  return [
    '🔮 Previsão para o próximo mês:',
    `Salário estimado: ${formatCurrency(prediction.salary)}`,
    `Gastos estimados: ${formatCurrency(prediction.expense)}`,
    `Saldo líquido previsto: ${formatCurrency(prediction.net)}`,
    '',
    `📌 Baseado na média móvel de ${prediction.months_used} ${prediction.months_used === 1 ? 'mês' : 'meses'}.`
  ].join('\n');
}

async function handleHistorical(phone, parts) {
  if (parts.length < 3) return '⚠️ Use: !historico AAAA-MM AAAA-MM';
  const startDate = parts[1];
  const endDate = parts[2];
  if (!moment(startDate, 'YYYY-MM', true).isValid() || !moment(endDate, 'YYYY-MM', true).isValid()) {
    return '⚠️ Datas inválidas. Formato AAAA-MM.';
  }
  await ensureUser(phone);
  const data = await getHistoricalData(phone, startDate, endDate);
  if (!data.length) return '📂 Nenhum dado histórico encontrado para o período.';
  const lines = data.map(d => {
    return `  • ${d.month}: Salário ${formatCurrency(d.salary)}, Gastos ${formatCurrency(d.expense)}, Líquido ${formatCurrency(d.net)}`;
  });
  return ['📈 Histórico Financeiro:', ...lines].join('\n');
}

async function handleExportSheets(phone, parts) {
  if (parts.length < 2) return '⚠️ Use: !exportar_sheets SHEETS_ID';
  const sheetsId = parts[1];
  await ensureUser(phone);
  await setSheetsId(phone, sheetsId);
  try {
    const entries = await getEntries(phone);
    const totals = await getTotals(phone);
    await exportToSheets(phone, sheetsId, entries, totals);
    return `✅ Dados exportados para Google Sheets!\nID salvo: ${sheetsId}`;
  } catch (e) {
    return `⚠️ Erro ao exportar: ${e.message}`;
  }
}

async function handleLanguage(phone, parts) {
  if (parts.length < 2) return '⚠️ Use: !idioma pt|en';
  const lang = parts[1].toLowerCase();
  if (!['pt','en'].includes(lang)) return '⚠️ Idioma inválido. Use pt ou en.';
  await ensureUser(phone);
  await setUserPrefs(phone, { language: lang });
  return `🌐 Idioma definido para ${lang === 'pt' ? 'Português' : 'English'}.`;
}

async function handlePrefs(phone) {
  await ensureUser(phone);
  const prefs = await getUserPrefs(phone);
  const brief = await getMorningBriefPrefs(phone);
  const watch = await getCryptoWatchlist(phone);
  return [
    '⚙️ Preferências:',
    `Idioma: ${prefs.language}`,
    `Timezone: ${prefs.timezone}`,
    `Hora notificações padrão: ${prefs.notify_hour}h`,
    `Insights semanais: ${prefs.insight_enabled ? 'ativados' : 'desativados'}`,
    `Briefing de mercado: ${brief.morning_brief_enabled ? 'ativado' : 'desativado'} às ${brief.morning_brief_hour}h`,
    `Criptos: ${watch.length ? watch.join(', ') : 'nenhuma'}`,
    '',
    'Alterar idioma: !idioma pt|en',
    'Alterar hora diária: !hora_notificar HORA',
    'Ativar/desativar insights: !insight sim|nao'
  ].join('\n');
}

async function handleNotifyHour(phone, parts) {
  if (parts.length < 2) return '⚠️ Use: !hora_notificar HORA(0-23)';
  const raw = parseInt(parts[1], 10);
  if (isNaN(raw) || raw < 0 || raw > 23) return '⚠️ Hora inválida. Use 0-23.';
  await ensureUser(phone);
  await setUserPrefs(phone, { notify_hour: raw });
  return `⏰ Hora das notificações diárias ajustada para ${raw}:00.`;
}

async function handleInsightToggle(phone, parts) {
  if (parts.length < 2) return '⚠️ Use: !insight sim|nao';
  const flag = parts[1].toLowerCase();
  if (!['sim','nao'].includes(flag)) return '⚠️ Valor inválido. Use sim ou nao.';
  await ensureUser(phone);
  await setUserPrefs(phone, { insight_enabled: flag === 'sim' ? 1 : 0 });
  return flag === 'sim' ? '🧠 Insights semanais ativados.' : '🧠 Insights semanais desativados.';
}

async function handleBriefingToggle(phone, parts) {
  if (parts.length < 2) return '⚠️ Use: !briefing sim|nao';
  const flag = parts[1].toLowerCase();
  if (!['sim','nao'].includes(flag)) return '⚠️ Valor inválido.';
  await ensureUser(phone);
  await setMorningBriefPrefs(phone, { enabled: flag === 'sim' ? 1 : 0 });
  return flag === 'sim' ? '📈 Briefing diário ativado.' : '📉 Briefing diário desativado.';
}

async function handleBriefingHour(phone, parts) {
  if (parts.length < 2) return '⚠️ Use: !briefing_hora HORA';
  const h = parseInt(parts[1],10);
  if (isNaN(h) || h < 0 || h > 23) return '⚠️ Hora inválida.';
  await ensureUser(phone);
  await setMorningBriefPrefs(phone, { hour: h });
  return `⏰ Briefing diário agendado para ${h}:00.`;
}

async function handleAddCrypto(phone, parts) {
  if (parts.length < 2) return '⚠️ Use: !addcripto SYMBOL';
  const symbol = parts[1].toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) return '⚠️ Símbolo inválido.';
  await ensureUser(phone);
  await addCryptoSymbol(phone, symbol);
  return `🪙 Cripto adicionada à sua lista: ${symbol}`;
}

async function handleRemoveCrypto(phone, parts) {
  if (parts.length < 2) return '⚠️ Use: !rmcripto SYMBOL';
  const symbol = parts[1].toUpperCase();
  await ensureUser(phone);
  await removeCryptoSymbol(phone, symbol);
  return `🧹 Cripto removida: ${symbol}`;
}

async function handleListCrypto(phone) {
  await ensureUser(phone);
  const list = await getCryptoWatchlist(phone);
  if (!list.length) return '🪙 Nenhuma cripto na sua lista. Use !addcripto BTC';
  return '🪙 Sua lista de criptos: ' + list.join(', ');
}

function handleMenu() {
  // Retorna estrutura para index.js montar botões.
  return {
    kind: 'buttons',
    text: 'Menu rápido – escolha uma categoria:',
    buttons: [
      { body: 'Saldo / Relatório', command: '!relatorio' },
      { body: 'Registrar Salário', command: '!ajuda salario' },
      { body: 'Registrar Gasto', command: '!ajuda gasto' },
      { body: 'Horas Extra', command: '!horaextra 1' },
      { body: 'Meta', command: '!meta 5000' },
      { body: 'Categorias', command: '!categorias' },
      { body: 'Previsão', command: '!previsao' },
      { body: 'Exportar CSV', command: '!exportcsv' }
    ]
  };
}

