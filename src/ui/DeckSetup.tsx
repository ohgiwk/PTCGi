import { useState } from 'react';
import { createGame, parseDeckList, validateDeck } from '../engine';
import type { GameState } from '../engine';
import { db } from './db';
import defaultDeck from './default-deck.txt?raw';

const STORAGE_KEY = 'ptcgi.decks';

function loadSaved(): [string, string] {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(v) && v.length === 2) return [String(v[0]), String(v[1])];
  } catch {
    // 保存がなくても動く
  }
  return [defaultDeck, defaultDeck];
}

export function DeckSetup({ onStart }: { onStart: (s: GameState) => void }) {
  const [texts, setTexts] = useState<[string, string]>(loadSaved);
  const [first, setFirst] = useState<'coin' | '0' | '1'>('coin');
  const parsed = texts.map((t) => parseDeckList(db, t));
  const problems = parsed.map((p) => [...p.errors, ...validateDeck(db, p.ids)]);
  const blocking = parsed.some((p) => p.ids.length === 0 || !p.ids.some((id) => {
    const c = db.get(id);
    return c.category === 'pokemon' && c.stage === 'Basic';
  }));

  const start = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(texts));
    } catch {
      // 保存できなくても続ける
    }
    onStart(
      createGame(db, [parsed[0].ids, parsed[1].ids], {
        firstPlayer: first === 'coin' ? undefined : (Number(first) as 0 | 1),
      }),
    );
  };

  return (
    <div className="setup">
      <h1>PTCGi 一人回し</h1>
      <p className="muted">
        デッキレシピを貼り付けてください。1行に「枚数 カード名 [セット 番号]」、または公式サイトのリスト表示をそのまま貼れます。
      </p>
      <div className="setup-decks">
        {[0, 1].map((p) => (
          <div key={p} className="setup-deck">
            <h2>プレイヤー{p + 1}のデッキ ({parsed[p].ids.length}枚)</h2>
            <textarea
              value={texts[p]}
              onChange={(e) => {
                const next = [...texts] as [string, string];
                next[p] = e.target.value;
                setTexts(next);
              }}
            />
            {problems[p].length > 0 && (
              <ul className="problems">
                {problems[p].map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <label>
          先攻:
          <select value={first} onChange={(e) => setFirst(e.target.value as 'coin' | '0' | '1')}>
            <option value="coin">コインで決める</option>
            <option value="0">プレイヤー1</option>
            <option value="1">プレイヤー2</option>
          </select>
        </label>
        <button className="primary big" disabled={blocking} onClick={start}>
          ゲーム開始
        </button>
      </div>
      <p className="muted small">カードデータ: {db.all().length}枚</p>
    </div>
  );
}
