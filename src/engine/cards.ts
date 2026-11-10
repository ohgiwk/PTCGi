import type { CardData, EnergyCard, PokemonCard, TrainerCard } from './types';

/** カードIDからカードデータを引く辞書。 */
export class CardDB {
  private byId = new Map<string, CardData>();

  constructor(cards: CardData[]) {
    for (const c of cards) this.byId.set(c.id, c);
  }

  get(id: string): CardData {
    const c = this.byId.get(id);
    if (!c) throw new Error(`カードが見つかりません: ${id}`);
    return c;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): CardData[] {
    return [...this.byId.values()];
  }

  /** 名前でさがす (再録カードは最初の1枚)。 */
  findByName(name: string): CardData | undefined {
    for (const c of this.byId.values()) if (c.name === name) return c;
    return undefined;
  }
}

export const isPokemon = (c: CardData): c is PokemonCard => c.category === 'pokemon';
export const isTrainer = (c: CardData): c is TrainerCard => c.category === 'trainer';
export const isEnergy = (c: CardData): c is EnergyCard => c.category === 'energy';
export const isBasicPokemon = (c: CardData): c is PokemonCard =>
  c.category === 'pokemon' && c.stage === 'Basic';
export const isBasicEnergy = (c: CardData): c is EnergyCard =>
  c.category === 'energy' && c.energyType === 'Basic';

/** 「ルールを持つポケモン」(ex など)。 */
export const hasRuleBox = (c: CardData): boolean =>
  c.category === 'pokemon' && /ex$/.test(c.name);
