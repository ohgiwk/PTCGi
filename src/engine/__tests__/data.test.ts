import { describe, expect, it } from 'vitest';
import cards from '../../data/cards.json';
import { CardDB } from '../cards';
import type { CardData } from '../types';

describe('取り込んだカードデータ', () => {
  const db = new CardDB(cards as CardData[]);
  it('基本エネルギーがある', () => {
    expect(db.findByName('基本雷エネルギー')).toBeTruthy();
    expect(db.findByName('基本闘エネルギー')).toBeTruthy();
  });
  it('ポケモンのワザのダメージが数値になっている', () => {
    for (const c of db.all()) {
      if (c.category !== 'pokemon') continue;
      for (const a of c.attacks) expect(typeof a.damage).toBe('number');
    }
  });
});
