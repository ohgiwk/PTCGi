// デッキレシピ (テキスト) をカードIDの配列にする。
// 1行に「枚数 カード名 [セットID 番号]」。番号は「554/742」の形でもよい。
// 「カード名 枚数」(公式サイトのリスト表示をコピーした形) も読める。

import type { CardDB } from './cards';
import type { CardData } from './types';

export interface ParsedDeck {
  ids: string[];
  errors: string[];
}

function normalize(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function parseDeckList(db: CardDB, text: string): ParsedDeck {
  const ids: string[] = [];
  const errors: string[] = [];
  const byName = new Map<string, CardData[]>();
  for (const c of db.all()) {
    const list = byName.get(c.name) ?? [];
    list.push(c);
    byName.set(c.name, list);
  }

  for (const rawLine of text.split('\n')) {
    const line = normalize(rawLine);
    if (!line || line.startsWith('#')) continue;
    // 見出し行 (「ポケモン (18)」など) は飛ばす
    if (/^(ポケモン|グッズ|ポケモンのどうぐ|サポート|スタジアム|エネルギー|トレーナーズ)\s*\(\d+\)$/.test(line)) continue;

    let count: number;
    let rest: string;
    let m = line.match(/^(\d+)\s*(?:枚)?\s+(.+)$/);
    if (m) {
      count = Number(m[1]);
      rest = m[2];
    } else if ((m = line.match(/^(.+?)\s*(\d+)\s*枚?$/))) {
      count = Number(m[2]);
      rest = m[1];
    } else {
      errors.push(`読めない行: ${rawLine.trim()}`);
      continue;
    }

    // 末尾の「セットID 番号」
    let setId: string | null = null;
    let localId: string | null = null;
    const sm = rest.match(/^(.+?)\s+([A-Za-z0-9-]+)\s+(\d+)(?:\/\d+)?$/);
    if (sm) {
      rest = sm[1];
      setId = sm[2];
      localId = sm[3];
    }
    const name = rest.trim();
    const candidates = byName.get(name);
    if (!candidates) {
      errors.push(`カードが見つかりません: ${name}`);
      continue;
    }
    let card = candidates[0];
    if (setId && localId) {
      const exact = candidates.find(
        (c) => c.setId.toUpperCase() === setId!.toUpperCase() && Number(c.localId) === Number(localId),
      );
      if (exact) card = exact;
      else errors.push(`${name} ${setId} ${localId} が見つからないので、${card.setId} ${card.localId} を使います`);
    }
    for (let i = 0; i < count; i++) ids.push(card.id);
  }
  return { ids, errors };
}

/** デッキの枚数・同名カードの枚数・たねポケモンの有無を確認する。 */
export function validateDeck(db: CardDB, ids: string[]): string[] {
  const problems: string[] = [];
  if (ids.length !== 60) problems.push(`デッキは60枚です (今は${ids.length}枚)`);
  const counts = new Map<string, number>();
  for (const id of ids) {
    const c = db.get(id);
    if (c.category === 'energy' && c.energyType === 'Basic') continue;
    counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  for (const [name, n] of counts) if (n > 4) problems.push(`${name}が${n}枚あります (同じ名前は4枚まで)`);
  if (!ids.some((id) => {
    const c = db.get(id);
    return c.category === 'pokemon' && c.stage === 'Basic';
  }))
    problems.push('たねポケモンが入っていません');
  return problems;
}
