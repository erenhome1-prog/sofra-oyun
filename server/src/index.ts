import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import cors from "cors";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { SOFRA_CONFIG, normalizeRoomCode } from "@sofra/shared";
import {
  SofraRoom,
  activeRoomsByCode,
  breatheIdlePersistentRooms,
  findActiveSessionForToken,
  findBestMatchmakingRoom,
  getMissingPersistentSlots,
  listPublicRooms,
  liveRooms,
  registerPersistentRoomSpawner
} from "./rooms/SofraRoom.js";
import { accountStore } from "./accounts.js";

// İsteğe bağlı ücretsiz LLM anahtarlarını (.env) ek paket gerektirmeden yükle
function loadOptionalEnvFile() {
  const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "server", ".env")];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    try {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed
          .slice(eqIdx + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // .env okunamazsa sessizce Beyin-2 yerel motorla devam et
    }
  }
}
loadOptionalEnvFile();

let ensuringPersistentRooms = false;
async function ensurePersistentLobbyRooms(): Promise<void> {
  if (ensuringPersistentRooms) return;
  const missing = getMissingPersistentSlots();
  if (missing.length === 0) return;
  ensuringPersistentRooms = true;
  try {
    for (const slot of missing) {
      await matchMaker.createRoom(SOFRA_CONFIG.ROOM_NAME, {
        roomTitle: slot.roomTitle,
        paceMode: slot.paceMode,
        targetPlayerCount: slot.targetPlayerCount,
        atmosphereTheme: slot.atmosphereTheme,
        persistentSlot: slot.slotId,
        seedBotCount: slot.seedBotCount
      });
    }
  } catch (err) {
    console.warn("[SOFRA] Kalıcı bekleme odası oluşturulurken uyarı:", err);
  } finally {
    ensuringPersistentRooms = false;
  }
}

registerPersistentRoomSpawner(() => {
  void ensurePersistentLobbyRooms();
});

const port = Number(process.env.PORT || SOFRA_CONFIG.SERVER_PORT);
const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", rooms: activeRoomsByCode.size });
});

app.get("/rooms", async (_req, res) => {
  await ensurePersistentLobbyRooms();
  res.json({ rooms: listPublicRooms() });
});

app.get("/quick-match", async (_req, res) => {
  await ensurePersistentLobbyRooms();
  const best = findBestMatchmakingRoom();
  if (!best) {
    res.status(404).json({ error: "Uygun açık oda bulunamadı." });
    return;
  }
  res.json({ room: best });
});

app.get("/find-room", (req, res) => {
  const rawCode = String(req.query.code || "");
  const code = normalizeRoomCode(rawCode);
  const roomId = activeRoomsByCode.get(code);
  const room = roomId ? liveRooms.get(roomId) : undefined;
  if (!roomId || !room) {
    res.status(404).json({ error: `Oda bulunamadı: ${code}` });
    return;
  }
  const summary = room.getSummary();
  res.json(summary);
});

app.get("/active-session", (req, res) => {
  const token = String(req.query.token || "");
  const session = findActiveSessionForToken(token);
  res.json({ session });
});

// ============================================================================
// ŞATO PASAPORTU (KAYIT OL / GİRİŞ YAP / KASA EŞİTLEME)
// ============================================================================
app.post("/auth/register", (req, res) => {
  const { username, pin, displayName } = req.body || {};
  const result = accountStore.register(username, pin, displayName);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ profile: result.profile });
});

app.post("/auth/login", (req, res) => {
  const { username, pin } = req.body || {};
  const result = accountStore.login(username, pin);
  if (!result.ok) {
    res.status(401).json({ error: result.error });
    return;
  }
  res.json({ profile: result.profile });
});

app.get("/auth/me", (req, res) => {
  const token = String(req.query.token || "");
  const profile = accountStore.getByToken(token);
  if (!profile) {
    res.status(404).json({ error: "Oturum bulunamadı." });
    return;
  }
  res.json({ profile });
});

app.post("/auth/sync-vault", (req, res) => {
  const { playerToken, ...patch } = req.body || {};
  const profile = accountStore.syncVault(String(playerToken || ""), patch);
  if (!profile) {
    res.status(404).json({ error: "Hesap bulunamadı." });
    return;
  }
  res.json({ profile });
});

// Bulut kurulumlarında (Render / VPS) derlenmiş 3B istemciyi de aynı sunucudan doğrudan sunabilsin
const clientDistCandidates = [
  path.resolve(process.cwd(), "client", "dist"),
  path.resolve(process.cwd(), "..", "client", "dist")
];
const activeClientDist = clientDistCandidates.find((dir) =>
  fs.existsSync(path.join(dir, "index.html"))
);
if (activeClientDist) {
  app.use(express.static(activeClientDist));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(activeClientDist, "index.html"));
  });
}

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

gameServer.define(SOFRA_CONFIG.ROOM_NAME, SofraRoom);

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`[SOFRA Sunucu] ws://0.0.0.0:${port} üzerinde çalışıyor.`);
  setTimeout(() => {
    void ensurePersistentLobbyRooms();
  }, 350);
  setInterval(() => {
    void ensurePersistentLobbyRooms();
    breatheIdlePersistentRooms();
  }, 25000);
});
