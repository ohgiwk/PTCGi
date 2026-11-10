// 1回の操作を処理するあいだ、状態を書きかえるための道具一式。
// カード効果もこのクラスのメソッドを使って書く。

import { CardDB, isBasicEnergy, isEnergy, isPokemon } from './cards';
import { passiveEffects } from './effects/registry';
import { nextRandom } from './rng';
import type {
  Answer,
  CardData,
  EnergyType,
  GameState,
  PlayerId,
  PlayerState,
  PokemonCard,
  PokemonSlot,
  Prompt,
  ProvidedEnergy,
} from './types';

export class GameError extends Error {}

/** 効果の途中で、プレイヤーの選択が必要になったときに投げる。 */
export class NeedInput {
  prompt: Prompt;
  constructor(prompt: Prompt) {
    this.prompt = prompt;
  }
}

export type Zone = 'deck' | 'hand' | 'discard' | 'prizes' | 'lostZone';

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export const emptyConditions = () => ({
  rotation: null,
  poisoned: false,
  burned: false,
  poisonCounters: 1,
});

export class Game {
  state: GameState;
  db: CardDB;
  private answers: Answer[];
  private answerIndex = 0;

  constructor(state: GameState, db: CardDB, answers: Answer[] = []) {
    this.state = state;
    this.db = db;
    this.answers = answers;
  }

  // ---------- 参照 ----------

  card(uid: string): CardData {
    const inst = this.state.cards[uid];
    if (!inst) throw new GameError(`不明なカード: ${uid}`);
    return this.db.get(inst.cardId);
  }

  owner(uid: string): PlayerId {
    return this.state.cards[uid].owner;
  }

  player(p: PlayerId): PlayerState {
    return this.state.players[p];
  }

  slots(p: PlayerId): PokemonSlot[] {
    const pl = this.player(p);
    return pl.active ? [pl.active, ...pl.bench] : [...pl.bench];
  }

  findSlot(id: string): { slot: PokemonSlot; owner: PlayerId; isActive: boolean } {
    for (const p of [0, 1] as PlayerId[]) {
      const pl = this.player(p);
      if (pl.active?.id === id) return { slot: pl.active, owner: p, isActive: true };
      const b = pl.bench.find((s) => s.id === id);
      if (b) return { slot: b, owner: p, isActive: false };
    }
    throw new GameError(`場にいないポケモン: ${id}`);
  }

  /** 今のポケモン (進化後) のカードデータ。 */
  pokemon(slot: PokemonSlot): PokemonCard {
    const c = this.card(slot.stack[slot.stack.length - 1]);
    if (!isPokemon(c)) throw new GameError('ポケモンではありません');
    return c;
  }

  name(slot: PokemonSlot): string {
    return this.pokemon(slot).name;
  }

  /** 場に出ているスタジアム・どうぐ・特殊エネルギー・特性の名前で、常時はたらく効果を集める。 */
  private passiveSources(slot: PokemonSlot | null): string[] {
    const names: string[] = [];
    if (this.state.stadium) names.push(this.card(this.state.stadium.uid).name);
    if (slot) {
      for (const t of slot.tools) names.push(this.card(t).name);
      for (const e of slot.energies) names.push(this.card(e).name);
      const pk = this.pokemon(slot);
      for (const a of pk.abilities) names.push(`${pk.name}/${a.name}`);
    }
    return names;
  }

  maxHp(slot: PokemonSlot): number {
    let hp = this.pokemon(slot).hp;
    for (const n of this.passiveSources(slot)) {
      const fx = passiveEffects[n];
      if (fx?.maxHp) hp += fx.maxHp(this, slot);
    }
    return hp;
  }

  remainingHp(slot: PokemonSlot): number {
    return Math.max(0, this.maxHp(slot) - slot.damage);
  }

  retreatCost(slot: PokemonSlot): number {
    let cost = this.pokemon(slot).retreat;
    for (const n of this.passiveSources(slot)) {
      const fx = passiveEffects[n];
      if (fx?.retreatCost) cost = fx.retreatCost(this, slot, cost);
    }
    return Math.max(0, cost);
  }

  /** ついているエネルギーが、それぞれ何タイプとしてはたらくか。 */
  energyProvided(slot: PokemonSlot): ProvidedEnergy[][] {
    return slot.energies.map((uid) => {
      const c = this.card(uid);
      return isEnergy(c) ? c.provides : ['Colorless'];
    });
  }

  /** ワザのエネルギーが足りているか。 */
  hasEnergyFor(slot: PokemonSlot, cost: EnergyType[]): boolean {
    return canPayCost(this.energyProvided(slot), cost);
  }

  hasMarker(kind: string, target: string | null, player?: PlayerId): boolean {
    return this.state.markers.some(
      (m) =>
        m.kind === kind &&
        (target === null || m.target === target) &&
        (player === undefined || m.player === player),
    );
  }

  // ---------- 記録・乱数 ----------

  log(text: string, player: PlayerId | null = null): void {
    this.state.log.push({ turn: this.state.turn, player, text });
  }

  random(): number {
    const [v, next] = nextRandom(this.state.rng);
    this.state.rng = next;
    return v;
  }

  /** コインを投げる。オモテなら true。 */
  flip(label = 'コイン'): boolean {
    const heads = this.random() < 0.5;
    this.log(`${label}: ${heads ? 'オモテ' : 'ウラ'}`);
    return heads;
  }

  shuffle(p: PlayerId): void {
    const deck = this.player(p).deck;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  // ---------- 選択 ----------

  /** プレイヤーに選んでもらう。まだ答えがなければ NeedInput を投げて処理を中断する。 */
  ask(prompt: Prompt): Answer {
    if (this.answerIndex < this.answers.length) {
      const a = this.answers[this.answerIndex++];
      validateAnswer(prompt, a);
      return a;
    }
    throw new NeedInput(prompt);
  }

  chooseCards(
    player: PlayerId,
    title: string,
    options: string[],
    min: number,
    max: number,
    visible?: string[],
  ): string[] {
    max = Math.min(max, options.length);
    min = Math.min(min, max);
    if (max === 0) return [];
    return this.ask({ kind: 'chooseCards', player, title, options, min, max, visible }) as string[];
  }

  choosePokemon(player: PlayerId, title: string, options: string[], min = 1, max = 1): string[] {
    max = Math.min(max, options.length);
    min = Math.min(min, max);
    if (max === 0) return [];
    return this.ask({ kind: 'choosePokemon', player, title, options, min, max }) as string[];
  }

  chooseOption(player: PlayerId, title: string, options: string[]): number {
    return this.ask({ kind: 'chooseOption', player, title, options }) as number;
  }

  yesNo(player: PlayerId, title: string): boolean {
    return this.ask({ kind: 'yesNo', player, title }) as boolean;
  }

  // ---------- カードの移動 ----------

  /** カードを今ある場所 (場もふくむ) から取りのぞく。 */
  private detach(uid: string): void {
    for (const p of [0, 1] as PlayerId[]) {
      const pl = this.player(p);
      for (const z of ['deck', 'hand', 'discard', 'prizes', 'lostZone'] as Zone[]) {
        const i = pl[z].indexOf(uid);
        if (i >= 0) {
          pl[z].splice(i, 1);
          return;
        }
      }
      for (const s of this.slots(p)) {
        for (const key of ['energies', 'tools'] as const) {
          const i = s[key].indexOf(uid);
          if (i >= 0) {
            s[key].splice(i, 1);
            return;
          }
        }
      }
    }
  }

  moveTo(uid: string, zone: Zone, opts: { toBottom?: boolean } = {}): void {
    this.detach(uid);
    const pl = this.player(this.owner(uid));
    if (zone === 'deck' && !opts.toBottom) pl.deck.unshift(uid);
    else pl[zone].push(uid);
  }

  /** 山札を引く。引けた枚数を返す。 */
  draw(p: PlayerId, n: number): number {
    const pl = this.player(p);
    let drawn = 0;
    for (let i = 0; i < n && pl.deck.length > 0; i++) {
      pl.hand.push(pl.deck.shift()!);
      drawn++;
    }
    if (drawn > 0) this.log(`山札を${drawn}枚引いた`, p);
    return drawn;
  }

  attachEnergyCard(uid: string, slot: PokemonSlot): void {
    this.detach(uid);
    slot.energies.push(uid);
  }

  newSlot(uid: string): PokemonSlot {
    this.detach(uid);
    return {
      id: uid,
      stack: [uid],
      energies: [],
      tools: [],
      damage: 0,
      conditions: emptyConditions(),
      playedTurn: this.state.turn,
      evolvedTurn: -1,
      abilityUsedTurn: {},
    };
  }

  /** ベンチにたねポケモンを出す。 */
  putOnBench(p: PlayerId, uid: string): PokemonSlot {
    const pl = this.player(p);
    if (pl.bench.length >= 5) throw new GameError('ベンチがいっぱいです');
    const slot = this.newSlot(uid);
    pl.bench.push(slot);
    this.log(`${this.card(uid).name}をベンチに出した`, p);
    return slot;
  }

  /** バトルポケモンとベンチポケモンを入れ替える。 */
  switchActive(p: PlayerId, benchId: string): void {
    const pl = this.player(p);
    const i = pl.bench.findIndex((s) => s.id === benchId);
    if (i < 0) throw new GameError('そのポケモンはベンチにいません');
    const next = pl.bench[i];
    if (pl.active) {
      pl.active.conditions = emptyConditions();
      pl.bench[i] = pl.active;
    } else {
      pl.bench.splice(i, 1);
    }
    pl.active = next;
    this.log(`${this.name(next)}がバトル場に出た`, p);
  }

  /** 場のポケモンを、ついているカードごとトラッシュする。 */
  discardSlot(slot: PokemonSlot): void {
    const { owner, isActive } = this.findSlot(slot.id);
    const pl = this.player(owner);
    for (const uid of [...slot.stack, ...slot.energies, ...slot.tools]) pl.discard.push(uid);
    if (isActive) pl.active = null;
    else pl.bench = pl.bench.filter((s) => s.id !== slot.id);
  }

  // ---------- ダメージ・回復・特殊状態 ----------

  /** ダメカンをのせる (弱点・抵抗力などは計算しない)。 */
  putDamage(slot: PokemonSlot, amount: number): void {
    if (amount <= 0) return;
    slot.damage += amount;
    this.log(`${this.name(slot)}に${amount}ダメージ`);
  }

  heal(slot: PokemonSlot, amount: number): void {
    const healed = Math.min(slot.damage, amount);
    slot.damage -= healed;
    if (healed > 0) this.log(`${this.name(slot)}のHPを${healed}回復した`);
  }

  /**
   * ワザのダメージをあたえる。バトルポケモンには弱点・抵抗力を計算する。
   * ベンチへのダメージには弱点・抵抗力を計算しない。
   */
  attackDamage(attacker: PokemonSlot, target: PokemonSlot, base: number): number {
    if (base <= 0) return 0;
    const { owner, isActive } = this.findSlot(target.id);
    let dmg = base;
    if (isActive) {
      const atkTypes = this.pokemon(attacker).types;
      const def = this.pokemon(target);
      if (def.weaknesses.some((w) => atkTypes.includes(w.type))) dmg *= 2;
      for (const r of def.resistances) {
        if (atkTypes.includes(r.type)) dmg += parseInt(r.value, 10) || -30;
      }
      for (const m of this.state.markers) {
        if (m.player === owner && m.kind === 'damageReduction' && (m.target === null || m.target === target.id)) {
          dmg -= Number(m.data?.amount ?? 0);
        }
        if (m.kind === 'preventDamage' && m.target === target.id) dmg = 0;
      }
    }
    dmg = Math.max(0, dmg);
    this.putDamage(target, dmg);
    return dmg;
  }

  setCondition(slot: PokemonSlot, cond: 'asleep' | 'confused' | 'paralyzed' | 'poisoned' | 'burned'): void {
    const label = { asleep: 'ねむり', confused: 'こんらん', paralyzed: 'マヒ', poisoned: 'どく', burned: 'やけど' }[cond];
    if (cond === 'poisoned') slot.conditions.poisoned = true;
    else if (cond === 'burned') slot.conditions.burned = true;
    else slot.conditions.rotation = cond;
    this.log(`${this.name(slot)}は${label}になった`);
  }

  // ---------- きぜつ・勝敗 ----------

  /**
   * HP が 0 になったポケモンをきぜつさせ、サイドをとる。
   * バトルポケモンがいなくなったプレイヤーは promoteQueue に入る。
   */
  checkKnockouts(): void {
    const s = this.state;
    if (s.phase === 'gameOver') return;
    const prizeTakers: PlayerId[] = [];
    for (const p of [0, 1] as PlayerId[]) {
      for (const slot of this.slots(p)) {
        if (slot.damage < this.maxHp(slot)) continue;
        const card = this.pokemon(slot);
        this.log(`${card.name}はきぜつした`, p);
        this.discardSlot(slot);
        const taker = other(p);
        const taken = this.takePrizes(taker, card.prizes);
        if (taken > 0) prizeTakers.push(taker);
      }
    }
    // 勝敗
    const wins: PlayerId[] = [];
    for (const p of [0, 1] as PlayerId[]) {
      const opp = other(p);
      if (prizeTakers.includes(p) && this.player(p).prizes.length === 0) wins.push(p);
      if (this.slots(opp).length === 0) wins.push(p);
    }
    const unique = [...new Set(wins)];
    if (unique.length === 2) return this.endGame('draw', 'おたがいに勝利条件を満たした');
    if (unique.length === 1) {
      const w = unique[0];
      const reason =
        this.player(w).prizes.length === 0 ? 'サイドをすべてとった' : '相手の場にポケモンがいなくなった';
      return this.endGame(w, reason);
    }
    for (const p of [0, 1] as PlayerId[]) {
      if (!this.player(p).active && !s.promoteQueue.includes(p)) s.promoteQueue.push(p);
    }
  }

  takePrizes(p: PlayerId, n: number): number {
    const pl = this.player(p);
    const taken = pl.prizes.splice(0, Math.min(n, pl.prizes.length));
    pl.hand.push(...taken);
    if (taken.length > 0) this.log(`サイドを${taken.length}枚とった (残り${pl.prizes.length}枚)`, p);
    return taken.length;
  }

  endGame(winner: PlayerId | 'draw', reason: string): void {
    this.state.winner = winner;
    this.state.phase = 'gameOver';
    this.state.promoteQueue = [];
    this.log(winner === 'draw' ? `引き分け (${reason})` : `プレイヤー${winner + 1}の勝ち (${reason})`);
  }

  isBasicEnergyCard(uid: string): boolean {
    return isBasicEnergy(this.card(uid));
  }
}

/** エネルギーの組み合わせでコストを払えるか (特定タイプを先にあて、残りを無色にあてる)。 */
export function canPayCost(provided: ProvidedEnergy[][], cost: EnergyType[]): boolean {
  const typed = cost.filter((c) => c !== 'Colorless');
  const colorless = cost.length - typed.length;
  if (provided.length < cost.length) return false;
  // 小さな数なので、全探索で割り当てる。
  const used = new Array(provided.length).fill(false);
  const assign = (i: number): boolean => {
    if (i === typed.length) return true;
    for (let j = 0; j < provided.length; j++) {
      if (used[j]) continue;
      if (provided[j].includes(typed[i]) || provided[j].includes('Any')) {
        used[j] = true;
        if (assign(i + 1)) return true;
        used[j] = false;
      }
    }
    return false;
  };
  if (!assign(0)) return false;
  return used.filter((u) => !u).length >= colorless;
}

function validateAnswer(prompt: Prompt, a: Answer): void {
  switch (prompt.kind) {
    case 'chooseCards':
    case 'choosePokemon': {
      if (!Array.isArray(a)) throw new GameError('カードを選んでください');
      if (a.length < prompt.min || a.length > prompt.max)
        throw new GameError(`${prompt.min}〜${prompt.max}枚選んでください`);
      if (new Set(a).size !== a.length) throw new GameError('同じものは選べません');
      if (!a.every((x) => prompt.options.includes(x))) throw new GameError('選べないものがふくまれています');
      return;
    }
    case 'chooseOption':
      if (typeof a !== 'number' || a < 0 || a >= prompt.options.length || !Number.isInteger(a))
        throw new GameError('選択肢を選んでください');
      return;
    case 'yesNo':
      if (typeof a !== 'boolean') throw new GameError('はい か いいえ を選んでください');
  }
}
