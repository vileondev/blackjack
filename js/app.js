import {
  RANKS, SUIT_SYMBOL, RED, createShoe, handValue, handLabel, isBlackjack, cardValue,
  hiLo, dealerShouldHit, settle, basicStrategy, canSplitCards,
} from './engine.js';
import * as sound from './sound.js';

const KEY = 'blackjack:v1';
const MAX_HANDS = 4;
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (n) => Math.round(n * 100) / 100;

/* ---------------- Estado e armazenamento local ---------------- */
let S = null;          // estado salvo
let busy = false;      // bloqueia comandos durante animações
let dealShown = null;  // durante a distribuição: quantas cartas já aparecem (ordem J, M, J, M)

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* armazenamento cheio ou bloqueado */ }
}
/** Converte saves antigos (uma mão só) para o formato com várias mãos. */
function migrate(s) {
  if (!s || !s.settings) return null;
  if (!s.hands) {
    s.hands = s.player && s.player.length ? [newHand(s.player, s.bet || 0, { doubled: !!s.doubled })] : [];
    s.cur = 0;
    delete s.player; delete s.doubled;
  }
  s.opts = { sound: true, ...s.opts };
  return s;
}

function newHand(cards, bet, extra = {}) {
  return { cards, bet, doubled: false, split: false, aces: false, done: false, ...extra };
}

function newState(money, decks, pen, opts) {
  return {
    v: 1,
    settings: { decks, pen, startMoney: money },
    money,
    shoe: createShoe(decks),
    phase: 'bet',           // bet | player | dealer | done
    lastBet: Math.min(25, money) || 0,
    hands: [], cur: 0, dealer: [], holeHidden: true,
    result: null,           // { outcome, payout, net, hands: [...] }
    rigBJ: false,
    round: 0,
    opts: { showHole: false, showNext: false, showCount: false, showHint: false, sound: true, ...opts },
    stats: { hands: 0, wins: 0, losses: 0, pushes: 0, bj: 0, best: money },
  };
}

const total = () => S.settings.decks * 52;
const hand = () => S.hands[S.cur];
const totalBet = () => S.hands.reduce((a, h) => a + h.bet, 0);

/* ---------------- Utilidades ---------------- */
function fmt(n) {
  const v = round2(n);
  return '$' + v.toLocaleString('pt-BR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
function parseMoney(str) {
  let s = String(str).trim().replace(/[\s$]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : NaN;
}
let toastT;
function toast(m) {
  const t = $('#toast'); t.textContent = m; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
}
function bump(dir) {
  const b = $('.bank'); b.classList.remove('up', 'down'); void b.offsetWidth; b.classList.add(dir);
}

/* ---------------- Sapato ---------------- */
function reshuffle(silent) {
  S.shoe = createShoe(S.settings.decks);
  if (!silent) { toast(`Sapato embaralhado · ${total()} cartas`); sound.play('shuffle'); }
}
function draw() {
  if (!S.shoe.length) reshuffle();
  return S.shoe.pop();
}
/** Tira do sapato uma carta que satisfaça `test` (de preferência a mais próxima do topo). */
function takeFromShoe(test) {
  for (let i = S.shoe.length - 1; i >= 0; i--) if (test(S.shoe[i])) return S.shoe.splice(i, 1)[0];
  return null;
}
/** Cartas que o jogador ainda não viu: o que resta no sapato + a carta virada da mesa. */
function unseen() {
  const u = S.shoe.slice();
  if (S.holeHidden && S.dealer[1] && S.phase === 'player') u.push(S.dealer[1]);
  return u;
}
function countInfo() {
  const u = unseen();
  const rc = -u.reduce((a, c) => a + hiLo(c), 0); // o sapato inteiro soma zero no Hi-Lo
  const decksLeft = u.length / 52;
  const tc = decksLeft > 0 ? rc / decksLeft : 0;
  return { rc, tc, left: u.length, decksLeft, u };
}

/* ---------------- Rodada ---------------- */
function canAct() { return S.phase === 'player' && !busy && dealShown == null && hand() && !hand().done; }
function canDouble() {
  const h = hand();
  return S.phase === 'player' && h && h.cards.length === 2 && !h.doubled && !h.aces && S.money >= h.bet;
}
function canSplit() {
  const h = hand();
  return S.phase === 'player' && h && canSplitCards(h.cards) && S.hands.length < MAX_HANDS && !h.aces && S.money >= h.bet;
}

async function deal(bet) {
  if (busy) return;
  busy = true;
  S.money = round2(S.money - bet); S.lastBet = bet;
  S.dealer = []; S.holeHidden = true; S.result = null; S.cur = 0;
  S.hands = [newHand([], bet)];
  S.round++;

  if (S.rigBJ) rigBlackjack();
  // Ordem real de distribuição: jogador, mesa, jogador, mesa (virada)
  const p = S.hands[0].cards;
  p.push(draw()); S.dealer.push(draw()); p.push(draw()); S.dealer.push(draw());
  S.phase = 'player';
  save();

  hideSheet('#bet-sheet');
  document.body.classList.remove('betting');
  sound.play('bet');
  bump('down');
  for (dealShown = 1; dealShown <= 4; dealShown++) { render(); sound.play('card'); await sleep(260); }
  dealShown = null; render();

  const up = S.dealer[0];
  const peek = up.r === 'A' || cardValue(up) === 10;
  if ((peek && isBlackjack(S.dealer)) || isBlackjack(p)) {
    await sleep(350);
    busy = false;
    return finish();
  }
  busy = false;
  render();
}

function rigBlackjack() {
  S.rigBJ = false;
  const ace = takeFromShoe((c) => c.r === 'A');
  const ten = takeFromShoe((c) => cardValue(c) === 10);
  const low1 = takeFromShoe((c) => cardValue(c) >= 2 && cardValue(c) <= 9);
  const low2 = takeFromShoe((c) => cardValue(c) >= 2 && cardValue(c) <= 9);
  const got = [ace, ten, low1, low2];
  if (got.some((c) => !c)) { got.forEach((c) => c && S.shoe.push(c)); toast('Não há cartas suficientes no sapato para armar o blackjack'); return; }
  // pop() tira do fim: empilhamos ao contrário da ordem de saída (J1, M1, J2, M2)
  S.shoe.push(low2, ten, low1, ace);
}

/** Encerra a mão atual e passa para a próxima (ou para a mesa). */
async function nextHand() {
  hand().done = true;
  while (S.cur < S.hands.length - 1) {
    S.cur++;
    const h = hand();
    if (h.cards.length === 1) {                // mão vinda de split: recebe a 2ª carta agora
      busy = true; save(); render(); await sleep(300);
      h.cards.push(draw()); sound.play('card'); save(); render();
      await sleep(350); busy = false;
      if (h.aces || handValue(h.cards).total === 21) { h.done = true; continue; }
    }
    if (!h.done) { save(); render(); return; }
  }
  // Todas as mãos jogadas
  const alive = S.hands.some((h) => handValue(h.cards).total <= 21);
  if (!alive) { busy = true; await sleep(400); busy = false; return finish(); }
  S.phase = 'dealer'; save();
  return dealerPlay();
}

async function hit() {
  if (!canAct()) return;
  const h = hand();
  h.cards.push(draw()); sound.play('card'); save(); render();
  const t = handValue(h.cards).total;
  if (t > 21) { sound.play('bust'); busy = true; await sleep(450); busy = false; return nextHand(); }
  if (t === 21) { busy = true; await sleep(250); busy = false; return nextHand(); }
}

async function stand() {
  if (!canAct()) return;
  sound.play('tap');
  return nextHand();
}

async function double() {
  if (!canAct() || !canDouble()) return;
  const h = hand();
  S.money = round2(S.money - h.bet); h.bet *= 2; h.doubled = true;
  sound.play('chip'); bump('down');
  h.cards.push(draw()); sound.play('card'); save(); render();
  busy = true; await sleep(500); busy = false;
  if (handValue(h.cards).total > 21) sound.play('bust');
  return nextHand();
}

async function split() {
  if (!canAct() || !canSplit()) return;
  const h = hand();
  const aces = h.cards[0].r === 'A';
  S.money = round2(S.money - h.bet);
  const second = h.cards.pop();
  h.split = true; h.aces = aces;
  S.hands.splice(S.cur + 1, 0, newHand([second], h.bet, { split: true, aces }));
  sound.play('chip'); bump('down');
  busy = true; save(); render(); await sleep(350);
  h.cards.push(draw()); sound.play('card'); save(); render();
  await sleep(350); busy = false;
  if (aces || handValue(h.cards).total === 21) return nextHand();
  render();
}

async function dealerPlay() {
  busy = true;
  S.holeHidden = false; save(); render(); sound.play('flip');
  await sleep(600);
  while (S.phase === 'dealer' && dealerShouldHit(S.dealer)) {
    S.dealer.push(draw()); sound.play('card'); save(); render();
    await sleep(650);
  }
  busy = false;
  if (S.phase === 'dealer') finish();
}

function finish(forced) {
  if (S.phase !== 'player' && S.phase !== 'dealer') return;
  if (S.holeHidden) sound.play('flip');
  S.holeHidden = false;
  const results = S.hands.map((h) => (forced ? { outcome: 'win', payout: h.bet * 2 } : settle(h.cards, S.dealer, h.bet, h.split)));
  const payout = results.reduce((a, r) => a + r.payout, 0);
  const bet = totalBet();
  const net = round2(payout - bet);
  S.money = round2(S.money + payout);
  let outcome = net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
  if (results.length === 1) outcome = results[0].outcome;
  S.result = { outcome, payout, net, bet, forced: !!forced, hands: results.map((r) => r.outcome) };

  const st = S.stats;
  results.forEach((r) => {
    st.hands++;
    if (r.outcome === 'win' || r.outcome === 'blackjack') st.wins++;
    if (r.outcome === 'blackjack') st.bj++;
    if (r.outcome === 'lose') st.losses++;
    if (r.outcome === 'push') st.pushes++;
  });
  st.best = Math.max(st.best, S.money);
  S.phase = 'done';
  save();
  if (payout > 0) bump('up');
  sound.play(outcome === 'blackjack' ? 'blackjack' : outcome === 'win' ? 'win' : outcome === 'push' ? 'push' : 'lose');
  render();
  setTimeout(() => {
    if (S.phase !== 'done') return;
    if (S.shoe.length < total() * S.settings.pen) { reshuffle(); save(); }
    openBet();
  }, 2200);
}

/* ---------------- Renderização ---------------- */
function cardEl(card) {
  const el = document.createElement('div');
  const sym = SUIT_SYMBOL[card.s];
  el.className = 'card deal';
  el.innerHTML = `<div class="in"><div class="face${RED[card.s] ? ' red' : ''}"><span class="rk">${card.r}</span><span class="st">${sym}</span></div><div class="back"></div></div>`;
  el.dataset.label = `${card.r} de ${{ s: 'espadas', h: 'copas', d: 'ouros', c: 'paus' }[card.s]}`;
  el.dataset.key = card.r + card.s;
  el.setAttribute('role', 'img');
  el.addEventListener('animationend', () => el.classList.remove('deal'), { once: true });
  return el;
}

function renderHand(box, cards, hideIndex) {
  if (box.dataset.round !== String(S.round)) { box.innerHTML = ''; box.dataset.round = S.round; }
  // Remove cartas que não pertencem mais a esta posição (ex.: a 2ª carta que foi para outra mão no split)
  for (let i = box.children.length - 1; i >= 0; i--) {
    if (i >= cards.length || box.children[i].dataset.key !== cards[i].r + cards[i].s) box.children[i].remove();
  }
  cards.forEach((c, i) => {
    let el = box.children[i];
    if (!el) { el = cardEl(c); box.appendChild(el); }
    const down = i === hideIndex && !S.opts.showHole;
    el.classList.toggle('down', down);
    el.classList.toggle('peek', i === hideIndex && S.opts.showHole);
    el.setAttribute('aria-label', down ? 'Carta virada' : el.dataset.label);
  });
}

function visibleHands() {
  if (dealShown == null) return { hs: S.hands.map((h) => h.cards), d: S.dealer };
  const p = [], d = [];
  const pc = S.hands[0].cards;
  for (let i = 0; i < dealShown; i++) (i % 2 ? d : p).push(i % 2 ? S.dealer[(i - 1) / 2] : pc[i / 2]);
  return { hs: [p], d };
}

const OUT_LABEL = { win: 'ganhou', blackjack: 'blackjack', push: 'empate', lose: 'perdeu' };

function renderPlayer(hs) {
  const wrap = $('#player-hands');
  if (wrap.dataset.round !== String(S.round)) { wrap.innerHTML = ''; wrap.dataset.round = S.round; }
  while (wrap.children.length > hs.length) wrap.lastChild.remove();
  while (wrap.children.length < hs.length) {
    const g = document.createElement('div');
    g.className = 'phand';
    g.innerHTML = '<div class="hand"></div><div class="sum small-sum"></div>';
    wrap.appendChild(g);
  }
  const multi = hs.length > 1;
  wrap.classList.toggle('multi', multi);
  wrap.classList.toggle('many', hs.length > 2);
  hs.forEach((cards, i) => {
    const g = wrap.children[i];
    const h = S.hands[i];
    renderHand($('.hand', g), cards, -1);
    const sum = $('.sum', g);
    let label = cards.length ? (h && h.split && cards.length === 2 && handValue(cards).total === 21 ? '21' : handLabel(cards)) : '';
    if (multi && h) label += ` · ${fmt(h.bet)}`;
    if (S.phase === 'done' && S.result && S.result.hands[i] && multi) label += ` · ${OUT_LABEL[S.result.hands[i]]}`;
    sum.textContent = label;
    const t = cards.length ? handValue(cards).total : 0;
    sum.classList.toggle('bust', t > 21);
    sum.classList.toggle('bj', !(h && h.split) && isBlackjack(cards));
    g.classList.toggle('active', multi && S.phase === 'player' && i === S.cur);
    g.classList.toggle('waiting', multi && S.phase === 'player' && i !== S.cur);
    g.classList.toggle('res-win', S.phase === 'done' && multi && /win|blackjack/.test(S.result?.hands[i] || ''));
    g.classList.toggle('res-lose', S.phase === 'done' && multi && S.result?.hands[i] === 'lose');
  });
}

function render() {
  if (!S) return;
  $('#money').textContent = fmt(S.money);
  const ci = countInfo();
  $('#shoe-left').innerHTML = `<b>${S.shoe.length}</b> / ${total()}`;

  const { hs, d } = visibleHands();
  const hideIdx = S.holeHidden && S.phase !== 'done' ? 1 : -1;
  renderPlayer(hs);
  renderHand($('#dealer-hand'), d, hideIdx);

  const ds = $('#dealer-sum');
  const dVisible = hideIdx === 1 && !S.opts.showHole ? d.slice(0, 1) : d;
  ds.textContent = dVisible.length ? handLabel(dVisible) : '';
  ds.classList.toggle('bust', d.length > 0 && hideIdx !== 1 && handValue(d).total > 21);
  ds.classList.toggle('bj', hideIdx !== 1 && isBlackjack(d));

  // Ficha da aposta no centro (soma de todas as mãos)
  const chip = $('#bet-chip');
  const tb = totalBet();
  chip.hidden = !(S.phase === 'player' || S.phase === 'dealer' || S.phase === 'done') || !tb;
  const badge = S.hands.length > 1 ? `${S.hands.length} mãos` : S.hands[0]?.doubled ? '×2' : '';
  chip.innerHTML = `<span>${fmt(tb)}</span>${badge ? `<small>${badge}</small>` : ''}`;

  // Botões: Double e Split só aparecem quando estão disponíveis
  const playing = canAct();
  $('#actions').classList.toggle('off', !playing);
  $('#btn-hit').disabled = !playing;
  $('#btn-stand').disabled = !playing;
  $('#btn-double').hidden = !(playing && canDouble());
  $('#btn-split').hidden = !(playing && canSplit());

  // Mensagem de resultado
  const msg = $('#msg');
  msg.className = 'msg';
  if (S.phase === 'done' && S.result) {
    const r = S.result;
    msg.textContent = resultText(r) + (r.forced ? ' 🃏' : '');
    msg.classList.add('on', r.outcome === 'blackjack' ? 'bj' : r.outcome === 'win' ? 'win' : r.outcome === 'lose' ? 'lose' : 'push');
  } else msg.textContent = '';

  // Contagem e dica
  const hud = $('#count-hud');
  hud.hidden = !S.opts.showCount;
  if (S.opts.showCount) hud.innerHTML = `RC <b>${ci.rc > 0 ? '+' : ''}${ci.rc}</b> · TC <b>${ci.tc > 0 ? '+' : ''}${ci.tc.toFixed(1)}</b> · <b>${ci.decksLeft.toFixed(1)}</b> baralhos`;
  const hint = $('#hint');
  const showHint = S.opts.showHint && playing;
  hint.hidden = !showHint;
  if (showHint) {
    const a = basicStrategy(hand().cards, S.dealer[0], canDouble(), canSplit());
    hint.innerHTML = `Estratégia básica: <b>${{ hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split' }[a]}</b>`;
  }

  if (!$('#menu-sheet').hidden) renderMenu();
}

function resultText(r) {
  if (r.hands && r.hands.length > 1) {
    if (r.net > 0) return `Você ganhou +${fmt(r.net)}`;
    if (r.net < 0) return `Você perdeu −${fmt(-r.net)}`;
    return 'Empate no total';
  }
  const busted = S.hands[0] && handValue(S.hands[0].cards).total > 21;
  return {
    blackjack: `Blackjack! +${fmt(r.net)}`,
    win: `Você ganhou +${fmt(r.net)}`,
    push: 'Empate',
    lose: busted ? `Estourou −${fmt(r.bet)}` : `Mesa ganhou −${fmt(r.bet)}`,
  }[r.outcome];
}

/* ---------------- Aposta ---------------- */
function openBet() {
  const inp = $('#bet-input');
  const v = Math.min(S.lastBet || 0, S.money);
  inp.value = v > 0 ? String(v).replace('.', ',') : '';
  fitBet();
  $('#bet-max').textContent = `Máximo ${fmt(S.money)}`;
  const last = $('#bet-last');
  last.hidden = !(S.phase === 'done' && S.result);
  if (!last.hidden) {
    const r = S.result;
    last.className = 'last ' + (r.outcome === 'blackjack' ? 'bj' : r.outcome === 'win' ? 'win' : r.outcome === 'lose' ? 'lose' : '');
    last.textContent = `${resultText(r)} · ${S.hands.map((h) => handLabel(h.cards)).join(' / ')} × ${handLabel(S.dealer)}`;
  }
  $('#bet-err').textContent = S.money <= 0 ? 'Sem dinheiro. Use as trapaças ou comece um novo jogo.' : '';
  $('#deal-btn').disabled = S.money <= 0;
  showSheet('#bet-sheet');
  document.body.classList.add('betting');
  placeBetLayer();
}
/** A tela de aposta começa logo abaixo da banca, para nunca ficar por cima dela. */
function placeBetLayer() {
  const layer = $('#bet-sheet');
  if (layer.hidden) return;
  const r = $('.bank').getBoundingClientRect();
  layer.style.top = Math.round(r.bottom + 14) + 'px';
}
addEventListener('resize', placeBetLayer);
function betValue() { return parseMoney($('#bet-input').value) || 0; }
function fitBet() { const i = $('#bet-input'); i.style.width = (Math.max(1, i.value.length) + 0.5) + 'ch'; }
function setBet(v) {
  v = Math.max(0, Math.min(round2(v), S.money));
  $('#bet-input').value = v ? String(v).replace('.', ',') : '';
  $('#bet-err').textContent = '';
  fitBet();
}

/* ---------------- Menu (trapaças) ---------------- */
function renderMenu() {
  const ci = countInfo();
  // Próxima carta: quantas de cada valor ainda há no sapato
  const inShoe = {}; RANKS.forEach((r) => (inShoe[r] = 0)); S.shoe.forEach((c) => inShoe[c.r]++);
  $$('#pick-rank button').forEach((b) => { const r = b.dataset.r; b.disabled = !inShoe[r]; $('small', b).textContent = inShoe[r]; });

  const nx = $('#next-cards');
  nx.hidden = !S.opts.showNext;
  if (S.opts.showNext) {
    nx.innerHTML = S.shoe.slice(-10).reverse().map((c) => `<span class="mini${RED[c.s] ? ' red' : ''}">${c.r}${SUIT_SYMBOL[c.s]}</span>`).join('') || '<span class="mut">Sapato vazio</span>';
  }

  // Composição das cartas não vistas (para contagem)
  const seen = {}; RANKS.forEach((r) => (seen[r] = 0)); ci.u.forEach((c) => seen[c.r]++);
  const per = S.settings.decks * 4;
  $('#composition').innerHTML =
    `<div class="info"><span>Não vistas <b>${ci.left}</b> de ${total()}</span><span>RC <b>${ci.rc > 0 ? '+' : ''}${ci.rc}</b> · TC <b>${ci.tc > 0 ? '+' : ''}${ci.tc.toFixed(1)}</b></span></div>` +
    RANKS.map((r) => `<div title="${r}: ${seen[r]} de ${per}"><b>${seen[r]}</b>${r}</div>`).join('');

  const st = S.stats;
  $('#stats').innerHTML = `<div><b>${st.hands}</b>mãos</div><div><b>${st.wins}</b>vitórias</div><div><b>${st.losses}</b>derrotas</div>
    <div><b>${st.pushes}</b>empates</div><div><b>${st.bj}</b>blackjacks</div><div><b>${fmt(st.best)}</b>recorde</div>`;

  $('#cheat-hole').checked = S.opts.showHole;
  $('#cheat-next').checked = S.opts.showNext;
  $('#opt-count').checked = S.opts.showCount;
  $('#opt-hint').checked = S.opts.showHint;
  $('#opt-sound').checked = S.opts.sound;
  $('#cheat-bj').textContent = S.rigBJ ? 'Blackjack armado ✓' : 'Próxima mão: blackjack';
}

function cheatMoney(mode) {
  const v = parseMoney($('#cheat-amount').value);
  if (!Number.isFinite(v) || v < 0) return toast('Valor inválido');
  S.money = mode === 'add' ? round2(S.money + v) : v;
  S.stats.best = Math.max(S.stats.best, S.money);
  save(); bump('up'); sound.play('bet'); render();
  if (!$('#bet-sheet').hidden) openBet();
  toast(mode === 'add' ? `+${fmt(v)} na banca` : `Banca definida em ${fmt(v)}`);
}

function cheatWin() {
  if (S.phase !== 'player' && S.phase !== 'dealer') return toast('Comece uma rodada primeiro');
  if (busy && S.phase === 'player') return toast('Aguarde as cartas');
  finish(true);
  hideSheet('#menu-sheet');
}

function pickNext(r) {
  const c = takeFromShoe((x) => x.r === r);
  if (!c) return toast(`Não há mais ${r} no sapato`);
  S.shoe.push(c); save(); render();
  sound.play('tap');
  toast(`Próxima carta: ${c.r}${SUIT_SYMBOL[c.s]}`);
}

/* ---------------- Sheets ---------------- */
function showSheet(id) { $(id).hidden = false; }
function hideSheet(id) { $(id).hidden = true; }

/* ---------------- Inicialização ---------------- */
function showSetup() {
  $('#table').hidden = true; hideSheet('#bet-sheet'); hideSheet('#menu-sheet');
  $('#setup').hidden = false;
}
async function startTable() {
  $('#setup').hidden = true; $('#table').hidden = false;
  sound.setEnabled(S.opts.sound);
  render();
  if (S.phase === 'dealer') return dealerPlay();
  if (S.phase === 'player') {
    const h = hand();
    const first = S.hands.length === 1 && h.cards.length === 2;
    const up = S.dealer[0];
    if (first && (isBlackjack(h.cards) || (isBlackjack(S.dealer) && (up.r === 'A' || cardValue(up) === 10)))) return finish();
    if (h.done || h.cards.length === 1) {          // app fechou no meio de um split
      if (h.cards.length === 1) { h.cards.push(draw()); save(); render(); }
      if (h.done || h.aces) return nextHand();
    }
    return;
  }
  openBet();
}

function bindSetup() {
  let decks = 6;
  const out = $('#setup-decks');
  const upd = () => { out.textContent = decks; $('#setup-cards').textContent = `${decks * 52} cartas`; };
  $$('#setup .step').forEach((b) => b.addEventListener('click', () => { decks = Math.max(1, Math.min(8, decks + Number(b.dataset.step))); upd(); sound.play('tap'); }));
  $$('#setup-pen button').forEach((b) => b.addEventListener('click', () => { $$('#setup-pen button').forEach((x) => x.setAttribute('aria-checked', x === b)); sound.play('tap'); }));
  $('#setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const m = parseMoney($('#setup-money').value);
    if (!Number.isFinite(m) || m <= 0) { toast('Informe um valor maior que zero'); return; }
    const pen = Number($('#setup-pen [aria-checked=true]').dataset.pen);
    S = newState(m, decks, pen, S ? { sound: S.opts.sound } : {});
    save();
    sound.play('shuffle');
    startTable();
  });
  upd();
}

function bindTable() {
  $('#btn-hit').addEventListener('click', hit);
  $('#btn-stand').addEventListener('click', stand);
  $('#btn-double').addEventListener('click', double);
  $('#btn-split').addEventListener('click', split);

  $('#bet-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = betValue();
    if (!(v > 0)) { $('#bet-err').textContent = 'Informe o valor da aposta.'; return; }
    if (v > S.money) { $('#bet-err').textContent = `Você só tem ${fmt(S.money)}.`; return; }
    deal(v);
  });
  $('#bet-input').addEventListener('input', fitBet);
  $$('#bet-sheet [data-add]').forEach((b) => b.addEventListener('click', () => { setBet(betValue() + Number(b.dataset.add)); sound.play('chip'); }));
  $$('#bet-sheet [data-op]').forEach((b) => b.addEventListener('click', () => {
    const v = betValue();
    setBet({ clear: 0, half: Math.floor(v / 2), double: v * 2, max: S.money }[b.dataset.op]);
    sound.play('tap');
  }));

  $('#open-menu').addEventListener('click', () => { renderMenu(); showSheet('#menu-sheet'); sound.play('tap'); });
  $('#close-menu').addEventListener('click', () => hideSheet('#menu-sheet'));
  $('#menu-sheet').addEventListener('click', (e) => { if (e.target.id === 'menu-sheet') hideSheet('#menu-sheet'); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSheet('#menu-sheet');
    if (!$('#menu-sheet').hidden || !$('#bet-sheet').hidden || $('#table').hidden) return;
    if (e.key === 'h') hit();
    if (e.key === 's') stand();
    if (e.key === 'd') double();
    if (e.key === 'p') split();
  });

  $('#cheat-add').addEventListener('click', () => cheatMoney('add'));
  $('#cheat-set').addEventListener('click', () => cheatMoney('set'));
  $('#cheat-win').addEventListener('click', cheatWin);
  $('#cheat-bj').addEventListener('click', () => { S.rigBJ = !S.rigBJ; save(); renderMenu(); toast(S.rigBJ ? 'A próxima mão será blackjack' : 'Blackjack desarmado'); });
  const opt = (id, key, after) => $(id).addEventListener('change', (e) => { S.opts[key] = e.target.checked; if (after) after(); save(); render(); });
  opt('#cheat-hole', 'showHole'); opt('#cheat-next', 'showNext'); opt('#opt-count', 'showCount'); opt('#opt-hint', 'showHint');
  opt('#opt-sound', 'sound', () => { sound.setEnabled(S.opts.sound); sound.play('chip'); });

  $('#pick-rank').innerHTML = RANKS.map((r) => `<button type="button" data-r="${r}">${r}<small></small></button>`).join('');
  $$('#pick-rank button').forEach((b) => b.addEventListener('click', () => pickNext(b.dataset.r)));

  $('#reshuffle').addEventListener('click', () => {
    if (S.phase === 'player' || S.phase === 'dealer') return toast('Termine a rodada antes de embaralhar');
    reshuffle(); save(); render();
  });
  $('#new-game').addEventListener('click', () => {
    if (!confirm('Começar um novo jogo? A banca e o sapato atuais serão apagados.')) return;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    hideSheet('#menu-sheet');
    showSetup();
  });
}

function init() {
  // O áudio só pode começar depois de um toque do usuário
  const unlock = () => sound.unlock();
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });

  bindSetup();
  bindTable();
  S = load();
  if (S && S.v === 1 && S.settings) startTable();
  else { S = null; showSetup(); }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

init();
