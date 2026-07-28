# Hold'em Dojo

An approachable, browser-based Texas Hold'em learning tool for complete beginners. Start by learning the cards, then understand blinds, calling, checking, folding, and showdown through playable practice tables.

**Live site:** [holdem-dojo-cn.taitingding.chatgpt.site](https://holdem-dojo-cn.taitingding.chatgpt.site)

Hold'em Dojo has no deposits, matchmaking, leaderboard, or real-money play. It is a learning and practice product, not a gambling product.

## Included

- A zero-to-first-hand course covering cards, winning, streets, actions, and hand rankings.
- Heads-up practice with cash games, tournaments, rebuys, and three strategy-AI difficulty levels.
- Six-max decision training with changing positions, prior actions, and multiway decisions.
- A closable coach panel for equity, pot-odds, and hand reviews after you decide.

> Six-max is decision training, not a continuous full-ring cash-game simulator. It does not yet model side pots or every multiway rule.

## Run locally

Requires Node.js 22.13 or later.

```bash
npm install
npm run dev
```

## Verify and publish

```bash
npm run lint
npm test
npm run build
```

## Product boundaries

- The AI is a practice-oriented strategy opponent, not a GTO solver or professional human-level bot.
- Practice statistics remain only in the current browser's local storage.
