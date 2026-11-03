// Motor do blackjack: sapato (baralhos), valores das mãos, contagem e estratégia básica.
// Sem dependência de interface, para poder ser testado isoladamente.

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['s', 'h', 'd', 'c']; // espadas, copas, ouros, paus
export const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const RED = { h: true, d: true };

/** Cria um sapato com `decks` baralhos completos de 52 cartas, já embaralhado. */
export function createShoe(decks, rand = randomInt) {
  const shoe = [];
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) for (const r of RANKS) shoe.push({ r, s });
  }
  return shuffle(shoe, rand);
}

/** Fisher–Yates. `rand(n)` devolve um inteiro em [0, n). */
export function shuffle(cards, rand = randomInt) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** Inteiro aleatório em [0, n) usando crypto quando disponível. */
export function randomInt(n) {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const max = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do { c.getRandomValues(buf); } while (buf[0] >= max);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}

export function cardValue(card) {
  if (card.r === 'A') return 1;
  if (card.r === 'J' || card.r === 'Q' || card.r === 'K') return 10;
  return Number(card.r);
}

/** Valor da mão: { total, soft } — soft quando um Ás está contando 11. */
export function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.r === 'A') aces++;
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

export function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

/** Texto da soma: "7/17" para mão soft, "21" para blackjack/21. */
export function handLabel(cards) {
  if (!cards.length) return '';
  const { total, soft } = handValue(cards);
  if (isBlackjack(cards)) return 'Blackjack';
  if (soft && total < 21) return `${total - 10}/${total}`;
  return String(total);
}

/** Valor Hi-Lo de uma carta: 2–6 = +1, 7–9 = 0, 10–A = −1. */
export function hiLo(card) {
  const v = cardValue(card);
  if (v >= 2 && v <= 6) return 1;
  if (v >= 7 && v <= 9) return 0;
  return -1;
}

/** O dealer compra até 17 e para em todo 17 (inclusive soft 17). */
export function dealerShouldHit(cards) {
  return handValue(cards).total < 17;
}

/** Duas cartas de mesmo valor podem ser divididas (10, J, Q e K contam como iguais). */
export function canSplitCards(cards) {
  return cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
}

/**
 * Resultado de uma mão do jogador.
 * Retorna { outcome: 'blackjack'|'win'|'push'|'lose', payout } — payout é quanto volta para a banca
 * (aposta incluída). Blackjack paga 3:2. Em mão vinda de split (`fromSplit`), 21 com duas cartas
 * não é blackjack e paga 1:1.
 */
export function settle(player, dealer, bet, fromSplit = false) {
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  const pBJ = !fromSplit && isBlackjack(player), dBJ = isBlackjack(dealer);
  if (pBJ && dBJ) return { outcome: 'push', payout: bet };
  if (pBJ) return { outcome: 'blackjack', payout: bet * 2.5 };
  if (dBJ) return { outcome: 'lose', payout: 0 };
  if (p > 21) return { outcome: 'lose', payout: 0 };
  if (d > 21 || p > d) return { outcome: 'win', payout: bet * 2 };
  if (p === d) return { outcome: 'push', payout: bet };
  return { outcome: 'lose', payout: 0 };
}

/**
 * Estratégia básica (vários baralhos, mesa para no soft 17, dobrar depois do split permitido).
 * Retorna 'hit' | 'stand' | 'double' | 'split'.
 */
export function basicStrategy(player, dealerUp, canDouble, canSplit = false) {
  const { total, soft } = handValue(player);
  const up = dealerUp.r === 'A' ? 11 : cardValue(dealerUp);
  const D = (cond, otherwise) => (cond ? (canDouble ? 'double' : otherwise) : null);

  if (canSplit && canSplitCards(player)) {
    const v = cardValue(player[0]);
    const split =
      v === 1 || v === 8 ||
      (v === 9 && ((up >= 2 && up <= 6) || up === 8 || up === 9)) ||
      ((v === 7 || v === 2 || v === 3) && up <= 7) ||
      (v === 6 && up <= 6) ||
      (v === 4 && (up === 5 || up === 6));
    if (split) return 'split';
  }

  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) return D(up >= 3 && up <= 6, 'stand') || (up <= 8 ? 'stand' : 'hit');
    if (total === 17) return D(up >= 3 && up <= 6, 'hit') || 'hit';
    if (total === 15 || total === 16) return D(up >= 4 && up <= 6, 'hit') || 'hit';
    if (total === 13 || total === 14) return D(up >= 5 && up <= 6, 'hit') || 'hit';
    return 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  if (total === 11) return D(up !== 11, 'hit') || 'hit';
  if (total === 10) return D(up <= 9, 'hit') || 'hit';
  if (total === 9) return D(up >= 3 && up <= 6, 'hit') || 'hit';
  return 'hit';
}
