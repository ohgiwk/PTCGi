// ゲームの進行。applyAction(state, action) で次の状態を返す (元の state は変えない)。

import { CardDB, isBasicPokemon, isEnergy, isPokemon, isTrainer } from './cards';
import {
  abilityEffects,
  abilityKey,
  attackEffects,
  attackKey,
  stadiumActions,
  trainerEffects,
  type AttackContext,
} from './effects/registry';
import { Game, GameError, NeedInput, other } from './game';
import type { Action, Answer, GameState, PlayerId, PlayerState, PokemonSlot } from './types';

export { GameError } from './game';

export interface NewGameOptions {
  seed?: number;
  /** 先攻のプレイヤー。省略するとコインで決める。 */
  firstPlayer?: PlayerId;
}

function emptyPlayer(): PlayerState {
  return {
    deck: [],
    hand: [],
    discard: [],
    prizes: [],
    lostZone: [],
    active: null,
    bench: [],
    mulligans: 0,
    mulliganDraw: 0,
    energyAttached: false,
    supporterPlayed: false,
    stadiumPlayed: false,
    retreated: false,
    usedThisTurn: [],
    setupDone: false,
  };
}

/**
 * 新しいゲームを作る。山札を切って7枚引き、たねポケモンがなければ引き直す。
 * decks はカードIDの配列 (60枚)。
 */
export function createGame(db: CardDB, decks: [string[], string[]], opts: NewGameOptions = {}): GameState {
  const state: GameState = {
    cards: {},
    players: [emptyPlayer(), emptyPlayer()],
    turn: 0,
    current: 0,
    firstPlayer: 0,
    phase: 'setup',
    stadium: null,
    markers: [],
    rng: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
    winner: null,
    promoteQueue: [],
    resume: 'main',
    pending: null,
    log: [],
    nextUid: 1,
  };
  const g = new Game(state, db);
  for (const p of [0, 1] as PlayerId[]) {
    for (const cardId of decks[p]) {
      db.get(cardId); // 存在チェック
      const uid = `c${state.nextUid++}`;
      state.cards[uid] = { uid, cardId, owner: p };
      state.players[p].deck.push(uid);
    }
    if (!state.players[p].deck.some((u) => isBasicPokemon(g.card(u))))
      throw new GameError(`プレイヤー${p + 1}の山札にたねポケモンがありません`);
    g.shuffle(p);
  }
  state.firstPlayer = opts.firstPlayer ?? (g.flip('先攻を決めるコイン') ? 0 : 1);
  state.current = state.firstPlayer;
  g.log(`プレイヤー${state.firstPlayer + 1}が先攻`);
  for (const p of [0, 1] as PlayerId[]) {
    const pl = state.players[p];
    for (;;) {
      g.draw(p, 7);
      if (pl.hand.some((u) => isBasicPokemon(g.card(u)))) break;
      pl.mulligans++;
      g.log('手札にたねポケモンがないので、引き直した', p);
      pl.deck.push(...pl.hand.splice(0));
      g.shuffle(p);
    }
  }
  return state;
}

/** 操作を1つ適用して、次の状態を返す。ルール上できない操作なら GameError を投げる。 */
export function applyAction(db: CardDB, state: GameState, action: Action): GameState {
  if (state.pending) {
    if (action.type !== 'answer') throw new GameError('効果の選択を待っています');
    const p = state.pending;
    if (action.player !== p.prompt.player) throw new GameError('選ぶのは相手のプレイヤーです');
    return run(db, p.base, p.action, [...p.answers, action.answer]);
  }
  if (action.type === 'answer') throw new GameError('選択を待っていません');
  return run(db, state, action, []);
}

function run(db: CardDB, base: GameState, action: Action, answers: Answer[]): GameState {
  const state = structuredClone(base);
  const g = new Game(state, db, answers);
  try {
    handle(g, action);
  } catch (e) {
    if (e instanceof NeedInput) {
      return { ...base, pending: { prompt: e.prompt, base, action, answers } };
    }
    throw e;
  }
  state.pending = null;
  return state;
}

// ---------- 操作ごとの処理 ----------

function handle(g: Game, a: Action): void {
  const s = g.state;
  if (s.phase === 'gameOver') throw new GameError('ゲームは終わっています');

  if (a.type === 'setupActive' || a.type === 'setupBench' || a.type === 'setupDone') {
    if (s.phase !== 'setup') throw new GameError('準備中ではありません');
    return handleSetup(g, a);
  }
  if (a.type === 'promote') return handlePromote(g, a.player, a.benchId);
  if (a.type === 'answer') throw new GameError('選択を待っていません');

  if (s.phase !== 'main') throw new GameError(s.phase === 'promote' ? 'バトルポケモンを選んでください' : '準備中です');
  if (a.player !== s.current) throw new GameError('相手の番です');
  const pl = g.player(a.player);

  switch (a.type) {
    case 'playBasic': {
      requireInHand(pl, a.uid);
      if (!isBasicPokemon(g.card(a.uid))) throw new GameError('たねポケモンではありません');
      g.putOnBench(a.player, a.uid);
      return;
    }
    case 'evolve':
      return handleEvolve(g, a.player, a.uid, a.target);
    case 'attachEnergy': {
      requireInHand(pl, a.uid);
      if (!isEnergy(g.card(a.uid))) throw new GameError('エネルギーではありません');
      if (pl.energyAttached) throw new GameError('エネルギーはこの番にもうつけました');
      const slot = ownSlot(g, a.player, a.target);
      g.attachEnergyCard(a.uid, slot);
      pl.energyAttached = true;
      g.log(`${g.card(a.uid).name}を${g.name(slot)}につけた`, a.player);
      return;
    }
    case 'playTrainer':
      return handleTrainer(g, a.player, a.uid, a.target);
    case 'retreat':
      return handleRetreat(g, a.player, a.benchId, a.discard);
    case 'useAbility':
      return handleAbility(g, a.player, a.slotId, a.ability);
    case 'useStadium': {
      if (!s.stadium) throw new GameError('スタジアムが出ていません');
      const name = g.card(s.stadium.uid).name;
      const fx = stadiumActions[name];
      if (!fx) throw new GameError(`${name}に使える効果はありません`);
      if (pl.usedThisTurn.includes(name)) throw new GameError('この番はもう使いました');
      const reason = fx.canUse?.(g, a.player);
      if (reason) throw new GameError(reason);
      pl.usedThisTurn.push(name);
      g.log(`${name}の効果を使った`, a.player);
      fx.use(g, a.player);
      g.checkKnockouts();
      afterMainAction(g);
      return;
    }
    case 'attack':
      return handleAttack(g, a.player, a.attack);
    case 'endTurn':
      g.log('番を終えた', a.player);
      return endTurn(g);
  }
}

function requireInHand(pl: PlayerState, uid: string) {
  if (!pl.hand.includes(uid)) throw new GameError('そのカードは手札にありません');
}

function ownSlot(g: Game, p: PlayerId, id: string): PokemonSlot {
  const f = g.findSlot(id);
  if (f.owner !== p) throw new GameError('自分のポケモンを選んでください');
  return f.slot;
}

function handleSetup(g: Game, a: Extract<Action, { type: 'setupActive' | 'setupBench' | 'setupDone' }>) {
  const pl = g.player(a.player);
  if (pl.setupDone) throw new GameError('準備はもう終わっています');
  if (a.type === 'setupActive' || a.type === 'setupBench') {
    requireInHand(pl, a.uid);
    if (!isBasicPokemon(g.card(a.uid))) throw new GameError('たねポケモンしか出せません');
    if (a.type === 'setupActive') {
      if (pl.active) throw new GameError('バトル場にはもう出しています');
      pl.active = g.newSlot(a.uid);
    } else {
      if (pl.bench.length >= 5) throw new GameError('ベンチがいっぱいです');
      pl.bench.push(g.newSlot(a.uid));
    }
    return;
  }
  // setupDone
  if (!pl.active) throw new GameError('バトル場にたねポケモンを出してください');
  const oppMull = g.player(other(a.player)).mulligans;
  const extra = Math.max(0, Math.min(a.mulliganDraw ?? 0, oppMull));
  pl.setupDone = true;
  pl.mulliganDraw = extra;
  const s = g.state;
  if (!s.players.every((p) => p.setupDone)) return;

  for (const p of [0, 1] as PlayerId[]) {
    const ps = g.player(p);
    ps.prizes = ps.deck.splice(0, 6);
    if (ps.mulliganDraw > 0) g.draw(p, ps.mulliganDraw);
    ps.mulliganDraw = 0;
  }
  g.log('サイドを6枚ずつ置いた。ゲーム開始');
  s.turn = 0;
  s.current = other(s.firstPlayer);
  startNextTurn(g);
}

function handleEvolve(g: Game, p: PlayerId, uid: string, target: string) {
  const pl = g.player(p);
  requireInHand(pl, uid);
  const card = g.card(uid);
  if (!isPokemon(card) || card.stage === 'Basic') throw new GameError('進化ポケモンではありません');
  const slot = ownSlot(g, p, target);
  if (card.evolveFrom !== g.name(slot)) throw new GameError(`${card.name}は${g.name(slot)}から進化できません`);
  const s = g.state;
  if (s.turn <= 2) throw new GameError('おたがいの最初の番は進化できません');
  if (slot.playedTurn === s.turn) throw new GameError('出したばかりのポケモンは進化できません');
  if (slot.evolvedTurn === s.turn) throw new GameError('この番に進化したポケモンは進化できません');
  evolveSlot(g, p, slot, uid);
}

/** 進化させる (ルールのチェックはしない。ふしぎなアメなどからも使う)。 */
export function evolveSlot(g: Game, p: PlayerId, slot: PokemonSlot, uid: string) {
  const from = g.name(slot);
  const pl = g.player(p);
  const i = pl.hand.indexOf(uid);
  if (i >= 0) pl.hand.splice(i, 1);
  slot.stack.push(uid);
  slot.evolvedTurn = g.state.turn;
  slot.conditions = { rotation: null, poisoned: false, burned: false, poisonCounters: 1 };
  g.log(`${from}を${g.card(uid).name}に進化させた`, p);
}

function handleTrainer(g: Game, p: PlayerId, uid: string, target?: string) {
  const pl = g.player(p);
  requireInHand(pl, uid);
  const card = g.card(uid);
  if (!isTrainer(card)) throw new GameError('トレーナーズではありません');
  const s = g.state;
  const fx = trainerEffects[card.name];

  switch (card.trainerType) {
    case 'Supporter':
      if (pl.supporterPlayed) throw new GameError('サポートはこの番にもう使いました');
      if (s.turn === 1) throw new GameError('先攻の最初の番はサポートを使えません');
      break;
    case 'Stadium':
      if (pl.stadiumPlayed) throw new GameError('スタジアムはこの番にもう出しました');
      if (s.stadium && g.card(s.stadium.uid).name === card.name)
        throw new GameError('同じ名前のスタジアムが出ています');
      break;
    case 'Tool': {
      if (!target) throw new GameError('どうぐをつけるポケモンを選んでください');
      const slot = ownSlot(g, p, target);
      if (slot.tools.length > 0) throw new GameError('どうぐはもうついています');
      break;
    }
  }
  const reason = fx?.canPlay?.(g, p);
  if (reason) throw new GameError(reason);

  // 手札から出してから効果を処理する。
  pl.hand.splice(pl.hand.indexOf(uid), 1);
  g.log(`${card.name}を使った${fx ? '' : ' (効果未実装)'}`, p);

  if (card.trainerType === 'Stadium') {
    if (s.stadium) g.player(s.stadium.owner).discard.push(s.stadium.uid);
    s.stadium = { uid, owner: p };
    pl.stadiumPlayed = true;
    return;
  }
  if (card.trainerType === 'Tool') {
    ownSlot(g, p, target!).tools.push(uid);
    return;
  }
  if (card.trainerType === 'Supporter') pl.supporterPlayed = true;
  fx?.play(g, p, uid, target);
  // 効果で別の場所に動いていなければトラッシュへ。
  if (!isPlaced(g, uid)) pl.discard.push(uid);
  g.checkKnockouts();
  afterMainAction(g);
}

function isPlaced(g: Game, uid: string): boolean {
  for (const p of [0, 1] as PlayerId[]) {
    const pl = g.player(p);
    if ([pl.deck, pl.hand, pl.discard, pl.prizes, pl.lostZone].some((z) => z.includes(uid))) return true;
    if (g.slots(p).some((s) => s.stack.includes(uid) || s.energies.includes(uid) || s.tools.includes(uid)))
      return true;
  }
  return false;
}

function handleRetreat(g: Game, p: PlayerId, benchId: string, discard: string[]) {
  const pl = g.player(p);
  const active = pl.active;
  if (!active) throw new GameError('バトルポケモンがいません');
  if (pl.retreated) throw new GameError('この番はもうにげました');
  const rot = active.conditions.rotation;
  if (rot === 'asleep' || rot === 'paralyzed') throw new GameError('ねむり・マヒのポケモンはにげられません');
  if (g.hasMarker('cantRetreat', active.id)) throw new GameError('このポケモンはにげられません');
  const cost = g.retreatCost(active);
  if (new Set(discard).size !== discard.length || !discard.every((u) => active.energies.includes(u)))
    throw new GameError('バトルポケモンについているエネルギーを選んでください');
  if (discard.length !== cost) throw new GameError(`にげるにはエネルギーを${cost}個トラッシュします`);
  for (const u of discard) g.moveTo(u, 'discard');
  pl.retreated = true;
  g.log(`${g.name(active)}はにげた`, p);
  g.switchActive(p, benchId);
}

function handleAbility(g: Game, p: PlayerId, slotId: string, ability: string) {
  const slot = ownSlot(g, p, slotId);
  const pk = g.pokemon(slot);
  if (!pk.abilities.some((a) => a.name === ability)) throw new GameError('その特性はありません');
  const fx = abilityEffects[abilityKey(pk.name, ability)];
  if (!fx) throw new GameError(`特性「${ability}」は未実装か、自分で使う特性ではありません`);
  const once = fx.oncePerTurn ?? true;
  if (once && slot.abilityUsedTurn[ability] === g.state.turn) throw new GameError('この番はもう使いました');
  const reason = fx.canUse?.(g, p, slot);
  if (reason) throw new GameError(reason);
  if (once) slot.abilityUsedTurn[ability] = g.state.turn;
  g.log(`${pk.name}の特性「${ability}」を使った`, p);
  fx.use(g, p, slot);
  g.checkKnockouts();
  afterMainAction(g);
}

function handleAttack(g: Game, p: PlayerId, attackName: string) {
  const s = g.state;
  const pl = g.player(p);
  const opp = g.player(other(p));
  if (s.turn === 1) throw new GameError('先攻の最初の番はワザを使えません');
  const attacker = pl.active;
  if (!attacker) throw new GameError('バトルポケモンがいません');
  const defender = opp.active;
  if (!defender) throw new GameError('相手のバトルポケモンがいません');
  const card = g.pokemon(attacker);
  const attack = card.attacks.find((a) => a.name === attackName);
  if (!attack) throw new GameError('そのワザはありません');
  const rot = attacker.conditions.rotation;
  if (rot === 'asleep' || rot === 'paralyzed') throw new GameError('ねむり・マヒのポケモンはワザを使えません');
  if (g.hasMarker('cantAttack', attacker.id)) throw new GameError('このポケモンはワザを使えません');
  if (!g.hasEnergyFor(attacker, attack.cost)) throw new GameError('エネルギーが足りません');

  const fx = attackEffects[attackKey(card.name, attack.name)];
  g.log(`${card.name}の「${attack.name}」${fx || !attack.effect ? '' : ' (効果未実装)'}`, p);

  let ok = true;
  if (rot === 'confused' && !g.flip('こんらん')) {
    g.log(`${card.name}はこんらんで自分に30ダメージ`, p);
    g.putDamage(attacker, 30);
    ok = false;
  }
  if (ok) {
    const ctx: AttackContext = {
      game: g,
      player: p,
      attacker,
      defender,
      attack,
      dealBase: (amount = attack.damage) => g.attackDamage(attacker, defender, amount),
    };
    if (fx) fx(ctx);
    else ctx.dealBase();
  }
  g.checkKnockouts();
  if (s.phase === 'gameOver') return;
  if (s.promoteQueue.length > 0) {
    s.phase = 'promote';
    s.resume = 'checkup';
    return;
  }
  endTurn(g);
}

/** トレーナーズや特性のあと、きぜつしたバトルポケモンがいれば入れ替えを待つ。 */
function afterMainAction(g: Game) {
  const s = g.state;
  if (s.phase === 'gameOver') return;
  if (s.promoteQueue.length > 0) {
    s.phase = 'promote';
    s.resume = 'main';
  }
}

function handlePromote(g: Game, p: PlayerId, benchId: string) {
  const s = g.state;
  if (s.phase !== 'promote' || !s.promoteQueue.includes(p)) throw new GameError('入れ替えを待っていません');
  g.switchActive(p, benchId);
  s.promoteQueue = s.promoteQueue.filter((x) => x !== p);
  if (s.promoteQueue.length > 0) return;
  s.phase = 'main';
  if (s.resume === 'checkup') endTurn(g);
  else if (s.resume === 'nextTurn') startNextTurn(g);
}

// ---------- 番の切りかえ ----------

/** 番を終える: 期限切れの効果を消し、ポケモンチェックをして、次の番へ。 */
function endTurn(g: Game) {
  const s = g.state;
  s.markers = s.markers.filter((m) => m.expiresAfterTurn > s.turn);
  pokemonCheckup(g);
  g.checkKnockouts();
  if (s.phase === 'gameOver') return;
  if (s.promoteQueue.length > 0) {
    s.phase = 'promote';
    s.resume = 'nextTurn';
    return;
  }
  startNextTurn(g);
}

/** ポケモンチェック。どく・やけど・ねむり・マヒを処理する。 */
function pokemonCheckup(g: Game) {
  const s = g.state;
  for (const p of [s.current, other(s.current)] as PlayerId[]) {
    const slot = g.player(p).active;
    if (!slot) continue;
    const c = slot.conditions;
    if (c.poisoned) {
      g.log(`${g.name(slot)}はどくのダメージを受けた`, p);
      g.putDamage(slot, 10 * c.poisonCounters);
    }
    if (c.burned) {
      g.log(`${g.name(slot)}はやけどのダメージを受けた`, p);
      g.putDamage(slot, 20);
      if (g.flip('やけど')) {
        c.burned = false;
        g.log(`${g.name(slot)}のやけどが治った`, p);
      }
    }
    if (c.rotation === 'asleep' && g.flip('ねむり')) {
      c.rotation = null;
      g.log(`${g.name(slot)}は目を覚ました`, p);
    }
    if (c.rotation === 'paralyzed' && p === s.current) {
      c.rotation = null;
      g.log(`${g.name(slot)}のマヒが治った`, p);
    }
  }
}

function startNextTurn(g: Game) {
  const s = g.state;
  s.turn++;
  s.current = s.turn === 1 ? s.firstPlayer : other(s.current);
  s.phase = 'main';
  const pl = g.player(s.current);
  pl.energyAttached = false;
  pl.supporterPlayed = false;
  pl.stadiumPlayed = false;
  pl.retreated = false;
  pl.usedThisTurn = [];
  g.log(`--- ${s.turn}番目の番 (プレイヤー${s.current + 1}) ---`);
  if (pl.deck.length === 0) {
    g.endGame(other(s.current), '相手が山札を引けなかった');
    return;
  }
  g.draw(s.current, 1);
}

// ---------- 今できる操作の一覧 ----------

/**
 * 今のプレイヤーが選べる操作を列挙する (画面のボタンや CPU 用)。
 * にげるときのエネルギーは、先頭から必要な数を選んだ1通りだけを返す。
 */
export function getLegalActions(db: CardDB, state: GameState): Action[] {
  if (state.phase === 'gameOver' || state.pending) return [];
  const g = new Game(structuredClone(state), db);
  const out: Action[] = [];
  const tryAdd = (a: Action) => {
    try {
      applyAction(db, state, a);
      out.push(a);
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
    }
  };

  if (state.phase === 'setup') {
    for (const p of [0, 1] as PlayerId[]) {
      const pl = g.player(p);
      if (pl.setupDone) continue;
      for (const uid of pl.hand) {
        tryAdd({ type: 'setupActive', player: p, uid });
        tryAdd({ type: 'setupBench', player: p, uid });
      }
      tryAdd({ type: 'setupDone', player: p, mulliganDraw: g.player(other(p)).mulligans });
    }
    return out;
  }
  if (state.phase === 'promote') {
    for (const p of state.promoteQueue)
      for (const b of g.player(p).bench) tryAdd({ type: 'promote', player: p, benchId: b.id });
    return out;
  }

  const p = state.current;
  const pl = g.player(p);
  const mySlots = g.slots(p).map((s) => s.id);
  for (const uid of pl.hand) {
    const c = g.card(uid);
    if (c.category === 'pokemon') {
      tryAdd({ type: 'playBasic', player: p, uid });
      for (const t of mySlots) tryAdd({ type: 'evolve', player: p, uid, target: t });
    } else if (c.category === 'energy') {
      for (const t of mySlots) tryAdd({ type: 'attachEnergy', player: p, uid, target: t });
    } else if (c.trainerType === 'Tool') {
      for (const t of mySlots) tryAdd({ type: 'playTrainer', player: p, uid, target: t });
    } else {
      tryAdd({ type: 'playTrainer', player: p, uid });
    }
  }
  if (pl.active) {
    const cost = g.retreatCost(pl.active);
    for (const b of pl.bench)
      tryAdd({ type: 'retreat', player: p, benchId: b.id, discard: pl.active.energies.slice(0, cost) });
    for (const atk of g.pokemon(pl.active).attacks) tryAdd({ type: 'attack', player: p, attack: atk.name });
  }
  for (const slot of g.slots(p))
    for (const ab of g.pokemon(slot).abilities)
      tryAdd({ type: 'useAbility', player: p, slotId: slot.id, ability: ab.name });
  tryAdd({ type: 'useStadium', player: p });
  out.push({ type: 'endTurn', player: p });
  return out;
}
