"use client";

import { useEffect, useMemo, useState } from "react";

type Suit = "♠" | "♥" | "♦" | "♣";
type Card = { rank: number; suit: Suit };
type Player = "hero" | "bot";
type Street = "preflop" | "flop" | "turn" | "river" | "complete";
type ActionKind = "fold" | "check" | "call" | "raise";

type Game = {
  handNo: number;
  deck: Card[];
  hero: Card[];
  bot: Card[];
  board: Card[];
  dealer: Player;
  street: Street;
  turn: Player | null;
  pot: number;
  finalPot: number;
  stacks: Record<Player, number>;
  pips: Record<Player, number>;
  currentBet: number;
  minRaise: number;
  raises: number;
  acted: Record<Player, boolean>;
  history: string[];
  note: string;
  outcome: string;
  revealBot: boolean;
};

type Eval = { score: number[]; name: string };

const STARTING_STACK = 1000;
const SB = 5;
const BB = 10;
const rankText: Record<number, string> = {
  14: "A", 13: "K", 12: "Q", 11: "J", 10: "10", 9: "9", 8: "8",
  7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2",
};
const streetName: Record<Street, string> = {
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  complete: "本手结束",
};

function shuffledDeck() {
  const deck: Card[] = [];
  (["♠", "♥", "♦", "♣"] as Suit[]).forEach((suit) => {
    for (let rank = 2; rank <= 14; rank += 1) deck.push({ rank, suit });
  });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawStreet(game: Game) {
  const next = { ...game, deck: [...game.deck], board: [...game.board] };
  next.deck.shift();
  const count = next.board.length === 0 ? 3 : 1;
  next.board.push(...next.deck.splice(0, count));
  return next;
}

function compareScore(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

function evaluateFive(cards: Card[]): Eval {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  ranks.forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const unique = [...new Set(ranks)];
  if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let i = 0; i <= unique.length - 5; i += 1) {
    if (unique[i] - unique[i + 4] === 4) {
      straightHigh = unique[i];
      break;
    }
  }
  if (flush && straightHigh) return { score: [8, straightHigh], name: "同花顺" };
  if (groups[0][1] === 4) return { score: [7, groups[0][0], groups[1][0]], name: "四条" };
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) {
    return { score: [6, groups[0][0], groups[1][0]], name: "葫芦" };
  }
  if (flush) return { score: [5, ...ranks], name: "同花" };
  if (straightHigh) return { score: [4, straightHigh], name: "顺子" };
  if (groups[0][1] === 3) {
    return {
      score: [3, groups[0][0], ...groups.slice(1).map(([r]) => r).sort((a, b) => b - a)],
      name: "三条",
    };
  }
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    const kicker = groups.find(([r, c]) => c === 1 && !pairs.includes(r))?.[0] ?? 0;
    return { score: [2, ...pairs, kicker], name: "两对" };
  }
  if (groups[0][1] === 2) {
    return {
      score: [1, groups[0][0], ...groups.slice(1).map(([r]) => r).sort((a, b) => b - a)],
      name: "一对",
    };
  }
  return { score: [0, ...ranks], name: "高牌" };
}

function evaluate(cards: Card[]): Eval {
  if (cards.length < 5) return { score: [0], name: "未成牌" };
  let best: Eval = { score: [-1], name: "" };
  for (let a = 0; a < cards.length - 4; a += 1)
    for (let b = a + 1; b < cards.length - 3; b += 1)
      for (let c = b + 1; c < cards.length - 2; c += 1)
        for (let d = c + 1; d < cards.length - 1; d += 1)
          for (let e = d + 1; e < cards.length; e += 1) {
            const value = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (compareScore(value.score, best.score) > 0) best = value;
          }
  return best;
}

function estimateEquity(hole: Card[], board: Card[], samples = 240) {
  const used = new Set([...hole, ...board].map((c) => `${c.rank}${c.suit}`));
  const pool: Card[] = [];
  (["♠", "♥", "♦", "♣"] as Suit[]).forEach((suit) => {
    for (let rank = 2; rank <= 14; rank += 1) {
      if (!used.has(`${rank}${suit}`)) pool.push({ rank, suit });
    }
  });
  let points = 0;
  for (let n = 0; n < samples; n += 1) {
    const copy = [...pool];
    for (let i = 0; i < 7 - board.length; i += 1) {
      const j = i + Math.floor(Math.random() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    const opp = copy.slice(0, 2);
    const runout = [...board, ...copy.slice(2, 2 + 5 - board.length)];
    const mine = evaluate([...hole, ...runout]);
    const theirs = evaluate([...opp, ...runout]);
    const cmp = compareScore(mine.score, theirs.score);
    points += cmp > 0 ? 1 : cmp === 0 ? 0.5 : 0;
  }
  return points / samples;
}

function startHand(previous?: Game): Game {
  const deck = shuffledDeck();
  const handNo = (previous?.handNo ?? 0) + 1;
  const dealer: Player = handNo % 2 === 1 ? "hero" : "bot";
  const stacks = previous
    ? { ...previous.stacks }
    : { hero: STARTING_STACK, bot: STARTING_STACK };
  if (stacks.hero < BB || stacks.bot < BB) {
    stacks.hero = STARTING_STACK;
    stacks.bot = STARTING_STACK;
  }
  const hero = [deck.shift()!, deck.shift()!];
  const bot = [deck.shift()!, deck.shift()!];
  const pips = { hero: dealer === "hero" ? SB : BB, bot: dealer === "bot" ? SB : BB };
  stacks.hero -= pips.hero;
  stacks.bot -= pips.bot;
  return {
    handNo, deck, hero, bot, board: [], dealer, street: "preflop", turn: dealer,
    pot: SB + BB, finalPot: 0, stacks, pips, currentBet: BB, minRaise: BB,
    raises: 0, acted: { hero: false, bot: false },
    history: [`第 ${handNo} 手：${dealer === "hero" ? "你" : "AI"} 在按钮位，小盲 ${SB} / 大盲 ${BB}`],
    note: dealer === "hero"
      ? "你在按钮位：翻牌前先行动，翻牌后拥有位置优势。"
      : "你在大盲位：翻牌前最后行动，但翻牌后要先说话。",
    outcome: "", revealBot: false,
  };
}

function runout(game: Game) {
  let next = game;
  while (next.board.length < 5) next = drawStreet(next);
  return next;
}

function showdown(game: Game): Game {
  const next = runout({ ...game, history: [...game.history] });
  const heroEval = evaluate([...next.hero, ...next.board]);
  const botEval = evaluate([...next.bot, ...next.board]);
  const cmp = compareScore(heroEval.score, botEval.score);
  const stacks = { ...next.stacks };
  let outcome = "";
  if (cmp > 0) {
    stacks.hero += next.pot;
    outcome = `你用${heroEval.name}赢下 ${next.pot} 筹码`;
  } else if (cmp < 0) {
    stacks.bot += next.pot;
    outcome = `AI 用${botEval.name}赢下 ${next.pot} 筹码`;
  } else {
    stacks.hero += Math.floor(next.pot / 2);
    stacks.bot += Math.ceil(next.pot / 2);
    outcome = `平分底池：双方都是${heroEval.name}`;
  }
  return {
    ...next, stacks, finalPot: next.pot, street: "complete", turn: null, revealBot: true,
    outcome, note: `摊牌：你的${heroEval.name} vs AI 的${botEval.name}。先比较牌型，再比较组成牌型的点数。`,
    history: [...next.history, `摊牌｜${outcome}`],
  };
}

function advanceStreet(game: Game): Game {
  if (game.street === "river" || game.stacks.hero === 0 || game.stacks.bot === 0) {
    return showdown(game);
  }
  const next = drawStreet(game);
  const street: Street =
    game.street === "preflop" ? "flop" : game.street === "flop" ? "turn" : "river";
  const first: Player = game.dealer === "hero" ? "bot" : "hero";
  return {
    ...next, street, turn: first, pips: { hero: 0, bot: 0 }, currentBet: 0,
    minRaise: BB, raises: 0, acted: { hero: false, bot: false },
    history: [...next.history, `${streetName[street]}发牌`],
    note: first === "hero"
      ? "你处于不利位置，需要先行动；用更强、更清晰的范围继续。"
      : "AI 先行动，你拥有位置：先获得信息，再做决定。",
  };
}

function recommendation(game: Game, equity: number) {
  const due = Math.max(0, game.currentBet - game.pips.hero);
  const potOdds = due > 0 ? due / (game.pot + due) : 0;
  if (due === 0) {
    if (equity >= 0.68) return { key: "raise", label: "价值下注", reason: "你的胜率优势明显，应让较差的牌付费。" };
    if (equity >= 0.52) return { key: "check", label: "过牌或小注", reason: "优势不大，控制底池通常更稳健。" };
    return { key: "check", label: "过牌", reason: "当前牌力偏弱，免费拿下一张牌最有价值。" };
  }
  if (equity + 0.04 < potOdds) {
    return { key: "fold", label: "弃牌", reason: `需要约 ${Math.round(potOdds * 100)}% 胜率，你的估算不足。` };
  }
  if (equity >= 0.72 && game.raises < 2) {
    return { key: "raise", label: "加注", reason: "牌力足够强，可以从跟注范围中榨取价值。" };
  }
  return { key: "call", label: "跟注", reason: `你的估算胜率高于约 ${Math.round(potOdds * 100)}% 的底池赔率门槛。` };
}

function actionFeedback(game: Game, kind: ActionKind, equity: number) {
  const rec = recommendation(game, equity);
  const normalized = kind === "check" ? "check" : kind;
  if (normalized === rec.key || (rec.key === "check" && kind === "raise" && equity >= 0.52)) {
    return `✓ 思路成立：${rec.reason}`;
  }
  const names: Record<ActionKind, string> = { fold: "弃牌", check: "过牌", call: "跟注", raise: "加注" };
  return `复盘：你选择了${names[kind]}；教练更偏向${rec.label}。${rec.reason}`;
}

function applyAction(game: Game, actor: Player, kind: ActionKind, raiseTo = 0, equity = 0.5): Game {
  if (game.turn !== actor || game.street === "complete") return game;
  const other: Player = actor === "hero" ? "bot" : "hero";
  const who = actor === "hero" ? "你" : "AI";
  const next: Game = {
    ...game, stacks: { ...game.stacks }, pips: { ...game.pips },
    acted: { ...game.acted }, history: [...game.history],
  };
  const feedback = actor === "hero" ? actionFeedback(game, kind, equity) : "";
  if (kind === "fold") {
    next.stacks[other] += next.pot;
    next.finalPot = next.pot;
    next.street = "complete";
    next.turn = null;
    next.revealBot = false;
    next.outcome = `${who}弃牌，${other === "hero" ? "你" : "AI"}赢下 ${next.pot} 筹码`;
    next.note = actor === "hero" ? feedback : "AI 认为继续投入不再划算。赢下一手不一定需要摊牌。";
    next.history.push(`${who}弃牌｜本手结束`);
    return next;
  }
  if (kind === "check") {
    next.acted[actor] = true;
    next.history.push(`${streetName[next.street]}｜${who}过牌`);
    next.note = actor === "hero" ? feedback : "AI 过牌，把行动权交给你。";
  } else if (kind === "call") {
    const due = Math.min(next.currentBet - next.pips[actor], next.stacks[actor]);
    next.stacks[actor] -= due;
    next.pips[actor] += due;
    next.pot += due;
    next.acted[actor] = true;
    next.history.push(`${streetName[next.street]}｜${who}跟注 ${due}`);
    next.note = actor === "hero" ? feedback : `AI 跟注 ${due}，它的范围通常仍包含中等牌力。`;
  } else {
    const maxTarget = Math.min(
      next.pips[actor] + next.stacks[actor],
      next.pips[other] + next.stacks[other],
    );
    const target = Math.max(next.currentBet + next.minRaise, Math.min(raiseTo, maxTarget));
    const paid = target - next.pips[actor];
    const raiseSize = target - next.currentBet;
    next.stacks[actor] -= paid;
    next.pips[actor] = target;
    next.pot += paid;
    next.currentBet = target;
    next.minRaise = Math.max(next.minRaise, raiseSize);
    next.raises += 1;
    next.acted[actor] = true;
    next.acted[other] = false;
    next.history.push(`${streetName[next.street]}｜${who}${game.currentBet ? "加注至" : "下注"} ${target}`);
    next.note = actor === "hero" ? feedback : `AI 主动施压到 ${target}。先算跟注成本，再看自己的胜率。`;
  }
  if (next.acted.hero && next.acted.bot && next.pips.hero === next.pips.bot) {
    return advanceStreet(next);
  }
  next.turn = other;
  return next;
}

function botDecision(game: Game) {
  const equity = estimateEquity(game.bot, game.board, 170);
  const due = Math.max(0, game.currentBet - game.pips.bot);
  const odds = due > 0 ? due / (game.pot + due) : 0;
  const maxTarget = Math.min(
    game.pips.bot + game.stacks.bot,
    game.pips.hero + game.stacks.hero,
  );
  if (due > 0) {
    if (equity + 0.06 < odds && Math.random() > 0.08) return applyAction(game, "bot", "fold");
    if (equity > 0.74 && game.raises < 2 && game.stacks.bot > due + BB) {
      const target = Math.min(maxTarget, game.currentBet + Math.max(game.minRaise, Math.round(game.pot * 0.55 / 5) * 5));
      return applyAction(game, "bot", "raise", target);
    }
    return applyAction(game, "bot", "call");
  }
  if ((equity > 0.58 || Math.random() < 0.08) && game.stacks.bot > 0) {
    const target = Math.min(maxTarget, Math.max(BB, Math.round(game.pot * 0.62 / 5) * 5));
    return applyAction(game, "bot", "raise", target);
  }
  return applyAction(game, "bot", "check");
}

function CardView({ card, hidden = false, small = false }: { card?: Card; hidden?: boolean; small?: boolean }) {
  if (!card || hidden) {
    return <div className={`playing-card card-back ${small ? "small" : ""}`} aria-label="暗牌"><span>♠</span></div>;
  }
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div className={`playing-card ${red ? "red" : ""} ${small ? "small" : ""}`} aria-label={`${rankText[card.rank]}${card.suit}`}>
      <strong>{rankText[card.rank]}</strong><span>{card.suit}</span>
    </div>
  );
}

function Metric({ label, value, muted }: { label: string; value: string; muted?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{muted && <small>{muted}</small>}</div>;
}

export default function PokerTrainer() {
  const [game, setGame] = useState<Game | null>(null);
  const [tab, setTab] = useState<"table" | "learn">("table");
  const [showHints, setShowHints] = useState(true);
  const [stats, setStats] = useState({ hands: 0, good: 0 });

  useEffect(() => {
    setGame(startHand());
    const saved = window.localStorage.getItem("holdem-dojo-stats");
    if (saved) setStats(JSON.parse(saved));
  }, []);

  useEffect(() => {
    if (!game || game.turn !== "bot" || game.street === "complete") return;
    const timer = window.setTimeout(() => setGame((current) => current ? botDecision(current) : current), 620);
    return () => window.clearTimeout(timer);
  }, [game]);

  const equity = useMemo(() => {
    if (!game) return 0.5;
    return estimateEquity(game.hero, game.board, 300);
  }, [game?.hero, game?.board]);

  const due = game ? Math.max(0, game.currentBet - game.pips.hero) : 0;
  const potOdds = game && due ? due / (game.pot + due) : 0;
  const rec = game ? recommendation(game, equity) : null;

  const raiseTargets = useMemo(() => {
    if (!game) return [];
    const maxTarget = Math.min(
      game.pips.hero + game.stacks.hero,
      game.pips.bot + game.stacks.bot,
    );
    const base = game.currentBet > 0
      ? game.currentBet + Math.max(game.minRaise, Math.round((game.pot + due) * 0.5 / 5) * 5)
      : Math.max(BB, Math.round(game.pot * 0.5 / 5) * 5);
    const large = game.currentBet > 0
      ? game.currentBet + Math.max(game.minRaise, Math.round((game.pot + due) * 0.85 / 5) * 5)
      : Math.max(BB, Math.round(game.pot * 0.85 / 5) * 5);
    return [
      { label: "1/2 池", value: Math.min(maxTarget, base) },
      { label: "大注", value: Math.min(maxTarget, large) },
      { label: "全下", value: maxTarget },
    ].filter((item, index, arr) => item.value > game.currentBet && arr.findIndex((x) => x.value === item.value) === index);
  }, [game, due]);

  function heroAct(kind: ActionKind, target = 0) {
    if (!game || game.turn !== "hero") return;
    setGame(applyAction(game, "hero", kind, target, equity));
  }

  function nextHand() {
    if (!game) return;
    const newStats = {
      hands: stats.hands + 1,
      good: stats.good + (game.note.startsWith("✓") ? 1 : 0),
    };
    setStats(newStats);
    window.localStorage.setItem("holdem-dojo-stats", JSON.stringify(newStats));
    setGame(startHand(game));
  }

  if (!game) return <main className="loading">正在洗牌…</main>;

  const heroHand = game.board.length >= 3 ? evaluate([...game.hero, ...game.board]).name : "起手牌";
  const heroCanAct = game.turn === "hero" && game.street !== "complete";
  const isRedBot = game.bot[0].suit === "♥" || game.bot[0].suit === "♦";

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="德州研习室首页">
          <span className="brand-mark">D</span>
          <span>德州研习室<small>Hold&apos;em Dojo</small></span>
        </a>
        <nav aria-label="主导航">
          <button className={tab === "table" ? "active" : ""} onClick={() => setTab("table")}>牌桌训练</button>
          <button className={tab === "learn" ? "active" : ""} onClick={() => setTab("learn")}>五分钟入门</button>
        </nav>
        <div className="header-note"><span></span>纯单机 · 无真钱</div>
      </header>

      {tab === "table" ? (
        <>
          <section className="hero-strip" id="top">
            <div>
              <p className="eyebrow">DECISION LAB / 决策实验室</p>
              <h1>少猜牌，<em>多算一层。</em></h1>
            </div>
            <p>和一位克制的 AI 打短桌训练局。每次行动都有即时复盘，重点学习范围、位置、赔率和尺度。</p>
          </section>

          <section className="workspace">
            <div className="table-column">
              <div className="table-meta">
                <span>第 {game.handNo} 手</span>
                <span className="street-pill">{streetName[game.street]}</span>
                <span>盲注 {SB}/{BB}</span>
              </div>
              <div className="poker-table">
                <div className={`seat bot-seat ${game.turn === "bot" ? "thinking" : ""}`}>
                  <div className="avatar">AI</div>
                  <div><strong>研习对手</strong><span>{game.stacks.bot} 筹码</span></div>
                  {game.dealer === "bot" && <b className="dealer-chip">D</b>}
                </div>
                <div className="bot-cards">
                  <CardView card={game.bot[0]} hidden={!game.revealBot} small />
                  <CardView card={game.bot[1]} hidden={!game.revealBot} small />
                  {game.revealBot && <span className={isRedBot ? "red-text" : ""}>{evaluate([...game.bot, ...game.board]).name}</span>}
                </div>

                <div className="pot"><span>底池 POT</span><strong>{game.pot}</strong></div>
                <div className="board" aria-label="公共牌">
                  {[0, 1, 2, 3, 4].map((i) => game.board[i]
                    ? <CardView key={`${game.board[i].rank}${game.board[i].suit}`} card={game.board[i]} />
                    : <div className="card-slot" key={i}>{i < 3 ? "F" : i === 3 ? "T" : "R"}</div>)}
                </div>
                <div className="bet-label bot-bet">{game.pips.bot > 0 && <><i></i>{game.pips.bot}</>}</div>
                <div className="bet-label hero-bet">{game.pips.hero > 0 && <><i></i>{game.pips.hero}</>}</div>

                <div className="hero-cards">
                  <CardView card={game.hero[0]} />
                  <CardView card={game.hero[1]} />
                  <span>{heroHand}</span>
                </div>
                <div className={`seat hero-seat ${game.turn === "hero" ? "thinking" : ""}`}>
                  <div className="avatar hero-avatar">你</div>
                  <div><strong>学习者</strong><span>{game.stacks.hero} 筹码</span></div>
                  {game.dealer === "hero" && <b className="dealer-chip">D</b>}
                </div>
              </div>

              <div className="action-panel">
                {game.street === "complete" ? (
                  <div className="result-row">
                    <div><span>本手结果</span><strong>{game.outcome}</strong></div>
                    <button className="primary-action" onClick={nextHand}>下一手牌 <kbd>N</kbd></button>
                  </div>
                ) : (
                  <>
                    <div className="turn-prompt">
                      <div><span>{heroCanAct ? "轮到你了" : "对手思考中"}</span><strong>{due > 0 ? `跟注需要 ${due}` : "可以过牌或主动下注"}</strong></div>
                      <small>{game.raises >= 3 ? "本轮已达到训练局加注上限" : "选择动作后，教练会解释这一步"}</small>
                    </div>
                    <div className="action-buttons">
                      {due > 0
                        ? <button disabled={!heroCanAct} className="fold" onClick={() => heroAct("fold")}>弃牌 <kbd>F</kbd></button>
                        : null}
                      <button disabled={!heroCanAct} onClick={() => heroAct(due > 0 ? "call" : "check")}>
                        {due > 0 ? `跟注 ${due}` : "过牌"} <kbd>C</kbd>
                      </button>
                      {game.raises < 3 && raiseTargets.map((item) => (
                        <button
                          disabled={!heroCanAct}
                          className="raise"
                          key={item.label}
                          onClick={() => heroAct("raise", item.value)}
                        >
                          {game.currentBet ? "加注" : "下注"} {item.label}<small>{item.value}</small>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <aside className="coach">
              <div className="coach-head">
                <div><p className="eyebrow">LIVE COACH</p><h2>决策教练</h2></div>
                <label className="switch"><input type="checkbox" checked={showHints} onChange={(e) => setShowHints(e.target.checked)} /><span></span>提示</label>
              </div>
              {showHints ? (
                <>
                  <div className="metrics">
                    <Metric label="估算胜率" value={`${Math.round(equity * 100)}%`} muted="vs 随机范围" />
                    <Metric label="底池赔率" value={due ? `${Math.round(potOdds * 100)}%` : "—"} muted={due ? "跟注门槛" : "无需跟注"} />
                    <Metric label="位置" value={game.dealer === "hero" ? "按钮位" : "大盲位"} muted={game.dealer === "hero" ? "翻后后行动" : "翻后先行动"} />
                  </div>
                  <div className="advice">
                    <span>当前建议</span>
                    <strong>{rec?.label}</strong>
                    <p>{rec?.reason}</p>
                  </div>
                </>
              ) : (
                <div className="hints-off"><span>◉</span><p>提示已隐藏。先独立决策，行动后仍会得到复盘。</p></div>
              )}
              <div className="coach-note">
                <span>教练点评</span>
                <p>{game.note}</p>
              </div>
              <details>
                <summary>查看行动记录</summary>
                <ol>{game.history.slice().reverse().map((item, i) => <li key={`${item}${i}`}>{item}</li>)}</ol>
              </details>
              <div className="progress">
                <div><span>本机练习</span><strong>{stats.hands} 手</strong></div>
                <div className="progress-track"><i style={{ width: `${Math.min(100, stats.hands * 4)}%` }}></i></div>
                <small>记录只保存在这台设备</small>
              </div>
            </aside>
          </section>

          <section className="principles">
            <p className="eyebrow">THINK IN THIS ORDER</p>
            <h2>每次行动前，按这个顺序想</h2>
            <div className="principle-grid">
              <article><b>01</b><span>位置</span><h3>谁先行动？</h3><p>后行动能看到更多信息，因此可以用更宽的范围进入底池。</p></article>
              <article><b>02</b><span>范围</span><h3>他可能有什么？</h3><p>不要执着猜中一手牌；根据前面的行动缩小一组可能手牌。</p></article>
              <article><b>03</b><span>赔率</span><h3>要赢多少次？</h3><p>跟注成本 ÷ 跟注后的总底池，就是不亏不赚所需的最低胜率。</p></article>
              <article><b>04</b><span>目标</span><h3>下注为了什么？</h3><p>价值下注让弱牌跟，诈唬让强于你的牌弃；说不清目的就先别下注。</p></article>
            </div>
          </section>
        </>
      ) : (
        <section className="learn-page">
          <div className="learn-intro">
            <p className="eyebrow">TEXAS HOLD&apos;EM / 从零开始</p>
            <h1>五分钟看懂一手德州</h1>
            <p>每人两张底牌，桌面最多发五张公共牌。你从七张牌中选出最强的五张组合；也可以在摊牌前让所有对手弃牌。</p>
            <button className="primary-action" onClick={() => setTab("table")}>进入练习牌桌 →</button>
          </div>
          <div className="lesson-stack">
            <article><span>01 / 发牌</span><h2>两张底牌，只属于你</h2><p>小盲和大盲先投入强制下注，形成初始底池。按钮位每手顺时针轮换；单挑时，按钮位同时是小盲。</p><div className="mini-cards"><CardView card={{rank:14,suit:"♠"}} small/><CardView card={{rank:13,suit:"♠"}} small/><b>AK 同花</b></div></article>
            <article><span>02 / 四轮行动</span><h2>翻前 → 翻牌 → 转牌 → 河牌</h2><div className="street-line"><i>2张底牌</i><b>→</b><i>3张翻牌</i><b>→</b><i>1张转牌</i><b>→</b><i>1张河牌</i></div><p>每轮可以弃牌、过牌、跟注、下注或加注。真实牌局允许继续反加；训练桌每轮最多三次加注，方便初学者聚焦。</p></article>
            <article><span>03 / 牌型</span><h2>从大到小，先比类别</h2><div className="ranking"><b>同花顺</b><b>四条</b><b>葫芦</b><b>同花</b><b>顺子</b><b>三条</b><b>两对</b><b>一对</b><b>高牌</b></div><p>类别相同，再比较组成牌型的点数。花色没有大小之分；A 既可在 AKQJ10 中作最大牌，也可在 A2345 中作 1。</p></article>
            <article><span>04 / 数学</span><h2>底池赔率是第一把尺</h2><div className="formula"><strong>跟注成本</strong><b>÷</b><strong>跟注后的总底池</strong><b>=</b><strong>最低胜率</strong></div><p>例如底池 100，对手下注 50：你付 50，跟注后底池 200，最低胜率是 25%。估算胜率高于它，跟注才有直接盈利空间。</p></article>
            <article><span>05 / 博弈</span><h2>范围比“读心”更可靠</h2><p>紧手玩家在前位加注，范围通常较强；按钮位小加注，范围可能很宽。观察位置、下注尺度和前序行动，用证据持续更新范围。</p><blockquote>好决策不保证这一手赢；它保证同样场景重复很多次后，你会赢得更多。</blockquote></article>
          </div>
        </section>
      )}

      <footer>
        <div><span className="brand-mark">D</span><strong>德州研习室</strong></div>
        <p>学习概率与策略，不提供充值、匹配、排行榜或真钱玩法。</p>
        <button onClick={() => { setGame(startHand()); setTab("table"); }}>重置练习</button>
      </footer>
    </main>
  );
}
