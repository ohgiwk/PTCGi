// pokeca-rag の data/cards.json を、このアプリ用のカードデータに変換する。
// 使い方: node scripts/import-cards.mjs /path/to/pokeca-rag/data/cards.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/import-cards.mjs <pokeca-rag/data/cards.json>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'cards.json');

const TYPE_LETTERS = {
  G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic',
  F: 'Fighting', D: 'Darkness', M: 'Metal', C: 'Colorless', N: 'Dragon', Y: 'Fairy',
};

const JP_TYPES = {
  草: 'Grass', 炎: 'Fire', 水: 'Water', 雷: 'Lightning', 超: 'Psychic',
  闘: 'Fighting', 悪: 'Darkness', 鋼: 'Metal',
};

function parseDamage(raw) {
  if (raw == null) return { damage: 0, damageMod: null };
  if (typeof raw === 'number') return { damage: raw, damageMod: null };
  const s = String(raw).normalize('NFKC');
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
  let mod = null;
  if (s.includes('+')) mod = '+';
  else if (s.includes('×') || s.toLowerCase().includes('x')) mod = 'x';
  else if (s.includes('-') || s.includes('－')) mod = '-';
  return { damage: n, damageMod: mod };
}

function energyProvides(card) {
  const text = card.effect ?? '';
  if (text.includes('すべてのタイプのエネルギー')) return ['Any'];
  const m = text.match(/\[([A-Z])\]エネルギー1個ぶん/);
  if (m && TYPE_LETTERS[m[1]]) return [TYPE_LETTERS[m[1]]];
  // 古いデータではテキストからタイプ記号が抜けているので、名前から判断する。
  const n = card.name.match(/(草|炎|水|雷|超|闘|悪|鋼)エネルギー$/);
  if (n) return [JP_TYPES[n[1]]];
  return ['Colorless'];
}

function prizeValue(card) {
  if (card.category !== 'ポケモン') return 1;
  if (/^メガ.*ex$/.test(card.name)) return 3;
  if (/ex$/.test(card.name)) return 2;
  return 1;
}

const raw = JSON.parse(readFileSync(src, 'utf8'));
const cards = raw.map((c) => {
  const category =
    c.category === 'ポケモン' ? 'pokemon' : c.category === 'トレーナーズ' ? 'trainer' : 'energy';
  const base = {
    id: c.id,
    name: c.name,
    category,
    setId: c.set_id,
    localId: c.local_id,
    regulationMark: c.regulation_mark,
    rarity: c.rarity,
  };
  if (category === 'pokemon') {
    return {
      ...base,
      hp: c.hp ?? 0,
      types: c.types ?? [],
      stage: c.stage ?? 'Basic',
      evolveFrom: c.evolve_from,
      abilities: (c.abilities ?? []).map((a) => ({ name: a.name, effect: a.effect ?? '' })),
      attacks: (c.attacks ?? []).map((a) => ({
        name: a.name,
        cost: a.cost ?? [],
        ...parseDamage(a.damage),
        effect: a.effect ?? '',
      })),
      weaknesses: (c.weaknesses ?? []).map((w) => ({ type: w.type, value: w.value })),
      resistances: (c.resistances ?? []).map((r) => ({ type: r.type, value: r.value })),
      retreat: c.retreat ?? 0,
      prizes: prizeValue(c),
    };
  }
  if (category === 'trainer') {
    return { ...base, trainerType: c.trainer_type ?? 'Item', effect: c.effect ?? '' };
  }
  return {
    ...base,
    energyType: c.energy_type === 'Normal' || /^基本.エネルギー$/.test(c.name) ? 'Basic' : 'Special',
    provides: energyProvides(c),
    effect: c.effect ?? '',
  };
});

// 進化元が抜けているカードがあるので、同じ名前の別のカードから補う。
const evolveFromByName = {};
for (const c of cards) if (c.category === 'pokemon' && c.evolveFrom) evolveFromByName[c.name] = c.evolveFrom;
let filled = 0;
for (const c of cards) {
  if (c.category === 'pokemon' && c.stage !== 'Basic' && !c.evolveFrom && evolveFromByName[c.name]) {
    c.evolveFrom = evolveFromByName[c.name];
    filled++;
  }
}
console.log(`filled evolveFrom for ${filled} cards`);

// 基本エネルギーは TCGdex のデータに入っていないので、ここで足す。
const BASIC = [
  ['Grass', '草'], ['Fire', '炎'], ['Water', '水'], ['Lightning', '雷'], ['Psychic', '超'],
  ['Fighting', '闘'], ['Darkness', '悪'], ['Metal', '鋼'],
];
for (const [type, jp] of BASIC) {
  cards.push({
    id: `BASIC-${type}`,
    name: `基本${jp}エネルギー`,
    category: 'energy',
    setId: 'BASIC',
    localId: type,
    regulationMark: null,
    rarity: 'Common',
    energyType: 'Basic',
    provides: [type],
    effect: '',
  });
}

writeFileSync(out, JSON.stringify(cards));
console.log(`wrote ${cards.length} cards to ${out}`);
