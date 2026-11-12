import { describe, expect, it } from "vitest";
import { formatDurationLabelTR, resolveDurationPreset } from "./config.js";
import {
  assignRoles,
  evaluateWinCondition,
  filterProfanityTR,
  generateRoomCode,
  getTraitorCount,
  normalizeRoomCode,
  resolveFinalDecision,
  resolveNightVictim,
  sanitizeNickname,
  tallyVotes
} from "./rules.js";
import { MEDIEVAL_STATIONS, detectRoomZone, resolveCastleCollision, resolveCastleStep } from "./map.js";

describe("SOFRA Oyun Kuralları ve Fizik Testleri", () => {
  it("SOFRA-XXXX formatında 4 rakamlı oda kodu üretir ve normalize eder", () => {
    expect(generateRoomCode(() => 0.4245)).toMatch(/^SOFRA-\d{4}$/);
    expect(normalizeRoomCode("4821")).toBe("SOFRA-4821");
    expect(normalizeRoomCode("sofra-4821")).toBe("SOFRA-4821");
  });

  it("Türkçe karakterli takma adları (ş ğ ı İ ç ö ü) eksiksiz korur ve küfrü filtreler", () => {
    expect(sanitizeNickname("Çağrı Şahin İğde")).toBe("Çağrı Şahin İğde");
    expect(filterProfanityTR("merhaba amk nasılsın")).toBe("merhaba *** nasılsın");
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

  it("yeni Orta Çağ odalarını (Simya, Cephanelik, Kütüphane, Zindan) ve etkileşim istasyonlarını doğru tanımlar", () => {
    expect(detectRoomZone(-20, 27).id).toBe("simya_odasi");
    expect(detectRoomZone(20, 27).id).toBe("cephanelik");
    expect(detectRoomZone(-20, -28).id).toBe("kutuphane");
    expect(detectRoomZone(20, -28).id).toBe("zindan");
    expect(MEDIEVAL_STATIONS.length).toBeGreaterThanOrEqual(5);

    // Kemerli geçiş noktaları duvarla tıkalı olmamalı
    expect(resolveCastleCollision(-12, 27, {}).hit).toBe(false);
    expect(resolveCastleCollision(12, 27, {}).hit).toBe(false);
    expect(resolveCastleCollision(-19, -24, {}).hit).toBe(false);
    expect(resolveCastleCollision(19, -24, {}).hit).toBe(false);
  });

  it("10m / 20m / 35m / 60m süre modlarını, istasyon kotalarını, ödül çarpanlarını ve Türkçe süre etiketlerini doğrular", () => {
    const p10 = resolveDurationPreset("10m");
    const p20 = resolveDurationPreset("20m");
    const p35 = resolveDurationPreset("35m");
    const p60 = resolveDurationPreset("60m");

    expect(p10.defaultPlayers).toBe(8);
    expect(p10.stationUsesPerDay).toBe(2);
    expect(p10.rewardMultiplier).toBe(1.0);
    expect(p10.durations.VOTE).toBe(65);
    expect(resolveDurationPreset("fast").id).toBe("10m");
    expect(resolveDurationPreset(undefined, true).id).toBe("10m");

    expect(p20.defaultPlayers).toBe(10);
    expect(p20.stationUsesPerDay).toBe(2);
    expect(p20.rewardMultiplier).toBe(1.2);
    expect(p20.durations.VOTE).toBe(100);
    expect(resolveDurationPreset("normal").id).toBe("20m");
    expect(resolveDurationPreset(undefined, false).id).toBe("20m");

    expect(p35.defaultPlayers).toBe(10);
    expect(p35.stationUsesPerDay).toBe(3);
    expect(p35.rewardMultiplier).toBe(1.5);
    expect(p35.durations.VOTE).toBe(135);
    expect(resolveDurationPreset("long").id).toBe("35m");

    expect(p60.defaultPlayers).toBe(12);
    expect(p60.stationUsesPerDay).toBe(4);
    expect(p60.rewardMultiplier).toBe(2.0);
    expect(p60.durations.VOTE).toBe(170);

    expect(formatDurationLabelTR(40)).toBe("40 sn");
    expect(formatDurationLabelTR(95)).toBe("1 Dk 35 sn");
    expect(formatDurationLabelTR(180)).toBe("3 Dk");
    expect(formatDurationLabelTR(210)).toBe("3 Dk 30 sn");
  });

  it("0 oy / çekimser oylama ve Final Sofrası DOUBT / MISAFIR_WINS dallarını doğru çözümler", () => {
    const emptyVote = tallyVotes({ p1: null, p2: undefined }, ["p1", "p2", "p3"]);
    expect(emptyVote.burnedTargetId).toBeNull();
    expect(emptyVote.isTie).toBe(false);
    expect(emptyVote.topTargets).toEqual([]);

    const rolesWithTraitor = { p1: "HAIN" as const, p2: "MISAFIR" as const, p3: "MISAFIR" as const, p4: "MISAFIR" as const };
    expect(
      resolveFinalDecision(
        { p1: "TRUST", p2: "DOUBT", p3: "TRUST", p4: "TRUST" },
        ["p1", "p2", "p3", "p4"],
        rolesWithTraitor
      )
    ).toBe("VOTE_AGAIN");

    const allGuests = { p2: "MISAFIR" as const, p3: "MISAFIR" as const, p4: "MISAFIR" as const };
    expect(
      resolveFinalDecision(
        { p2: "TRUST", p3: "TRUST", p4: "TRUST" },
        ["p2", "p3", "p4"],
        allGuests
      )
    ).toBe("MISAFIR_WINS");
  });

  it("Oda #11 Kâhya mührü, içeriden çıkış (anti-hapis), dış sur sınırı ve alt-adım kapı tünelleme korumasını doğrular", () => {
    // Oda #11 (x=16.5, z=12.5) Kâhya anahtarı olmadan geçilemez
    const kahyaBlocked = resolveCastleCollision(
      16.5,
      12.5,
      { door_yatak_11: false },
      0.42,
      { seat: 11, lockedDoors: { door_yatak_11: true }, hasKahyaKey: false }
    );
    expect(kahyaBlocked.hit).toBe(true);

    // Paslı Kâhya Anahtarı olan davetli Oda #11 kapısından geçebilir
    const kahyaUnlocked = resolveCastleCollision(
      16.5,
      12.5,
      { door_yatak_11: false },
      0.42,
      { seat: 2, lockedDoors: { door_yatak_11: true }, hasKahyaKey: true }
    );
    expect(kahyaUnlocked.hit).toBe(false);

    // Kilitli bir yatak odasının içindeki yabancı davetli dışarı çıkabilir (anti-hapis)
    const exitFromInside = resolveCastleCollision(
      -16.5,
      -7.5,
      { door_yatak_1: false },
      0.42,
      { seat: 2, currentRoomId: "yatak_1", lockedDoors: { door_yatak_1: true } }
    );
    expect(exitFromInside.hit).toBe(false);

    // Koşu adımıyla (1.5m) yabancı kilitli kapıdan içeri tünelleme engellenmeli!
    const tunnelAttempt = resolveCastleStep(
      -15.6,
      -7.5,
      -17.6,
      -7.5,
      { door_yatak_1: false },
      0.42,
      { seat: 2, currentRoomId: "bati_koridor", lockedDoors: { door_yatak_1: true } }
    );
    expect(tunnelAttempt.hit).toBe(true);
    expect(tunnelAttempt.x).toBeGreaterThan(-16.5);
    expect(detectRoomZone(tunnelAttempt.x, tunnelAttempt.z).id).toBe("bati_koridor");

    // Yatay bölme duvarı AABB içine düşen nokta koridora fırlatılmadan Z ekseninde itilmeli
    const horizWall = resolveCastleCollision(-21.0, -5.0, {}, 0.42, { seat: 1, currentRoomId: "yatak_1" });
    expect(horizWall.hit).toBe(true);
    expect(Math.abs(horizWall.x - -21.0)).toBeLessThan(0.1);

    // Dış sur sınırlarının ötesine çıkış engellenmeli
    const outerClamp = resolveCastleCollision(40, -50, {});
    expect(outerClamp.hit).toBe(true);
    expect(outerClamp.x).toBeLessThanOrEqual(25.2);
    expect(outerClamp.z).toBeGreaterThanOrEqual(-31.0);
  });
});
