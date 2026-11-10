import { useState } from 'react';
import type { GameState } from './engine';
import { DeckSetup } from './ui/DeckSetup';
import { GameScreen } from './ui/GameScreen';
import './ui/styles.css';

export default function App() {
  const [game, setGame] = useState<GameState | null>(null);
  return game ? <GameScreen initial={game} onExit={() => setGame(null)} /> : <DeckSetup onStart={setGame} />;
}
