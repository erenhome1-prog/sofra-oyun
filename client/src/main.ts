import * as THREE from "three";
import { Client, Room } from "colyseus.js";
import { SOFRA_CONFIG, normalizeRoomCode, sanitizeNickname } from "@sofra/shared";

// ============================================================================
// 1. THREE.JS SAHNESİ: Siyah Sahne + Ortada Dönen SOFRA Mühür Küpü
// ============================================================================
const canvas = document.getElementById("scene-canvas") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070608);
scene.fog = new THREE.FogExp2(0x070608, 0.08);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.3, 4.5);
camera.lookAt(0, 0, 0);

const ambientLight = new THREE.AmbientLight(0xffdcb8, 0.55);
scene.add(ambientLight);

const candleLight = new THREE.PointLight(0xff7b29, 4.5, 16);
candleLight.position.set(2.2, 2.6, 2.5);
scene.add(candleLight);

const rimLight = new THREE.PointLight(0xb2161e, 3.0, 14);
rimLight.position.set(-2.5, -1.5, 2.0);
scene.add(rimLight);

// Ortada dönen gotik SOFRA küpü + altın tel kafes
const cubeGroup = new THREE.Group();
const geometry = new THREE.BoxGeometry(1.45, 1.45, 1.45);
const material = new THREE.MeshStandardMaterial({
  color: 0xb2161e,
  roughness: 0.35,
  metalness: 0.45
});
const cube = new THREE.Mesh(geometry, material);
cubeGroup.add(cube);

const edgesGeo = new THREE.EdgesGeometry(geometry);
const edgesMat = new THREE.LineBasicMaterial({ color: 0xc9a24e });
const wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
wireframe.scale.setScalar(1.015);
cubeGroup.add(wireframe);

scene.add(cubeGroup);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  cubeGroup.rotation.x = t * 0.45;
  cubeGroup.rotation.y = t * 0.75;
  candleLight.intensity = 4.2 + Math.sin(t * 7.0) * 0.35;
  renderer.render(scene, camera);
}
animate();

// ============================================================================
// 2. COLYSEUS BAĞLANTISI VE LOBİ ARAYÜZÜ
// ============================================================================
const entryView = document.getElementById("entry-view") as HTMLDivElement;
const lobbyView = document.getElementById("lobby-view") as HTMLDivElement;
const nickInput = document.getElementById("nick-input") as HTMLInputElement;
const codeInput = document.getElementById("code-input") as HTMLInputElement;
const createBtn = document.getElementById("create-btn") as HTMLButtonElement;
const joinBtn = document.getElementById("join-btn") as HTMLButtonElement;
const leaveBtn = document.getElementById("leave-btn") as HTMLButtonElement;
const errorBox = document.getElementById("error-box") as HTMLDivElement;
const roomCodeDisplay = document.getElementById("room-code-display") as HTMLDivElement;
const playerListEl = document.getElementById("player-list") as HTMLUListElement;
const playerCountEl = document.getElementById("player-count") as HTMLSpanElement;

const host = window.location.hostname || "localhost";
const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
const httpProtocol = window.location.protocol === "https:" ? "https" : "http";
const serverWsUrl = `${wsProtocol}://${host}:${SOFRA_CONFIG.SERVER_PORT}`;
const serverHttpUrl = `${httpProtocol}://${host}:${SOFRA_CONFIG.SERVER_PORT}`;

const colyseusClient = new Client(serverWsUrl);
let activeRoom: Room | null = null;

// URL'de ?oda=SOFRA-XXXX varsa kutuya otomatik doldur
const urlParams = new URLSearchParams(window.location.search);
const initialOda = urlParams.get("oda");
if (initialOda) {
  codeInput.value = normalizeRoomCode(initialOda);
}

function showError(msg: string) {
  errorBox.textContent = msg;
}

function renderLobbyState(state: any, mySessionId: string) {
  roomCodeDisplay.textContent = state.code || "SOFRA-....";
  playerListEl.innerHTML = "";

  const entries: Array<{ id: string; nick: string; seat: number }> = [];
  if (state.players && typeof state.players.forEach === "function") {
    state.players.forEach((p: any, key: string) => {
      entries.push({
        id: p.id || key,
        nick: p.nick || "Misafir",
        seat: p.seat || 1
      });
    });
  }

  entries.sort((a, b) => a.seat - b.seat);
  playerCountEl.textContent = String(entries.length);

  for (const item of entries) {
    const li = document.createElement("li");
    li.className = "player-item";

    const nameSpan = document.createElement("span");
    const isHost = state.hostId === item.id;
    const isMe = mySessionId === item.id;
    nameSpan.textContent = `${item.nick}${isMe ? " (Sen)" : ""}${isHost ? " ◆ Kurucu" : ""}`;

    const seatSpan = document.createElement("span");
    seatSpan.className = "seat-badge";
    seatSpan.textContent = `Koltuk #${item.seat}`;

    li.appendChild(nameSpan);
    li.appendChild(seatSpan);
    playerListEl.appendChild(li);
  }
}

function bindRoomEvents(room: Room) {
  activeRoom = room;
  entryView.classList.add("hidden");
  lobbyView.classList.remove("hidden");
  showError("");

  room.onStateChange((state) => {
    renderLobbyState(state, room.sessionId);
  });

  room.onLeave(() => {
    activeRoom = null;
    lobbyView.classList.add("hidden");
    entryView.classList.remove("hidden");
  });
}

createBtn.addEventListener("click", async () => {
  try {
    showError("");
    const nick = sanitizeNickname(nickInput.value);
    nickInput.value = nick;
    const room = await colyseusClient.create(SOFRA_CONFIG.ROOM_NAME, { nick });
    bindRoomEvents(room);
  } catch (err: any) {
    showError(`Oda kurulamadı: ${err?.message || err}`);
  }
});

joinBtn.addEventListener("click", async () => {
  try {
    showError("");
    const nick = sanitizeNickname(nickInput.value);
    nickInput.value = nick;
    const code = normalizeRoomCode(codeInput.value);
    if (!code) {
      showError("Lütfen geçerli bir oda kodu girin (ör. SOFRA-4821).");
      return;
    }
    codeInput.value = code;

    const findRes = await fetch(`${serverHttpUrl}/find-room?code=${encodeURIComponent(code)}`);
    if (!findRes.ok) {
      showError(`"${code}" kodlu aktif bir oda bulunamadı.`);
      return;
    }
    const { roomId } = await findRes.json();
    const room = await colyseusClient.joinById(roomId, { nick, code });
    bindRoomEvents(room);
  } catch (err: any) {
    showError(`Odaya katılınamadı: ${err?.message || err}`);
  }
});

leaveBtn.addEventListener("click", async () => {
  if (activeRoom) {
    await activeRoom.leave();
  }
});

roomCodeDisplay.addEventListener("click", async () => {
  const code = roomCodeDisplay.textContent || "";
  if (code && navigator.clipboard) {
    await navigator.clipboard.writeText(code);
    const prev = roomCodeDisplay.textContent;
    roomCodeDisplay.textContent = `${code} (KOPYALANDI)`;
    setTimeout(() => {
      roomCodeDisplay.textContent = prev;
    }, 1200);
  }
});
