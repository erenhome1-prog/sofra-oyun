import { describe, expect, it } from "vitest";
import { MASTER_RIDDLE_BANK } from "./riddleBank.js";
import { createPuzzleChallenge, getRiddleBankSize } from "./botAI.js";

describe("225+ Türkçe Bilmece & Şifre Havuzu (Anti-Repeat + Şık Karıştırma)", () => {
  it("en az 200 özgün ve tekrarsız Türkçe bilmece/bulmaca içerir", () => {
    expect(getRiddleBankSize()).toBeGreaterThanOrEqual(200);
    const seenPrompts = new Set<string>();
    for (const item of MASTER_RIDDLE_BANK) {
      expect(item.q.trim().length).toBeGreaterThan(10);
      expect(seenPrompts.has(item.q)).toBe(false);
      seenPrompts.add(item.q);

      expect(item.opts.length).toBeGreaterThanOrEqual(3);
      expect(new Set(item.opts).size).toBe(item.opts.length);
      expect(item.ans).toBeGreaterThanOrEqual(0);
      expect(item.ans).toBeLessThan(item.opts.length);
    }
  });

  it("aynı oyuncuya art arda 150 çekilişte hiçbir bilmeceyi tekrar etmez ve doğru şıkkı korur", () => {
    const promptToAnswer = new Map(
      MASTER_RIDDLE_BANK.map((r) => [r.q, r.opts[r.ans]])
    );
    const seen = new Set<string>();
    const correctPositions = new Set<number>();

    for (let i = 0; i < 150; i++) {
      const ch = createPuzzleChallenge("ANY", "unit_test_player_token");
      expect(seen.has(ch.prompt)).toBe(false);
      seen.add(ch.prompt);

      const expectedAnswer = promptToAnswer.get(ch.prompt);
      expect(ch.options[ch.correctIndex]).toBe(expectedAnswer);
      correctPositions.add(ch.correctIndex);
    }

    // Şıklar her seferinde karıştığı için doğru cevap hep 0. indexte kalmaz
    expect(correctPositions.size).toBeGreaterThan(1);
  });
});
