// NLU simples para interpretar frases naturais em comandos padronizados.
// Retorna string de comando no formato existente (ex: '!gasto 35 almoço') ou null.

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9#\s.,:-]/g, ' ') // remove chars estranhos mantendo numeros e #
    .replace(/\s+/g, ' ') // collapse espaços
    .trim();
}

function extractNumbers(str) {
  // Captura valores monetários com possível prefixo R$, separadores de mil e decimais
  const regex = /(?:r\$\s*)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+[.,]\d+|\d+)/gi;
  const matches = [];
  let m;
  while ((m = regex.exec(str)) !== null) {
    let raw = m[1];
    // Normaliza: remove separadores de mil (.) quando formato brasileiro, ou (,)
    // Estratégia: remove todos . e , exceto o último separador decimal se houver
    const cleaned = raw.replace(/(?!^)[.,](?=\d{3}(?:[.,]|$))/g, ''); // remove milhar
    // Substitui vírgula decimal por ponto
    const normalized = cleaned.replace(/,/g, '.');
    const value = parseFloat(normalized);
    if (!isNaN(value)) matches.push(value);
  }
  return matches;
}

function extractDate(str) {
  const m = str.match(/(20\d{2}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function extractCategory(str) {
  const m = str.match(/#([a-z0-9_]+)/i);
  return m ? m[1] : null;
}

// Detecta intenção principal
export function interpret(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const original = raw.trim();
  const text = normalize(original);

  // Ajuda / comandos
  if (/\b(ajuda|help|comandos)\b/.test(text)) return '!ajuda';
  if (/\b(menu|opcoes|buttons|botoes)\b/.test(text)) return '!menu';

  // Relatorio
  if (/\b(relatorio|resumo|status)\b/.test(text)) {
    // relatorio mensal?
    const month = text.match(/(20\d{2}[-](0[1-9]|1[0-2]))/);
    if (month) return `!relatoriomes ${month[1]}`;
    return '!relatorio';
  }

  // Meta / Goal (PT/EN)
  if (/\b(meta|objetivo|goal|target)\b/.test(text) || /quero ganhar|quero receber/.test(text)) {
    const nums = extractNumbers(text);
    if (nums.length) return `!meta ${nums[0]}`;
    return '!meta 0';
  }

  // Salario / Salary / Pay
  if (/\b(salario|salary|recebi|ganhei|pay(?:ment)?|deposito|pagamento)\b/.test(text)) {
    const nums = extractNumbers(text);
    if (nums.length) return `!salario ${nums[0]}`;
    return null; // precisa valor
  }

  // Gasto / Expense / Spent - permite valor no fim ("gastei almoco 25") ou no início
  if (/\b(gasto|gastei|despesa|comprei|paguei|custou|spent|expense|buy|bought|cost)\b/.test(text)) {
    const nums = extractNumbers(text);
    let value = nums.length ? nums[0] : null;
    // Se valor não detectado no início, tenta último número como fallback (valor no fim)
    if (!value && nums.length) value = nums[nums.length - 1];
    if (!value) return null;
    const cat = extractCategory(text);
    // Remove possíveis números e palavra-chave comum da descrição
    let desc = original
      .replace(/#([a-z0-9_]+)/i, '')
      .replace(/(?:r\$\s*)?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+[.,]\d+|\d+/gi,'')
      .replace(/\b(gasto|gastei|despesa|comprei|paguei|custou|spent|expense|buy|bought|cost)\b/gi,'')
      .trim();
    desc = desc.length ? desc : 'gasto';
    return `!gasto ${value} ${desc}${cat?` #${cat}`:''}`;
  }

  // Hora extra / Overtime
  if (/\b(hora ?extra|extras|overtime)\b/.test(text)) {
    const nums = extractNumbers(text);
    const h = nums.length ? nums[0] : null;
    if (!h) return null;
    const date = extractDate(text);
    return `!horaextra ${h}${date?` ${date}`:''}`;
  }

  // Folga / Leave / Day off
  if (/\b(folga|descanso|ferias|day off|leave|pto)\b/.test(text)) {
    const date = extractDate(text);
    return `!folga${date?` ${date}`:''}`;
  }

  // Dia trabalhado / Workday
  if (/\b(trabalhei|dia trabalhado|workday|worked today|worked)\b/.test(text)) {
    const date = extractDate(text);
    return `!trabalhei${date?` ${date}`:''}`;
  }

  // Banco de folgas / Leave bank
  if (/\b(banco de folgas|banco folgas|folgas saldo|leave bank)\b/.test(text)) return '!bancofolgas';

  // Categorias / Categories breakdown
  if (/\b(categorias|gastos por categoria|category breakdown|categories)\b/.test(text)) return '!categorias';

  // Previsao / Forecast
  if (/\b(previsao|previsao proximo mes|prever|forecast|prediction)\b/.test(text)) return '!previsao';

  // Historico / History
  if (/\b(historico|historico de|history|historical)\b/.test(text)) {
    const months = text.match(/(20\d{2}-\d{2})/g);
    if (months && months.length >= 2) return `!historico ${months[0]} ${months[1]}`;
    return null;
  }

  // Exportacao / Export
  if (/\b(exportar csv|csv|planilha|exportar planilha|export csv|spreadsheet)\b/.test(text)) return '!exportcsv';
  if (/\b(exportar pdf|pdf relatorio|export pdf)\b/.test(text)) return '!exportpdf';

  // Notificacoes / Notifications
  if (/\b(ativar notificacoes diarias|enable daily notifications)\b/.test(text)) return '!notificar diaria sim';
  if (/\b(desativar notificacoes diarias|disable daily notifications)\b/.test(text)) return '!notificar diaria nao';
  if (/\b(ativar notificacoes semanais|enable weekly notifications)\b/.test(text)) return '!notificar semanal sim';
  if (/\b(desativar notificacoes semanais|disable weekly notifications)\b/.test(text)) return '!notificar semanal nao';

  // Idioma / Language
  if (/\b(idioma ingles|english language|set english|english)\b/.test(text)) return '!idioma en';
  if (/\b(idioma portugues|portuguese language|set portuguese|portugues)\b/.test(text)) return '!idioma pt';

  // Insights toggle
  if (/\b(ativar insights|enable insights)\b/.test(text)) return '!insight sim';
  if (/\b(desativar insights|disable insights)\b/.test(text)) return '!insight nao';

  // Hora notificar / notification hour
  if (/\b(hora notificacao|hora notificar|notification hour|notify hour)\b/.test(text)) {
    const num = extractNumber(text);
    if (num != null && num >=0 && num <=23) return `!hora_notificar ${num}`;
    return null;
  }

  return null; // nada reconhecido
}

export default interpret;

// Sugestões quando não reconhecido
export function suggest(raw) {
  if (!raw) return [];
  const t = normalize(raw);
  const hints = [];
  if (/sal/.test(t)) hints.push('Ex: salario 4500');
  if (/gast|desp|spent|expens/.test(t)) hints.push('Ex: gastei 25 lanche');
  if (/meta|goal|target/.test(t)) hints.push('Ex: meta 6000');
  if (/hora/.test(t)) hints.push('Ex: hora extra 2');
  if (/folg|leave|day off/.test(t)) hints.push('Ex: folga 2025-12-10');
  if (/trabalh|work/.test(t)) hints.push('Ex: trabalhei hoje');
  if (/prev|forecast|predict/.test(t)) hints.push('Ex: previsao');
  if (/hist/.test(t)) hints.push('Ex: historico 2025-09 2025-12');
  if (/categ/.test(t)) hints.push('Ex: categorias');
  if (/csv|sheet|plan/.test(t)) hints.push('Ex: exportar csv');
  if (!hints.length) hints.push('Ex: gasto 20 cafe');
  return hints.slice(0,3);
}