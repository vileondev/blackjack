# Blackjack

Blackjack no navegador, mobile first, que funciona offline (PWA) e guarda tudo no aparelho.

## Como jogar
1. Na primeira vez, defina o **dinheiro inicial**, a **quantidade de baralhos** (1 a 8) e quando o sapato é embaralhado.
2. Antes de cada rodada, faça a aposta (digite o valor ou toque nas fichas).
3. Jogue com **Hit**, **Stand** e **Double** (Double só nas 2 primeiras cartas e se houver saldo).

## Regras
- Sapato real com N baralhos de 52 cartas: as cartas saem de verdade e só voltam quando o sapato é embaralhado, então dá para contar cartas.
- O sapato é embaralhado ao fim da rodada em que sobrar menos que a porcentagem escolhida (50%, 25% ou 15%).
- Blackjack paga 3:2. A mesa compra até 17 e para em todo 17 (inclusive soft 17).
- A mesa confere blackjack quando mostra Ás ou carta de valor 10.
- Sem split e sem seguro.

## Menu (☰): trapaças e contagem
- Adicionar ou definir dinheiro, ganhar a rodada atual, armar blackjack na próxima mão.
- Ver a carta virada da mesa, ver as próximas cartas do sapato e escolher a próxima carta.
- Contagem Hi-Lo (running count e true count), cartas não vistas por valor e dica de estratégia básica.
- Estatísticas e novo jogo.

## Offline e salvamento
- Tudo (banca, sapato, rodada em andamento e opções) fica no `localStorage` do aparelho.
- O `sw.js` guarda os arquivos do jogo para abrir sem internet. **Ao mudar qualquer arquivo, aumente `VERSION` no `sw.js`.**
- Para instalar: abra o site no celular e use "Adicionar à tela inicial" (iPhone: Safari → Compartilhar; Android: menu do Chrome → Instalar app).

## Rodar localmente
Precisa ser servido por HTTP (o service worker não funciona abrindo o arquivo direto):
```
python3 -m http.server 8080
```
e abra http://localhost:8080.

Testes do motor do jogo: `npm test` (Node 18+).

## Estrutura
- `index.html`, `css/style.css`: interface
- `js/engine.js`: regras (sapato, valores, pagamentos, Hi-Lo, estratégia básica)
- `js/app.js`: rodadas, aposta, trapaças e salvamento
- `sw.js`, `manifest.webmanifest`, `icons/`: PWA
