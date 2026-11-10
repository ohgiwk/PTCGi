// 実装済みのカード効果。ステップ3でデッキに合わせて増やしていく。
// ここに書いたものは、ルールエンジンの仕組みが動くことの確認もかねている。

import { hasRuleBox, isPokemon } from '../cards';
import { other } from '../game';
import { evolveSlot } from '../engine';
import {
  abilityEffects,
  abilityKey,
  attackEffects,
  attackKey,
  passiveEffects,
  trainerEffects,
} from './registry';

// ---------- グッズ ----------

trainerEffects['ポケパッド'] = {
  play(g, p) {
    const pl = g.player(p);
    const options = pl.deck.filter((u) => {
      const c = g.card(u);
      return isPokemon(c) && !hasRuleBox(c);
    });
    const [picked] = g.chooseCards(p, 'ポケモン (ルールを持つポケモンをのぞく) を1枚選ぶ', options, 0, 1, pl.deck);
    if (picked) {
      g.moveTo(picked, 'hand');
      g.log(`${g.card(picked).name}を手札に加えた`, p);
    }
    g.shuffle(p);
  },
};

// ---------- サポート ----------

trainerEffects['MCの盛り上げ'] = {
  play(g, p) {
    g.draw(p, 2);
    if (g.player(other(p)).prizes.length <= 3) g.draw(p, 2);
  },
};

trainerEffects['ボスの指令（ゲーチス）'] = {
  canPlay(g, p) {
    return g.player(other(p)).bench.length === 0 ? '相手のベンチにポケモンがいません' : null;
  },
  play(g, p) {
    const opp = other(p);
    const [id] = g.choosePokemon(p, '相手のベンチポケモンを1匹選ぶ', g.player(opp).bench.map((s) => s.id));
    g.switchActive(opp, id);
  },
};

trainerEffects['ユカリ'] = {
  play(g, p) {
    const [id] = g.choosePokemon(p, 'HPを150回復するポケモンを選ぶ', g.slots(p).map((s) => s.id));
    g.heal(g.findSlot(id).slot, 150);
  },
};

// ---------- 特殊エネルギー ----------

passiveEffects['グロウ草エネルギー'] = {
  maxHp: (g, slot) => (g.pokemon(slot).types.includes('Grass') ? 20 : 0),
};

passiveEffects['マグネット鋼エネルギー'] = {
  retreatCost: (g, slot, cost) => (g.pokemon(slot).types.includes('Metal') ? 0 : cost),
};

// ---------- ワザ ----------

attackEffects[attackKey('イトマル', 'ねばるいと')] = (c) => {
  c.dealBase();
  const g = c.game;
  g.state.markers.push({
    kind: 'cantRetreat',
    source: 'ねばるいと',
    target: c.defender.id,
    player: other(c.player),
    expiresAfterTurn: g.state.turn + 1,
  });
};

// =====================================================================
// タケルライコex ジャラランガ デッキ
// =====================================================================

const isDragon = (g: import('../game').Game, slot: import('../types').PokemonSlot) =>
  g.pokemon(slot).types.includes('Dragon');

// ---------- ポケモン ----------

attackEffects[attackKey('タケルライコex', 'はじけるほうこう')] = (c) => {
  const g = c.game;
  const pl = g.player(c.player);
  for (const u of [...pl.hand]) g.moveTo(u, 'discard');
  g.log('手札をすべてトラッシュした', c.player);
  g.draw(c.player, 6);
};

attackEffects[attackKey('タケルライコex', 'きょくらいごう')] = (c) => {
  const g = c.game;
  const options = g.slots(c.player).flatMap((s) => s.energies.filter((u) => g.isBasicEnergyCard(u)));
  const picked = g.chooseCards(c.player, 'トラッシュする基本エネルギーを好きなだけ選ぶ', options, 0, options.length);
  for (const u of picked) g.moveTo(u, 'discard');
  if (picked.length > 0) g.log(`基本エネルギーを${picked.length}枚トラッシュした`, c.player);
  c.dealBase(70 * picked.length);
};

attackEffects[attackKey('ジャラコ', 'かたいあたま')] = (c) => {
  c.dealBase();
  c.game.state.markers.push({
    kind: 'damageReduction',
    source: 'かたいあたま',
    target: c.attacker.id,
    player: c.player,
    expiresAfterTurn: c.game.state.turn + 1,
    data: { amount: 30 },
  });
};

attackEffects[attackKey('ジャランゴ', 'ダブルスマッシュ')] = (c) => {
  const heads = [c.game.flip(), c.game.flip()].filter(Boolean).length;
  c.dealBase(70 * heads);
};

abilityEffects[abilityKey('ジャラランガ', 'スケイルビート')] = {
  use(g, p) {
    const top = g.topOfDeck(p, 6);
    const energies = top.filter((u) => g.isBasicEnergyCard(u));
    const dragons = g.slots(p).filter((s) => isDragon(g, s));
    const picked =
      dragons.length > 0
        ? g.chooseCards(p, '[N]ポケモンにつける基本エネルギーを好きなだけ選ぶ', energies, 0, energies.length, top)
        : [];
    for (const u of picked) {
      const [id] = g.choosePokemon(
        p,
        `${g.card(u).name}をつける[N]ポケモンを選ぶ`,
        g.slots(p).filter((s) => isDragon(g, s)).map((s) => s.id),
      );
      const slot = g.findSlot(id).slot;
      g.attachEnergyCard(u, slot);
      g.log(`${g.card(u).name}を${g.name(slot)}につけた`, p);
    }
    g.shuffle(p);
  },
};

attackEffects[attackKey('タケルライコ', 'らくらいあらし')] = (c) => {
  const g = c.game;
  const opp = other(c.player);
  const [id] = g.choosePokemon(c.player, 'ダメージをあたえる相手のポケモンを選ぶ', g.slots(opp).map((s) => s.id));
  g.attackDamage(c.attacker, g.findSlot(id).slot, 30 * c.attacker.energies.length);
};

attackEffects[attackKey('ノコッチ', 'いれかわる')] = (c) => {
  const g = c.game;
  const bench = g.player(c.player).bench;
  if (bench.length === 0) return;
  const [id] = g.choosePokemon(c.player, '入れ替えるベンチポケモンを選ぶ', bench.map((s) => s.id));
  g.switchActive(c.player, id);
};

abilityEffects[abilityKey('ノココッチ', 'にげあしドロー')] = {
  use(g, p, slot) {
    g.draw(p, 3);
    g.returnSlotToDeck(slot);
    g.log('ノココッチと、ついているカードを山札にもどした', p);
    g.shuffle(p);
  },
};

// ---------- グッズ ----------

trainerEffects['なかよしポフィン'] = {
  canPlay(g, p) {
    return g.player(p).bench.length >= 5 ? 'ベンチがいっぱいです' : null;
  },
  play(g, p) {
    const pl = g.player(p);
    const options = pl.deck.filter((u) => {
      const c = g.card(u);
      return isPokemon(c) && c.stage === 'Basic' && c.hp <= 70;
    });
    const room = 5 - pl.bench.length;
    const picked = g.chooseCards(p, 'ベンチに出すHP70以下のたねポケモンを2枚まで選ぶ', options, 0, Math.min(2, room), pl.deck);
    for (const u of picked) g.putOnBench(p, u);
    g.shuffle(p);
  },
};

/** ふしぎなアメで、手札の2進化ポケモン uid が進化できる場のたねポケモン。 */
function candyTargets(g: import('../game').Game, p: import('../types').PlayerId, uid: string): string[] {
  const c = g.card(uid);
  if (!isPokemon(c) || c.stage !== 'Stage2' || !c.evolveFrom) return [];
  const stage1 = g.db.all().find((x) => isPokemon(x) && x.name === c.evolveFrom && x.evolveFrom);
  if (!stage1 || !isPokemon(stage1)) return [];
  return g
    .slots(p)
    .filter((s) => {
      const pk = g.pokemon(s);
      return pk.stage === 'Basic' && pk.name === stage1.evolveFrom && s.playedTurn !== g.state.turn;
    })
    .map((s) => s.id);
}

trainerEffects['ふしぎなアメ'] = {
  canPlay(g, p) {
    if (g.state.turn <= 2) return '最初の番はふしぎなアメを使えません';
    const ok = g.player(p).hand.some((u) => candyTargets(g, p, u).length > 0);
    return ok ? null : '進化させられる2進化ポケモンとたねポケモンの組み合わせがありません';
  },
  play(g, p) {
    const hand = g.player(p).hand.filter((u) => candyTargets(g, p, u).length > 0);
    const [uid] = g.chooseCards(p, '進化させる2進化ポケモンを選ぶ', hand, 1, 1);
    const [target] = g.choosePokemon(p, '進化させるたねポケモンを選ぶ', candyTargets(g, p, uid));
    evolveSlot(g, p, g.findSlot(target).slot, uid);
  },
};

// ---------- サポート ----------

trainerEffects['リーリエの決心'] = {
  play(g, p) {
    const pl = g.player(p);
    for (const u of [...pl.hand]) g.moveTo(u, 'deck');
    g.shuffle(p);
    g.draw(p, pl.prizes.length === 6 ? 8 : 6);
  },
};

trainerEffects['ヒカリ'] = {
  play(g, p) {
    const pl = g.player(p);
    for (const [stage, label] of [
      ['Basic', 'たねポケモン'],
      ['Stage1', '1進化ポケモン'],
      ['Stage2', '2進化ポケモン'],
    ] as const) {
      const options = pl.deck.filter((u) => {
        const c = g.card(u);
        return isPokemon(c) && c.stage === stage;
      });
      const [picked] = g.chooseCards(p, `${label}を1枚選ぶ`, options, 0, 1, pl.deck);
      if (picked) {
        g.moveTo(picked, 'hand');
        g.log(`${g.card(picked).name}を手札に加えた`, p);
      }
    }
    g.shuffle(p);
  },
};
