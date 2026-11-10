// カード効果の登録場所。カード名 (再録は同じ効果) をキーにする。
// 登録されていないカードは「効果未実装」として、効果なしで処理する。

import type { Game } from '../game';
import type { Attack, PlayerId, PokemonSlot } from '../types';

export interface AttackContext {
  game: Game;
  player: PlayerId;
  attacker: PokemonSlot;
  defender: PokemonSlot;
  attack: Attack;
  /** カードに書かれたダメージで、相手のバトルポケモンにダメージをあたえる。 */
  dealBase(amount?: number): number;
}

/** ワザの効果。キーは「ポケモン名/ワザ名」。 */
export type AttackEffect = (c: AttackContext) => void;

export interface TrainerEffect {
  /** 使えない理由を返す。使えるなら null。 */
  canPlay?(g: Game, player: PlayerId): string | null;
  play(g: Game, player: PlayerId, uid: string, target?: string): void;
}

export interface AbilityEffect {
  /** 自分で使う特性なら true。常にはたらく特性は passiveEffects に書く。 */
  canUse?(g: Game, player: PlayerId, slot: PokemonSlot): string | null;
  use(g: Game, player: PlayerId, slot: PokemonSlot): void;
  /** 番に1回だけ使える特性か (既定は true)。 */
  oncePerTurn?: boolean;
}

/** スタジアムの「自分の番ごとに1回〜してよい」効果。 */
export interface StadiumAction {
  canUse?(g: Game, player: PlayerId): string | null;
  use(g: Game, player: PlayerId): void;
}

/** 常にはたらく効果 (どうぐ・特殊エネルギー・スタジアム・特性)。 */
export interface PassiveEffect {
  maxHp?(g: Game, slot: PokemonSlot): number;
  retreatCost?(g: Game, slot: PokemonSlot, current: number): number;
}

export const attackEffects: Partial<Record<string, AttackEffect>> = {};
export const trainerEffects: Partial<Record<string, TrainerEffect>> = {};
export const abilityEffects: Partial<Record<string, AbilityEffect>> = {};
export const stadiumActions: Partial<Record<string, StadiumAction>> = {};
export const passiveEffects: Partial<Record<string, PassiveEffect>> = {};

export const attackKey = (pokemon: string, attack: string) => `${pokemon}/${attack}`;
export const abilityKey = (pokemon: string, ability: string) => `${pokemon}/${ability}`;
