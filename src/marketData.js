// Módulo de coleta de dados de mercado: preços cripto, notícias, sugestão simples.
// NOTA: Para evitar dependências externas pesadas, usamos fetch simples e APIs públicas.
// Ajuste endpoints conforme necessidade real e adicione chaves se necessário.

import fetch from 'node-fetch';

export async function getCryptoPrices(symbols = []) {
  if (!symbols.length) return [];
  // Usando CoinGecko simples
  const joined = symbols.map(s => s.toLowerCase()).join(',');
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${joined}&vs_currencies=usd,brl&include_24hr_change=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return Object.entries(json).map(([id, data]) => ({
      id,
      usd: data.usd,
      brl: data.brl,
      change24: data.usd_24h_change
    }));
  } catch (e) {
    return symbols.map(s => ({ id: s, error: e.message }));
  }
}

export async function getMarketNews(limit = 3) {
  // Placeholder simples usando RSS de economia/finanças - pode ser adaptado
  // Para simplificar, retornamos estrutura mock se falhar.
  const feedUrls = [
    'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL&region=US&lang=en-US',
    'https://www.infomoney.com.br/feed/'
  ];
  const items = [];
  for (const f of feedUrls) {
    try {
      const res = await fetch(f, { timeout: 8000 });
      if (!res.ok) continue;
      const text = await res.text();
      // Extração bem simples de <title> ... </title>
      const titles = [...text.matchAll(/<title>([^<]+)<\/title>/g)].map(m => m[1]).slice(1); // pula o primeiro (feed title)
      for (const t of titles) {
        if (items.length < limit) items.push({ title: t }); else break;
      }
    } catch {}
    if (items.length >= limit) break;
  }
  if (!items.length) {
    return [
      { title: 'Mercado estável, sem grandes movimentos reportados.' },
      { title: 'Acompanhe seus gastos para investir melhor.' }
    ].slice(0, limit);
  }
  return items.slice(0, limit);
}

export function getInvestmentSuggestions(totals) {
  // Heurística simples baseada em proporção de gastos vs salário
  const suggestions = [];
  const salary = totals.salary || 0;
  const expense = totals.expense || 0;
  if (salary > 0) {
    const pct = (expense / salary) * 100;
    if (pct < 40) suggestions.push('Você mantém bons níveis de gasto: considere aportar em renda fixa (Tesouro Selic/CDI).');
    else if (pct < 70) suggestions.push('Reduza gastos supérfluos para liberar capital para investimentos mensais.');
    else suggestions.push('Gastos altos: priorize quitação de dívidas antes de novos aportes.');
  } else {
    suggestions.push('Registre seu salário para gerar sugestões mais precisas.');
  }
  suggestions.push('Diversifique: considere alocar parte em ETFs globais para proteção cambial.');
  return suggestions;
}
