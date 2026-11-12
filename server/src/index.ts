import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { SOFRA_CONFIG, normalizeRoomCode } from "@sofra/shared";
import {
  SofraRoom,
  activeRoomsByCode,
  findActiveSessionForToken,
  listPublicRooms,
  liveRooms
} from "./rooms/SofraRoom.js";
import { accountStore } from "./accounts.js";

const port = Number(process.env.PORT || SOFRA_CONFIG.SERVER_PORT);
const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", rooms: activeRoomsByCode.size });
});

app.get("/rooms", (_req, res) => {
  res.json({ rooms: listPublicRooms() });
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

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

gameServer.define(SOFRA_CONFIG.ROOM_NAME, SofraRoom);

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`[SOFRA Sunucu] ws://0.0.0.0:${port} üzerinde çalışıyor.`);
});
