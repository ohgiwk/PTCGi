import cards from './data/cards.json';

// 画面はステップ2で作る。今はカードデータが読めていることだけ表示する。
export default function App() {
  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>PTCGi</h1>
      <p>ルールエンジンを開発中です。カードデータ: {cards.length}枚</p>
    </main>
  );
}
