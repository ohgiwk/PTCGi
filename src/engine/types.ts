// ゲームエンジンで使う型。画面 (React) には依存しない。

export type EnergyType =
  | 'Grass'
  | 'Fire'
  | 'Water'
  | 'Lightning'
  | 'Psychic'
  | 'Fighting'
  | 'Darkness'
  | 'Metal'
  | 'Dragon'
  | 'Fairy'
  | 'Colorless';

/** エネルギーが「何タイプとしてはたらくか」。Any はすべてのタイプ。 */
export type ProvidedEnergy = EnergyType | 'Any';

// ---------- カードデータ (src/data/cards.json) ----------

export interface Attack {
  name: string;
  cost: EnergyType[];
  damage: number;
  /** 「30+」「50×」「120-」のような記号。なければ null。 */
  damageMod: '+' | 'x' | '-' | null;
  effect: string;
}

export interface Ability {
  name: string;
  effect: string;
}

interface CardBase {
  id: string;
  name: string;
  setId: string;
  localId: string;
  regulationMark: string | null;
  rarity: string | null;
}

export interface PokemonCard extends CardBase {
  category: 'pokemon';
  hp: number;
  types: EnergyType[];
  stage: 'Basic' | 'Stage1' | 'Stage2';
  evolveFrom: string | null;
  abilities: Ability[];
  attacks: Attack[];
  weaknesses: { type: EnergyType; value: string }[];
  resistances: { type: EnergyType; value: string }[];
  retreat: number;
  /** きぜつしたときに相手がとるサイドの枚数。 */
  prizes: number;
}

export interface TrainerCard extends CardBase {
  category: 'trainer';
  trainerType: 'Item' | 'Supporter' | 'Stadium' | 'Tool';
  effect: string;
}

export interface EnergyCard extends CardBase {
  category: 'energy';
  energyType: 'Basic' | 'Special';
  provides: ProvidedEnergy[];
  effect: string;
}

export type CardData = PokemonCard | TrainerCard | EnergyCard;

// ---------- ゲーム状態 ----------

export type PlayerId = 0 | 1;

/** 1枚1枚のカードの実体。uid はゲーム内で一意。 */
export interface CardInstance {
  uid: string;
  cardId: string;
  owner: PlayerId;
}

export type RotationCondition = 'asleep' | 'confused' | 'paralyzed';

export interface Conditions {
  /** ねむり・こんらん・マヒは同時に1つだけ。 */
  rotation: RotationCondition | null;
  poisoned: boolean;
  burned: boolean;
  /** どくのダメカン数 (通常1。効果で増えることがある)。 */
  poisonCounters: number;
}

/** 場に出ているポケモン1匹 (進化前のカードやついているカードもふくむ)。 */
export interface PokemonSlot {
  /** 一番下のたねポケモンの uid。進化しても変わらない。 */
  id: string;
  /** 下から順のポケモンカード。最後が今のポケモン。 */
  stack: string[];
  energies: string[];
  tools: string[];
  damage: number;
  conditions: Conditions;
  /** 場に出た番 (state.turn の値)。 */
  playedTurn: number;
  /** 最後に進化した番。進化していなければ -1。 */
  evolvedTurn: number;
  /** 特性を使った番。特性名 → turn。 */
  abilityUsedTurn: Record<string, number>;
}

export interface PlayerState {
  deck: string[];
  hand: string[];
  discard: string[];
  prizes: string[];
  lostZone: string[];
  active: PokemonSlot | null;
  bench: PokemonSlot[];
  mulligans: number;
  /** 相手の引き直しの回数ぶん、追加で引く枚数 (準備のときに選ぶ)。 */
  mulliganDraw: number;
  /** この番にしたこと。 */
  energyAttached: boolean;
  supporterPlayed: boolean;
  stadiumPlayed: boolean;
  retreated: boolean;
  /** 「番に1回」の効果で、この番に使ったもの (スタジアム名など)。 */
  usedThisTurn: string[];
  /** 準備フェーズでバトル場・ベンチを出し終えたか。 */
  setupDone: boolean;
}

/**
 * 「次の相手の番、〜」のような、一定期間だけ続く効果。
 * どのカードの効果かは source、中身は kind と data で表す。
 */
export interface Marker {
  kind: string;
  source: string;
  /** 対象のポケモン (slot.id)。プレイヤー全体なら null。 */
  target: string | null;
  player: PlayerId;
  /** この turn が終わったら消える。 */
  expiresAfterTurn: number;
  data?: Record<string, unknown>;
}

export type Phase = 'setup' | 'main' | 'promote' | 'gameOver';

/** きぜつ後の入れ替えが終わったあと、何を続けるか。 */
export type Resume = 'main' | 'checkup' | 'nextTurn';

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
}

export interface GameState {
  cards: Record<string, CardInstance>;
  players: [PlayerState, PlayerState];
  /** 1 = 先攻の最初の番。番が変わるたびに +1。準備中は 0。 */
  turn: number;
  current: PlayerId;
  firstPlayer: PlayerId;
  phase: Phase;
  stadium: { uid: string; owner: PlayerId } | null;
  markers: Marker[];
  /** 乱数の状態。同じ状態からは同じ結果になる。 */
  rng: number;
  winner: PlayerId | 'draw' | null;
  /** きぜつしたバトルポケモンの入れ替えを待っているプレイヤー。 */
  promoteQueue: PlayerId[];
  resume: Resume;
  /** 効果の途中で選択を待っているときの情報。 */
  pending: Pending | null;
  log: LogEntry[];
  nextUid: number;
}

// ---------- 効果の途中で出す選択肢 ----------

export type Prompt =
  | {
      kind: 'chooseCards';
      player: PlayerId;
      title: string;
      /** 選べるカード (uid)。 */
      options: string[];
      /** 見えているが選べないカード (山札を見るときなど)。 */
      visible?: string[];
      min: number;
      max: number;
    }
  | {
      kind: 'choosePokemon';
      player: PlayerId;
      title: string;
      /** slot.id */
      options: string[];
      min: number;
      max: number;
    }
  | {
      kind: 'chooseOption';
      player: PlayerId;
      title: string;
      options: string[];
    }
  | {
      kind: 'yesNo';
      player: PlayerId;
      title: string;
    };

export type Answer = string[] | number | boolean;

export interface Pending {
  prompt: Prompt;
  /** 選択の前の状態。答えがそろったらここからやり直す。 */
  base: GameState;
  action: Action;
  answers: Answer[];
}

// ---------- プレイヤーの操作 ----------

export type Action =
  // 準備
  | { type: 'setupActive'; player: PlayerId; uid: string }
  | { type: 'setupBench'; player: PlayerId; uid: string }
  | { type: 'setupDone'; player: PlayerId; mulliganDraw?: number }
  // 自分の番
  | { type: 'playBasic'; player: PlayerId; uid: string }
  | { type: 'evolve'; player: PlayerId; uid: string; target: string }
  | { type: 'attachEnergy'; player: PlayerId; uid: string; target: string }
  | { type: 'playTrainer'; player: PlayerId; uid: string; target?: string }
  | { type: 'retreat'; player: PlayerId; benchId: string; discard: string[] }
  | { type: 'useAbility'; player: PlayerId; slotId: string; ability: string }
  | { type: 'useStadium'; player: PlayerId }
  | { type: 'attack'; player: PlayerId; attack: string }
  | { type: 'endTurn'; player: PlayerId }
  // きぜつ後
  | { type: 'promote'; player: PlayerId; benchId: string }
  // 効果の選択に答える
  | { type: 'answer'; player: PlayerId; answer: Answer };
