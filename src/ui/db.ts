import cards from '../data/cards.json';
import { CardDB } from '../engine';
import type { CardData } from '../engine';

export const db = new CardDB(cards as CardData[]);
