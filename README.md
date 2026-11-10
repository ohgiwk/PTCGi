# PTCGi

iPad などのタブレットのブラウザで動く、ポケモンカードの対戦アプリです。
まずは一人回し (両方のプレイヤーを自分で動かす) から作り、のちに CPU 対戦を足します。

## 開発

```bash
npm install
npm run dev     # 画面 (ステップ2で作成予定)
npm test        # ルールエンジンのテスト
npm run build
```

## カードデータ

カードデータは [pokeca-rag](../pokeca-rag) の `data/cards.json` から作ります。
pokeca-rag でセットを取得したら、次のコマンドで取り込み直してください。

```bash
node scripts/import-cards.mjs ../pokeca-rag/data/cards.json
```

`src/data/cards.json` に書き出されます。基本エネルギーは元データにないので、このスクリプトで足しています。

## 構成

```
src/engine/            ルールエンジン (画面に依存しない)
  types.ts             カードデータ・ゲーム状態・操作の型
  engine.ts            createGame / applyAction / getLegalActions
  game.ts              状態を書きかえる道具 (カード効果もこれで書く)
  effects/registry.ts  カード効果の登録場所
  effects/cards.ts     実装済みのカード効果
decks/                 デッキレシピ
scripts/               カードデータの取り込み
```

### ルールエンジンの使い方

```ts
import { CardDB, createGame, applyAction, getLegalActions } from './engine';

const db = new CardDB(cards);
let state = createGame(db, [deck1, deck2], { seed: 1 });
state = applyAction(db, state, { type: 'setupActive', player: 0, uid });
```

- `applyAction` は元の状態を変えず、新しい状態を返します。ルール上できない操作は `GameError` を投げます。
- 乱数の状態も `GameState` に入っているので、同じ状態と操作からは必ず同じ結果になります。
- カード効果の途中でプレイヤーの選択が必要になると、`state.pending.prompt` に選択肢が入ります。
  `{ type: 'answer', answer }` を送ると、効果を最初からやり直して続きを処理します。
- 効果が登録されていないカードは、ログに「効果未実装」と出して効果なしで処理します。

### カード効果の書き方

`src/engine/effects/cards.ts` に、カード名をキーにして登録します。

```ts
trainerEffects['MCの盛り上げ'] = {
  play(g, p) {
    g.draw(p, 2);
    if (g.player(other(p)).prizes.length <= 3) g.draw(p, 2);
  },
};
```
