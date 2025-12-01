// Google Sheets integration
import { google } from 'googleapis';

export async function exportToSheets(phone, sheetsId, entries, totals) {
  // Requires GOOGLE_APPLICATION_CREDENTIALS env var or service account JSON
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    
    const values = [
      ['ID', 'Tipo', 'Valor', 'Horas', 'Categoria', 'Data', 'Descrição'],
      ...entries.map(e => [e.id, e.type, e.amount || '', e.hours || '', e.category || '', e.event_date || e.created_at, e.description || ''])
    ];
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsId,
      range: 'Dados!A1',
      valueInputOption: 'RAW',
      resource: { values }
    });

    const summaryValues = [
      ['Resumo Financeiro'],
      ['Salários', totals.salary],
      ['Gastos', totals.expense],
      ['Horas Extra', totals.overtime_hours],
      ['Folgas', totals.leave]
    ];
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsId,
      range: 'Resumo!A1',
      valueInputOption: 'RAW',
      resource: { values: summaryValues }
    });

    return true;
  } catch (e) {
    console.error('Erro ao exportar para Google Sheets:', e.message || e);
    return false;
  }
}
