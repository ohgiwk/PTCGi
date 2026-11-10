import type { CardData, GameState, PokemonSlot, ProvidedEnergy } from '../engine';
import { Game } from '../engine';
import { db } from './db';
import { TYPE_INFO, typeColor } from './energy';

export function EnergyIcon({ type, size = 18 }: { type: ProvidedEnergy; size?: number }) {
  const info = TYPE_INFO[type];
  return (
    <span
      className="energy-icon"
      style={{ width: size, height: size, fontSize: size * 0.62, background: info.color, color: info.text }}
      title={info.label}
    >
      {info.label}
    </span>
  );
}

function categoryLabel(c: CardData): string {
  if (c.category === 'pokemon') return c.stage === 'Basic' ? 'たね' : c.stage === 'Stage1' ? '1進化' : '2進化';
  if (c.category === 'trainer')
    return { Item: 'グッズ', Supporter: 'サポート', Stadium: 'スタジアム', Tool: 'どうぐ' }[c.trainerType];
  return c.energyType === 'Basic' ? '基本エネ' : '特殊エネ';
}

function cardAccent(c: CardData): string {
  if (c.category === 'pokemon') return typeColor(c.types[0]);
  if (c.category === 'energy') return TYPE_INFO[c.provides[0]].color;
  return { Item: '#4a7bd0', Supporter: '#d0794a', Stadium: '#4aa36b', Tool: '#8a5cc2' }[c.trainerType];
}

/** 手札や選択肢に出す小さなカード。 */
export function MiniCard({
  uid,
  state,
  selected,
  highlighted,
  dimmed,
  onClick,
}: {
  uid: string;
  state: GameState;
  selected?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const c = db.get(state.cards[uid].cardId);
  return (
    <button
      className={`mini-card ${selected ? 'selected' : ''} ${highlighted ? 'highlighted' : ''} ${dimmed ? 'dimmed' : ''}`}
      style={{
        borderTopColor: cardAccent(c),
        background: c.category === 'energy' ? TYPE_INFO[c.provides[0]].color : undefined,
        color: c.category === 'energy' ? TYPE_INFO[c.provides[0]].text : undefined,
      }}
      onClick={onClick}
    >
      <span className="mini-kind">{categoryLabel(c)}</span>
      <span className="mini-name">{c.name}</span>
      {c.category === 'pokemon' && <span className="mini-hp">HP{c.hp}</span>}
    </button>
  );
}

const CONDITION_LABEL = { asleep: 'ねむり', confused: 'こんらん', paralyzed: 'マヒ' } as const;

/** 場のポケモン。 */
export function SlotView({
  slot,
  state,
  selected,
  highlighted,
  isActive,
  onClick,
}: {
  slot: PokemonSlot;
  state: GameState;
  selected?: boolean;
  highlighted?: boolean;
  isActive?: boolean;
  onClick?: () => void;
}) {
  const g = new Game(state, db);
  const pk = g.pokemon(slot);
  const maxHp = g.maxHp(slot);
  const hp = Math.max(0, maxHp - slot.damage);
  const c = slot.conditions;
  return (
    <button
      className={`slot ${isActive ? 'active' : ''} ${selected ? 'selected' : ''} ${highlighted ? 'highlighted' : ''}`}
      style={{ borderTopColor: typeColor(pk.types[0]) }}
      onClick={onClick}
    >
      <div className="slot-head">
        <span className="slot-stage">{categoryLabel(pk)}</span>
        <span className="slot-name">{pk.name}</span>
      </div>
      <div className="hp-bar">
        <div className="hp-fill" style={{ width: `${(hp / maxHp) * 100}%`, background: hp / maxHp > 0.5 ? '#3fa34d' : hp / maxHp > 0.25 ? '#f4c20d' : '#e4572e' }} />
      </div>
      <div className="slot-hp">
        HP {hp}/{maxHp}
        {slot.damage > 0 && <span className="damage">−{slot.damage}</span>}
      </div>
      <div className="slot-energies">
        {g.energyProvided(slot).map((p, i) => (
          <EnergyIcon key={i} type={p[0]} size={16} />
        ))}
      </div>
      {slot.tools.length > 0 && <div className="slot-tool">🔧 {g.card(slot.tools[0]).name}</div>}
      <div className="slot-conditions">
        {c.rotation && <span className="cond">{CONDITION_LABEL[c.rotation]}</span>}
        {c.poisoned && <span className="cond poison">どく</span>}
        {c.burned && <span className="cond burn">やけど</span>}
      </div>
    </button>
  );
}

/** カードの全文。画像がないので、ここで効果を読む。 */
export function CardDetail({ card, slot, state }: { card: CardData; slot?: PokemonSlot; state: GameState }) {
  const g = new Game(state, db);
  return (
    <div className="detail">
      <div className="detail-head" style={{ borderColor: cardAccent(card) }}>
        <span className="detail-kind">{categoryLabel(card)}</span>
        <h3>{card.name}</h3>
        {card.category === 'pokemon' && (
          <span className="detail-hp">
            HP{slot ? `${g.remainingHp(slot)}/${g.maxHp(slot)}` : card.hp}
            {card.types.map((t) => (
              <EnergyIcon key={t} type={t} size={16} />
            ))}
          </span>
        )}
      </div>
      {card.category === 'pokemon' && (
        <>
          {card.evolveFrom && <p className="muted">{card.evolveFrom}から進化</p>}
          {card.abilities.map((a) => (
            <div key={a.name} className="detail-block ability">
              <div className="detail-title">特性 {a.name}</div>
              <p>{a.effect}</p>
            </div>
          ))}
          {card.attacks.map((a) => (
            <div key={a.name} className="detail-block">
              <div className="detail-title">
                {a.cost.map((t, i) => (
                  <EnergyIcon key={i} type={t} size={16} />
                ))}
                <span>{a.name}</span>
                <span className="detail-dmg">
                  {a.damage > 0 ? a.damage : ''}
                  {a.damageMod === 'x' ? '×' : a.damageMod ?? ''}
                </span>
              </div>
              {a.effect && <p>{a.effect}</p>}
            </div>
          ))}
          <div className="detail-foot">
            <span>弱点 {card.weaknesses.map((w) => `${TYPE_INFO[w.type].label}${w.value}`).join(' ') || 'なし'}</span>
            <span>抵抗力 {card.resistances.map((r) => `${TYPE_INFO[r.type].label}${r.value}`).join(' ') || 'なし'}</span>
            <span>にげる {slot ? g.retreatCost(slot) : card.retreat}</span>
          </div>
          {slot && slot.energies.length > 0 && (
            <div className="detail-attached">
              ついているカード: {[...slot.energies, ...slot.tools].map((u) => g.card(u).name).join('、')}
            </div>
          )}
        </>
      )}
      {card.category !== 'pokemon' && card.effect && <p className="detail-text">{card.effect}</p>}
      <p className="muted small">
        {card.setId} {card.localId}
      </p>
    </div>
  );
}
