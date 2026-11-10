import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getLegalActions } from '../engine';
import { canPayCost } from '../game';
import type { GameState } from '../types';
import { act, build, db, uidOf } from './helpers';

const deckOf = (...ids: string[]) => {
  const d = [...ids];
  while (d.length < 60) d.push('E-L');
  return d;
};

describe('準備', () => {
  it('7枚引き、たねポケモンがなければ引き直す', () => {
    const s = createGame(db, [deckOf('ピカ'), deckOf('ヒトカ')], { seed: 42, firstPlayer: 0 });
    for (const p of s.players) {
      expect(p.hand).toHaveLength(7);
      expect(p.hand.some((u) => db.get(s.cards[u].cardId).category === 'pokemon')).toBe(true);
      expect(p.deck).toHaveLength(53);
    }
    // 60枚中たねが1枚なので、ほぼ確実に引き直しが起きている。
    expect(s.players[0].mulligans + s.players[1].mulligans).toBeGreaterThan(0);
  });

  it('両者が準備を終えるとサイドを置き、先攻が1枚引いて始まる', () => {
    let s = createGame(db, [deckOf('ピカ', 'ピカ', 'ピカ', 'ピカ'), deckOf('ヒトカ', 'ヒトカ', 'ヒトカ', 'ヒトカ')], {
      seed: 7,
      firstPlayer: 1,
    });
    for (const p of [0, 1] as const) {
      const basic = s.players[p].hand.find((u) => db.get(s.cards[u].cardId).category === 'pokemon')!;
      s = applyAction(db, s, { type: 'setupActive', player: p, uid: basic });
    }
    s = applyAction(db, s, { type: 'setupDone', player: 0 });
    expect(s.phase).toBe('setup');
    s = applyAction(db, s, { type: 'setupDone', player: 1 });
    expect(s.phase).toBe('main');
    expect(s.turn).toBe(1);
    expect(s.current).toBe(1);
    expect(s.players[0].prizes).toHaveLength(6);
    expect(s.players[1].prizes).toHaveLength(6);
    expect(s.players[1].hand).toHaveLength(7); // 7 - 1 (バトル場) + 1 (ドロー)
  });

  it('バトル場を出さずに準備を終えることはできない', () => {
    const s = createGame(db, [deckOf('ピカ'), deckOf('ヒトカ')], { seed: 3, firstPlayer: 0 });
    expect(() => applyAction(db, s, { type: 'setupDone', player: 0 })).toThrow('バトル場');
  });
});

describe('最初の番の制限', () => {
  it('先攻の最初の番はワザとサポートが使えない', () => {
    const s = build([{ active: 'ピカ', hand: ['T-MC', 'E-L'] }, { active: 'ヒトカ' }], { turn: 1 });
    expect(() => act(s, { type: 'attack', player: 0, attack: 'たいあたり' })).toThrow('最初の番');
    expect(() => act(s, { type: 'playTrainer', player: 0, uid: uidOf(s, 0, 'T-MC') })).toThrow('最初の番');
  });

  it('おたがいの最初の番は進化できない', () => {
    const s = build([{ active: 'ピカ', hand: ['ライ'] }, { active: 'ヒトカ' }], { turn: 2, current: 0 });
    const target = s.players[0].active!.id;
    expect(() => act(s, { type: 'evolve', player: 0, uid: uidOf(s, 0, 'ライ'), target })).toThrow('最初の番');
  });
});

describe('メインの操作', () => {
  it('エネルギーは番に1回だけつけられる', () => {
    let s = build([{ active: 'ピカ', hand: ['E-L', 'E-F'] }, { active: 'ヒトカ' }]);
    const target = s.players[0].active!.id;
    s = act(s, { type: 'attachEnergy', player: 0, uid: uidOf(s, 0, 'E-L'), target });
    expect(s.players[0].active!.energies).toHaveLength(1);
    expect(() => act(s, { type: 'attachEnergy', player: 0, uid: uidOf(s, 0, 'E-F'), target })).toThrow('もうつけました');
  });

  it('進化: 出したばかりのポケモンは進化できず、次の番ならできる', () => {
    let s = build([{ active: 'ピカ', hand: ['ピカ', 'ライ'] }, { active: 'ヒトカ' }]);
    s = act(s, { type: 'playBasic', player: 0, uid: uidOf(s, 0, 'ピカ') });
    const benched = s.players[0].bench[0].id;
    expect(() => act(s, { type: 'evolve', player: 0, uid: uidOf(s, 0, 'ライ'), target: benched })).toThrow('出したばかり');
    s = act(s, { type: 'evolve', player: 0, uid: uidOf(s, 0, 'ライ'), target: s.players[0].active!.id });
    expect(db.get(s.cards[s.players[0].active!.stack.at(-1)!].cardId).name).toBe('ライ');
  });

  it('にげる: エネルギーをトラッシュして入れ替える。マヒだとにげられない', () => {
    let s = build([{ active: 'ゴロ', bench: ['ピカ'], hand: ['E-F'] }, { active: 'ヒトカ' }]);
    const active = s.players[0].active!;
    s.players[0].active!.energies.push(uidOf(s, 0, 'E-F'));
    s.players[0].hand = [];
    const e = active.energies[0];
    expect(() =>
      act(s, { type: 'retreat', player: 0, benchId: s.players[0].bench[0].id, discard: [e] }),
    ).toThrow('2個');
    // コスト2を満たすようにもう1枚
    const extra = s.players[0].deck[0];
    s.players[0].deck.shift();
    s.players[0].active!.energies.push(extra);
    const paralyzed = structuredClone(s);
    paralyzed.players[0].active!.conditions.rotation = 'paralyzed';
    expect(() =>
      act(paralyzed, { type: 'retreat', player: 0, benchId: s.players[0].bench[0].id, discard: [e, extra] }),
    ).toThrow('にげられません');
    s = act(s, { type: 'retreat', player: 0, benchId: s.players[0].bench[0].id, discard: [e, extra] });
    expect(db.get(s.cards[s.players[0].active!.id].cardId).name).toBe('ピカ');
    expect(s.players[0].discard).toHaveLength(2);
  });
});

function withEnergy(s: GameState, p: 0 | 1, n: number) {
  const pl = s.players[p];
  for (let i = 0; i < n; i++) pl.active!.energies.push(pl.deck.shift()!);
  return s;
}

describe('ワザとダメージ', () => {
  it('弱点は2倍、抵抗力は-30', () => {
    let s = withEnergy(build([{ active: 'ピカ' }, { active: 'ヒトカ' }]), 0, 1);
    s = act(s, { type: 'attack', player: 0, attack: 'たいあたり' });
    expect(s.players[1].active!.damage).toBe(60);

    let t = withEnergy(build([{ active: 'ピカ' }, { active: 'ゴロ' }]), 0, 1);
    t = act(t, { type: 'attack', player: 0, attack: 'たいあたり' });
    expect(t.players[1].active!.damage).toBe(0);
  });

  it('エネルギーが足りないとワザは使えない', () => {
    const s = withEnergy(build([{ active: 'つよex' }, { active: 'ヒトカ' }]), 0, 1);
    expect(() => act(s, { type: 'attack', player: 0, attack: 'でかい' })).toThrow('足りません');
  });

  it('ワザを使うと番が終わり、相手が1枚引く', () => {
    let s = withEnergy(build([{ active: 'ピカ' }, { active: 'ゴロ' }]), 0, 1);
    const before = s.players[1].hand.length;
    s = act(s, { type: 'attack', player: 0, attack: 'たいあたり' });
    expect(s.current).toBe(1);
    expect(s.turn).toBe(4);
    expect(s.players[1].hand).toHaveLength(before + 1);
  });

  it('きぜつさせるとサイドをとり、相手はベンチから出す', () => {
    let s = withEnergy(build([{ active: 'ピカ' }, { active: 'ヒトカ', bench: ['ゴロ'] }]), 0, 1);
    s.players[1].active!.damage = 20;
    s = act(s, { type: 'attack', player: 0, attack: 'たいあたり' });
    expect(s.players[0].prizes).toHaveLength(5);
    expect(s.phase).toBe('promote');
    expect(s.promoteQueue).toEqual([1]);
    expect(() => act(s, { type: 'endTurn', player: 0 })).toThrow();
    s = act(s, { type: 'promote', player: 1, benchId: s.players[1].bench[0].id });
    expect(s.phase).toBe('main');
    expect(s.current).toBe(1);
    expect(db.get(s.cards[s.players[1].active!.id].cardId).name).toBe('ゴロ');
  });

  it('ex をきぜつさせるとサイドを2枚とる', () => {
    let s = withEnergy(build([{ active: 'ピカ' }, { active: 'つよex', bench: ['ゴロ'] }]), 0, 1);
    s.players[1].active!.damage = 190;
    s = act(s, { type: 'attack', player: 0, attack: 'たいあたり' });
    expect(s.players[0].prizes).toHaveLength(4);
  });
});

describe('勝敗', () => {
  it('サイドをすべてとると勝ち', () => {
    let s = withEnergy(build([{ active: 'ピカ', prizes: 1 }, { active: 'ヒトカ', bench: ['ゴロ'] }]), 0, 1);
    s.players[1].active!.damage = 60;
    s = act(s, { type: 'attack', player: 0, attack: 'たいあたり' });
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toBe(0);
  });

  it('相手の場にポケモンがいなくなると勝ち', () => {
    let s = withEnergy(build([{ active: 'ピカ' }, { active: 'ヒトカ' }]), 0, 1);
    s.players[1].active!.damage = 60;
    s = act(s, { type: 'attack', player: 0, attack: 'たいあたり' });
    expect(s.winner).toBe(0);
  });

  it('番のはじめに山札を引けないと負け', () => {
    let s = build([{ active: 'ピカ' }, { active: 'ヒトカ' }]);
    s.players[1].deck = [];
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.winner).toBe(0);
  });
});

describe('ポケモンチェック', () => {
  it('どくは番の終わりに10ダメージ', () => {
    let s = build([{ active: 'ピカ' }, { active: 'ゴロ' }]);
    s.players[1].active!.conditions.poisoned = true;
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.players[1].active!.damage).toBe(10);
  });

  it('マヒは自分の番が終わると治る', () => {
    let s = build([{ active: 'ピカ' }, { active: 'ゴロ' }]);
    s.players[1].active!.conditions.rotation = 'paralyzed';
    s = act(s, { type: 'endTurn', player: 0 }); // 相手(マヒをかけた側)の番の終わり: まだ治らない
    expect(s.players[1].active!.conditions.rotation).toBe('paralyzed');
    s = act(s, { type: 'endTurn', player: 1 }); // 自分の番の終わり: 治る
    expect(s.players[1].active!.conditions.rotation).toBeNull();
  });
});

describe('効果の途中の選択', () => {
  it('ポケパッド: 山札からポケモンを選んで手札に加える', () => {
    let s = build([{ active: 'ピカ', hand: ['T-PAD'], deck: ['ヒトカ', 'つよex'] }, { active: 'ゴロ' }]);
    s = act(s, { type: 'playTrainer', player: 0, uid: uidOf(s, 0, 'T-PAD') });
    expect(s.pending?.prompt.kind).toBe('chooseCards');
    const prompt = s.pending!.prompt as Extract<typeof s.pending, object>['prompt'] & { options: string[] };
    // ルールを持つポケモン (つよex) は選べない
    const names = prompt.options.map((u) => db.get(s.cards[u].cardId).name);
    expect(names).toEqual(['ヒトカ']);
    expect(() => act(s, { type: 'endTurn', player: 0 })).toThrow('選択');
    s = act(s, { type: 'answer', player: 0, answer: prompt.options });
    expect(s.pending).toBeNull();
    expect(s.players[0].hand.map((u) => s.cards[u].cardId)).toEqual(['ヒトカ']);
    expect(s.players[0].discard.map((u) => s.cards[u].cardId)).toEqual(['T-PAD']);
  });

  it('答えが条件に合わなければ、選択を待ったまま', () => {
    const s = build([{ active: 'ピカ', hand: ['T-PAD'], deck: ['ヒトカ'] }, { active: 'ゴロ' }]);
    const t = act(s, { type: 'playTrainer', player: 0, uid: uidOf(s, 0, 'T-PAD') });
    expect(() => act(t, { type: 'answer', player: 0, answer: ['nope'] })).toThrow();
    expect(t.pending).not.toBeNull();
  });
});

describe('getLegalActions', () => {
  it('今できる操作を返す', () => {
    const s = withEnergy(build([{ active: 'ピカ', hand: ['E-L', 'ピカ'] }, { active: 'ゴロ' }]), 0, 1);
    const types = getLegalActions(db, s).map((a) => a.type);
    expect(types).toContain('attachEnergy');
    expect(types).toContain('playBasic');
    expect(types).toContain('attack');
    expect(types).toContain('endTurn');
    expect(types).not.toContain('retreat'); // ベンチがいない
  });
});

describe('canPayCost', () => {
  it('特定タイプを先に、残りを無色にあてる', () => {
    expect(canPayCost([['Lightning'], ['Fighting']], ['Lightning', 'Colorless'])).toBe(true);
    expect(canPayCost([['Fighting'], ['Fighting']], ['Lightning', 'Colorless'])).toBe(false);
    expect(canPayCost([['Any'], ['Fighting']], ['Lightning', 'Fighting'])).toBe(true);
    expect(canPayCost([['Lightning']], ['Lightning', 'Colorless'])).toBe(false);
  });
});
