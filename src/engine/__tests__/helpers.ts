import '../effects/cards';
import { CardDB } from '../cards';
import { applyAction, createGame } from '../engine';
import { Game } from '../game';
import type { Action, CardData, GameState, PlayerId, PokemonCard } from '../types';

/** テスト用の小さなカードデータ。 */
export function poke(id: string, extra: Partial<PokemonCard> = {}): PokemonCard {
  return {
    id,
    name: id,
    category: 'pokemon',
    setId: 'T',
    localId: id,
    regulationMark: 'J',
    rarity: null,
    hp: 100,
    types: ['Lightning'],
    stage: 'Basic',
    evolveFrom: null,
    abilities: [],
    attacks: [{ name: 'たいあたり', cost: ['Colorless'], damage: 30, damageMod: null, effect: '' }],
    weaknesses: [],
    resistances: [],
    retreat: 1,
    prizes: 1,
    ...extra,
  };
}

export const testCards: CardData[] = [
  poke('ピカ'),
  poke('ライ', { stage: 'Stage1', evolveFrom: 'ピカ', hp: 150 }),
  poke('ヒトカ', { types: ['Fire'], weaknesses: [{ type: 'Lightning', value: 'x2' }], hp: 70 }),
  poke('ゴロ', { types: ['Fighting'], resistances: [{ type: 'Lightning', value: '-30' }], hp: 120, retreat: 2 }),
  poke('つよex', { name: 'つよex', hp: 200, prizes: 2, attacks: [{ name: 'でかい', cost: ['Lightning', 'Colorless'], damage: 200, damageMod: null, effect: '' }] }),
  {
    id: 'E-L', name: '基本雷エネルギー', category: 'energy', setId: 'B', localId: 'L', regulationMark: null,
    rarity: null, energyType: 'Basic', provides: ['Lightning'], effect: '',
  },
  {
    id: 'E-F', name: '基本闘エネルギー', category: 'energy', setId: 'B', localId: 'F', regulationMark: null,
    rarity: null, energyType: 'Basic', provides: ['Fighting'], effect: '',
  },
  {
    id: 'T-MC', name: 'MCの盛り上げ', category: 'trainer', setId: 'T', localId: 'mc', regulationMark: 'J',
    rarity: null, trainerType: 'Supporter', effect: '',
  },
  {
    id: 'T-PAD', name: 'ポケパッド', category: 'trainer', setId: 'T', localId: 'pad', regulationMark: 'J',
    rarity: null, trainerType: 'Item', effect: '',
  },
];
export const db = new CardDB(testCards);

export interface Layout {
  active: string;
  bench?: string[];
  hand?: string[];
  /** 山札の上から。足りないぶんは基本雷エネルギーでうめる。 */
  deck?: string[];
  deckSize?: number;
  prizes?: number;
}

/**
 * 盤面を直接組み立てたゲームを作る。準備は終わっていて、turn 番目の番の最初 (ドロー後) になる。
 */
export function build(
  layout: [Layout, Layout],
  opts: { turn?: number; current?: PlayerId; db?: CardDB; filler?: string } = {},
): GameState {
  const cardDb = opts.db ?? db;
  const filler = opts.filler ?? 'E-L';
  const decks: [string[], string[]] = [[], []];
  for (const p of [0, 1] as PlayerId[]) {
    const l = layout[p];
    const listed = [l.active, ...(l.bench ?? []), ...(l.hand ?? []), ...(l.deck ?? [])];
    const size = Math.max(listed.length + (l.prizes ?? 6), l.deckSize ?? 30);
    decks[p] = [...listed];
    while (decks[p].length < size) decks[p].push(filler);
  }
  const state = createGame(cardDb, decks, { seed: 1, firstPlayer: 0 });
  const g = new Game(state, cardDb);
  for (const p of [0, 1] as PlayerId[]) {
    const pl = state.players[p];
    // いったん全部山札にもどして、IDの順にならべ直す。
    const all = [...pl.deck, ...pl.hand];
    pl.hand = [];
    const take = (cardId: string) => {
      const i = all.findIndex((u) => state.cards[u].cardId === cardId);
      if (i < 0) throw new Error(`no ${cardId}`);
      return all.splice(i, 1)[0];
    };
    const l = layout[p];
    pl.active = g.newSlot(take(l.active));
    pl.active.playedTurn = 0;
    pl.bench = (l.bench ?? []).map((id) => {
      const s = g.newSlot(take(id));
      s.playedTurn = 0;
      return s;
    });
    pl.hand = (l.hand ?? []).map(take);
    const top = (l.deck ?? []).map(take);
    const prizes = all.splice(0, l.prizes ?? 6);
    pl.prizes = prizes;
    pl.deck = [...top, ...all];
    pl.setupDone = true;
  }
  state.phase = 'main';
  state.turn = opts.turn ?? 3;
  state.current = opts.current ?? 0;
  state.log = [];
  return state;
}

export function act(state: GameState, a: Action): GameState {
  return applyAction(db, state, a);
}

export function uidOf(state: GameState, p: PlayerId, cardId: string, zone: 'hand' | 'deck' | 'discard' = 'hand'): string {
  const u = state.players[p][zone].find((x) => state.cards[x].cardId === cardId);
  if (!u) throw new Error(`${cardId} not in ${zone}`);
  return u;
}
