import { useState } from 'react';
import type { Answer, GameState, Prompt } from '../engine';
import { Game } from '../engine';
import { MiniCard } from './CardView';
import { db } from './db';

/** カード効果の途中の選択 (state.pending.prompt) に答えるダイアログ。 */
export function PromptDialog({
  prompt,
  state,
  onAnswer,
}: {
  prompt: Prompt;
  state: GameState;
  onAnswer: (a: Answer) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const g = new Game(state, db);
  const who = `プレイヤー${prompt.player + 1}`;

  if (prompt.kind === 'yesNo') {
    return (
      <Modal title={`${who}: ${prompt.title}`}>
        <div className="row">
          <button className="primary" onClick={() => onAnswer(true)}>はい</button>
          <button onClick={() => onAnswer(false)}>いいえ</button>
        </div>
      </Modal>
    );
  }
  if (prompt.kind === 'chooseOption') {
    return (
      <Modal title={`${who}: ${prompt.title}`}>
        <div className="column">
          {prompt.options.map((o, i) => (
            <button key={i} onClick={() => onAnswer(i)}>{o}</button>
          ))}
        </div>
      </Modal>
    );
  }

  const toggle = (id: string) => {
    if (picked.includes(id)) setPicked(picked.filter((x) => x !== id));
    else if (prompt.max === 1) setPicked([id]);
    else if (picked.length < prompt.max) setPicked([...picked, id]);
  };
  const ok = picked.length >= prompt.min && picked.length <= prompt.max;
  const range = prompt.min === prompt.max ? `${prompt.max}` : `${prompt.min}〜${prompt.max}`;

  return (
    <Modal title={`${who}: ${prompt.title}`} subtitle={`${range}つ選ぶ (選択中 ${picked.length})`}>
      <div className="prompt-grid">
        {prompt.kind === 'chooseCards'
          ? (prompt.visible ?? prompt.options).map((uid) => {
              const selectable = prompt.options.includes(uid);
              return (
                <MiniCard
                  key={uid}
                  uid={uid}
                  state={state}
                  dimmed={!selectable}
                  selected={picked.includes(uid)}
                  onClick={selectable ? () => toggle(uid) : undefined}
                />
              );
            })
          : prompt.options.map((id) => {
              const { slot, owner, isActive } = g.findSlot(id);
              return (
                <button
                  key={id}
                  className={`choice ${picked.includes(id) ? 'selected' : ''}`}
                  onClick={() => toggle(id)}
                >
                  <b>{g.name(slot)}</b>
                  <span className="muted small">
                    P{owner + 1} {isActive ? 'バトル場' : 'ベンチ'} / HP{g.remainingHp(slot)}
                  </span>
                </button>
              );
            })}
      </div>
      <div className="row">
        <button className="primary" disabled={!ok} onClick={() => onAnswer(picked)}>
          決定
        </button>
      </div>
    </Modal>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="close" onClick={onClose} aria-label="閉じる">
              ✕
            </button>
          )}
        </div>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
