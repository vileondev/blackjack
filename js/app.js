import {
  RANKS, SUIT_SYMBOL, RED, createShoe, handValue, handLabel, isBlackjack, cardValue,
  hiLo, dealerShouldHit, settle, basicStrategy,
} from './engine.js';

const KEY = 'blackjack:v1';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Estado e armazenamento local ---------------- */
let S = null;          // estado salvo
let busy = false;      // bloqueia comandos durante animações
let dealShown = null;  // durante a distribuição: quantas cartas já aparecem (ordem J, M, J, M)

function load() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* armazenamento cheio ou bloqueado */ }
}

function newState(money, decks, pen) {
  return {
    v: 1,
    settings: { decks, pen, startMoney: money },
    money,
    shoe: createShoe(decks),
    phase: 'bet',           // bet | player | dealer | done
    bet: 0, lastBet: Math.min(25, money) || 0,
    player: [], dealer: [], holeHidden: true, doubled: false,
    result: null,           // { outcome, payout, net }
    rigBJ: false,
    round: 0,
    opts: { showHole: false, showNext: false, showCount: false, showHint: false },
    stats: { hands: 0, wins: 0, losses: 0, pushes: 0, bj: 0, best: money },
  };
}

const total = () => S.settings.decks * 52;

/* ---------------- Utilidades ---------------- */
function fmt(n) {
  const v = Math.round(n * 100) / 100;
  return '$' + v.toLocaleString('pt-BR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
function parseMoney(str) {
  let s = String(str).trim().replace(/[\s$]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
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
  if (!silent) toast(`Sapato embaralhado · ${total()} cartas`);
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
function canDouble() {
  return S.phase === 'player' && S.player.length === 2 && !S.doubled && S.money >= S.bet;
}

async function deal(bet) {
  if (busy) return;
  busy = true;
  S.money -= bet; S.bet = bet; S.lastBet = bet;
  S.player = []; S.dealer = []; S.holeHidden = true; S.doubled = false; S.result = null;
  S.round++;

  if (S.rigBJ) rigBlackjack();
  // Ordem real de distribuição: jogador, mesa, jogador, mesa (virada)
  S.player.push(draw()); S.dealer.push(draw()); S.player.push(draw()); S.dealer.push(draw());
  S.phase = 'player';
  save();

  hideSheet('#bet-sheet');
  document.body.classList.remove('betting');
  bump('down');
  for (dealShown = 1; dealShown <= 4; dealShown++) { render(); await sleep(260); }
  dealShown = null; render();

  const up = S.dealer[0];
  const peek = up.r === 'A' || cardValue(up) === 10;
  if ((peek && isBlackjack(S.dealer)) || isBlackjack(S.player)) {
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

async function hit() {
  if (busy || S.phase !== 'player') return;
  S.player.push(draw()); save(); render();
  const t = handValue(S.player).total;
  if (t > 21) { busy = true; await sleep(450); busy = false; return finish(); }
  if (t === 21) return stand();
}

async function stand() {
  if (busy || S.phase !== 'player') return;
  S.phase = 'dealer'; save();
  return dealerPlay();
}

async function double() {
  if (busy || !canDouble()) return;
  S.money -= S.bet; S.bet *= 2; S.doubled = true;
  bump('down');
  S.player.push(draw()); save(); render();
  busy = true; await sleep(500); busy = false;
  if (handValue(S.player).total > 21) return finish();
  S.phase = 'dealer'; save();
  return dealerPlay();
}

async function dealerPlay() {
  busy = true;
  S.holeHidden = false; save(); render();
  await sleep(600);
  while (S.phase === 'dealer' && dealerShouldHit(S.dealer)) {
    S.dealer.push(draw()); save(); render();
    await sleep(650);
  }
  busy = false;
  if (S.phase === 'dealer') finish();
}

function finish(forced) {
  if (S.phase !== 'player' && S.phase !== 'dealer') return;
  S.holeHidden = false;
  const r = forced || settle(S.player, S.dealer, S.bet);
  S.money = Math.round((S.money + r.payout) * 100) / 100;
  S.result = { ...r, net: r.payout - S.bet };
  const st = S.stats;
  st.hands++;
  if (r.outcome === 'win' || r.outcome === 'blackjack') st.wins++;
  if (r.outcome === 'blackjack') st.bj++;
  if (r.outcome === 'lose') st.losses++;
  if (r.outcome === 'push') st.pushes++;
  st.best = Math.max(st.best, S.money);
  S.phase = 'done';
  if (S.shoe.length < total() * S.settings.pen) reshuffle();
  save();
  if (r.payout > 0) bump('up');
  render();
  setTimeout(() => { if (S.phase === 'done') openBet(); }, 2200);
}

/* ---------------- Renderização ---------------- */
function cardEl(card) {
  const el = document.createElement('div');
  const sym = SUIT_SYMBOL[card.s];
  el.className = 'card deal';
  el.innerHTML = `<div class="in"><div class="face${RED[card.s] ? ' red' : ''}"><span class="rk">${card.r}</span><span class="st">${sym}</span></div><div class="back"></div></div>`;
  el.dataset.label = `${card.r} de ${{ s: 'espadas', h: 'copas', d: 'ouros', c: 'paus' }[card.s]}`;
  el.setAttribute('role', 'img');
  el.addEventListener('animationend', () => el.classList.remove('deal'), { once: true });
  return el;
}

function renderHand(box, cards, hideIndex) {
  if (box.dataset.round !== String(S.round)) { box.innerHTML = ''; box.dataset.round = S.round; }
  while (box.children.length > cards.length) box.lastChild.remove();
  cards.forEach((c, i) => {
    let el = box.children[i];
    if (!el) { el = cardEl(c); box.appendChild(el); }
    const down = i === hideIndex && !S.opts.showHole;
    el.classList.toggle('down', down);
    el.classList.toggle('peek', i === hideIndex && S.opts.showHole);
    el.setAttribute('aria-label', down ? 'Carta virada' : el.dataset.label);
  });
}

function visibleCards() {
  if (dealShown == null) return { p: S.player, d: S.dealer };
  const p = [], d = [];
  for (let i = 0; i < dealShown; i++) (i % 2 ? d : p).push(i % 2 ? S.dealer[(i - 1) / 2] : S.player[i / 2]);
  return { p, d };
}

function render() {
  if (!S) return;
  $('#money').textContent = fmt(S.money);
  const ci = countInfo();
  $('#shoe-left').innerHTML = `<b>${S.shoe.length}</b> / ${total()}`;

  const { p, d } = visibleCards();
  const hideIdx = S.holeHidden && S.phase !== 'done' ? 1 : -1;
  renderHand($('#player-hand'), p, -1);
  renderHand($('#dealer-hand'), d, hideIdx);

  // Somas
  const ps = $('#player-sum');
  ps.textContent = p.length ? handLabel(p) : '';
  ps.classList.toggle('bust', p.length > 0 && handValue(p).total > 21);
  ps.classList.toggle('bj', isBlackjack(p) && p.length === 2);
  const ds = $('#dealer-sum');
  const dVisible = hideIdx === 1 && !S.opts.showHole ? d.slice(0, 1) : d;
  ds.textContent = dVisible.length ? handLabel(dVisible) : '';
  ds.classList.toggle('bust', d.length > 0 && hideIdx !== 1 && handValue(d).total > 21);
  ds.classList.toggle('bj', hideIdx !== 1 && isBlackjack(d));

  // Aposta em jogo
  const chip = $('#bet-chip');
  chip.hidden = !(S.phase === 'player' || S.phase === 'dealer' || S.phase === 'done') || !S.bet;
  chip.innerHTML = `<span>${fmt(S.bet)}</span>${S.doubled ? '<small>×2</small>' : ''}`;

  // Botões
  const playing = S.phase === 'player' && !busy && dealShown == null;
  $('#actions').classList.toggle('off', !playing);
  $('#btn-hit').disabled = !playing;
  $('#btn-stand').disabled = !playing;
  $('#btn-double').disabled = !(playing && canDouble());

  // Mensagem de resultado
  const msg = $('#msg');
  msg.className = 'msg';
  if (S.phase === 'done' && S.result) {
    const r = S.result;
    const txt = resultText(r);
    msg.textContent = r.forced ? txt + ' 🃏' : txt;
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
    const a = basicStrategy(S.player, S.dealer[0], canDouble());
    hint.innerHTML = `Estratégia básica: <b>${{ hit: 'Hit', stand: 'Stand', double: 'Double' }[a]}</b>`;
  }

  if (!$('#menu-sheet').hidden) renderMenu();
}

function resultText(r) {
  return { blackjack: `Blackjack! +${fmt(r.net)}`, win: `Você ganhou +${fmt(r.net)}`, push: 'Empate', lose: handValue(S.player).total > 21 ? `Estourou −${fmt(S.bet)}` : `Mesa ganhou −${fmt(S.bet)}` }[r.outcome];
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
    last.textContent = `${resultText(r)} · ${handLabel(S.player)} × ${handLabel(S.dealer)}`;
  }
  $('#bet-err').textContent = S.money <= 0 ? 'Sem dinheiro. Use as trapaças ou comece um novo jogo.' : '';
  $('#deal-btn').disabled = S.money <= 0;
  showSheet('#bet-sheet');
  document.body.classList.add('betting');
}
function betValue() { return parseMoney($('#bet-input').value) || 0; }
function fitBet() { const i = $('#bet-input'); i.style.width = (Math.max(1, i.value.length) + 0.5) + 'ch'; }
function setBet(v) {
  v = Math.max(0, Math.min(Math.round(v * 100) / 100, S.money));
  $('#bet-input').value = v ? String(v).replace('.', ',') : '';
  $('#bet-err').textContent = '';
  fitBet();
}

/* ---------------- Menu (trapaças) ---------------- */
function renderMenu() {
  const ci = countInfo();
  // Próxima carta: quantas de cada valor ainda há no sapato
  const inShoe = {}; RANKS.forEach((r) => (inShoe[r] = 0)); S.shoe.forEach((c) => inShoe[c.r]++);
  $$('#pick-rank button').forEach((b) => { const r = b.dataset.r; b.disabled = !inShoe[r]; b.querySelector('small').textContent = inShoe[r]; });

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
  $('#cheat-bj').textContent = S.rigBJ ? 'Blackjack armado ✓' : 'Próxima mão: blackjack';
}

function cheatMoney(mode) {
  const v = parseMoney($('#cheat-amount').value);
  if (!Number.isFinite(v) || v < 0) return toast('Valor inválido');
  S.money = mode === 'add' ? Math.round((S.money + v) * 100) / 100 : v;
  S.stats.best = Math.max(S.stats.best, S.money);
  save(); bump('up'); render();
  if (!$('#bet-sheet').hidden) openBet();
  toast(mode === 'add' ? `+${fmt(v)} na banca` : `Banca definida em ${fmt(v)}`);
}

function cheatWin() {
  if (S.phase !== 'player' && S.phase !== 'dealer') return toast('Comece uma rodada primeiro');
  if (busy && S.phase === 'player') return toast('Aguarde as cartas');
  finish({ outcome: 'win', payout: S.bet * 2, forced: true });
  hideSheet('#menu-sheet');
}

function pickNext(r) {
  const c = takeFromShoe((x) => x.r === r);
  if (!c) return toast(`Não há mais ${r} no sapato`);
  S.shoe.push(c); save(); render();
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
function startTable() {
  $('#setup').hidden = true; $('#table').hidden = false;
  render();
  if (S.phase === 'dealer') dealerPlay();
  else if (S.phase === 'player' && (isBlackjack(S.player) || isBlackjack(S.dealer) && (S.dealer[0].r === 'A' || cardValue(S.dealer[0]) === 10))) finish();
  else if (S.phase === 'bet' || S.phase === 'done') openBet();
}

function bindSetup() {
  let decks = 6;
  const out = $('#setup-decks');
  const upd = () => { out.textContent = decks; $('#setup-cards').textContent = `${decks * 52} cartas`; };
  $$('#setup .step').forEach((b) => b.addEventListener('click', () => { decks = Math.max(1, Math.min(8, decks + Number(b.dataset.step))); upd(); }));
  $$('#setup-pen button').forEach((b) => b.addEventListener('click', () => $$('#setup-pen button').forEach((x) => x.setAttribute('aria-checked', x === b))));
  $('#setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const m = parseMoney($('#setup-money').value);
    if (!Number.isFinite(m) || m <= 0) { toast('Informe um valor maior que zero'); return; }
    const pen = Number($('#setup-pen [aria-checked=true]').dataset.pen);
    S = newState(m, decks, pen);
    save();
    startTable();
  });
  upd();
}

function bindTable() {
  $('#btn-hit').addEventListener('click', hit);
  $('#btn-stand').addEventListener('click', stand);
  $('#btn-double').addEventListener('click', double);

  $('#bet-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = betValue();
    if (!(v > 0)) { $('#bet-err').textContent = 'Informe o valor da aposta.'; return; }
    if (v > S.money) { $('#bet-err').textContent = `Você só tem ${fmt(S.money)}.`; return; }
    deal(v);
  });
  $('#bet-input').addEventListener('input', fitBet);
  $$('#bet-sheet [data-add]').forEach((b) => b.addEventListener('click', () => setBet(betValue() + Number(b.dataset.add))));
  $$('#bet-sheet [data-op]').forEach((b) => b.addEventListener('click', () => {
    const v = betValue();
    setBet({ clear: 0, half: Math.floor(v / 2), double: v * 2, max: S.money }[b.dataset.op]);
  }));

  $('#open-menu').addEventListener('click', () => { renderMenu(); showSheet('#menu-sheet'); });
  $('#close-menu').addEventListener('click', () => hideSheet('#menu-sheet'));
  $('#menu-sheet').addEventListener('click', (e) => { if (e.target.id === 'menu-sheet') hideSheet('#menu-sheet'); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSheet('#menu-sheet');
    if (!$('#menu-sheet').hidden || !$('#bet-sheet').hidden || $('#table').hidden) return;
    if (e.key === 'h') hit(); if (e.key === 's') stand(); if (e.key === 'd') double();
  });

  $('#cheat-add').addEventListener('click', () => cheatMoney('add'));
  $('#cheat-set').addEventListener('click', () => cheatMoney('set'));
  $('#cheat-win').addEventListener('click', cheatWin);
  $('#cheat-bj').addEventListener('click', () => { S.rigBJ = !S.rigBJ; save(); renderMenu(); toast(S.rigBJ ? 'A próxima mão será blackjack' : 'Blackjack desarmado'); });
  const opt = (id, key) => $(id).addEventListener('change', (e) => { S.opts[key] = e.target.checked; save(); render(); });
  opt('#cheat-hole', 'showHole'); opt('#cheat-next', 'showNext'); opt('#opt-count', 'showCount'); opt('#opt-hint', 'showHint');

  $('#pick-rank').innerHTML = RANKS.map((r) => `<button type="button" data-r="${r}">${r}<small></small></button>`).join('');
  $$('#pick-rank button').forEach((b) => b.addEventListener('click', () => pickNext(b.dataset.r)));

  $('#reshuffle').addEventListener('click', () => {
    if (S.phase === 'player' || S.phase === 'dealer') return toast('Termine a rodada antes de embaralhar');
    reshuffle(); save(); render();
  });
  $('#new-game').addEventListener('click', () => {
    if (!confirm('Começar um novo jogo? A banca e o sapato atuais serão apagados.')) return;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    S = null; showSetup();
  });
}

function init() {
  bindSetup();
  bindTable();
  S = load();
  if (S && S.v === 1 && S.settings) startTable();
  else showSetup();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

init();
