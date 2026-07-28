import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Hold'em Dojo document shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>德州研习室｜从零开始学德州扑克<\/title>/);
  assert.match(html, /不涉及真钱/);
  assert.match(html, /og\.png/);
  assert.match(html, /从第一张牌/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/i);
});

test("keeps the public release focused on the learning product", async () => {
  const [trainer, page, layout, packageJson, readme] = await Promise.all([
    readFile(new URL("../app/poker-trainer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(trainer, /function BeginnerCourse/);
  assert.match(trainer, /function SixMaxTrainer/);
  assert.match(trainer, /不提供充值、匹配、排行榜或真钱玩法/);
  assert.match(page, /<PokerTrainer \/>/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(packageJson, /"test": "npm run build && node --test tests\/rendered-html\.test\.mjs"/);
  assert.match(readme, /no deposits, matchmaking, leaderboard, or real-money play/i);
  await access(new URL("public/og.png", templateRoot));
});
