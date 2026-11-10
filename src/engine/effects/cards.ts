// 実装済みのカード効果。ステップ3でデッキに合わせて増やしていく。
// ここに書いたものは、ルールエンジンの仕組みが動くことの確認もかねている。

import { hasRuleBox, isPokemon } from '../cards';
import { other } from '../game';
import {
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
