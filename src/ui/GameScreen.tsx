import { useMemo, useState } from 'react';
import type { Action, Answer, GameState, PlayerId, PokemonSlot } from '../engine';
import { applyAction, Game, GameError, getLegalActions, other, trainerEffects } from '../engine';
import { CardDetail, MiniCard, SlotView } from './CardView';
import { db } from './db';
import { Modal, PromptDialog } from './PromptDialog';

type Selection = { kind: 'hand'; uid: string } | { kind: 'slot'; id: string } | null;
type Mode = null | { kind: 'retreat' } | { kind: 'retreatEnergy'; benchId: string; cost: number };
type Pile = { player: PlayerId; zone: 'discard' | 'lostZone' } | null;

/** 下側に表示するプレイヤー (今操作するプレイヤー)。 */
function viewerOf(s: GameState): PlayerId {
  if (s.pending) return s.pending.prompt.player;
  if (s.phase === 'setup') return s.players[0].setupDone ? 1 : 0;
  if (s.phase === 'promote') return s.promoteQueue[0];
  return s.current;
}

export function GameScreen({ initial, onExit }: { initial: GameState; onExit: () => void }) {
  const [history, setHistory] = useState<GameState[]>([initial]);
  const state = history[history.length - 1];
  const [sel, setSel] = useState<Selection>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [pile, setPile] = useState<Pile>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [retreatPick, setRetreatPick] = useState<string[]>([]);

  const g = useMemo(() => new Game(state, db), [state]);
  const legal = useMemo(() => getLegalActions(db, state), [state]);
  const viewer = viewerOf(state);
  const opp = other(viewer);

  const dispatch = (a: Action) => {
    try {
      const next = applyAction(db, state, a);
      setHistory([...history, next]);
      setSel(null);
      setMode(null);
      setError(null);
    } catch (e) {
      if (e instanceof GameError) setError(e.message);
      else throw e;
    }
  };
  const undo = () => {
    if (history.length <= 1) return;
    setHistory(history.slice(0, -1));
    setSel(null);
    setMode(null);
    setError(null);
  };

  // ---- 選択中のカードでできること ----
  const handActions = sel?.kind === 'hand' ? legal.filter((a) => 'uid' in a && a.uid === sel.uid) : [];
  const targetActions = handActions.filter((a): a is Action & { target: string } => 'target' in a && !!a.target);
  const plainActions = handActions.filter((a) => !('target' in a) || !a.target);
  const targetIds = new Set(targetActions.map((a) => a.target));

  const selectedSlot: PokemonSlot | null = sel?.kind === 'slot' ? safeSlot(g, sel.id) : null;
  const selectedSlotOwner = selectedSlot ? g.findSlot(selectedSlot.id).owner : null;
  const slotActions: Action[] =
    selectedSlot && selectedSlotOwner === viewer
      ? legal.filter(
          (a) =>
            (a.type === 'useAbility' && a.slotId === selectedSlot.id) ||
            ((a.type === 'attack' || a.type === 'retreat') && g.player(viewer).active?.id === selectedSlot.id),
        )
      : [];
  const canRetreat = slotActions.some((a) => a.type === 'retreat');
  const retreatTargets = new Set(
    mode?.kind === 'retreat' ? legal.filter((a) => a.type === 'retreat').map((a) => (a as { benchId: string }).benchId) : [],
  );
  const promoteTargets = new Set(
    state.phase === 'promote' ? legal.filter((a) => a.type === 'promote' && a.player === viewer).map((a) => (a as { benchId: string }).benchId) : [],
  );

  const onSlotClick = (slot: PokemonSlot) => {
    if (sel?.kind === 'hand' && targetIds.has(slot.id)) {
      dispatch(targetActions.find((a) => a.target === slot.id)!);
      return;
    }
    if (mode?.kind === 'retreat' && retreatTargets.has(slot.id)) {
      const active = g.player(viewer).active!;
      const cost = g.retreatCost(active);
      if (cost === 0 || active.energies.length === cost) {
        dispatch({ type: 'retreat', player: viewer, benchId: slot.id, discard: active.energies.slice(0, cost) });
      } else {
        setRetreatPick([]);
        setMode({ kind: 'retreatEnergy', benchId: slot.id, cost });
      }
      return;
    }
    if (promoteTargets.has(slot.id)) {
      dispatch({ type: 'promote', player: viewer, benchId: slot.id });
      return;
    }
    setMode(null);
    setSel(sel?.kind === 'slot' && sel.id === slot.id ? null : { kind: 'slot', id: slot.id });
  };

  const actionLabel = (a: Action): string => {
    switch (a.type) {
      case 'setupActive':
        return 'バトル場に出す';
      case 'setupBench':
      case 'playBasic':
        return 'ベンチに出す';
      case 'playTrainer':
        return trainerEffects[g.card(a.uid).name] ? '使う' : '使う (効果未実装)';
      case 'attack':
        return `ワザ「${a.attack}」`;
      case 'useAbility':
        return `特性「${a.ability}」`;
      default:
        return a.type;
    }
  };

  // ---- 詳細パネルに出すカード ----
  const detail = (() => {
    if (sel?.kind === 'hand') return <CardDetail card={g.card(sel.uid)} state={state} />;
    if (selectedSlot) return <CardDetail card={g.pokemon(selectedSlot)} slot={selectedSlot} state={state} />;
    if (state.stadium) return <CardDetail card={g.card(state.stadium.uid)} state={state} />;
    return <p className="muted">カードをタップすると、ここに効果が出ます。</p>;
  })();

  const hint = (() => {
    if (state.phase === 'setup') return `プレイヤー${viewer + 1}の準備: たねポケモンをバトル場とベンチに出してください`;
    if (state.phase === 'promote') return `プレイヤー${viewer + 1}: バトル場に出すポケモンを選んでください`;
    if (mode?.kind === 'retreat') return 'にげる先のベンチポケモンを選んでください';
    if (targetActions.length > 0) return '光っているポケモンを選んでください';
    return null;
  })();

  const vp = g.player(viewer);
  const setupDoneAction = legal.find((a) => a.type === 'setupDone' && a.player === viewer);
  const stadiumAction = legal.find((a) => a.type === 'useStadium');

  return (
    <div className="game">
      <div className="board">
        <PlayerArea
          state={state}
          player={opp}
          top
          sel={sel}
          highlight={(id) => targetIds.has(id) || retreatTargets.has(id) || promoteTargets.has(id)}
          onSlotClick={onSlotClick}
          onPile={(zone) => setPile({ player: opp, zone })}
        />
        <div className="midline">
          <span className="turn">
            {state.phase === 'setup' ? '準備中' : `${state.turn}番目の番 / プレイヤー${state.current + 1}`}
          </span>
          {state.stadium && (
            <span className="stadium">
              スタジアム: {g.card(state.stadium.uid).name}
              {stadiumAction && (
                <button className="small-btn" onClick={() => dispatch(stadiumAction)}>
                  使う
                </button>
              )}
            </span>
          )}
          {hint && <span className="hint">{hint}</span>}
        </div>
        <PlayerArea
          state={state}
          player={viewer}
          sel={sel}
          highlight={(id) => targetIds.has(id) || retreatTargets.has(id) || promoteTargets.has(id)}
          onSlotClick={onSlotClick}
          onPile={(zone) => setPile({ player: viewer, zone })}
        />
        <div className="hand">
          {vp.hand.map((uid) => (
            <MiniCard
              key={uid}
              uid={uid}
              state={state}
              selected={sel?.kind === 'hand' && sel.uid === uid}
              highlighted={legal.some((a) => 'uid' in a && a.uid === uid)}
              onClick={() => {
                setMode(null);
                setSel(sel?.kind === 'hand' && sel.uid === uid ? null : { kind: 'hand', uid });
              }}
            />
          ))}
        </div>
      </div>

      <aside className="side">
        <div className="side-top">
          <b>プレイヤー{viewer + 1}の操作</b>
          <div className="row wrap">
            <button onClick={undo} disabled={history.length <= 1}>1手戻す</button>
            <button onClick={() => setShowLog(true)}>ログ</button>
            <button onClick={onExit}>やめる</button>
          </div>
        </div>
        <div className="actions">
          {plainActions.map((a, i) => (
            <button key={i} className="primary" onClick={() => dispatch(a)}>
              {actionLabel(a)}
            </button>
          ))}
          {slotActions
            .filter((a) => a.type !== 'retreat')
            .map((a, i) => (
              <button key={`s${i}`} className="primary" onClick={() => dispatch(a)}>
                {actionLabel(a)}
              </button>
            ))}
          {canRetreat && (
            <button onClick={() => setMode(mode?.kind === 'retreat' ? null : { kind: 'retreat' })}>
              {mode?.kind === 'retreat' ? 'にげるのをやめる' : 'にげる'}
            </button>
          )}
          {setupDoneAction && setupDoneAction.type === 'setupDone' && (
            <button className="primary" onClick={() => dispatch(setupDoneAction)}>
              準備完了
              {(setupDoneAction.mulliganDraw ?? 0) > 0 && ` (相手の引き直しぶん${setupDoneAction.mulliganDraw}枚引く)`}
            </button>
          )}
          {state.phase === 'main' && !state.pending && (
            <button className="end-turn" onClick={() => dispatch({ type: 'endTurn', player: state.current })}>
              番を終える
            </button>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="detail-wrap">{detail}</div>
      </aside>

      {state.pending && (
        <PromptDialog
          key={history.length}
          prompt={state.pending.prompt}
          state={state}
          onAnswer={(answer: Answer) => dispatch({ type: 'answer', player: state.pending!.prompt.player, answer })}
        />
      )}

      {mode?.kind === 'retreatEnergy' && (
        <Modal title={`トラッシュするエネルギーを${mode.cost}個選ぶ`} onClose={() => setMode(null)}>
          <div className="prompt-grid">
            {vp.active!.energies.map((uid) => (
              <MiniCard
                key={uid}
                uid={uid}
                state={state}
                selected={retreatPick.includes(uid)}
                onClick={() =>
                  setRetreatPick(
                    retreatPick.includes(uid)
                      ? retreatPick.filter((x) => x !== uid)
                      : retreatPick.length < mode.cost
                        ? [...retreatPick, uid]
                        : retreatPick,
                  )
                }
              />
            ))}
          </div>
          <div className="row">
            <button
              className="primary"
              disabled={retreatPick.length !== mode.cost}
              onClick={() => dispatch({ type: 'retreat', player: viewer, benchId: mode.benchId, discard: retreatPick })}
            >
              にげる
            </button>
          </div>
        </Modal>
      )}

      {pile && (
        <Modal
          title={`プレイヤー${pile.player + 1}の${pile.zone === 'discard' ? 'トラッシュ' : 'ロストゾーン'}`}
          onClose={() => setPile(null)}
        >
          <div className="prompt-grid">
            {g.player(pile.player)[pile.zone].map((uid) => (
              <MiniCard key={uid} uid={uid} state={state} />
            ))}
            {g.player(pile.player)[pile.zone].length === 0 && <p className="muted">まだありません</p>}
          </div>
        </Modal>
      )}

      {showLog && (
        <Modal title="ログ" onClose={() => setShowLog(false)}>
          <ol className="log">
            {[...state.log].reverse().map((l, i) => (
              <li key={i}>
                {l.player !== null && <b>P{l.player + 1} </b>}
                {l.text}
              </li>
            ))}
          </ol>
        </Modal>
      )}

      {state.phase === 'gameOver' && (
        <Modal title={state.winner === 'draw' ? '引き分け' : `プレイヤー${(state.winner as number) + 1}の勝ち`}>
          <p>{state.log[state.log.length - 1]?.text}</p>
          <div className="row">
            <button onClick={undo}>1手戻す</button>
            <button className="primary" onClick={onExit}>
              デッキ選択にもどる
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function safeSlot(g: Game, id: string): PokemonSlot | null {
  try {
    return g.findSlot(id).slot;
  } catch {
    return null;
  }
}

function PlayerArea({
  state,
  player,
  top,
  sel,
  highlight,
  onSlotClick,
  onPile,
}: {
  state: GameState;
  player: PlayerId;
  top?: boolean;
  sel: Selection;
  highlight: (id: string) => boolean;
  onSlotClick: (s: PokemonSlot) => void;
  onPile: (zone: 'discard' | 'lostZone') => void;
}) {
  const pl = state.players[player];
  const isSel = (id: string) => sel?.kind === 'slot' && sel.id === id;
  const bench = (
    <div className="bench">
      {pl.bench.map((s) => (
        <SlotView
          key={s.id}
          slot={s}
          state={state}
          selected={isSel(s.id)}
          highlighted={highlight(s.id)}
          onClick={() => onSlotClick(s)}
        />
      ))}
      {Array.from({ length: Math.max(0, 5 - pl.bench.length) }, (_, i) => (
        <div key={`e${i}`} className="slot empty" />
      ))}
    </div>
  );
  const activeRow = (
    <div className="active-row">
      <div className="piles">
        <div className="pile">サイド<b>{pl.prizes.length}</b></div>
        <div className="pile">山札<b>{pl.deck.length}</b></div>
      </div>
      {pl.active ? (
        <SlotView
          slot={pl.active}
          state={state}
          isActive
          selected={isSel(pl.active.id)}
          highlighted={highlight(pl.active.id)}
          onClick={() => onSlotClick(pl.active!)}
        />
      ) : (
        <div className="slot active empty">バトル場</div>
      )}
      <div className="piles">
        <button className="pile" onClick={() => onPile('discard')}>
          トラッシュ<b>{pl.discard.length}</b>
        </button>
        {top && <div className="pile">手札<b>{pl.hand.length}</b></div>}
      </div>
    </div>
  );
  return (
    <section className={`area ${top ? 'top' : 'bottom'} ${state.current === player ? 'current' : ''}`}>
      <div className="area-label">プレイヤー{player + 1}</div>
      {top ? (
        <>
          {bench}
          {activeRow}
        </>
      ) : (
        <>
          {activeRow}
          {bench}
        </>
      )}
    </section>
  );
}
