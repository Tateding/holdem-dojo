"use client";

import { useEffect, useMemo, useState } from "react";

type Suit = "♠" | "♥" | "♦" | "♣";
type Card = { rank: number; suit: Suit };
type Player = "hero" | "bot";
type Street = "preflop" | "flop" | "turn" | "river" | "complete";
type ActionKind = "fold" | "check" | "call" | "raise";
type Difficulty = "guide" | "standard" | "advanced";
type MatchMode = "cash" | "tournament";
type RebuyMode = "auto" | "manual" | "off";
type TableSize = "headsUp" | "sixMax";

type TableSettings = {
  difficulty: Difficulty;
  mode: MatchMode;
  stackBB: 50 | 100 | 200;
  rebuy: RebuyMode;
  tableSize: TableSize;
};

type Tendencies = {
  decisions: number;
  folds: number;
  calls: number;
  raises: number;
};

type SixSeat = {
  id: string;
  name: string;
  position: string;
  stack: number;
  active: boolean;
  action: string;
  hole: Card[];
};

type SixScenario = {
  handNo: number;
  street: Street;
  board: Card[];
  hero: Card[];
  heroPosition: string;
  seats: SixSeat[];
  pot: number;
  toCall: number;
  deck: Card[];
  resolved: boolean;
  outcome: string;
  feedback: string;
  reveal: boolean;
};

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
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  settings: TableSettings;
  matchOver: boolean;
  rebuyPending: boolean;
};

type Eval = { score: number[]; name: string };

const emptyStats = { hands: 0, good: 0 };

function initialStats() {
  if (typeof window === "undefined") return emptyStats;
  try {
    const saved = window.localStorage.getItem("holdem-dojo-stats");
    if (!saved) return emptyStats;
    const parsed = JSON.parse(saved) as { hands?: unknown; good?: unknown };
    return {
      hands: typeof parsed.hands === "number" ? parsed.hands : 0,
      good: typeof parsed.good === "number" ? parsed.good : 0,
    };
  } catch {
    return emptyStats;
  }
}

const SB = 5;
const BB = 10;
const defaultSettings: TableSettings = {
  difficulty: "guide",
  mode: "cash",
  stackBB: 100,
  rebuy: "auto",
  tableSize: "headsUp",
};
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

function estimateMultiwayEquity(hole: Card[], board: Card[], opponents: number, samples = 300) {
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
    const needed = opponents * 2 + (5 - board.length);
    for (let i = 0; i < needed; i += 1) {
      const j = i + Math.floor(Math.random() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    const runout = [...board, ...copy.slice(opponents * 2, needed)];
    const heroEval = evaluate([...hole, ...runout]);
    let tied = 1;
    let beaten = false;
    for (let i = 0; i < opponents; i += 1) {
      const opponentEval = evaluate([...copy.slice(i * 2, i * 2 + 2), ...runout]);
      const cmp = compareScore(heroEval.score, opponentEval.score);
      if (cmp < 0) {
        beaten = true;
        break;
      }
      if (cmp === 0) tied += 1;
    }
    if (!beaten) points += 1 / tied;
  }
  return points / samples;
}

function createSixScenario(previous?: SixScenario, settings: TableSettings = defaultSettings): SixScenario {
  const deck = shuffledDeck();
  const hero = deck.splice(0, 2);
  const names = ["岩石", "观察者", "进攻手", "稳健派", "变速手"];
  const allPositions = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
  const heroPosition = allPositions[Math.floor(Math.random() * allPositions.length)];
  const botPositions = allPositions.filter((position) => position !== heroPosition);
  const streetRoll = Math.random();
  const street: Street = streetRoll < 0.28 ? "preflop" : streetRoll < 0.64 ? "flop" : streetRoll < 0.84 ? "turn" : "river";
  const boardTarget = street === "preflop" ? 0 : street === "flop" ? 3 : street === "turn" ? 4 : 5;
  const botHoles = names.map(() => deck.splice(0, 2));
  const board: Card[] = [];
  if (boardTarget >= 3) {
    deck.shift();
    board.push(...deck.splice(0, 3));
  }
  if (boardTarget >= 4) {
    deck.shift();
    board.push(deck.shift()!);
  }
  if (boardTarget >= 5) {
    deck.shift();
    board.push(deck.shift()!);
  }
  const maxActive = settings.difficulty === "guide" ? 2 : settings.difficulty === "standard" ? 4 : 5;
  const activeCount = 1 + Math.floor(Math.random() * maxActive);
  const activeIndexes = [...Array(5).keys()].sort(() => Math.random() - 0.5).slice(0, activeCount);
  const facingBet = Math.random() < (settings.difficulty === "guide" ? 0.58 : settings.difficulty === "standard" ? 0.72 : 0.84);
  const sizingSteps = settings.difficulty === "guide" ? 2 : settings.difficulty === "standard" ? 5 : 8;
  const baseBet = street === "preflop" ? 20 + Math.floor(Math.random() * sizingSteps) * 10 : 25 + Math.floor(Math.random() * sizingSteps) * 10;
  const toCall = facingBet ? baseBet : 0;
  const starting = settings.stackBB * BB;
  const seats: SixSeat[] = names.map((name, index) => {
    const active = activeIndexes.includes(index);
    const action = !active ? "弃牌" : facingBet && index === activeIndexes[0] ? `下注 ${baseBet}` : facingBet ? "跟注" : "过牌";
    return {
      id: `bot-${index}`,
      name,
      position: botPositions[index],
      stack: starting - (active ? Math.max(10, baseBet) : 0),
      active,
      action,
      hole: botHoles[index],
    };
  });
  return {
    handNo: (previous?.handNo ?? 0) + 1,
    street,
    board,
    hero,
    heroPosition,
    seats,
    pot: 15 + activeCount * Math.max(10, baseBet),
    toCall,
    deck,
    resolved: false,
    outcome: "",
    feedback: "",
    reveal: false,
  };
}

function sixRecommendation(scenario: SixScenario, equity: number) {
  const odds = scenario.toCall > 0 ? scenario.toCall / (scenario.pot + scenario.toCall) : 0;
  if (scenario.toCall === 0) {
    if (equity > 0.58) return { key: "raise", label: "下注", reason: "你的多人胜率仍然领先，可以让较弱的牌付费。" };
    return { key: "check", label: "过牌", reason: "多人底池中需要更强的牌，免费继续通常更稳妥。" };
  }
  if (equity + 0.03 < odds) return { key: "fold", label: "弃牌", reason: `跟注至少需要约 ${Math.round(odds * 100)}% 胜率，目前估算不足。` };
  if (equity > 0.64) return { key: "raise", label: "加注", reason: "即使面对多名对手，你仍有明显胜率优势。" };
  return { key: "call", label: "跟注", reason: `估算胜率高于约 ${Math.round(odds * 100)}% 的跟注门槛。` };
}

function resolveSixScenario(
  scenario: SixScenario,
  action: "fold" | "call" | "check" | "raise",
  equity: number,
  difficulty: Difficulty,
) {
  const rec = sixRecommendation(scenario, equity);
  if (action === "fold") {
    return {
      ...scenario,
      resolved: true,
      outcome: `你在 ${scenario.heroPosition} 位置弃牌，保留剩余筹码`,
      feedback: rec.key === "fold" ? `思路成立：${rec.reason}` : `这次偏保守。教练更倾向${rec.label}：${rec.reason}`,
    };
  }
  let contenders = scenario.seats.filter((seat) => seat.active);
  let updatedSeats = scenario.seats;
  let extra = scenario.toCall;
  if (action === "raise") {
    const raiseExtra = Math.max(20, Math.round(scenario.pot * 0.65 / 5) * 5);
    extra += raiseExtra;
    const foldChance = difficulty === "guide" ? 0.46 : difficulty === "standard" ? 0.34 : 0.27;
    let continuing = contenders.filter(() => Math.random() > foldChance);
    if (continuing.length === 0) continuing = [contenders[Math.floor(Math.random() * contenders.length)]];
    const ids = new Set(continuing.map((seat) => seat.id));
    updatedSeats = scenario.seats.map((seat) => seat.active && !ids.has(seat.id) ? { ...seat, active: false, action: "面对加注弃牌" } : seat);
    contenders = continuing;
  }
  const deck = [...scenario.deck];
  const board = [...scenario.board];
  while (board.length < 5) {
    deck.shift();
    board.push(...deck.splice(0, board.length === 0 ? 3 : 1));
  }
  const heroEval = evaluate([...scenario.hero, ...board]);
  let bestSeat: SixSeat | null = null;
  let heroBest = true;
  let tie = false;
  contenders.forEach((seat) => {
    const opponentEval = evaluate([...seat.hole, ...board]);
    const cmp = compareScore(heroEval.score, opponentEval.score);
    if (cmp < 0) {
      heroBest = false;
      if (!bestSeat || compareScore(opponentEval.score, evaluate([...bestSeat.hole, ...board]).score) > 0) bestSeat = seat;
    } else if (cmp === 0) tie = true;
  });
  const finalPot = scenario.pot + extra + (action === "raise" ? contenders.length * Math.max(20, extra - scenario.toCall) : 0);
  const outcome = heroBest
    ? tie ? `你用${heroEval.name}与对手平分约 ${finalPot} 的底池` : `你用${heroEval.name}赢下约 ${finalPot} 的多人底池`
    : `${bestSeat?.name ?? "对手"}在摊牌时获胜；你的牌型是${heroEval.name}`;
  const normalized = action === "check" ? "check" : action;
  return {
    ...scenario,
    board,
    seats: updatedSeats,
    deck,
    resolved: true,
    reveal: true,
    outcome,
    feedback: normalized === rec.key || (rec.key === "call" && action === "raise")
      ? `思路成立：${rec.reason}`
      : `复盘：教练更倾向${rec.label}。${rec.reason}`,
  };
}

function blindsForHand(settings: TableSettings, handNo: number) {
  if (settings.mode === "cash") return { smallBlind: SB, bigBlind: BB, level: 1 };
  const level = Math.floor((handNo - 1) / 5) + 1;
  const bigBlind = Math.min(160, BB * 2 ** (level - 1));
  return { smallBlind: Math.max(5, Math.floor(bigBlind / 2)), bigBlind, level };
}

function startHand(previous?: Game, chosenSettings?: TableSettings): Game {
  const settings = chosenSettings ?? previous?.settings ?? defaultSettings;
  const deck = shuffledDeck();
  const handNo = (previous?.handNo ?? 0) + 1;
  const { smallBlind, bigBlind, level } = blindsForHand(settings, handNo);
  const startingStack = settings.stackBB * BB;
  const dealer: Player = handNo % 2 === 1 ? "hero" : "bot";
  const stacks = previous
    ? { ...previous.stacks }
    : { hero: startingStack, bot: startingStack };
  const hero = [deck.shift()!, deck.shift()!];
  const bot = [deck.shift()!, deck.shift()!];
  const pips = {
    hero: Math.min(stacks.hero, dealer === "hero" ? smallBlind : bigBlind),
    bot: Math.min(stacks.bot, dealer === "bot" ? smallBlind : bigBlind),
  };
  stacks.hero -= pips.hero;
  stacks.bot -= pips.bot;
  const fresh: Game = {
    handNo, deck, hero, bot, board: [], dealer, street: "preflop", turn: dealer,
    pot: pips.hero + pips.bot, finalPot: 0, stacks, pips, currentBet: Math.max(pips.hero, pips.bot), minRaise: bigBlind,
    raises: 0, acted: { hero: false, bot: false },
    history: [
      `第 ${handNo} 手：${dealer === "hero" ? "你" : "AI"} 先放 ${smallBlind}，另一方先放 ${bigBlind}`,
      ...(settings.mode === "tournament" && (handNo - 1) % 5 === 0 ? [`锦标赛第 ${level} 级：盲注 ${smallBlind}/${bigBlind}`] : []),
    ],
    note: dealer === "hero"
      ? "这一手你有 D 标记。桌上发出公共牌后，对手会先选，你可以看完他的动作再决定。"
      : "这一手对手有 D 标记。桌上发出公共牌后，你需要先做决定。",
    outcome: "", revealBot: false, smallBlind, bigBlind, startingStack, settings,
    matchOver: false, rebuyPending: false,
  };
  const other: Player = dealer === "hero" ? "bot" : "hero";
  if (fresh.stacks[dealer] === 0 && fresh.pips[other] >= fresh.pips[dealer]) return showdown(fresh);
  return fresh;
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
    minRaise: game.bigBlind, raises: 0, acted: { hero: false, bot: false },
    history: [...next.history, `${streetName[street]}发牌`],
    note: first === "hero"
      ? "公共牌已经出现。这一轮你先选，所以还不知道对手准备怎么做。"
      : "对手先选。等它行动后，你会多知道一条信息。",
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
    return { key: "raise", label: "加注", reason: "你的牌很强，可以多放一些筹码，让较弱的牌付出更多。" };
  }
  return { key: "call", label: "跟注", reason: `继续需要大约 ${Math.round(potOdds * 100)}% 的胜率；你目前的估算比它高。` };
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
    next.note = actor === "hero" ? feedback : `AI 补了 ${due}，选择继续看后面的牌。`;
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

function botDecision(game: Game, tendencies: Tendencies) {
  const difficulty = game.settings.difficulty;
  const profile = difficulty === "guide"
    ? { samples: 90, foldBuffer: 0.12, bluff: 0, raiseAt: 0.82, betAt: 0.7, size: 0.45 }
    : difficulty === "standard"
      ? { samples: 220, foldBuffer: 0.06, bluff: 0.08, raiseAt: 0.74, betAt: 0.58, size: 0.62 }
      : { samples: 520, foldBuffer: 0.02, bluff: 0.12, raiseAt: 0.67, betAt: 0.53, size: 0.72 };
  const foldRate = tendencies.decisions ? tendencies.folds / tendencies.decisions : 0;
  const raiseRate = tendencies.decisions ? tendencies.raises / tendencies.decisions : 0;
  const adaptiveBluff = difficulty === "advanced"
    ? Math.min(0.28, profile.bluff + foldRate * 0.22)
    : profile.bluff;
  const equity = Math.min(
    1,
    estimateEquity(game.bot, game.board, profile.samples) + (difficulty === "advanced" && raiseRate > 0.35 ? 0.025 : 0),
  );
  const due = Math.max(0, game.currentBet - game.pips.bot);
  const odds = due > 0 ? due / (game.pot + due) : 0;
  const maxTarget = Math.min(
    game.pips.bot + game.stacks.bot,
    game.pips.hero + game.stacks.hero,
  );
  if (due > 0) {
    if (equity + profile.foldBuffer < odds && Math.random() > adaptiveBluff * 0.35) return applyAction(game, "bot", "fold");
    if (equity > profile.raiseAt && game.raises < 2 && game.stacks.bot > due + game.bigBlind) {
      const variedSize = difficulty === "advanced" ? 0.48 + Math.random() * 0.52 : profile.size;
      const target = Math.min(maxTarget, game.currentBet + Math.max(game.minRaise, Math.round(game.pot * variedSize / 5) * 5));
      return applyAction(game, "bot", "raise", target);
    }
    return applyAction(game, "bot", "call");
  }
  if ((equity > profile.betAt || Math.random() < adaptiveBluff) && game.stacks.bot > 0) {
    const variedSize = difficulty === "advanced" ? 0.38 + Math.random() * 0.68 : profile.size;
    const target = Math.min(maxTarget, Math.max(game.bigBlind, Math.round(game.pot * variedSize / 5) * 5));
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

const beginnerSteps = [
  { short: "认识牌", title: "扑克牌，其实只有两个信息", kicker: "第 1 关 · 先别管德州" },
  { short: "怎么赢", title: "德州的目标：凑出最好的 5 张", kicker: "第 2 关 · 游戏目标" },
  { short: "发几次牌", title: "一手牌，要经过四个小回合", kicker: "第 3 关 · 游戏流程" },
  { short: "四个按钮", title: "轮到你时，只需要选四种动作", kicker: "第 4 关 · 怎么操作" },
  { short: "牌型大小", title: "先记住最常见的三种牌型", kicker: "第 5 关 · 怎么比大小" },
  { short: "第一次决定", title: "来做一个完全看得懂的决定", kicker: "最后一关 · 试一试" },
];

function BeginnerCourse({ onStart }: { onStart: () => void }) {
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const lesson = beginnerSteps[step];

  function move(next: number) {
    setAnswer(null);
    setStep(Math.max(0, Math.min(beginnerSteps.length - 1, next)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="beginner-course" id="top">
      <aside className="lesson-nav">
        <div>
          <p className="eyebrow">ZERO TO FIRST HAND</p>
          <h1>从第一张牌<br />开始学</h1>
          <p>不背术语，不考数学。每一页只学一件事。</p>
        </div>
        <ol>
          {beginnerSteps.map((item, index) => (
            <li key={item.short} className={index === step ? "current" : index < step ? "done" : ""}>
              <button onClick={() => move(index)} aria-label={`第${index + 1}关：${item.short}`}>
                <b>{index < step ? "✓" : index + 1}</b><span>{item.short}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="course-progress"><i style={{ width: `${((step + 1) / beginnerSteps.length) * 100}%` }}></i></div>
        <small>{step + 1} / {beginnerSteps.length}</small>
      </aside>

      <div className="lesson-card">
        <div className="lesson-heading">
          <p className="eyebrow">{lesson.kicker}</p>
          <h2>{lesson.title}</h2>
        </div>

        {step === 0 && (
          <div className="lesson-body">
            <p className="plain-lead">看一张牌，只看<strong>数字</strong>和<strong>花色</strong>。数字决定大小，花色只是分类。</p>
            <div className="suit-grid">
              <div className="black-suit"><b>♠</b><span>黑桃</span></div>
              <div className="red-suit"><b>♥</b><span>红桃</span></div>
              <div className="red-suit"><b>♦</b><span>方块</span></div>
              <div className="black-suit"><b>♣</b><span>梅花</span></div>
            </div>
            <div className="rank-ladder">
              <span>小</span>
              <div>2</div><div>3</div><div>4</div><div>5</div><div>6</div><div>7</div><div>8</div><div>9</div><div>10</div><div>J</div><div>Q</div><div>K</div><div className="ace">A</div>
              <span>大</span>
            </div>
            <div className="remember"><b>只记一句：</b>A 最大，K 第二；四种花色没有谁更厉害。</div>
            <div className="tiny-quiz">
              <div><span>点一下更大的牌：</span><strong>A 和 K，谁大？</strong></div>
              <button className={answer === "a" ? "correct" : ""} onClick={() => setAnswer("a")}>A</button>
              <button className={answer === "k" ? "wrong" : ""} onClick={() => setAnswer("k")}>K</button>
              {answer && <p>{answer === "a" ? "答对了。A 是普通比较中最大的单张。" : "再看看上面的大小顺序：A 排在 K 后面，所以 A 更大。"}</p>}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="lesson-body">
            <p className="plain-lead">你手里有 <strong>2 张自己的牌</strong>，桌上最多出现 <strong>5 张大家共用的牌</strong>。</p>
            <div className="seven-card-demo">
              <div className="card-group"><span>只给你的</span><div><CardView card={{ rank: 14, suit: "♠" }} /><CardView card={{ rank: 14, suit: "♥" }} /></div></div>
              <b>＋</b>
              <div className="card-group public"><span>桌上共用的</span><div><CardView card={{ rank: 14, suit: "♦" }} /><CardView card={{ rank: 9, suit: "♣" }} /><CardView card={{ rank: 6, suit: "♠" }} /><CardView card={{ rank: 3, suit: "♥" }} /><CardView card={{ rank: 2, suit: "♣" }} /></div></div>
            </div>
            <div className="simple-equation">
              <span>一共能看到 7 张</span><b>→</b><strong>自动挑出最好的 5 张</strong>
            </div>
            <p className="friendly-note">不用自己拖动选牌，游戏会自动帮你判断。上面的例子里，你有三个 A，叫作“三条”。</p>
            <div className="two-ways">
              <article><b>方法 1</b><h3>比牌赢</h3><p>最后还没退出的人亮牌，5 张组合更大的人赢。</p></article>
              <article><b>方法 2</b><h3>让对手先退出</h3><p>如果其他人都选择弃牌，你不用亮牌也能赢。</p></article>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="lesson-body">
            <p className="plain-lead">不是一下发完。桌上的公共牌会分 <strong>3 次</strong>出现，中间大家都能重新决定。</p>
            <div className="round-road">
              <article><b>①</b><span>开始</span><h3>每人 2 张</h3><p>桌上还没有公共牌</p><div className="road-cards"><i></i><i></i></div></article>
              <article><b>②</b><span>翻牌</span><h3>桌上发 3 张</h3><p>第一次看到公共牌</p><div className="road-cards"><i></i><i></i><i></i></div></article>
              <article><b>③</b><span>转牌</span><h3>再发 1 张</h3><p>桌上现在共 4 张</p><div className="road-cards single"><i></i></div></article>
              <article><b>④</b><span>河牌</span><h3>最后 1 张</h3><p>桌上最终共 5 张</p><div className="road-cards single"><i></i></div></article>
            </div>
            <div className="remember"><b>把它想成四个小回合：</b>看一下新牌，再决定一次。任何时候都可以退出这一手。</div>
          </div>
        )}

        {step === 3 && (
          <div className="lesson-body">
            <p className="plain-lead">筹码先当作<strong>游戏分数</strong>。轮到你时，按钮看着多，其实只有下面四个意思。</p>
            <div className="action-dictionary">
              <article className="fold-card"><b>弃牌</b><span>FOLD</span><p>这手不玩了。已经放进去的分数拿不回来，但不用继续付。</p><em>像：这一题先跳过</em></article>
              <article><b>过牌</b><span>CHECK</span><p>不加分数，把机会交给下一位。只有没人要求你补分数时才能用。</p><em>像：我先看看</em></article>
              <article><b>跟注</b><span>CALL</span><p>对手放了多少，你补到一样多，继续看后面的牌。</p><em>像：我跟你一样</em></article>
              <article className="raise-card"><b>下注 / 加注</b><span>BET / RAISE</span><p>主动多放分数，让对手选择跟上，或者退出。</p><em>像：我把难度提高</em></article>
            </div>
            <div className="example-call">
              <div><span>桌中已有</span><strong>100</strong></div><b>＋</b><div><span>对手刚放</span><strong>20</strong></div><b>→</b><div><span>你想继续，就补</span><strong>20</strong></div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="lesson-body">
            <p className="plain-lead">先不用背九种牌型。初学时，认出这三种就已经能开始玩。</p>
            <div className="starter-hands">
              <article><span>最常见</span><div className="hand-example"><CardView card={{rank:8,suit:"♠"}} small/><CardView card={{rank:8,suit:"♥"}} small/></div><h3>一对</h3><p>两个数字相同。比如两个 8。</p></article>
              <article><span>排成队</span><div className="text-cards"><i>5</i><i>6</i><i>7</i><i>8</i><i>9</i></div><h3>顺子</h3><p>五个连续数字，花色随意。</p></article>
              <article><span>同一种花色</span><div className="text-cards red-mini"><i>2♥</i><i>5♥</i><i>8♥</i><i>J♥</i><i>K♥</i></div><h3>同花</h3><p>五张都是同一种花色，数字不必连续。</p></article>
            </div>
            <details className="all-ranks">
              <summary>需要时再看：完整牌型从大到小</summary>
              <div className="ranking"><b>同花顺</b><b>四条</b><b>葫芦</b><b>同花</b><b>顺子</b><b>三条</b><b>两对</b><b>一对</b><b>高牌</b></div>
              <p>游戏会自动显示你现在是什么牌型，所以不必一次背完。</p>
            </details>
          </div>
        )}

        {step === 5 && (
          <div className="lesson-body">
            <p className="plain-lead">你拿到了<strong>两个 A</strong>——这是最好的起手牌。对手加了 20，你要补 20 才能继续。</p>
            <div className="first-decision">
              <div className="decision-cards"><CardView card={{rank:14,suit:"♠"}}/><CardView card={{rank:14,suit:"♥"}}/></div>
              <div><span>你的牌</span><strong>一对 A</strong><p>现在还没有公共牌</p></div>
              <div className="decision-cost"><span>继续要补</span><strong>20</strong></div>
            </div>
            <div className="decision-question">
              <h3>你会怎么选？</h3>
              <button className={answer === "fold" ? "wrong" : ""} onClick={() => setAnswer("fold")}>弃牌</button>
              <button className={answer === "call" ? "correct" : ""} onClick={() => setAnswer("call")}>跟注</button>
              <button className={answer === "raise" ? "best" : ""} onClick={() => setAnswer("raise")}>加注</button>
            </div>
            {answer && (
              <div className={`answer-box ${answer === "fold" ? "answer-wrong" : ""}`}>
                {answer === "raise" && <><strong>最好：加注</strong><p>两个 A 非常强，主动多放分数，常能让较弱的牌付出更多。</p></>}
                {answer === "call" && <><strong>可以继续，但偏保守</strong><p>跟注不会犯大错；不过这手牌足够强，通常更适合加注。</p></>}
                {answer === "fold" && <><strong>这次太早退出了</strong><p>两个 A 是最强的起手牌。拿到明显的好牌，应该继续，而不是害怕每一次下注。</p></>}
              </div>
            )}
            <div className="graduation">
              <div><b>你已经会最小闭环了</b><span>认牌 → 看公共牌 → 选动作 → 比五张组合</span></div>
              <button className="primary-action" onClick={onStart}>带着中文提示打第一手 →</button>
            </div>
          </div>
        )}

        <div className="lesson-controls">
          <button disabled={step === 0} onClick={() => move(step - 1)}>← 上一关</button>
          {step < beginnerSteps.length - 1
            ? <button className="next-lesson" onClick={() => move(step + 1)}>下一关：{beginnerSteps[step + 1].short} →</button>
            : <button className="next-lesson" onClick={onStart}>进入牌桌 →</button>}
        </div>
      </div>
    </section>
  );
}

function SimulationSetup({
  initial,
  onStart,
}: {
  initial: TableSettings;
  onStart: (settings: TableSettings) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const multiplayer = draft.tableSize === "sixMax";
  const difficultyInfo = {
    guide: { title: "陪练", tag: "第一次上桌", tone: "最容易", points: multiplayer ? ["约 160 次多人胜率模拟", "只安排较清晰的对手行动", "复盘解释更直接", "默认打开教练提示"] : ["约 90 次胜率模拟", "不主动诈唬", "只有很强时才加注", "下注尺度固定、容易看懂"] },
    standard: { title: "标准", tag: "理解基本规则后", tone: "接近普通玩家", points: multiplayer ? ["约 380 次多人胜率模拟", "会出现多人跟注与加注", "加注后部分对手会弃牌", "位置变化更频繁"] : ["约 220 次胜率模拟", "约 8% 随机诈唬", "会根据底池赔率弃牌", "会进行价值下注和加注"] },
    advanced: { title: "进阶", tag: "练习真实博弈", tone: "最难", points: multiplayer ? ["约 760 次多人胜率模拟", "更复杂的多人存活组合", "面对加注的对手更顽强", "默认关闭教练提示"] : ["约 520 次胜率模拟", "下注尺度会混合变化", "记录你的弃牌与加注倾向", "你越常弃牌，它越常诈唬"] },
  };

  function patch(next: Partial<TableSettings>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  return (
    <section className="simulation-setup" id="top">
      <div className="setup-intro">
        <p className="eyebrow">TABLE SIMULATOR / 牌局仿真</p>
        <h1>先定规则，<br /><em>再坐上牌桌。</em></h1>
        <p>这里设置的是实际牌局规则，不只是外观。AI 行为、盲注速度、筹码深度和输光后的处理都会跟着改变。</p>
        <div className="simulation-badge"><span></span><b>{draft.tableSize === "headsUp" ? "单挑仿真" : "六人决策桌"}</b><small>{draft.tableSize === "headsUp" ? "你 vs 1 位 AI" : "你 + 5 位 AI"} · 无真钱</small></div>
      </div>

      <div className="setup-form">
        <section className="setup-section">
          <div className="setup-title"><b>01</b><div><span>这次坐几个人</span><h2>选择牌桌模块</h2></div></div>
          <div className="table-size-grid">
            <button className={draft.tableSize === "headsUp" ? "selected" : ""} onClick={() => patch({ tableSize: "headsUp" })}>
              <div className="seat-dots two"><i></i><i></i></div>
              <span>HEADS-UP</span><strong>单挑完整牌局</strong>
              <p>你对一名 AI，连续保留筹码，适合学习下注流程和长期对抗。</p>
            </button>
            <button className={draft.tableSize === "sixMax" ? "selected" : ""} onClick={() => patch({ tableSize: "sixMax" })}>
              <div className="seat-dots six"><i></i><i></i><i></i><i></i><i></i><i></i></div>
              <span>6-MAX</span><strong>六人桌决策训练</strong>
              <p>五名 AI 同桌，位置与前序行动每题变化，重点练习多人底池判断。</p>
            </button>
          </div>
          {draft.tableSize === "sixMax" && <p className="module-note">六人模块采用“随机决策点 → 你的选择 → 自动跑到摊牌”的训练方式，每题重置有效筹码，暂不模拟多路边池。</p>}
        </section>

        <section className="setup-section">
          <div className="setup-title"><b>02</b><div><span>再选 AI</span><h2>难度档次</h2></div></div>
          <div className="difficulty-grid">
            {(Object.keys(difficultyInfo) as Difficulty[]).map((key) => {
              const info = difficultyInfo[key];
              return (
                <button key={key} className={draft.difficulty === key ? "selected" : ""} onClick={() => patch({ difficulty: key })}>
                  <div><span>{info.tag}</span><strong>{info.title}</strong><em>{info.tone}</em></div>
                  <ul>{info.points.map((point) => <li key={point}>{point}</li>)}</ul>
                  <i>{draft.difficulty === key ? "已选择" : "选择"}</i>
                </button>
              );
            })}
          </div>
        </section>

        {draft.tableSize === "headsUp" && (
        <section className="setup-section">
          <div className="setup-title"><b>03</b><div><span>牌局怎么结束</span><h2>现金桌还是锦标赛</h2></div></div>
          <div className="mode-grid">
            <button className={draft.mode === "cash" ? "selected" : ""} onClick={() => patch({ mode: "cash", rebuy: draft.rebuy === "off" ? "off" : "auto" })}>
              <span>CASH / 普通筹码桌</span><strong>随时打，盲注固定</strong>
              <p>盲注一直是 5/10；每手结束都可以离开。输光后可按设置补充筹码。</p>
            </button>
            <button className={draft.mode === "tournament" ? "selected" : ""} onClick={() => patch({ mode: "tournament", rebuy: draft.rebuy === "auto" ? "manual" : draft.rebuy })}>
              <span>TOURNAMENT / 锦标赛</span><strong>盲注升级，直到一方出局</strong>
              <p>每 5 手盲注翻倍，逼迫牌局向前；输光后按再入规则处理。</p>
            </button>
          </div>
        </section>
        )}

        <section className={`setup-section setup-pair ${draft.tableSize === "sixMax" ? "single" : ""}`}>
          <div>
            <div className="setup-title"><b>04</b><div><span>能承受多少波动</span><h2>起始筹码</h2></div></div>
            <div className="segmented">
              {([50, 100, 200] as const).map((value) => (
                <button key={value} className={draft.stackBB === value ? "selected" : ""} onClick={() => patch({ stackBB: value })}>
                  <strong>{value} BB</strong><span>{value * BB} 筹码</span>
                </button>
              ))}
            </div>
            <p className="setup-help">BB 是“大盲”的缩写。100 BB 表示起始筹码等于 100 个大盲，最适合学习。</p>
          </div>
          {draft.tableSize === "headsUp" && <div>
            <div className="setup-title"><b>05</b><div><span>输光之后怎么办</span><h2>再入规则</h2></div></div>
            <div className="rebuy-options">
              {draft.mode === "cash" && (
                <button className={draft.rebuy === "auto" ? "selected" : ""} onClick={() => patch({ rebuy: "auto" })}>
                  <strong>自动补满</strong><span>输光后自动恢复起始筹码</span>
                </button>
              )}
              <button className={draft.rebuy === "manual" ? "selected" : ""} onClick={() => patch({ rebuy: "manual" })}>
                <strong>手动再入</strong><span>输光后由你决定是否重新加入</span>
              </button>
              <button className={draft.rebuy === "off" ? "selected" : ""} onClick={() => patch({ rebuy: "off" })}>
                <strong>禁止再入</strong><span>输光即结束整场</span>
              </button>
            </div>
          </div>}
        </section>

        <section className="setup-summary">
          <div>
            <span>你的仿真牌局</span>
            <strong>
              {draft.tableSize === "headsUp"
                ? `单挑 · ${difficultyInfo[draft.difficulty].title} AI · ${draft.mode === "cash" ? "普通筹码桌" : "锦标赛"} · ${draft.stackBB} BB`
                : `六人桌 · ${difficultyInfo[draft.difficulty].title} AI · ${draft.stackBB} BB 情景训练`}
            </strong>
            <p>
              {draft.tableSize === "headsUp"
                ? `${draft.mode === "cash" ? "固定盲注 5/10" : "每 5 手盲注升级"} · ${draft.rebuy === "auto" ? "自动补满" : draft.rebuy === "manual" ? "允许手动再入" : "输光结束"}`
                : "随机位置与前序行动 · 每题自动跑到摊牌 · 可完全关闭教练"}
            </p>
          </div>
          <button className="launch-table" onClick={() => onStart(draft)}>开始这场牌局 →</button>
        </section>
      </div>
    </section>
  );
}

function SixMaxTrainer({
  settings,
  coachOpen,
  onCoachOpen,
  onSetup,
}: {
  settings: TableSettings;
  coachOpen: boolean;
  onCoachOpen: (open: boolean) => void;
  onSetup: () => void;
}) {
  const [scenario, setScenario] = useState<SixScenario>(() => createSixScenario(undefined, settings));

  const activeOpponents = scenario?.seats.filter((seat) => seat.active).length ?? 1;
  const samples = settings.difficulty === "guide" ? 160 : settings.difficulty === "standard" ? 380 : 760;
  const equity = useMemo(
    () => scenario ? estimateMultiwayEquity(scenario.hero, scenario.board, activeOpponents, samples) : 0,
    [scenario, activeOpponents, samples],
  );
  const advice = scenario ? sixRecommendation(scenario, equity) : null;
  const potOdds = scenario?.toCall ? scenario.toCall / (scenario.pot + scenario.toCall) : 0;

  if (!scenario) return <main className="loading">正在安排六人座位…</main>;

  function act(action: "fold" | "call" | "check" | "raise") {
    setScenario((current) => current ? resolveSixScenario(current, action, equity, settings.difficulty) : current);
  }

  function nextScenario() {
    setScenario((current) => createSixScenario(current ?? undefined, settings));
  }

  return (
    <>
      <section className="six-hero" id="top">
        <div>
          <p className="eyebrow">6-MAX DECISION LAB / 六人桌</p>
          <h1>先看前面发生了什么，<em>再看自己的牌。</em></h1>
        </div>
        <div className="six-mode-note">
          <span>情景仿真</span>
          <p>每题抽取一个真实六人桌决策点。你选择后，系统自动发完剩余公共牌并摊牌。</p>
          <button onClick={onSetup}>更改桌型或难度</button>
        </div>
      </section>

      <section className={`six-workspace ${coachOpen ? "" : "coach-closed"}`}>
        <div className="six-main">
          <div className="six-meta">
            <span>第 {scenario.handNo} 题</span>
            <strong>{streetName[scenario.street]}</strong>
            <span>你在 {scenario.heroPosition} · {activeOpponents} 名对手仍在牌局</span>
          </div>
          <div className="six-table">
            {scenario.seats.map((seat, index) => (
              <div className={`six-seat six-seat-${index} ${seat.active ? "active" : "folded"}`} key={seat.id}>
                <div className="six-avatar">{seat.name.slice(0, 1)}</div>
                <div><strong>{seat.name}</strong><span>{seat.position} · {seat.stack}</span><em>{seat.action}</em></div>
                <div className="mini-hole">
                  {seat.active ? (
                    <>
                      <CardView card={seat.hole[0]} hidden={!scenario.reveal} small />
                      <CardView card={seat.hole[1]} hidden={!scenario.reveal} small />
                    </>
                  ) : <b>已弃牌</b>}
                </div>
              </div>
            ))}

            <div className="six-pot"><span>底池</span><strong>{scenario.pot}</strong></div>
            <div className="six-board">
              {[0, 1, 2, 3, 4].map((index) => scenario.board[index]
                ? <CardView key={`${scenario.board[index].rank}${scenario.board[index].suit}`} card={scenario.board[index]} />
                : <div className="card-slot" key={index}>{index < 3 ? "F" : index === 3 ? "T" : "R"}</div>)}
            </div>
            <div className="six-hero-seat">
              <div className="hero-position"><b>{scenario.heroPosition}</b><span>你的位置</span></div>
              <div className="six-hero-cards"><CardView card={scenario.hero[0]} /><CardView card={scenario.hero[1]} /></div>
              <div><strong>你</strong><span>{settings.stackBB * BB} 筹码</span></div>
            </div>
          </div>

          <div className="six-action-panel">
            {scenario.resolved ? (
              <div className="six-result">
                <div><span>本题结果</span><strong>{scenario.outcome}</strong></div>
                <button className="primary-action" onClick={nextScenario}>下一道六人题 →</button>
              </div>
            ) : (
              <>
                <div className="turn-prompt">
                  <div><span>轮到你了</span><strong>{scenario.toCall ? `继续需要补 ${scenario.toCall}` : "目前没人要求你补筹码"}</strong></div>
                  <small>先观察每个座位下方的前序行动</small>
                </div>
                <div className="action-buttons six-actions">
                  {scenario.toCall > 0 && <button className="fold" onClick={() => act("fold")}>弃牌</button>}
                  <button onClick={() => act(scenario.toCall ? "call" : "check")}>{scenario.toCall ? `跟注 ${scenario.toCall}` : "过牌"}</button>
                  <button className="raise" onClick={() => act("raise")}>{scenario.toCall ? "加注 2/3 池" : "下注 2/3 池"}</button>
                </div>
              </>
            )}
          </div>
        </div>

        {coachOpen ? (
          <aside className="coach six-coach">
            <div className="coach-head">
              <div><p className="eyebrow">MULTIWAY COACH</p><h2>多人教练</h2></div>
              <button className="coach-close" onClick={() => onCoachOpen(false)} aria-label="关闭教练提示">×</button>
            </div>
            <div className="independent-tip"><b>想独立思考？</b><p>关闭后整个提示栏会消失，不再显示胜率和建议。</p></div>
            <div className="metrics">
              <Metric label="多人估算胜率" value={`${Math.round(equity * 100)}%`} muted={`面对 ${activeOpponents} 人`} />
              <Metric label="继续的门槛" value={scenario.toCall ? `${Math.round(potOdds * 100)}%` : "不用付"} muted="底池赔率" />
              <Metric label="你的位置" value={scenario.heroPosition} muted="六人桌位置" />
            </div>
            <div className="advice">
              <span>当前建议</span>
              <strong>{advice?.label}</strong>
              <p>{advice?.reason}</p>
            </div>
            <div className="coach-note">
              <span>{scenario.resolved ? "行动复盘" : "多人桌提醒"}</span>
              <p>{scenario.resolved ? scenario.feedback : "对手越多，任何一手随机牌击中公共牌的机会越大，所以多人底池通常需要更强的牌才能继续。"}</p>
            </div>
            <details open>
              <summary>位置的简单含义</summary>
              <dl className="position-list">
                <div><dt>UTG / HJ</dt><dd>较早行动，要更谨慎。</dd></div>
                <div><dt>CO / BTN</dt><dd>较晚行动，信息更多。</dd></div>
                <div><dt>SB / BB</dt><dd>已经放入盲注，翻牌后通常先行动。</dd></div>
              </dl>
            </details>
          </aside>
        ) : (
          <button className="coach-reopen" onClick={() => onCoachOpen(true)}><span>?</span>打开教练提示</button>
        )}
      </section>
    </>
  );
}

export default function PokerTrainer() {
  const [game, setGame] = useState<Game>(() => startHand(undefined, defaultSettings));
  const [tab, setTab] = useState<"table" | "six" | "learn" | "setup">("learn");
  const [showHints, setShowHints] = useState(true);
  const [coachOpen, setCoachOpen] = useState(true);
  const [stats, setStats] = useState(initialStats);
  const [settings, setSettings] = useState<TableSettings>(defaultSettings);
  const [tendencies, setTendencies] = useState<Tendencies>({ decisions: 0, folds: 0, calls: 0, raises: 0 });

  useEffect(() => {
    if (!game || game.turn !== "bot" || game.street === "complete") return;
    const thinkTime = game.settings.difficulty === "guide" ? 520 : game.settings.difficulty === "standard" ? 720 : 920;
    const timer = window.setTimeout(() => setGame((current) => current ? botDecision(current, tendencies) : current), thinkTime);
    return () => window.clearTimeout(timer);
  }, [game, tendencies]);

  const equity = useMemo(() => {
    if (!game) return 0.5;
    return estimateEquity(game.hero, game.board, 300);
  }, [game]);

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
      : Math.max(game.bigBlind, Math.round(game.pot * 0.5 / 5) * 5);
    const large = game.currentBet > 0
      ? game.currentBet + Math.max(game.minRaise, Math.round((game.pot + due) * 0.85 / 5) * 5)
      : Math.max(game.bigBlind, Math.round(game.pot * 0.85 / 5) * 5);
    return [
      { label: "1/2 池", value: Math.min(maxTarget, base) },
      { label: "大注", value: Math.min(maxTarget, large) },
      { label: "全下", value: maxTarget },
    ].filter((item, index, arr) => item.value > game.currentBet && arr.findIndex((x) => x.value === item.value) === index);
  }, [game, due]);

  function heroAct(kind: ActionKind, target = 0) {
    if (!game || game.turn !== "hero") return;
    setTendencies((current) => ({
      decisions: current.decisions + 1,
      folds: current.folds + (kind === "fold" ? 1 : 0),
      calls: current.calls + (kind === "call" || kind === "check" ? 1 : 0),
      raises: current.raises + (kind === "raise" ? 1 : 0),
    }));
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
    const heroBusted = game.stacks.hero <= 0;
    const botBusted = game.stacks.bot <= 0;
    if (game.settings.mode === "cash" && (heroBusted || botBusted)) {
      if (heroBusted && game.settings.rebuy !== "auto") {
        setGame({ ...game, matchOver: true, rebuyPending: game.settings.rebuy === "manual" });
        return;
      }
      const replenished: Game = {
        ...game,
        stacks: {
          hero: heroBusted ? game.startingStack : game.stacks.hero,
          bot: botBusted ? game.startingStack : game.stacks.bot,
        },
      };
      setGame(startHand(replenished));
      return;
    }
    if (game.settings.mode === "tournament" && (heroBusted || botBusted)) {
      setGame({
        ...game,
        matchOver: true,
        rebuyPending: heroBusted && game.settings.rebuy === "manual",
        outcome: heroBusted ? "你失去全部有效筹码，本场锦标赛结束" : "AI 失去全部有效筹码，你赢下本场锦标赛",
      });
      return;
    }
    setGame(startHand(game));
  }

  function startSimulation(nextSettings: TableSettings) {
    setSettings(nextSettings);
    setTendencies({ decisions: 0, folds: 0, calls: 0, raises: 0 });
    setGame(startHand(undefined, nextSettings));
    setShowHints(nextSettings.difficulty !== "advanced");
    setCoachOpen(nextSettings.difficulty !== "advanced");
    setTab(nextSettings.tableSize === "sixMax" ? "six" : "table");
  }

  function rebuy() {
    if (!game) return;
    const replenished: Game = {
      ...game,
      stacks: {
        hero: game.stacks.hero <= 0 ? game.startingStack : game.stacks.hero,
        bot: game.stacks.bot <= 0 ? game.startingStack : game.stacks.bot,
      },
      matchOver: false,
      rebuyPending: false,
    };
    setGame(startHand(replenished));
  }

  function restartMatch() {
    setTendencies({ decisions: 0, folds: 0, calls: 0, raises: 0 });
    setGame(startHand(undefined, settings));
  }

  if (!game) return <main className="loading">正在洗牌…</main>;

  const heroHand = game.board.length >= 3 ? evaluate([...game.hero, ...game.board]).name : "起手牌";
  const heroCanAct = game.turn === "hero" && game.street !== "complete";
  const isRedBot = game.bot[0].suit === "♥" || game.bot[0].suit === "♦";
  const difficultyLabel = game.settings.difficulty === "guide" ? "陪练 AI" : game.settings.difficulty === "standard" ? "标准 AI" : "进阶 AI";
  const tournamentLevel = blindsForHand(game.settings, game.handNo).level;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="德州研习室首页">
          <span className="brand-mark">D</span>
          <span>德州研习室<small>Hold&apos;em Dojo</small></span>
        </a>
        <nav aria-label="主导航">
          <button className={tab === "learn" ? "active" : ""} onClick={() => setTab("learn")}>从零开始</button>
          <button className={tab === "setup" ? "active" : ""} onClick={() => setTab("setup")}>仿真设置</button>
          <button className={tab === "table" ? "active" : ""} onClick={() => setTab("table")}>牌桌练习</button>
          <button
            className={tab === "six" ? "active" : ""}
            onClick={() => {
              const next = { ...settings, tableSize: "sixMax" as TableSize };
              setSettings(next);
              setTab("six");
            }}
          >
            六人桌
          </button>
        </nav>
        <div className="header-note"><span></span>纯单机 · 无真钱</div>
      </header>

      {tab === "table" ? (
        <>
          <section className="hero-strip" id="top">
            <div>
              <p className="eyebrow">YOUR FIRST TABLE / 第一张练习桌</p>
              <h1>先看牌，<em>再做选择。</em></h1>
            </div>
            <p>看不懂术语也没关系。轮到你时只看三件事：手里的牌、继续要付多少、教练建议什么。</p>
          </section>

          <section className={`workspace ${coachOpen ? "" : "coach-closed"}`}>
            <div className="table-column">
              <div className="table-meta">
                <span>{game.settings.mode === "cash" ? "普通筹码桌" : `锦标赛 Lv.${tournamentLevel}`} · {difficultyLabel}</span>
                <span className="street-pill">{streetName[game.street]}</span>
                <span>第 {game.handNo} 手 · 盲注 {game.smallBlind}/{game.bigBlind}</span>
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
                  game.matchOver ? (
                    <div className="result-row match-result">
                      <div><span>{game.settings.mode === "tournament" ? "整场结果" : "筹码不足"}</span><strong>{game.outcome}</strong></div>
                      <div className="result-actions">
                        {game.rebuyPending && <button className="primary-action" onClick={rebuy}>再入并补到 {game.startingStack}</button>}
                        <button onClick={restartMatch}>重新开赛</button>
                        <button onClick={() => setTab("setup")}>修改设置</button>
                      </div>
                    </div>
                  ) : (
                    <div className="result-row">
                      <div><span>本手结果</span><strong>{game.outcome}</strong></div>
                      <button className="primary-action" onClick={nextHand}>下一手牌 <kbd>N</kbd></button>
                    </div>
                  )
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

            {coachOpen ? (
            <aside className="coach">
              <div className="coach-head">
                <div><p className="eyebrow">LIVE COACH</p><h2>决策教练</h2></div>
                <div className="coach-controls">
                  <label className="switch"><input type="checkbox" checked={showHints} onChange={(e) => setShowHints(e.target.checked)} /><span></span>提示</label>
                  <button className="coach-close" onClick={() => setCoachOpen(false)} aria-label="关闭教练提示">×</button>
                </div>
              </div>
              <div className={`ai-profile ${game.settings.difficulty}`}>
                <div><span>当前对手</span><strong>{difficultyLabel}</strong></div>
                <button onClick={() => setTab("setup")}>更换难度</button>
                <p>
                  {game.settings.difficulty === "guide" && "不诈唬、强牌才加注，适合边看提示边理解规则。"}
                  {game.settings.difficulty === "standard" && "会计算赔率、偶尔诈唬，并使用不同的价值下注。"}
                  {game.settings.difficulty === "advanced" && `正在观察你：已记录 ${tendencies.decisions} 次决定，弃牌 ${tendencies.decisions ? Math.round(tendencies.folds / tendencies.decisions * 100) : 0}%，加注 ${tendencies.decisions ? Math.round(tendencies.raises / tendencies.decisions * 100) : 0}%。`}
                </p>
              </div>
              {showHints ? (
                <>
                  <div className="metrics">
                    <Metric label="大概能赢几次" value={`${Math.round(equity * 100)}%`} muted="同样场面打 100 次" />
                    <Metric label="继续是否划算" value={due ? `${Math.round(potOdds * 100)}%` : "不用付"} muted={due ? "最低需要的胜率" : "可以免费看牌"} />
                    <Metric label="谁更晚行动" value={game.dealer === "hero" ? "你" : "对手"} muted="晚行动能多看一步" />
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
              <details className="plain-glossary">
                <summary>看不懂词？点开人话词典</summary>
                <dl>
                  <div><dt>底池</dt><dd>桌子中间、这一手要争夺的全部筹码。</dd></div>
                  <div><dt>跟注</dt><dd>补到和对手一样多，继续玩这一手。</dd></div>
                  <div><dt>胜率</dt><dd>相同场面重复很多次，你大概能赢几次。</dd></div>
                  <div><dt>位置</dt><dd>谁先做决定。越晚决定，看到的信息越多。</dd></div>
                </dl>
              </details>
              <div className="progress">
                <div><span>本机练习</span><strong>{stats.hands} 手</strong></div>
                <div className="progress-track"><i style={{ width: `${Math.min(100, stats.hands * 4)}%` }}></i></div>
                <small>记录只保存在这台设备</small>
              </div>
            </aside>
            ) : (
              <button className="coach-reopen" onClick={() => setCoachOpen(true)}><span>?</span>打开教练提示</button>
            )}
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
      ) : tab === "six" ? (
        <SixMaxTrainer
          settings={settings}
          coachOpen={coachOpen}
          onCoachOpen={setCoachOpen}
          onSetup={() => setTab("setup")}
        />
      ) : tab === "setup" ? (
        <SimulationSetup initial={settings} onStart={startSimulation} />
      ) : (
        <BeginnerCourse onStart={() => setTab("setup")} />
      )}

      <footer>
        <div><span className="brand-mark">D</span><strong>德州研习室</strong></div>
        <p>学习概率与策略，不提供充值、匹配、排行榜或真钱玩法。</p>
        <button onClick={() => { setSettings(defaultSettings); setGame(startHand(undefined, defaultSettings)); setTab("learn"); }}>重新从零学习</button>
      </footer>
    </main>
  );
}
