import { describe, expect, it } from 'vitest';
import cards from '../../data/cards.json';
import { CardDB } from '../cards';
import { applyAction } from '../engine';
import type { Action, CardData, GameState } from '../types';
import { build, type Layout } from './helpers';

const db = new CardDB(cards as CardData[]);
const L = 'BASIC-Lightning';
const F = 'BASIC-Fighting';
const act = (s: GameState, a: Action) => applyAction(db, s, a);
// 山札の下のほうに闘エネルギーとたねポケモンを足しておく (エネルギーをつけるため・準備のため)。
const setup = (layout: [Layout, Layout], turn = 3) =>
  build(
    layout.map((l) => ({ ...l, deck: [...(l.deck ?? []), ...Array(10).fill(L), F, F, F, 'M6-050'] })) as [Layout, Layout],
    { db, filler: L, turn },
  );
const name = (s: GameState, uid: string) => db.get(s.cards[uid].cardId).name;
const hand = (s: GameState, p: 0 | 1) => s.players[p].hand.map((u) => name(s, u));
const inHand = (s: GameState, p: 0 | 1, n: string) => s.players[p].hand.find((u) => name(s, u) === n)!;
const energize = (s: GameState, p: 0 | 1, ...ids: string[]) => {
  const pl = s.players[p];
  for (const id of ids) {
    const i = pl.deck.findIndex((u) => s.cards[u].cardId === id);
    pl.active!.energies.push(pl.deck.splice(i, 1)[0]);
  }
  return s;
};
const answer = (s: GameState, a: string[] | number | boolean) =>
  act(s, { type: 'answer', player: s.pending!.prompt.player, answer: a });
const options = (s: GameState) => (s.pending!.prompt as { options: string[] }).options;

describe('タケルライコex', () => {
  it('はじけるほうこう: 手札をすべてトラッシュして6枚引く', () => {
    let s = setup([{ active: 'MC-554', hand: ['M6-050', 'M6-050'] }, { active: 'M6-050' }]);
    s = energize(s, 0, L);
    s = act(s, { type: 'attack', player: 0, attack: 'はじけるほうこう' });
    expect(s.players[0].discard).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(6);
  });

  it('きょくらいごう: トラッシュした基本エネルギー×70', () => {
    let s = setup([{ active: 'MC-554', bench: ['M6-050'] }, { active: 'MC-554' }]);
    s = energize(s, 0, L, F);
    s.players[0].bench[0].energies.push(s.players[0].deck.shift()!);
    s = act(s, { type: 'attack', player: 0, attack: 'きょくらいごう' });
    expect(options(s)).toHaveLength(3);
    s = answer(s, options(s));
    expect(s.players[1].active!.damage).toBe(210);
    expect(s.players[0].active!.energies).toHaveLength(0);
  });
});

describe('ジャラコ・ジャランゴ・ジャラランガ', () => {
  it('かたいあたま: 次の相手の番、受けるダメージ-30', () => {
    let s = setup([{ active: 'M6-050' }, { active: 'SV7-075' }]);
    s = energize(s, 0, L, F);
    s = energize(s, 1, L, F, L);
    s = act(s, { type: 'attack', player: 0, attack: 'かたいあたま' });
    s = act(s, { type: 'attack', player: 1, attack: 'リューズヘッド' });
    // 130 - 30 = 100 → HP70 のジャラコはきぜつ
    expect(s.players[1].prizes).toHaveLength(5);
  });

  it('ダブルスマッシュ: オモテの数×70', () => {
    let s = setup([{ active: 'M6-051' }, { active: 'MC-554' }]);
    s = energize(s, 0, L, F);
    s = act(s, { type: 'attack', player: 0, attack: 'ダブルスマッシュ' });
    const heads = s.log.filter((l) => l.text.includes('オモテ')).length;
    expect(s.players[1].active!.damage).toBe(70 * heads);
  });

  it('スケイルビート: 山札の上6枚の基本エネルギーを[N]ポケモンにつける', () => {
    let s = setup([{ active: 'M6-052', bench: ['MC-554'], deck: [L, F, 'M6-050', L] }, { active: 'M6-050' }]);
    s = act(s, { type: 'useAbility', player: 0, slotId: s.players[0].active!.id, ability: 'スケイルビート' });
    expect(s.pending!.prompt.kind).toBe('chooseCards');
    const picks = options(s).slice(0, 2);
    s = answer(s, picks);
    s = answer(s, [s.players[0].bench[0].id]);
    s = answer(s, [s.players[0].active!.id]);
    expect(s.pending).toBeNull();
    expect(s.players[0].bench[0].energies).toHaveLength(1);
    expect(s.players[0].active!.energies).toHaveLength(1);
    expect(() =>
      act(s, { type: 'useAbility', player: 0, slotId: s.players[0].active!.id, ability: 'スケイルビート' }),
    ).toThrow('もう使いました');
  });
});

describe('タケルライコ', () => {
  it('らくらいあらし: ベンチにもエネルギー×30 (弱点・抵抗力なし)', () => {
    let s = setup([{ active: 'SV7-075' }, { active: 'M6-050', bench: ['MC-554'] }]);
    s = energize(s, 0, L, F, L);
    s = act(s, { type: 'attack', player: 0, attack: 'らくらいあらし' });
    s = answer(s, [s.players[1].bench[0].id]);
    expect(s.players[1].bench[0].damage).toBe(90);
  });
});

describe('ノコッチ・ノココッチ', () => {
  it('ノココッチはノコッチから進化できる', () => {
    let s = setup([{ active: 'SV9-078', hand: ['SV8a-130'] }, { active: 'M6-050' }]);
    s = act(s, { type: 'evolve', player: 0, uid: inHand(s, 0, 'ノココッチ'), target: s.players[0].active!.id });
    expect(name(s, s.players[0].active!.stack.at(-1)!)).toBe('ノココッチ');
  });

  it('にげあしドロー: 3枚引いて、自分を山札にもどす', () => {
    let s = setup([{ active: 'M6-050', bench: ['SV8a-130'] }, { active: 'M6-050' }]);
    const deckBefore = s.players[0].deck.length;
    s = act(s, { type: 'useAbility', player: 0, slotId: s.players[0].bench[0].id, ability: 'にげあしドロー' });
    expect(s.players[0].hand).toHaveLength(3);
    expect(s.players[0].bench).toHaveLength(0);
    expect(s.players[0].deck).toHaveLength(deckBefore - 3 + 1);
  });

  it('いれかわる: ベンチと入れ替える', () => {
    let s = setup([{ active: 'SV9-078', bench: ['M6-050'] }, { active: 'M6-050' }]);
    s = energize(s, 0, L);
    s = act(s, { type: 'attack', player: 0, attack: 'いれかわる' });
    s = answer(s, [s.players[0].bench[0].id]);
    expect(name(s, s.players[0].active!.id)).toBe('ジャラコ');
  });
});

describe('トレーナーズ', () => {
  it('なかよしポフィン: HP70以下のたねを2枚までベンチに出す', () => {
    let s = setup([{ active: 'M6-050', hand: ['MC-648'], deck: ['M6-050', 'SV9-078', 'MC-554'] }, { active: 'M6-050' }]);
    s = act(s, { type: 'playTrainer', player: 0, uid: inHand(s, 0, 'なかよしポフィン') });
    expect(new Set(options(s).map((u) => name(s, u)))).toEqual(new Set(['ジャラコ', 'ノコッチ']));
    s = answer(s, options(s).slice(0, 2));
    expect(s.players[0].bench).toHaveLength(2);
  });

  it('ふしぎなアメ: たねから2進化に進化する', () => {
    let s = setup([{ active: 'M6-050', hand: ['MC-655', 'M6-052'] }, { active: 'M6-050' }]);
    s = act(s, { type: 'playTrainer', player: 0, uid: inHand(s, 0, 'ふしぎなアメ') });
    s = answer(s, [inHand(s, 0, 'ジャラランガ')]);
    s = answer(s, [s.players[0].active!.id]);
    expect(name(s, s.players[0].active!.stack.at(-1)!)).toBe('ジャラランガ');
  });

  it('ふしぎなアメ: 最初の番や出したばかりのポケモンには使えない', () => {
    const s = setup([{ active: 'M6-050', hand: ['MC-655', 'M6-052'] }, { active: 'M6-050' }], 2);
    expect(() => act(s, { type: 'playTrainer', player: 0, uid: inHand(s, 0, 'ふしぎなアメ') })).toThrow('最初の番');
    let t = setup([{ active: 'SV9-078', hand: ['MC-655', 'M6-052', 'M6-050'] }, { active: 'M6-050' }]);
    t = act(t, { type: 'playBasic', player: 0, uid: inHand(t, 0, 'ジャラコ') });
    expect(() => act(t, { type: 'playTrainer', player: 0, uid: inHand(t, 0, 'ふしぎなアメ') })).toThrow('組み合わせ');
  });

  it('リーリエの決心: サイドが6枚なら8枚引く', () => {
    let s = setup([{ active: 'M6-050', hand: ['M1L-062', 'M6-050'] }, { active: 'M6-050' }]);
    s = act(s, { type: 'playTrainer', player: 0, uid: inHand(s, 0, 'リーリエの決心') });
    expect(s.players[0].hand).toHaveLength(8);
  });

  it('ヒカリ: たね・1進化・2進化を1枚ずつ', () => {
    let s = setup([{ active: 'M6-050', hand: ['M2-077'], deck: ['M6-050', 'M6-051', 'M6-052'] }, { active: 'M6-050' }]);
    s = act(s, { type: 'playTrainer', player: 0, uid: inHand(s, 0, 'ヒカリ') });
    for (let i = 0; i < 3; i++) s = answer(s, [options(s)[0]]);
    expect(hand(s, 0).sort()).toEqual(['ジャラコ', 'ジャラランガ', 'ジャランゴ'].sort());
  });
});
