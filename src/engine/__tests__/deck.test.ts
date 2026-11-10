/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import cards from '../../data/cards.json';
import { CardDB } from '../cards';
import { parseDeckList, validateDeck } from '../deck';
import type { CardData } from '../types';

const db = new CardDB(cards as CardData[]);

describe('デッキレシピ', () => {
  it('タケルライコex ジャラランガ のレシピを読める', () => {
    const text = readFileSync(new URL('../../../decks/takeru-jararanga.txt', import.meta.url), 'utf8');
    const { ids, errors } = parseDeckList(db, text);
    expect(errors).toEqual([]);
    expect(ids).toHaveLength(60);
    expect(validateDeck(db, ids)).toEqual([]);
    expect(ids).toContain('MC-554');
    expect(ids).toContain('SV8a-130');
  });

  it('公式サイトのリスト表示をコピーした形も読める', () => {
    const text = 'ポケモン (2)\nジャラコ M6 050/076 2枚\nグッズ (1)\nポケパッド\t1枚\n';
    const { ids, errors } = parseDeckList(db, text);
    expect(errors).toEqual([]);
    expect(ids).toEqual(['M6-050', 'M6-050', expect.any(String)]);
  });
});
