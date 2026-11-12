import { describe, expect, it } from "vitest";
import { generateRoomCode, normalizeRoomCode, sanitizeNickname } from "./rules.js";

describe("SOFRA Aşama 0 Kuralları", () => {
  it("SOFRA-XXXX formatında 4 rakamlı oda kodu üretir", () => {
    const code = generateRoomCode(() => 0.4245);
    expect(code).toMatch(/^SOFRA-\d{4}$/);
  });

  it("oda kodunu normalize eder (4821 -> SOFRA-4821)", () => {
    expect(normalizeRoomCode("4821")).toBe("SOFRA-4821");
    expect(normalizeRoomCode("sofra-4821")).toBe("SOFRA-4821");
    expect(normalizeRoomCode("sofra4821")).toBe("SOFRA-4821");
  });

  it("Türkçe karakterli takma adları (ş ğ ı İ ç ö ü) eksiksiz korur", () => {
    expect(sanitizeNickname("Çağrı Şahin İğde")).toBe("Çağrı Şahin İğde");
    expect(sanitizeNickname("Özgür_Ümit")).toBe("Özgür_Ümit");
    expect(sanitizeNickname("   ")).toBe("Misafir");
  });
});
