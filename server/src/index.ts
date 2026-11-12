import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { SOFRA_CONFIG, normalizeRoomCode } from "@sofra/shared";
import { SofraRoom, activeRoomsByCode } from "./rooms/SofraRoom.js";

const port = Number(process.env.PORT || SOFRA_CONFIG.SERVER_PORT);
const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", rooms: activeRoomsByCode.size });
});

app.get("/find-room", (req, res) => {
  const rawCode = String(req.query.code || "");
  const code = normalizeRoomCode(rawCode);
  const roomId = activeRoomsByCode.get(code);
  if (!roomId) {
    res.status(404).json({ error: `Oda bulunamadı: ${code}` });
    return;
  }
  res.json({ code, roomId });
});

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

gameServer.define(SOFRA_CONFIG.ROOM_NAME, SofraRoom);

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`[SOFRA Sunucu] ws://0.0.0.0:${port} üzerinde çalışıyor.`);
});
