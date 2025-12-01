# WhatsApp Bot GIULIA

Bot para gerenciar informações financeiras por número (salários, gastos, horas extras, folgas) via comandos no WhatsApp, com personalidade dinâmica.

## Funcionalidades
- Registro de salário, gastos, horas extras e folgas
- Cálculo de totais e relatório consolidado
- Detecção de variação de salário (humor do bot)
- Página HTML para escanear QR (`/qr`)
- Persistência local segura em SQLite
- Exportação CSV e PDF
- Metas financeiras mensais
- Alertas configuráveis de gastos (percentual ou valor absoluto)
- Dashboard em tempo real (`/dashboard`) com gráficos (Chart.js) e Socket.IO
 - Horas extras com data por dia; folgas com data; relatório mensal detalhado
 - Categorias de gastos com alertas por categoria
 - Notificações automáticas diárias e semanais (resumos)
 - Gráfico histórico com seleção de período (dashboard)
 - Previsão simples por média móvel (comando)

## Comandos
```
!salario VALOR
!gasto VALOR [CATEGORIA] DESCRICAO   (ex: !gasto 25 [alimentacao] almoco)
!horaextra HORAS [AAAA-MM-DD]
!folga [AAAA-MM-DD]
!trabalhei [AAAA-MM-DD]
!relatorio
!relatoriomes AAAA-MM
!salario_mes AAAA-MM VALOR
!meta VALOR
!alerta pct VALOR
!alerta valor VALOR
!alerta cat [CATEGORIA] pct VALOR | valor VALOR
!alertas
!previsao [MESES]
!bancofolgas
!exportcsv
!exportpdf
!ajuda
```


```
src/
  index.js        -> servidor + eventos do bot
  db.js           -> conexão e operações SQLite
  commands.js     -> parsing e execução dos comandos
public/qr.html    -> página para escanear QR
```
