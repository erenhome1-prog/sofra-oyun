import { describe, expect, it } from "vitest";
import {
  assignRoles,
  evaluateWinCondition,
  generateRoomCode,
  getTraitorCount,
  normalizeRoomCode,
  resolveFinalDecision,
  resolveNightVictim,
  sanitizeNickname,
  tallyVotes
} from "./rules.js";
import { resolveCastleCollision } from "./map.js";

describe("SOFRA Oyun Kuralları ve Fizik Testleri", () => {
  it("SOFRA-XXXX formatında 4 rakamlı oda kodu üretir ve normalize eder", () => {
    expect(generateRoomCode(() => 0.4245)).toMatch(/^SOFRA-\d{4}$/);
    expect(normalizeRoomCode("4821")).toBe("SOFRA-4821");
    expect(normalizeRoomCode("sofra-4821")).toBe("SOFRA-4821");
  });

  it("Türkçe karakterli takma adları (ş ğ ı İ ç ö ü) eksiksiz korur", () => {
    expect(sanitizeNickname("Çağrı Şahin İğde")).toBe("Çağrı Şahin İğde");
  });

  it("6-8 oyuncuda 1 hain, 9-12 oyuncuda 2 hain dağıtır", () => {
    expect(getTraitorCount(6)).toBe(1);
    expect(getTraitorCount(8)).toBe(1);
    expect(getTraitorCount(9)).toBe(2);
    expect(getTraitorCount(12)).toBe(2);

    const ids10 = Array.from({ length: 10 }, (_, i) => `p${i + 1}`);
    const roles = assignRoles(ids10, () => 0.3);
    const traitors = Object.values(roles).filter((r) => r === "HAIN");
    expect(traitors.length).toBe(2);
  });

  it("oylama sayımında kendine oy vermeyi reddeder ve eşitliği tespit eder", () => {
    const alive = ["p1", "p2", "p3", "p4"];
    // p1 kendine oy vermeye çalışıyor -> sayılmamalı
    const res1 = tallyVotes({ p1: "p1", p2: "p3", p3: "p2" }, alive);
    expect(res1.countsByTarget["p1"]).toBeUndefined();
    expect(res1.isTie).toBe(true);
    expect(res1.burnedTargetId).toBeNull();

    const res2 = tallyVotes({ p1: "p3", p2: "p3", p3: "p2" }, alive);
    expect(res2.isTie).toBe(false);
    expect(res2.burnedTargetId).toBe("p3");
  });

  it("gece seçiminde Altın Kolye takan oyuncuyu korur", () => {
    const nightProtected = resolveNightVictim(["p2"], ["p2", "p3"], "p2");
    expect(nightProtected.victimId).toBeNull();
    expect(nightProtected.protectedByNecklace).toBe(true);

    const nightKilled = resolveNightVictim(["p3"], ["p2", "p3"], "p2");
    expect(nightKilled.victimId).toBe("p3");
    expect(nightKilled.protectedByNecklace).toBe(false);
  });

  it("iki kazanma koşulunu ve 4 kişilik final kararını doğru hesaplar", () => {
    const roles = { p1: "HAIN" as const, p2: "MISAFIR" as const, p3: "MISAFIR" as const };
    expect(evaluateWinCondition(["p1", "p2", "p3"], roles)).toBe("CONTINUE");
    expect(evaluateWinCondition(["p2", "p3"], roles)).toBe("MISAFIR_WINS");
    expect(evaluateWinCondition(["p1", "p2"], roles)).toBe("HAIN_WINS");

    expect(
      resolveFinalDecision(
        { p1: "TRUST", p2: "TRUST", p3: "TRUST" },
        ["p1", "p2", "p3"],
        roles
      )
    ).toBe("HAIN_WINS");
  });

  it("kapalı kapıdan ve yuvarlak masadan geçmeyi engeller; oda sahibine kendi özel odasını açar", () => {
    // Masa merkezine (0,0) girmeye çalışan oyuncuyu masa dışına iter
    const tableHit = resolveCastleCollision(0.5, 0.5, {});
    expect(tableHit.hit).toBe(true);
    expect(Math.hypot(tableHit.x, tableHit.z)).toBeGreaterThan(3.5);

    // Oda #1 kapısı (-16.5, -7.5) kapalıyken başkasının (Koltuk #2) geçişini engeller
    const strangerBlocked = resolveCastleCollision(
      -16.5,
      -7.5,
      { door_yatak_1: false },
      0.42,
      { seat: 2, lockedDoors: { door_yatak_1: true } }
    );
    expect(strangerBlocked.hit).toBe(true);

    // Oda #1 sahibi (Koltuk #1) kendi cebindeki anahtarla kilitli kapısından doğrudan geçebilir
    const ownerAllowed = resolveCastleCollision(
      -16.5,
      -7.5,
      { door_yatak_1: false },
      0.42,
      { seat: 1, lockedDoors: { door_yatak_1: true } }
    );
    expect(ownerAllowed.hit).toBe(false);
  });
});
