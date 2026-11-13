import * as THREE from "three";
import {
  CASTLE_WALLS,
  CHARACTERS,
  COUNCIL_BOARD_POS,
  DOORS,
  MEDIEVAL_STATIONS,
  PUZZLE_ALTARS,
  ROOM_ZONES,
  getSeatTransform
} from "@sofra/shared";

export interface CharacterVisualState {
  sessionId: string;
  name: string;
  seat: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
  alive: boolean;
  isGhost: boolean;
  hasGoldNecklace: boolean;
  coatColor: string;
  accentColor: string;
  hat: string;
  mask: string;
  isLocal: boolean;
}

export interface PickedCharacterInfo {
  sessionId: string;
  seat: number;
  name: string;
  isLocal: boolean;
  screenX: number;
  screenY: number;
}

export interface PickedWorldInteractable {
  kind: "door" | "altar" | "station" | "board";
  id: string;
  label: string;
  x: number;
  z: number;
}

interface CharacterRig {
  sessionId: string;
  group: THREE.Group;
  hitCylinder: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  accentMat: THREE.MeshStandardMaterial;
  headMesh: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  hatGroup: THREE.Group;
  maskGroup: THREE.Group;
  necklaceMesh: THREE.Mesh;
  labelCanvas: HTMLCanvasElement;
  labelCtx: CanvasRenderingContext2D;
  labelTexture: THREE.CanvasTexture;
  labelSprite: THREE.Sprite;
  lastCoat: string;
  lastAccent: string;
  lastHat: string;
  lastMask: string;
  lastName: string;
  lastSeat: number;
  lastChat: string;
  chatExpiresAt: number;
  isLocal: boolean;
  targetPos: THREE.Vector3;
  targetRotY: number;
  walkCycle: number;
}

interface OccludableWall {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  mats: THREE.Material[];
  alpha: number;
  doorId?: string;
}

function scaleBoxGeometryUVs(geo: THREE.BoxGeometry, repeatX: number, repeatY: number): THREE.BoxGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (uv) {
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * repeatX, uv.getY(i) * repeatY);
    }
    uv.needsUpdate = true;
  }
  return geo;
}

function disposeObjectSubtree(root: THREE.Object3D, keepMaterials?: Set<THREE.Material>): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (!keepMaterials?.has(m)) m.dispose();
      }
    } else if (mat && !keepMaterials?.has(mat)) {
      mat.dispose();
    }
  });
}

interface WorldFloatingSprite {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  x: number;
  z: number;
  maxDist: number;
  dayOnly: boolean;
}

const CAMERA_MIN_DIST = 1.9;
const CAMERA_MAX_DIST = 8.4;
const INSPECT_MIN_DIST = 1.25;
const INSPECT_MAX_DIST = 4.8;

const CAMERA_ZOOM_PRESETS: ReadonlyArray<{ dist: number; pitch: number; label: string }> = [
  { dist: 5.8, pitch: 0.38, label: "🔭 Standart" },
  { dist: 7.4, pitch: 0.44, label: "🔭 Geniş" },
  { dist: 2.8, pitch: 0.24, label: "🔭 Yakın" },
  { dist: 4.3, pitch: 0.32, label: "🔭 Orta" }
];

function segmentIntersectsExpandedAABB(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  pad: number
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0.025;
  let t1 = 0.975;

  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-6) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  return (
    clip(-dx, ax - (minX - pad)) &&
    clip(dx, maxX + pad - ax) &&
    clip(-dz, az - (minZ - pad)) &&
    clip(dz, maxZ + pad - az) &&
    t0 <= t1
  );
}

function raycastSegmentAABBEntry(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  pad: number
): number {
  const bMinX = minX - pad;
  const bMaxX = maxX + pad;
  const bMinZ = minZ - pad;
  const bMaxZ = maxZ + pad;

  // Başlangıç noktası genişletilmiş kutunun içindeyse (ör. kendi kapı eşiğinden geçerken), çekirdek kutuyu test et
  if (ax > bMinX && ax < bMaxX && az > bMinZ && az < bMaxZ) {
    if (pad > 0.05) {
      return raycastSegmentAABBEntry(ax, az, bx, bz, minX, maxX, minZ, maxZ, 0.04);
    }
    return 1.0;
  }

  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0.0;
  let t1 = 1.0;

  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-7) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    clip(-dx, ax - bMinX) &&
    clip(dx, bMaxX - ax) &&
    clip(-dz, az - bMinZ) &&
    clip(dz, bMaxZ - az) &&
    t0 <= t1
  ) {
    return Math.max(0.0, Math.min(1.0, t0));
  }
  return 1.0;
}

export class CastleScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;

  private candleLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[] = [];
  private torchFlames: { mesh: THREE.Mesh; baseY: number; phase: number }[] = [];
  private floatingRelics: { mesh: THREE.Object3D; baseY: number; phase: number }[] = [];
  private clockGears: { mesh: THREE.Object3D; speed: number }[] = [];
  private occludableWalls: OccludableWall[] = [];
  private worldSprites: WorldFloatingSprite[] = [];
  private activePhase = "LOBBY";

  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  private moonLight!: THREE.DirectionalLight;
  private playerLanternLight!: THREE.PointLight;
  private brightnessMode = 1; // 0: Loş Orta Çağ, 1: Meşale Aydınlığı (Varsayılan), 2: Ekstra Parlak
  private atmosphereTheme: "torch" | "crimson" | "mist" = "torch";

  private fireplaceLight!: THREE.PointLight;
  private fireplaceCoreMesh!: THREE.Mesh;
  private emberPoints!: THREE.Points;
  private emberVelocities: number[] = [];
  private fireMode: "normal" | "red" | "white" = "normal";
  private fireModeTimer = 0;
  private blackoutTimer = 0;
  private ghostFlickerTimer = 0;

  private dustPoints!: THREE.Points;
  private doorPivots = new Map<string, { pivot: THREE.Group; targetAngle: number; closedAngle: number; isOpen?: boolean }>();
  private plateMeshes = new Map<number, THREE.Mesh>();
  private characterRigs = new Map<string, CharacterRig>();
  private pickRaycaster = new THREE.Raycaster();
  private pickNdc = new THREE.Vector2();
  private sharedHitGeo = new THREE.CylinderGeometry(0.55, 0.55, 2.1, 10);
  private sharedHitMat = new THREE.MeshBasicMaterial({ visible: false });
  private worldInteractableMeshes: THREE.Object3D[] = [];

  // Procedural Medieval Textures
  private stoneWallTex!: THREE.CanvasTexture;
  private flagstoneTex!: THREE.CanvasTexture;
  private oakWoodTex!: THREE.CanvasTexture;
  private crimsonCarpetTex!: THREE.CanvasTexture;
  private stainedGlassTex!: THREE.CanvasTexture;
  private crowBannerTex!: THREE.CanvasTexture;

  // Camera & 360° Character Inspect state
  public cameraYaw = 0;
  public cameraPitch = 0.36;
  public cameraDistance = 7.4;
  public targetCameraDistance = 7.4;
  private springArmFactor = 1.0;
  private isSprinting = false;
  private currentFovBoost = 0;
  private localPlayerX = 0;
  private localPlayerZ = 16;
  public localPlayerIsGhost = false;
  private zoomPresetIndex = 0;
  private cameraFocusMode: "PLAYER" | "TABLE" | "FIRE" = "TABLE";
  public inspectTargetId: string | null = null;
  public inspectOrbitYaw = 0;
  public inspectPitch = 0.16;
  public inspectDistance = 2.45;
  public targetInspectDistance = 2.45;
  private cameraTarget = new THREE.Vector3(0, 1.25, -1.35);

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x16121b);
    this.scene.fog = new THREE.FogExp2(0x16121b, 0.0068);

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      150
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 2,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.65;

    container.innerHTML = "";
    container.appendChild(this.renderer.domElement);

    this.initProceduralMedievalTextures();
    this.buildLighting();
    this.buildCastleArchitecture();
    this.buildMedievalPropsAndRooms();
    this.buildWorldInteractableTargets();
    this.buildRoundTableAndChairs();
    this.buildFireplaceAndEmbers();
    this.buildAtmosphereDust();
    this.onResize();

    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("orientationchange", () => this.forceResize());
    screen.orientation?.addEventListener?.("change", () => this.forceResize());
    window.visualViewport?.addEventListener?.("resize", () => {
      if (document.body.classList.contains("keyboard-open")) return;
      this.onResize();
    });
  }

  public forceResize(): void {
    this.onResize();
    for (const delay of [80, 200, 420, 700]) {
      window.setTimeout(() => this.onResize(), delay);
    }
  }

  private onResize(): void {
    if (document.body.classList.contains("keyboard-open")) return;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const baseFov = aspect < 1 ? 76 : 62;
    this.camera.fov = baseFov + this.currentFovBoost;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  public setSprintVisual(active: boolean): void {
    this.isSprinting = active;
  }

  public computeCameraWallClamp(
    originX: number,
    originZ: number,
    desiredX: number,
    desiredZ: number
  ): number {
    let minT = 1.0;
    for (const w of CASTLE_WALLS) {
      const t = raycastSegmentAABBEntry(
        originX,
        originZ,
        desiredX,
        desiredZ,
        w.minX,
        w.maxX,
        w.minZ,
        w.maxZ,
        0.28
      );
      if (t < minT) minT = t;
    }
    for (const d of DOORS) {
      if (this.doorPivots.get(d.id)?.isOpen) continue;
      const halfW = d.width * 0.5;
      const halfD = d.depth * 0.5;
      const t = raycastSegmentAABBEntry(
        originX,
        originZ,
        desiredX,
        desiredZ,
        d.x - halfW,
        d.x + halfW,
        d.z - halfD,
        d.z + halfD,
        0.24
      );
      if (t < minT) minT = t;
    }
    return minT;
  }

  public hasLineOfSight2D(ax: number, az: number, bx: number, bz: number): boolean {
    if (Math.hypot(bx - ax, bz - az) < 0.75) return true;
    for (const w of CASTLE_WALLS) {
      if (
        segmentIntersectsExpandedAABB(ax, az, bx, bz, w.minX, w.maxX, w.minZ, w.maxZ, 0.03)
      ) {
        return false;
      }
    }
    for (const d of DOORS) {
      if (this.doorPivots.get(d.id)?.isOpen) continue;
      const halfW = d.width * 0.5;
      const halfD = d.depth * 0.5;
      if (
        segmentIntersectsExpandedAABB(
          ax,
          az,
          bx,
          bz,
          d.x - halfW,
          d.x + halfW,
          d.z - halfD,
          d.z + halfD,
          0.02
        )
      ) {
        return false;
      }
    }
    return true;
  }

  public hasNearbyHiddenPresence(playerX: number, playerZ: number, maxRadius = 4.6): boolean {
    if (this.activePhase !== "DAY" || this.localPlayerIsGhost) return false;
    for (const [, rig] of this.characterRigs.entries()) {
      if (rig.isLocal || rig.sessionId === "__preview_self__") continue;
      if (rig.bodyMat.opacity < 0.8) continue; // Hayaletleri sayma
      const d = Math.hypot(rig.group.position.x - playerX, rig.group.position.z - playerZ);
      if (d <= maxRadius && !rig.group.visible) {
        return true;
      }
    }
    return false;
  }

  public setActivePhase(phase: string): void {
    const nextPhase = phase || "LOBBY";
    const changed = nextPhase !== this.activePhase;
    const prevPhase = this.activePhase;
    this.activePhase = nextPhase;

    if (!changed) return;
    this.isSprinting = false;

    if (prevPhase === "FIRE" && nextPhase !== "FIRE") {
      this.fireMode = "normal";
      this.fireModeTimer = 0;
    }

    if (nextPhase === "FIRE") {
      this.cameraFocusMode = "FIRE";
      this.cameraYaw = 0;
      this.cameraPitch = 0.14;
      this.cameraDistance = 5.4;
      this.targetCameraDistance = 3.9;
    } else if (
      nextPhase === "TABLE" ||
      nextPhase === "VOTE" ||
      nextPhase === "NIGHT" ||
      nextPhase === "MORNING" ||
      nextPhase === "FINAL" ||
      nextPhase === "LOBBY" ||
      nextPhase === "ARRIVAL" ||
      nextPhase === "TRIAL" ||
      nextPhase === "RESULT"
    ) {
      const wasTableView =
        this.cameraFocusMode === "TABLE" &&
        (prevPhase === "TABLE" || prevPhase === "VOTE" || prevPhase === "FINAL");
      this.cameraFocusMode = "TABLE";
      if (!wasTableView) {
        // Sinematik kamera süzülüşü: Avize hizasından Yuvarlak Sofraya yumuşak iniş
        this.cameraYaw = nextPhase === "VOTE" || nextPhase === "TABLE" ? 0.34 : 0;
        this.cameraPitch = nextPhase === "VOTE" || nextPhase === "TABLE" ? 0.46 : 0.36;
        this.cameraDistance = 10.2;
        this.targetCameraDistance = 8.1;
      }
    } else {
      // DAY: Oyuncuyu takip eden, duvar arkası görmeyen yaylı üçüncü şahıs kamera
      this.cameraFocusMode = "PLAYER";
      this.springArmFactor = 1.0;
      if (prevPhase === "FIRE" || prevPhase === "ARRIVAL" || prevPhase === "MORNING" || prevPhase === "NIGHT") {
        this.cameraYaw = 0;
        this.cameraPitch = 0.38;
        this.targetCameraDistance = 5.8;
      }
    }
  }

  public resetInspectCamera(): void {
    this.inspectOrbitYaw = 0;
    this.inspectPitch = 0.16;
    const defDist = window.innerWidth < window.innerHeight ? 2.85 : 2.45;
    this.targetInspectDistance = defDist;
    this.inspectDistance = defDist;
  }

  public getCameraZoomLabel(): string {
    if (this.inspectTargetId) {
      if (this.targetInspectDistance <= 1.85) return "🔍 Yakın";
      if (this.targetInspectDistance >= 3.35) return "🔍 Uzak";
      return "🔍 Orta";
    }
    if (this.targetCameraDistance >= 6.8) return "🔭 Geniş";
    if (this.targetCameraDistance >= 5.1) return "🔭 Standart";
    if (this.targetCameraDistance >= 3.6) return "🔭 Orta";
    return "🔭 Yakın";
  }

  public getCameraZoomProgress(): number {
    if (this.inspectTargetId) {
      const ratio =
        (INSPECT_MAX_DIST - this.targetInspectDistance) / (INSPECT_MAX_DIST - INSPECT_MIN_DIST);
      return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    }
    const ratio =
      (CAMERA_MAX_DIST - this.targetCameraDistance) / (CAMERA_MAX_DIST - CAMERA_MIN_DIST);
    return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  }

  public setCameraZoomProgress(progress01: number): string {
    const clamped = Math.max(0, Math.min(1, progress01));
    if (this.inspectTargetId) {
      this.targetInspectDistance =
        INSPECT_MAX_DIST - clamped * (INSPECT_MAX_DIST - INSPECT_MIN_DIST);
      return this.getCameraZoomLabel();
    }
    this.targetCameraDistance =
      CAMERA_MAX_DIST - clamped * (CAMERA_MAX_DIST - CAMERA_MIN_DIST);
    const nextT =
      (this.targetCameraDistance - CAMERA_MIN_DIST) / (CAMERA_MAX_DIST - CAMERA_MIN_DIST);
    if (this.cameraFocusMode !== "FIRE") {
      this.cameraPitch = 0.22 + nextT * 0.24;
    }
    return this.getCameraZoomLabel();
  }

  public cycleCameraZoom(): string {
    if (this.inspectTargetId) {
      if (this.targetInspectDistance > 3.1) {
        this.targetInspectDistance = 1.55;
      } else if (this.targetInspectDistance < 2.0) {
        this.targetInspectDistance = 2.45;
      } else {
        this.targetInspectDistance = 3.95;
      }
      return this.getCameraZoomLabel();
    }
    this.zoomPresetIndex = (this.zoomPresetIndex + 1) % CAMERA_ZOOM_PRESETS.length;
    const preset = CAMERA_ZOOM_PRESETS[this.zoomPresetIndex];
    this.targetCameraDistance = preset.dist;
    this.cameraPitch = preset.pitch;
    return preset.label;
  }

  public adjustCameraZoom(deltaDist: number): string {
    if (this.inspectTargetId) {
      this.targetInspectDistance = Math.max(
        INSPECT_MIN_DIST,
        Math.min(INSPECT_MAX_DIST, this.targetInspectDistance + deltaDist * 0.55)
      );
      return this.getCameraZoomLabel();
    }
    const prevDist = this.targetCameraDistance;
    this.targetCameraDistance = Math.max(
      CAMERA_MIN_DIST,
      Math.min(CAMERA_MAX_DIST, this.targetCameraDistance + deltaDist)
    );
    const actualDelta = this.targetCameraDistance - prevDist;
    if (Math.abs(actualDelta) > 1e-4 && this.cameraFocusMode !== "FIRE") {
      const deltaT = actualDelta / (CAMERA_MAX_DIST - CAMERA_MIN_DIST);
      this.cameraPitch = Math.max(0.16, Math.min(0.47, this.cameraPitch + deltaT * 0.26));
    }
    return this.getCameraZoomLabel();
  }

  // ==========================================================================
  // PROSEDÜREL ORTA ÇAĞ DOKU ÜRETİCİSİ (KESME TAŞ, ARNAVUT KALDIRIMI, MEŞE, SANCAK, VİTRAY)
  // ==========================================================================
  private initProceduralMedievalTextures(): void {
    // 1. Kesme Şato Taşı Duvar Dokusu (Ashlar Stone Masonry)
    const wallCv = document.createElement("canvas");
    wallCv.width = 512;
    wallCv.height = 512;
    const wctx = wallCv.getContext("2d")!;
    wctx.fillStyle = "#2b2621";
    wctx.fillRect(0, 0, 512, 512);

    const rows = 8;
    const rowH = 512 / rows;
    const stoneShades = ["#6d6356", "#5f564a", "#776c5e", "#554c42", "#665c4f"];
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const cols = 4;
      const colW = 512 / cols;
      const offset = (r % 2) * (colW / 2);
      for (let c = -1; c <= cols; c++) {
        const x = c * colW + offset;
        const shade = stoneShades[(r * 7 + c * 3 + 10) % stoneShades.length];
        wctx.fillStyle = shade;
        wctx.fillRect(x + 3, y + 3, colW - 6, rowH - 6);

        // Üst ışık pahı & alt gölge
        wctx.fillStyle = "rgba(255, 238, 205, 0.12)";
        wctx.fillRect(x + 4, y + 4, colW - 8, 5);
        wctx.fillStyle = "rgba(15, 12, 10, 0.28)";
        wctx.fillRect(x + 4, y + rowH - 9, colW - 8, 5);

        // Taş gözenekleri
        for (let s = 0; s < 14; s++) {
          const sx = x + 8 + ((r * 37 + c * 53 + s * 29) % Math.max(12, colW - 16));
          const sy = y + 8 + ((r * 19 + c * 41 + s * 17) % Math.max(12, rowH - 16));
          wctx.fillStyle = s % 2 === 0 ? "rgba(0,0,0,0.16)" : "rgba(255,245,220,0.09)";
          wctx.fillRect(sx, sy, 4, 3);
        }
      }
    }
    this.stoneWallTex = new THREE.CanvasTexture(wallCv);
    this.stoneWallTex.wrapS = THREE.RepeatWrapping;
    this.stoneWallTex.wrapT = THREE.RepeatWrapping;
    this.stoneWallTex.repeat.set(3, 2);

    // 2. Orta Çağ Kayrak / Arnavut Taş Zemin Dokusu (Flagstone Floor)
    const flCv = document.createElement("canvas");
    flCv.width = 512;
    flCv.height = 512;
    const fctx = flCv.getContext("2d")!;
    fctx.fillStyle = "#1f1c19";
    fctx.fillRect(0, 0, 512, 512);
    const tileShades = ["#4b453e", "#413c36", "#534c44", "#3b3631", "#48423b"];
    const grid = 6;
    const step = 512 / grid;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const jx = ((gx * 23 + gy * 13) % 9) - 4;
        fctx.fillStyle = tileShades[(gx * 5 + gy * 3) % tileShades.length];
        fctx.fillRect(gx * step + 3 + jx * 0.4, gy * step + 3, step - 6, step - 6);
        fctx.strokeStyle = "rgba(255, 226, 175, 0.08)";
        fctx.lineWidth = 2;
        fctx.strokeRect(gx * step + 5, gy * step + 5, step - 10, step - 10);
      }
    }
    this.flagstoneTex = new THREE.CanvasTexture(flCv);
    this.flagstoneTex.wrapS = THREE.RepeatWrapping;
    this.flagstoneTex.wrapT = THREE.RepeatWrapping;
    this.flagstoneTex.repeat.set(16, 19);

    // 3. Yaşlandırılmış Koyu Meşe Tahta & Demir Perçin Dokusu
    const wdCv = document.createElement("canvas");
    wdCv.width = 256;
    wdCv.height = 256;
    const dctx = wdCv.getContext("2d")!;
    const planks = 4;
    const pw = 256 / planks;
    const woodShades = ["#59351c", "#4d2d17", "#633b20", "#462814"];
    for (let p = 0; p < planks; p++) {
      dctx.fillStyle = woodShades[p % woodShades.length];
      dctx.fillRect(p * pw, 0, pw - 2, 256);
      dctx.fillStyle = "#211208";
      dctx.fillRect((p + 1) * pw - 2, 0, 2, 256);
      // Damar çizgileri
      dctx.strokeStyle = "rgba(28, 14, 6, 0.35)";
      dctx.lineWidth = 1.5;
      for (let g = 0; g < 6; g++) {
        dctx.beginPath();
        dctx.moveTo(p * pw + 6 + g * 9, 0);
        dctx.bezierCurveTo(p * pw + 2 + g * 9, 90, p * pw + 12 + g * 9, 170, p * pw + 5 + g * 9, 256);
        dctx.stroke();
      }
      // Demir çiviler
      dctx.fillStyle = "#1a1715";
      dctx.beginPath();
      dctx.arc(p * pw + pw / 2, 26, 4, 0, Math.PI * 2);
      dctx.arc(p * pw + pw / 2, 230, 4, 0, Math.PI * 2);
      dctx.fill();
    }
    this.oakWoodTex = new THREE.CanvasTexture(wdCv);
    this.oakWoodTex.wrapS = THREE.RepeatWrapping;
    this.oakWoodTex.wrapT = THREE.RepeatWrapping;

    // 4. Kraliyet Bordo & Altın İşlemeli Orta Çağ Halısı Dokusu
    const cpCv = document.createElement("canvas");
    cpCv.width = 512;
    cpCv.height = 512;
    const cctx = cpCv.getContext("2d")!;
    cctx.fillStyle = "#68131d";
    cctx.fillRect(0, 0, 512, 512);
    cctx.strokeStyle = "#d4ac54";
    cctx.lineWidth = 14;
    cctx.strokeRect(18, 18, 476, 476);
    cctx.lineWidth = 4;
    cctx.strokeRect(36, 36, 440, 440);
    // Elmas hanedan motifleri
    cctx.strokeStyle = "rgba(212, 172, 84, 0.36)";
    cctx.lineWidth = 2.5;
    for (let y = 80; y <= 432; y += 64) {
      for (let x = 80; x <= 432; x += 64) {
        cctx.beginPath();
        cctx.moveTo(x, y - 22);
        cctx.lineTo(x + 22, y);
        cctx.lineTo(x, y + 22);
        cctx.lineTo(x - 22, y);
        cctx.closePath();
        cctx.stroke();
      }
    }
    this.crimsonCarpetTex = new THREE.CanvasTexture(cpCv);

    // 5. Gotik Katedral Vitray Pencere Dokusu
    const sgCv = document.createElement("canvas");
    sgCv.width = 256;
    sgCv.height = 512;
    const gctx = sgCv.getContext("2d")!;
    const grad = gctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#1c3b75");
    grad.addColorStop(0.45, "#7d192b");
    grad.addColorStop(1, "#2a1f4d");
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 256, 512);
    const vitrayColors = ["#e0314b", "#2d6cdf", "#f4b942", "#2ca58d", "#9d4edd"];
    for (let y = 24; y < 490; y += 44) {
      for (let x = 20; x < 236; x += 44) {
        gctx.fillStyle = vitrayColors[(x + y) % vitrayColors.length];
        gctx.globalAlpha = 0.72;
        gctx.fillRect(x + 3, y + 3, 38, 38);
      }
    }
    gctx.globalAlpha = 1.0;
    // Kurşun vitray çerçevesi + gül pencere
    gctx.strokeStyle = "#18141c";
    gctx.lineWidth = 8;
    gctx.strokeRect(8, 8, 240, 496);
    gctx.beginPath();
    gctx.arc(128, 120, 68, 0, Math.PI * 2);
    gctx.fillStyle = "#ffd166";
    gctx.fill();
    gctx.stroke();
    gctx.beginPath();
    gctx.arc(128, 120, 34, 0, Math.PI * 2);
    gctx.fillStyle = "#b5172c";
    gctx.fill();
    gctx.stroke();
    this.stainedGlassTex = new THREE.CanvasTexture(sgCv);

    // 6. Kargalı Şato Hanedan Sancağı Dokusu (Altın Taçlı Kuzgun Arması)
    const bnCv = document.createElement("canvas");
    bnCv.width = 256;
    bnCv.height = 512;
    const bctx = bnCv.getContext("2d")!;
    bctx.fillStyle = "#5c0f19";
    bctx.fillRect(0, 0, 256, 512);
    bctx.strokeStyle = "#e0b858";
    bctx.lineWidth = 12;
    bctx.strokeRect(14, 14, 228, 484);
    // Ortada altın kalkan ve siyah kuzgun silüeti
    bctx.fillStyle = "#d4ac54";
    bctx.beginPath();
    bctx.moveTo(64, 130);
    bctx.lineTo(192, 130);
    bctx.lineTo(192, 260);
    bctx.lineTo(128, 340);
    bctx.lineTo(64, 260);
    bctx.closePath();
    bctx.fill();
    bctx.fillStyle = "#131016";
    bctx.font = "bold 92px Georgia, serif";
    bctx.textAlign = "center";
    bctx.fillText("🦅", 128, 256);
    bctx.fillStyle = "#ffe69c";
    bctx.font = "bold 24px Georgia, serif";
    bctx.fillText("KARGALI ŞATO", 128, 410);
    this.crowBannerTex = new THREE.CanvasTexture(bnCv);
  }

  private attachMaterialsToNearestWall(
    x: number,
    z: number,
    mats: THREE.Material[],
    fallbackHalf = 0.75
  ): void {
    for (const wall of this.occludableWalls) {
      if (
        !wall.doorId &&
        x >= wall.minX - 0.95 &&
        x <= wall.maxX + 0.95 &&
        z >= wall.minZ - 0.95 &&
        z <= wall.maxZ + 0.95
      ) {
        for (const m of mats) {
          if (!wall.mats.includes(m)) wall.mats.push(m);
        }
        return;
      }
    }
    this.occludableWalls.push({
      minX: x - fallbackHalf,
      maxX: x + fallbackHalf,
      minZ: z - fallbackHalf,
      maxZ: z + fallbackHalf,
      mats,
      alpha: 1.0
    });
  }

  private buildLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0xf3dfc1, 1.52);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x9fb6e8, 0x6e4c32, 1.62);
    this.scene.add(this.hemiLight);

    this.moonLight = new THREE.DirectionalLight(0xffe9c4, 1.55);
    this.moonLight.position.set(16, 30, -18);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(1024, 1024);
    this.moonLight.shadow.camera.near = 2;
    this.moonLight.shadow.camera.far = 85;
    const d = 30;
    this.moonLight.shadow.camera.left = -d;
    this.moonLight.shadow.camera.right = d;
    this.moonLight.shadow.camera.top = d;
    this.moonLight.shadow.camera.bottom = -d;
    this.scene.add(this.moonLight);

    // Oyuncuyu/kamerayı takip eden sıcak Orta Çağ Meşale Feneri (60 FPS için gereksiz 13 statik PointLight kaldırıldı)
    this.playerLanternLight = new THREE.PointLight(0xffcb78, 3.25, 28, 1.02);
    this.playerLanternLight.position.set(0, 2.7, 15);
    this.scene.add(this.playerLanternLight);

    // Büyük Şölen Salonu Ana Demir Avize Işığı (6-pass cubemap gölge kapalı -> ~4x FPS artışı)
    const tableLight = new THREE.PointLight(0xffb354, 4.15, 32, 1.12);
    tableLight.position.set(0, 5.0, 0);
    tableLight.castShadow = false;
    this.scene.add(tableLight);
    this.candleLights.push({ light: tableLight, baseIntensity: 4.15, phase: 0.2 });
  }

  public setAtmosphereTheme(theme: string): void {
    const valid = theme === "crimson" || theme === "mist" ? theme : "torch";
    if (valid === this.atmosphereTheme) return;
    this.atmosphereTheme = valid;

    if (valid === "crimson") {
      this.scene.background = new THREE.Color(0x220d14);
      this.scene.fog = new THREE.FogExp2(0x220d14, 0.0082);
      this.moonLight.color.setHex(0xff99a8);
      this.hemiLight.color.setHex(0xd96b7e);
    } else if (valid === "mist") {
      this.scene.background = new THREE.Color(0x141d29);
      this.scene.fog = new THREE.FogExp2(0x182330, 0.0105);
      this.moonLight.color.setHex(0xc4e0ff);
      this.hemiLight.color.setHex(0x8ecae6);
    } else {
      this.scene.background = new THREE.Color(0x16121b);
      this.scene.fog = new THREE.FogExp2(0x16121b, 0.0078);
      this.moonLight.color.setHex(0xffe9c4);
      this.hemiLight.color.setHex(0x9fb6e8);
    }
  }

  public cycleBrightnessBoost(): string {
    this.brightnessMode = (this.brightnessMode + 1) % 3;
    return this.applyBrightnessPreset();
  }

  private applyBrightnessPreset(): string {
    if (this.brightnessMode === 2) {
      this.renderer.toneMappingExposure = 2.3;
      this.ambientLight.intensity = 2.18;
      this.hemiLight.intensity = 2.08;
      this.playerLanternLight.intensity = 4.05;
      return "☀️ Ekstra Parlak";
    } else if (this.brightnessMode === 1) {
      this.renderer.toneMappingExposure = 1.65;
      this.ambientLight.intensity = 1.52;
      this.hemiLight.intensity = 1.62;
      this.playerLanternLight.intensity = 3.25;
      return "💡 Meşale Aydınlığı";
    } else {
      this.renderer.toneMappingExposure = 1.2;
      this.ambientLight.intensity = 0.98;
      this.hemiLight.intensity = 1.08;
      this.playerLanternLight.intensity = 2.25;
      return "🕯️ Loş Orta Çağ";
    }
  }

  public triggerBlackout(durationSec: number): void {
    this.blackoutTimer = Math.max(this.blackoutTimer, durationSec);
  }

  public triggerGhostFlicker(): void {
    this.ghostFlickerTimer = 2.6;
  }

  // ==========================================================================
  // ORTA ÇAĞ KESME TAŞ MİMARİSİ, SURLAR, BURÇLAR, KEMERLER, AVİZELER VE MEŞALELER
  // ==========================================================================
  private buildCastleArchitecture(): void {
    // 1. Ana Orta Çağ Kayrak Taşı Zemin
    const floorGeo = new THREE.PlaneGeometry(66, 78);
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.flagstoneTex,
      color: 0x9c9286,
      roughness: 0.84,
      metalness: 0.08
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 2. Oda Halıları ve Orta Çağ Ahşap/Pirinç Oda Tabelaları
    const zoneFloorColors: Record<string, number> = {
      simya_odasi: 0x1b3b2b,
      cephanelik: 0x3d231c,
      kutuphane: 0x3b243d,
      zindan: 0x222026,
      avlu: 0x2d3328,
      saat_kulesi: 0x382b1e
    };

    for (const zone of ROOM_ZONES) {
      const w = (zone.maxX - zone.minX) * 0.86;
      const d = (zone.maxZ - zone.minZ) * 0.86;
      const cx = (zone.minX + zone.maxX) / 2;
      const cz = (zone.minZ + zone.maxZ) / 2;

      const isMain = zone.id === "yemek_salonu" || zone.id === "antre";
      const isBed = Boolean(zone.isPrivateBedroom);
      const rugMat = isMain
        ? new THREE.MeshStandardMaterial({
            map: this.crimsonCarpetTex,
            roughness: 0.82
          })
        : new THREE.MeshStandardMaterial({
            color: zoneFloorColors[zone.id] ?? (isBed ? 0x45222c : 0x362b26),
            roughness: 0.88
          });

      const rug = new THREE.Mesh(new THREE.PlaneGeometry(w, d), rugMat);
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(cx, 0.016, cz);
      rug.receiveShadow = true;
      this.scene.add(rug);

      // Orta Çağ Parşömen/Demir Oda Tabelası
      const signCanvas = document.createElement("canvas");
      signCanvas.width = 512;
      signCanvas.height = 96;
      const sctx = signCanvas.getContext("2d")!;
      sctx.fillStyle = "rgba(26, 17, 12, 0.88)";
      sctx.strokeStyle = "#d4ac54";
      sctx.lineWidth = 4;
      sctx.beginPath();
      sctx.roundRect(14, 12, 484, 72, 12);
      sctx.fill();
      sctx.stroke();
      sctx.fillStyle = "#ffe59e";
      sctx.font = "bold 25px Georgia, serif";
      sctx.textAlign = "center";
      sctx.fillText(zone.name.toUpperCase(), 256, 57);
      const signMat = new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(signCanvas),
        transparent: true,
        depthTest: true
      });
      const signSprite = new THREE.Sprite(signMat);
      signSprite.position.set(cx, isBed ? 3.45 : 3.85, cz);
      signSprite.scale.set(isBed ? 2.25 : 2.85, 0.48, 1);
      this.scene.add(signSprite);
      this.worldSprites.push({
        sprite: signSprite,
        mat: signMat,
        x: cx,
        z: cz,
        maxDist: 14.0,
        dayOnly: true
      });
    }

    // 3. Kesme Taş Duvarlar + Alt/Üst Taş Silmeler + Mazgallı Surlar (Kamera Engeli Yarı-Saydam Geçişli)
    const stonePlinthMat = new THREE.MeshStandardMaterial({
      color: 0x3b352f,
      roughness: 0.85,
      metalness: 0.12
    });
    const timberBeamMat = new THREE.MeshStandardMaterial({
      map: this.oakWoodTex,
      color: 0x6e472b,
      roughness: 0.75
    });

    for (const w of CASTLE_WALLS) {
      const sx = w.maxX - w.minX;
      const sz = w.maxZ - w.minZ;
      const cx = (w.minX + w.maxX) / 2;
      const cz = (w.minZ + w.maxZ) / 2;
      const isOuter = w.id.startsWith("outer_");
      const wallHeight = isOuter ? 7.2 : 6.4;

      const len = Math.max(sx, sz);
      const wallMat = new THREE.MeshStandardMaterial({
        map: this.stoneWallTex,
        roughness: 0.86,
        metalness: 0.08
      });
      const wallCorniceMat = new THREE.MeshStandardMaterial({
        color: 0x3b352f,
        roughness: 0.85,
        metalness: 0.12
      });

      const wallGeo = scaleBoxGeometryUVs(
        new THREE.BoxGeometry(sx, wallHeight, sz),
        Math.max(1, len / 3.8),
        wallHeight / 2.7
      );
      const wallMesh = new THREE.Mesh(wallGeo, wallMat);
      wallMesh.position.set(cx, wallHeight / 2, cz);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      this.scene.add(wallMesh);

      // Taş Kaide (Plinth — zeminde hep katı kalarak kapı/duvar sınırını net gösterir) & Üst Taş Korniş
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.1, 0.34, sz + 0.1), stonePlinthMat);
      plinth.position.set(cx, 0.17, cz);
      this.scene.add(plinth);

      const cornice = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.12, 0.24, sz + 0.12), wallCorniceMat);
      cornice.position.set(cx, wallHeight - 0.1, cz);
      this.scene.add(cornice);

      this.occludableWalls.push({
        minX: w.minX,
        maxX: w.maxX,
        minZ: w.minZ,
        maxZ: w.maxZ,
        mats: [wallMat, wallCorniceMat],
        alpha: 1.0
      });

      // Dış surların üstüne Orta Çağ Mazgalları (Battlement Merlons)
      if (isOuter) {
        const alongX = sx > sz;
        const span = alongX ? sx : sz;
        const count = Math.floor(span / 2.4);
        const merlonGeo = new THREE.BoxGeometry(
          alongX ? 1.25 : sx + 0.16,
          0.85,
          alongX ? sz + 0.16 : 1.25
        );
        for (let m = 0; m < count; m++) {
          const offset = -span / 2 + 1.2 + m * 2.4;
          const merlon = new THREE.Mesh(merlonGeo, wallCorniceMat);
          merlon.position.set(alongX ? cx + offset : cx, wallHeight + 0.42, alongX ? cz : cz + offset);
          this.scene.add(merlon);
        }
      }
    }

    // 4. 4 Köşe Orta Çağ Gözetleme Burcu (Watchtowers) & Güney Kale Kapısı (Portcullis)
    const towerGeo = new THREE.CylinderGeometry(2.3, 2.6, 9.2, 16);
    const roofGeo = new THREE.ConeGeometry(2.9, 3.6, 16);
    const corners: [number, number][] = [
      [-26, -32],
      [26, -32],
      [-26, 34],
      [26, 34]
    ];
    for (const [tx, tz] of corners) {
      const tMat = new THREE.MeshStandardMaterial({
        map: this.stoneWallTex,
        color: 0x7c7265,
        roughness: 0.85
      });
      const rMat = new THREE.MeshStandardMaterial({
        color: 0x222633,
        roughness: 0.65,
        metalness: 0.25
      });
      const tower = new THREE.Mesh(towerGeo, tMat);
      tower.position.set(tx, 4.6, tz);
      this.scene.add(tower);
      const roof = new THREE.Mesh(roofGeo, rMat);
      roof.position.set(tx, 10.9, tz);
      this.scene.add(roof);
      this.occludableWalls.push({
        minX: tx - 2.6,
        maxX: tx + 2.6,
        minZ: tz - 2.6,
        maxZ: tz + 2.6,
        mats: [tMat, rMat],
        alpha: 1.0
      });
    }

    // Güney Kargalı Avlu Demir Parmaklıklı Kale Kapısı (Portcullis Gatehouse)
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1e1d22, roughness: 0.42, metalness: 0.82 });
    const gateStoneMat = stonePlinthMat.clone();
    const gateGroup = new THREE.Group();
    gateGroup.position.set(0, 0, 33.4);
    const gateArchL = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.75, 5.8, 12), gateStoneMat);
    gateArchL.position.set(-3.2, 2.9, 0);
    const gateArchR = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.75, 5.8, 12), gateStoneMat);
    gateArchR.position.set(3.2, 2.9, 0);
    const gateLintel = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.1, 1.2), gateStoneMat);
    gateLintel.position.set(0, 5.5, 0);
    gateGroup.add(gateArchL, gateArchR, gateLintel);
    const gateBarGeo = new THREE.CylinderGeometry(0.05, 0.05, 5.0, 8);
    for (let gx = -2.4; gx <= 2.4; gx += 0.6) {
      const bar = new THREE.Mesh(gateBarGeo, ironMat);
      bar.position.set(gx, 2.5, 0);
      gateGroup.add(bar);
    }
    this.scene.add(gateGroup);
    this.occludableWalls.push({
      minX: -3.9,
      maxX: 3.9,
      minZ: 32.7,
      maxZ: 34.1,
      mats: [gateStoneMat, ironMat],
      alpha: 1.0
    });

    // 5. Kemerli Taş Sütunlar ve Tavan Meşe Kirişleri (Gothic Archways & Timber Beams)
    const archPassages: Array<{ x: number; z: number; span: number; alongZ?: boolean }> = [
      { x: 0, z: 10, span: 7.2 },
      { x: 0, z: -10, span: 6.8 },
      { x: -12, z: -4.65, span: 3.7, alongZ: true },
      { x: -12, z: 4.65, span: 3.7, alongZ: true },
      { x: 12, z: -4.65, span: 3.7, alongZ: true },
      { x: 12, z: 4.65, span: 3.7, alongZ: true },
      { x: -12, z: -16.9, span: 4.2, alongZ: true },
      { x: 12, z: -16.9, span: 4.2, alongZ: true },
      { x: -19, z: -24, span: 4.4 },
      { x: 19, z: -24, span: 4.4 },
      { x: -8.5, z: -27.1, span: 4.2, alongZ: true },
      { x: 8.5, z: -27.1, span: 4.2, alongZ: true },
      { x: -12, z: 27.0, span: 4.4, alongZ: true },
      { x: 12, z: 27.0, span: 4.4, alongZ: true }
    ];

    const archColGeo = new THREE.CylinderGeometry(0.32, 0.38, 4.8, 12);
    const archKeyGeo = new THREE.BoxGeometry(0.55, 0.95, 0.82);
    for (const ap of archPassages) {
      const g = new THREE.Group();
      g.position.set(ap.x, 0, ap.z);
      if (ap.alongZ) g.rotation.y = Math.PI / 2;

      const archStoneMat = stonePlinthMat.clone();
      const archGoldMat = new THREE.MeshStandardMaterial({ color: 0xc9a24e, roughness: 0.45, metalness: 0.55 });
      const half = ap.span / 2;
      const colL = new THREE.Mesh(archColGeo, archStoneMat);
      colL.position.set(-half, 2.4, 0);
      const colR = new THREE.Mesh(archColGeo, archStoneMat);
      colR.position.set(half, 2.4, 0);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(ap.span + 0.8, 0.75, 0.72), archStoneMat);
      lintel.position.set(0, 4.95, 0);
      const keystone = new THREE.Mesh(archKeyGeo, archGoldMat);
      keystone.position.set(0, 4.85, 0);
      g.add(colL, colR, lintel, keystone);
      this.scene.add(g);

      const extentX = ap.alongZ ? 0.55 : half + 0.45;
      const extentZ = ap.alongZ ? half + 0.45 : 0.55;
      this.occludableWalls.push({
        minX: ap.x - extentX,
        maxX: ap.x + extentX,
        minZ: ap.z - extentZ,
        maxZ: ap.z + extentZ,
        mats: [archStoneMat, archGoldMat],
        alpha: 1.0
      });
    }

    // Büyük Şölen Salonu Tavan Meşe Kirişleri
    const beamGeo = new THREE.BoxGeometry(24, 0.36, 0.42);
    for (const bz of [-6, 0, 6]) {
      const beam = new THREE.Mesh(beamGeo, timberBeamMat);
      beam.position.set(0, 5.35, bz);
      this.scene.add(beam);
    }

    // 6. Demir Zincirli Orta Çağ Mum Avizeleri (Kamera açısını kapatmaması için tavan hizasında yükseltildi)
    this.buildWroughtIronChandelier(0, 4.82, 0, 2.0, 10);
    this.buildWroughtIronChandelier(0, 5.08, 16, 1.25, 8);
    this.buildWroughtIronChandelier(-19, 4.72, -17, 1.2, 6);
    this.buildWroughtIronChandelier(19, 4.72, -17, 1.2, 6);

    // 7. Duvar Meşaleleri (Flickering Wall Torch Sconces)
    const torchCoords: Array<[number, number, number]> = [
      [-11.5, 2.85, -8.2], [-11.5, 2.85, 0], [-11.5, 2.85, 8.2],
      [11.5, 2.85, -8.2], [11.5, 2.85, 0], [11.5, 2.85, 8.2],
      [-5.5, 2.95, -9.5], [5.5, 2.95, -9.5],
      [-6.0, 2.95, 9.5], [6.0, 2.95, 9.5],
      [-11.5, 2.85, 15], [11.5, 2.85, 15],
      [-16.0, 2.75, -6], [-16.0, 2.75, 4], [-16.0, 2.75, 14],
      [16.0, 2.75, -6], [16.0, 2.75, 4], [16.0, 2.75, 14],
      [-25.2, 2.9, 27], [25.2, 2.9, 27],
      [-25.2, 2.9, -28], [25.2, 2.9, -28],
      [-7.8, 2.9, -28], [7.8, 2.9, -28]
    ];
    torchCoords.forEach(([tx, ty, tz], idx) => this.buildWallTorch(tx, ty, tz, idx));

    // 8. Gotik Vitray Pencereler & Kargalı Şato Hanedan Sancakları (Duvarla birlikte şeffaflaşır)
    const bannerSpecs: Array<[number, number, number, number]> = [
      [-11.68, 3.2, -1.3, Math.PI / 2],
      [-11.68, 3.2, 1.3, Math.PI / 2],
      [11.68, 3.2, -1.3, -Math.PI / 2],
      [11.68, 3.2, 1.3, -Math.PI / 2],
      [-7.5, 3.3, -9.68, 0],
      [7.5, 3.3, -9.68, 0],
      [-7.5, 3.3, 9.68, Math.PI],
      [7.5, 3.3, 9.68, Math.PI]
    ];
    const bannerClothGeo = new THREE.PlaneGeometry(1.35, 2.7);
    const bannerRodGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8);
    for (const [bx, by, bz, ry] of bannerSpecs) {
      const bClothMat = new THREE.MeshStandardMaterial({
        map: this.crowBannerTex,
        roughness: 0.72,
        side: THREE.DoubleSide
      });
      const bRodMat = new THREE.MeshStandardMaterial({
        color: 0xd4ac54,
        metalness: 0.8,
        roughness: 0.25
      });
      const bGroup = new THREE.Group();
      bGroup.position.set(bx, by, bz);
      bGroup.rotation.y = ry;
      const cloth = new THREE.Mesh(bannerClothGeo, bClothMat);
      const rod = new THREE.Mesh(bannerRodGeo, bRodMat);
      rod.rotation.z = Math.PI / 2;
      rod.position.y = 1.36;
      bGroup.add(cloth, rod);
      this.scene.add(bGroup);
      this.attachMaterialsToNearestWall(bx, bz, [bClothMat, bRodMat]);
    }

    const windowGeo = new THREE.PlaneGeometry(1.7, 3.2);
    const windowSpecs: Array<[number, number, number, number]> = [
      [-25.4, 3.2, -17, Math.PI / 2],
      [25.4, 3.2, -17, -Math.PI / 2],
      [-19, 3.4, -31.4, 0],
      [0, 3.8, -31.4, 0],
      [-25.4, 3.2, 27, Math.PI / 2],
      [25.4, 3.2, 27, -Math.PI / 2]
    ];
    for (const [wx, wy, wz, wry] of windowSpecs) {
      const wGlassMat = new THREE.MeshBasicMaterial({
        map: this.stainedGlassTex,
        side: THREE.DoubleSide
      });
      const win = new THREE.Mesh(windowGeo, wGlassMat);
      win.position.set(wx, wy, wz);
      win.rotation.y = wry;
      this.scene.add(win);
      this.attachMaterialsToNearestWall(wx, wz, [wGlassMat]);
    }

    // 9. Demir Kuşaklı Meşe Yatak Odası Kapıları (#1..#12)
    const doorArchGeo = new THREE.BoxGeometry(0.62, 0.42, 2.35);
    const doorLeafGeo = new THREE.BoxGeometry(1.92, 3.4, 0.16);
    const doorStrapGeo = new THREE.BoxGeometry(1.86, 0.1, 0.2);
    const doorKnockerGeo = new THREE.TorusGeometry(0.11, 0.025, 8, 16);
    const doorSconceGeo = new THREE.SphereGeometry(0.16, 10, 10);

    for (const door of DOORS) {
      const dArchMat = stonePlinthMat.clone();
      const dWoodMat = new THREE.MeshStandardMaterial({
        map: this.oakWoodTex,
        color: 0x9c6b43,
        roughness: 0.65,
        metalness: 0.1
      });
      const dStrapMat = new THREE.MeshStandardMaterial({
        color: 0x222026,
        roughness: 0.4,
        metalness: 0.85
      });
      const dBrassMat = new THREE.MeshStandardMaterial({
        color: 0xe6be5a,
        roughness: 0.28,
        metalness: 0.88
      });
      const dSconceMat = new THREE.MeshBasicMaterial({
        color: door.sealedByKahya ? 0xff3b4e : 0xffcf6e
      });

      // Kapı Taş Kemeri
      const archFrame = new THREE.Mesh(doorArchGeo, dArchMat);
      archFrame.position.set(door.x, 3.6, door.z);
      this.scene.add(archFrame);

      const pivot = new THREE.Group();
      pivot.position.set(door.x, 0, door.z);

      const leafGroup = new THREE.Group();
      const doorMesh = new THREE.Mesh(doorLeafGeo, dWoodMat);
      doorMesh.position.set(0, 1.7, 0);
      doorMesh.castShadow = true;
      leafGroup.add(doorMesh);

      // Demir menteşe kuşakları + halka tokmak
      for (const sy of [0.65, 1.7, 2.75]) {
        const strap = new THREE.Mesh(doorStrapGeo, dStrapMat);
        strap.position.set(0, sy, 0);
        leafGroup.add(strap);
      }
      const ringKnocker = new THREE.Mesh(doorKnockerGeo, dBrassMat);
      ringKnocker.position.set(0.62, 1.58, 0.12);
      leafGroup.add(ringKnocker);

      const sconce = new THREE.Mesh(doorSconceGeo, dSconceMat);
      sconce.position.set(door.x, 3.92, door.z);
      this.scene.add(sconce);

      const badgeCanvas = document.createElement("canvas");
      badgeCanvas.width = 192;
      badgeCanvas.height = 64;
      const bctx = badgeCanvas.getContext("2d")!;
      bctx.fillStyle = door.sealedByKahya ? "rgba(95, 12, 22, 0.94)" : "rgba(28, 18, 12, 0.92)";
      bctx.strokeStyle = door.sealedByKahya ? "#ff5a6b" : "#e5be5c";
      bctx.lineWidth = 4;
      bctx.beginPath();
      bctx.roundRect(8, 6, 176, 52, 10);
      bctx.fill();
      bctx.stroke();
      bctx.fillStyle = "#fff1c2";
      bctx.font = "bold 25px Georgia, serif";
      bctx.textAlign = "center";
      bctx.fillText(door.sealedByKahya ? "🔒 #11" : `🗝️ ODA #${door.ownerSeat}`, 96, 41);
      const badgeMat = new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(badgeCanvas),
        transparent: true,
        depthTest: true
      });
      const badgeSprite = new THREE.Sprite(badgeMat);
      const badgeX = door.x < 0 ? door.x + 0.58 : door.x - 0.58;
      badgeSprite.position.set(badgeX, 3.35, door.z);
      badgeSprite.scale.set(1.22, 0.4, 1);
      this.scene.add(badgeSprite);
      this.worldSprites.push({
        sprite: badgeSprite,
        mat: badgeMat,
        x: badgeX,
        z: door.z,
        maxDist: 11.5,
        dayOnly: true
      });

      pivot.add(leafGroup);
      const closedAngle = door.orientation === "vertical" ? Math.PI / 2 : 0;
      pivot.rotation.y = closedAngle;
      this.scene.add(pivot);

      this.doorPivots.set(door.id, {
        pivot,
        targetAngle: closedAngle,
        closedAngle,
        isOpen: false
      });

      const isVert = door.orientation === "vertical";
      this.occludableWalls.push({
        minX: door.x - (isVert ? 0.35 : 1.05),
        maxX: door.x + (isVert ? 0.35 : 1.05),
        minZ: door.z - (isVert ? 1.05 : 0.35),
        maxZ: door.z + (isVert ? 1.05 : 0.35),
        mats: [dArchMat, dWoodMat, dStrapMat, dBrassMat, dSconceMat],
        alpha: 1.0,
        doorId: door.id
      });
    }
  }

  private buildWroughtIronChandelier(x: number, y: number, z: number, radius: number, candleCount: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1e1b20, roughness: 0.45, metalness: 0.82 });
    const waxMat = new THREE.MeshStandardMaterial({ color: 0xf4ebd0, roughness: 0.7 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb84d });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.065, 10, 28), ironMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.95, 8), ironMat);
    chain.position.y = 0.48;
    group.add(chain);

    const waxGeo = new THREE.CylinderGeometry(0.05, 0.055, 0.24, 8);
    const flameGeo = new THREE.ConeGeometry(0.055, 0.15, 8);
    for (let i = 0; i < candleCount; i++) {
      const ang = (i / candleCount) * Math.PI * 2;
      const cx = Math.cos(ang) * radius;
      const cz = Math.sin(ang) * radius;
      const wax = new THREE.Mesh(waxGeo, waxMat);
      wax.position.set(cx, 0.15, cz);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(cx, 0.34, cz);
      group.add(wax, flame);
      this.torchFlames.push({ mesh: flame, baseY: 0.34, phase: i * 0.9 + x });
    }

    this.scene.add(group);
  }

  private buildWallTorch(x: number, y: number, z: number, idx: number): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x221f24, roughness: 0.5, metalness: 0.8 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8c24 });
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.035, 0.55, 8), ironMat);
    stick.rotation.z = x < 0 ? -0.25 : 0.25;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.06, 0.12, 10), ironMat);
    cup.position.y = 0.26;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 10), flameMat);
    flame.position.y = 0.46;
    g.add(stick, cup, flame);
    this.scene.add(g);
    this.torchFlames.push({ mesh: flame, baseY: 0.46, phase: idx * 1.13 });
    this.attachMaterialsToNearestWall(x, z, [ironMat, flameMat]);
  }

  private buildKnightArmor(x: number, z: number, rotY: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;

    const steelMat = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.26, metalness: 0.88 });
    const goldTrim = new THREE.MeshStandardMaterial({ color: 0xd4ac54, roughness: 0.32, metalness: 0.82 });
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x38322c, roughness: 0.82 });

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.28, 0.95), plinthMat);
    plinth.position.y = 0.14;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.85, 10), steelMat);
    legs.position.y = 0.7;
    const cuirass = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.25, 0.78, 12), steelMat);
    cuirass.position.y = 1.48;
    const pauldronL = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), steelMat);
    pauldronL.position.set(-0.36, 1.72, 0);
    const pauldronR = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), steelMat);
    pauldronR.position.set(0.36, 1.72, 0);
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.34, 12), steelMat);
    helm.position.y = 2.08;
    const plume = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.32, 8),
      new THREE.MeshStandardMaterial({ color: 0x9b1c24, roughness: 0.7 })
    );
    plume.position.set(0, 2.38, -0.05);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.78, 0.08), goldTrim);
    shield.position.set(-0.38, 1.32, 0.24);
    const halberdShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 2.75, 8),
      new THREE.MeshStandardMaterial({ color: 0x4b2e19, roughness: 0.75 })
    );
    halberdShaft.position.set(0.42, 1.5, 0.15);
    const halberdBlade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.48, 4), steelMat);
    halberdBlade.position.set(0.42, 2.95, 0.15);

    g.add(plinth, legs, cuirass, pauldronL, pauldronR, helm, plume, shield, halberdShaft, halberdBlade);
    this.scene.add(g);
  }

  // ==========================================================================
  // TÜM YENİ ORTA ÇAĞ ODALARININ 3B EŞYALARI VE İSTASYONLARI
  // ==========================================================================
  private buildMedievalPropsAndRooms(): void {
    const oakMat = new THREE.MeshStandardMaterial({ map: this.oakWoodTex, color: 0x7c5032, roughness: 0.7 });
    const darkIronMat = new THREE.MeshStandardMaterial({ color: 0x201e24, roughness: 0.42, metalness: 0.85 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd8b15a, roughness: 0.28, metalness: 0.86 });
    const stoneMat = new THREE.MeshStandardMaterial({ map: this.stoneWallTex, color: 0x7a7064, roughness: 0.85 });

    // 1. Büyük Şölen Salonu & Antre Muhafız Şövalye Zırhları
    const armorSpots: Array<[number, number, number]> = [
      [-5.2, 9.2, Math.PI],
      [5.2, 9.2, Math.PI],
      [-5.2, -9.1, 0],
      [5.2, -9.1, 0],
      [-5.4, 20.5, Math.PI],
      [5.4, 20.5, Math.PI],
      [23.5, 24.0, -Math.PI / 2],
      [23.5, 31.0, -Math.PI / 2]
    ];
    for (const [ax, az, arot] of armorSpots) {
      this.buildKnightArmor(ax, az, arot);
    }

    // 2. 12 Özel Yatak Odası Orta Çağ Mobilyaları (Meşe Karyola, Sandık ve Arma Kalkan)
    for (let i = 0; i < 6; i++) {
      const zCenter = -10 + i * 5 + 2.5;
      this.populateMedievalBedroom(-23.8, zCenter, i + 1, 1);
      this.populateMedievalBedroom(23.8, zCenter, i + 7, -1);
    }

    // 3. Rün & Bulmaca Salonu Kürsüleri
    const altarPedMat = new THREE.MeshStandardMaterial({ color: 0x423832, roughness: 0.65, metalness: 0.25 });
    for (const altar of PUZZLE_ALTARS) {
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 1.18, 12), altarPedMat);
      ped.position.set(altar.x, 0.59, altar.z);
      ped.castShadow = true;
      this.scene.add(ped);

      const orbColor = altar.kind === "RUNE" ? 0x6be2ff : altar.kind === "RIDDLE" ? 0xffd166 : 0xd896ff;
      const orb = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.34, 0),
        new THREE.MeshBasicMaterial({ color: orbColor })
      );
      orb.position.set(altar.x, 1.56, altar.z);
      this.scene.add(orb);
      this.floatingRelics.push({ mesh: orb, baseY: 1.56, phase: altar.x + altar.z });
    }

    // 4. Konsey & Harita Salonu: Şüphe Tahtası + Orta Çağ Savaş Haritası Masası
    const boardStand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.6, 2.6), oakMat);
    boardStand.position.set(COUNCIL_BOARD_POS.x, 1.4, COUNCIL_BOARD_POS.z);
    this.scene.add(boardStand);

    const warTable = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.92, 1.8), oakMat);
    warTable.position.set(-18.5, 0.46, -17.0);
    const mapScroll = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xe6d2aa, roughness: 0.85 })
    );
    mapScroll.rotation.x = -Math.PI / 2;
    mapScroll.position.set(-18.5, 0.94, -17.0);
    this.scene.add(warTable, mapScroll);

    // 5. ⚗️ Simya & İksir Mahzeni (Güneybatı: X = -26..-12, Z = 20..34)
    const cauldronGroup = new THREE.Group();
    cauldronGroup.position.set(-20.5, 0, 27.5);
    const firePit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.9, 0.25, 14),
      new THREE.MeshBasicMaterial({ color: 0xff5a1f })
    );
    firePit.position.y = 0.13;
    const cauldronPot = new THREE.Mesh(new THREE.SphereGeometry(0.82, 16, 14), darkIronMat);
    cauldronPot.position.y = 0.78;
    const greenBrew = new THREE.Mesh(
      new THREE.CylinderGeometry(0.68, 0.68, 0.12, 16),
      new THREE.MeshBasicMaterial({ color: 0x38f294 })
    );
    greenBrew.position.y = 1.32;
    cauldronGroup.add(firePit, cauldronPot, greenBrew);
    this.scene.add(cauldronGroup);

    // İksir Şişesi Rafları
    const alchemyShelf = new THREE.Mesh(new THREE.BoxGeometry(0.65, 2.8, 4.4), oakMat);
    alchemyShelf.position.set(-24.8, 1.4, 27.5);
    this.scene.add(alchemyShelf);
    const potionColors = [0xff2e55, 0x38f294, 0x4cc9f0, 0xffbe0b, 0xb5179e];
    for (let py = 0; py < 3; py++) {
      for (let pz = 0; pz < 5; pz++) {
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.14, 0.34, 8),
          new THREE.MeshBasicMaterial({ color: potionColors[(py + pz) % potionColors.length] })
        );
        bottle.position.set(-24.4, 0.75 + py * 0.85, 25.9 + pz * 0.8);
        this.scene.add(bottle);
      }
    }

    // 6. ⚔️ Şövalye Cephaneliği (Güneydoğu: X = 12..26, Z = 20..34)
    const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.65), oakMat);
    anvilBase.position.set(20.5, 0.28, 27.5);
    const anvilTop = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.42, 0.48), darkIronMat);
    anvilTop.position.set(20.5, 0.76, 27.5);
    const weaponRack = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.3, 0.55), oakMat);
    weaponRack.position.set(19.5, 1.15, 32.6);
    const forgeBrazier = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.45, 0.9, 12), darkIronMat);
    forgeBrazier.position.set(22.5, 0.45, 27.5);
    const forgeGlow = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 0.55, 10),
      new THREE.MeshBasicMaterial({ color: 0xff6d1f })
    );
    forgeGlow.position.set(22.5, 1.05, 27.5);
    this.torchFlames.push({ mesh: forgeGlow, baseY: 1.05, phase: 4.2 });
    this.scene.add(anvilBase, anvilTop, weaponRack, forgeBrazier, forgeGlow);

    // 7. 📚 Şato Kütüphanesi & Vakayiname Arşivi (Kuzeybatı: X = -26..-8.5, Z = -32..-24)
    const bookcaseGeo = new THREE.BoxGeometry(2.4, 3.8, 0.65);
    const booksRowGeo = new THREE.BoxGeometry(2.1, 0.42, 0.52);
    const bookColors = [0x8f1d2c, 0x1d4e89, 0x2b6e44, 0x7a4e1d, 0x54236b];
    for (let bx = -24.0; bx <= -12.0; bx += 3.0) {
      const bcMat = oakMat.clone();
      const bookcase = new THREE.Mesh(bookcaseGeo, bcMat);
      bookcase.position.set(bx, 1.9, -31.1);
      this.scene.add(bookcase);
      const rowMats: THREE.Material[] = [bcMat];
      for (let row = 0; row < 4; row++) {
        const bMat = new THREE.MeshStandardMaterial({
          color: bookColors[(row + Math.abs(Math.round(bx))) % bookColors.length],
          roughness: 0.75
        });
        rowMats.push(bMat);
        const books = new THREE.Mesh(booksRowGeo, bMat);
        books.position.set(bx, 0.65 + row * 0.85, -30.98);
        this.scene.add(books);
      }
      this.occludableWalls.push({
        minX: bx - 1.25,
        maxX: bx + 1.25,
        minZ: -31.5,
        maxZ: -30.7,
        mats: rowMats,
        alpha: 1.0
      });
    }
    const lectern = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.25, 10), oakMat);
    lectern.position.set(-19.5, 0.62, -28.0);
    const openTome = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.12, 0.62),
      new THREE.MeshStandardMaterial({ color: 0xf4e4c1, roughness: 0.8 })
    );
    openTome.position.set(-19.5, 1.3, -28.0);
    openTome.rotation.x = 0.25;
    this.scene.add(lectern, openTome);

    // 8. ⛓️ Zindan & Sorgu Mahzeni (Kuzeydoğu: X = 8.5..26, Z = -32..-24)
    for (let dz = -31.2; dz <= -25.2; dz += 0.65) {
      const cellBar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 4.8, 8), darkIronMat);
      cellBar.position.set(22.8, 2.4, dz);
      this.scene.add(cellBar);
    }
    for (const cxChain of [16.5, 20.5, 24.0]) {
      const chainMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), darkIronMat);
      chainMesh.position.set(cxChain, 3.8, -30.2);
      this.scene.add(chainMesh);
    }
    const dungeonBrazier = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.4, 1.0, 10), darkIronMat);
    dungeonBrazier.position.set(19.5, 0.5, -28.0);
    const dungeonFlame = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 0.65, 10),
      new THREE.MeshBasicMaterial({ color: 0xff3b2f })
    );
    dungeonFlame.position.set(19.5, 1.2, -28.0);
    this.torchFlames.push({ mesh: dungeonFlame, baseY: 1.2, phase: 2.1 });
    this.scene.add(dungeonBrazier, dungeonFlame);

    // 9. ⛲ Kargalı Avlu Taş Dilek Kuyusu & Kuzgun Ağaçları (X = -12..12, Z = 22..34)
    const wellGroup = new THREE.Group();
    wellGroup.position.set(0, 0, 27.6);
    const wellWall = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.95, 18), stoneMat);
    wellWall.position.y = 0.48;
    const wellWater = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.95, 0.1, 16),
      new THREE.MeshBasicMaterial({ color: 0x1d6fa5 })
    );
    wellWater.position.y = 0.72;
    const wellPostL = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 8), oakMat);
    wellPostL.position.set(-0.95, 1.5, 0);
    const wellPostR = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 8), oakMat);
    wellPostR.position.set(0.95, 1.5, 0);
    const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.05, 4), oakMat);
    wellRoof.position.y = 2.95;
    wellRoof.rotation.y = Math.PI / 4;
    wellGroup.add(wellWall, wellWater, wellPostL, wellPostR, wellRoof);
    this.scene.add(wellGroup);

    // Kargalı Avlu Kuru Orta Çağ Ağaçları & Tünemiş Kuzgunlar
    for (const treeX of [-7.5, 7.5]) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.42, 3.4, 8),
        new THREE.MeshStandardMaterial({ color: 0x2b211b, roughness: 0.9 })
      );
      trunk.position.set(treeX, 1.7, 29.8);
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.14, 2.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x2b211b, roughness: 0.9 })
      );
      branch.position.set(treeX + (treeX < 0 ? 0.65 : -0.65), 2.95, 29.8);
      branch.rotation.z = treeX < 0 ? -0.8 : 0.8;
      // Siyah Kuzgun
      const crow = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.44, 8),
        new THREE.MeshStandardMaterial({ color: 0x0d0c12, roughness: 0.5 })
      );
      crow.position.set(treeX, 3.55, 29.8);
      crow.rotation.x = 0.35;
      this.scene.add(trunk, branch, crow);
    }

    // 10. 🕰️ Saat Kulesi: Dev Romen Rakamlı Orta Çağ Saati, Dönen Pirinç Çarklar ve Çan
    const clockCv = document.createElement("canvas");
    clockCv.width = 256;
    clockCv.height = 256;
    const cctx = clockCv.getContext("2d")!;
    cctx.fillStyle = "#1c1510";
    cctx.beginPath();
    cctx.arc(128, 128, 120, 0, Math.PI * 2);
    cctx.fill();
    cctx.strokeStyle = "#e6be5a";
    cctx.lineWidth = 10;
    cctx.stroke();
    cctx.fillStyle = "#ffe6a3";
    cctx.font = "bold 28px Georgia, serif";
    cctx.textAlign = "center";
    cctx.fillText("XII", 128, 44);
    cctx.fillText("VI", 128, 228);
    cctx.fillText("IX", 38, 138);
    cctx.fillText("III", 218, 138);
    const clockDial = new THREE.Mesh(
      new THREE.CircleGeometry(1.85, 28),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(clockCv) })
    );
    clockDial.position.set(0, 3.7, -31.35);
    this.scene.add(clockDial);

    for (const [gx, gy, rad, spd] of [
      [-2.8, 3.2, 0.95, 0.45],
      [2.8, 3.2, 0.95, -0.45],
      [0, 1.6, 0.75, 0.75]
    ] as [number, number, number, number][]) {
      const gear = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.12, 8, 12), goldMat);
      gear.position.set(gx, gy, -31.1);
      this.scene.add(gear);
      this.clockGears.push({ mesh: gear, speed: spd });
    }

    // 11. Orta Çağ Etkileşim İstasyonları Üstü Yüzen Parşömen Etiketleri
    for (const st of MEDIEVAL_STATIONS) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.95, 1.15, 24),
        new THREE.MeshBasicMaterial({ color: 0xf4c95d, side: THREE.DoubleSide, transparent: true, opacity: 0.72 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(st.x, 0.03, st.z);
      this.scene.add(ring);

      const stCv = document.createElement("canvas");
      stCv.width = 384;
      stCv.height = 88;
      const stCtx = stCv.getContext("2d")!;
      stCtx.fillStyle = "rgba(24, 16, 10, 0.9)";
      stCtx.strokeStyle = "#f4c95d";
      stCtx.lineWidth = 4;
      stCtx.beginPath();
      stCtx.roundRect(10, 10, 364, 68, 14);
      stCtx.fill();
      stCtx.stroke();
      stCtx.fillStyle = "#ffe8a3";
      stCtx.font = "bold 24px Georgia, serif";
      stCtx.textAlign = "center";
      stCtx.fillText(`${st.icon} ${st.shortLabel} ETKİLEŞİMİ`, 192, 53);
      const spMat = new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(stCv),
        transparent: true,
        depthTest: true
      });
      const sp = new THREE.Sprite(spMat);
      sp.position.set(st.x, 2.38, st.z);
      sp.scale.set(2.15, 0.49, 1);
      this.scene.add(sp);
      this.floatingRelics.push({ mesh: sp, baseY: 2.38, phase: st.x * 0.5 });
      this.worldSprites.push({
        sprite: sp,
        mat: spMat,
        x: st.x,
        z: st.z,
        maxDist: 13.0,
        dayOnly: true
      });
    }

    // Antre Hazine Sandığı (Merkez 360° karakter inceleme sahnesini engellememek için yan duvara alındı)
    const chestGroup = new THREE.Group();
    chestGroup.position.set(-8.4, 0, 18.6);
    const chestBox = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.92, 1.02), oakMat);
    chestBox.position.y = 0.46;
    const chestGold = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.24, 1.08), goldMat);
    chestGold.position.y = 0.82;
    chestGroup.add(chestBox, chestGold);
    this.scene.add(chestGroup);
  }

  private buildWorldInteractableTargets(): void {
    const doorHitGeo = new THREE.BoxGeometry(2.1, 3.6, 1.0);
    for (const door of DOORS) {
      const m = new THREE.Mesh(doorHitGeo, this.sharedHitMat);
      m.position.set(door.x, 1.8, door.z);
      if (door.orientation === "vertical") {
        m.rotation.y = Math.PI / 2;
      }
      m.userData.interactable = {
        kind: "door",
        id: door.id,
        label: door.label,
        x: door.x,
        z: door.z
      } satisfies PickedWorldInteractable;
      this.scene.add(m);
      this.worldInteractableMeshes.push(m);
    }

    const altarHitGeo = new THREE.CylinderGeometry(1.15, 1.15, 2.4, 10);
    for (const altar of PUZZLE_ALTARS) {
      const m = new THREE.Mesh(altarHitGeo, this.sharedHitMat);
      m.position.set(altar.x, 1.2, altar.z);
      m.userData.interactable = {
        kind: "altar",
        id: altar.id,
        label: `🔮 ${altar.label}`,
        x: altar.x,
        z: altar.z
      } satisfies PickedWorldInteractable;
      this.scene.add(m);
      this.worldInteractableMeshes.push(m);
    }

    const stationHitGeo = new THREE.CylinderGeometry(1.4, 1.4, 2.7, 10);
    for (const st of MEDIEVAL_STATIONS) {
      const m = new THREE.Mesh(stationHitGeo, this.sharedHitMat);
      m.position.set(st.x, 1.35, st.z);
      m.userData.interactable = {
        kind: "station",
        id: st.id,
        label: st.title,
        x: st.x,
        z: st.z
      } satisfies PickedWorldInteractable;
      this.scene.add(m);
      this.worldInteractableMeshes.push(m);
    }

    const boardHit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.9, 2.9), this.sharedHitMat);
    boardHit.position.set(COUNCIL_BOARD_POS.x, 1.45, COUNCIL_BOARD_POS.z);
    boardHit.userData.interactable = {
      kind: "board",
      id: "council_board",
      label: "📋 Konsey Şüphe Tahtası",
      x: COUNCIL_BOARD_POS.x,
      z: COUNCIL_BOARD_POS.z
    } satisfies PickedWorldInteractable;
    this.scene.add(boardHit);
    this.worldInteractableMeshes.push(boardHit);
  }

  private populateMedievalBedroom(bedX: number, zCenter: number, seat: number, dirSign: number): void {
    const charDef = CHARACTERS.find((c) => c.seat === seat);
    const blanketHex = seat === 11 ? "#7a0e18" : charDef?.coatColor || "#5c1a24";

    const g = new THREE.Group();
    g.position.set(bedX, 0, zCenter);

    const oakMat = new THREE.MeshStandardMaterial({ map: this.oakWoodTex, color: 0x6b4226, roughness: 0.72 });
    const blanketMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(blanketHex), roughness: 0.8 });
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0xefe5ce, roughness: 0.75 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4ac54, metalness: 0.8, roughness: 0.3 });

    // Meşe Orta Çağ Karyolası (Dış duvara yaslı — kapı önünü asla kapatmaz)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.42, 1.35), oakMat);
    frame.position.set(0, 0.28, -0.8);
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.35, 1.42), oakMat);
    headboard.position.set(-dirSign * 1.05, 0.72, -0.8);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.22, 1.24), blanketMat);
    mattress.position.set(0, 0.56, -0.8);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.92), pillowMat);
    pillow.position.set(-dirSign * 0.72, 0.72, -0.8);

    // Demir Kuşaklı Özel Oda Sandığı
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.62), oakMat);
    chest.position.set(-dirSign * 0.6, 0.28, 1.25);
    const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.66), brassMat);
    lockPlate.position.set(-dirSign * 0.6, 0.38, 1.25);

    g.add(frame, headboard, mattress, pillow, chest, lockPlate);
    this.scene.add(g);
  }

  private buildRoundTableAndChairs(): void {
    const tableGroup = new THREE.Group();

    const topMat = new THREE.MeshStandardMaterial({
      map: this.oakWoodTex,
      color: 0x6e4427,
      roughness: 0.52,
      metalness: 0.14
    });
    const topMesh = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.1, 0.24, 36), topMat);
    topMesh.position.y = 0.95;
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    tableGroup.add(topMesh);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xd8b258,
      metalness: 0.86,
      roughness: 0.24,
      side: THREE.DoubleSide
    });
    const ringMesh = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.24, 36), ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 1.075;
    tableGroup.add(ringMesh);

    const pedMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.45, 0.92, 20), topMat);
    pedMesh.position.y = 0.46;
    tableGroup.add(pedMesh);

    // Merkez Altın Şamdan & Orta Çağ Şölen Tepsileri
    const candBase = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.38, 0.78, 16), ringMat);
    candBase.position.y = 1.44;
    tableGroup.add(candBase);
    for (let b = 0; b < 4; b++) {
      const ba = (b / 4) * Math.PI * 2;
      const platter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.28, 0.06, 16),
        new THREE.MeshStandardMaterial({ color: 0xc0c7d1, metalness: 0.82, roughness: 0.25 })
      );
      platter.position.set(Math.cos(ba) * 1.15, 1.1, Math.sin(ba) * 1.15);
      tableGroup.add(platter);
    }

    const chairWoodMat = new THREE.MeshStandardMaterial({ map: this.oakWoodTex, color: 0x5c341d, roughness: 0.62 });
    const velvetMat = new THREE.MeshStandardMaterial({ color: 0x7a1622, roughness: 0.78 });
    const kahyaThroneMat = new THREE.MeshStandardMaterial({ color: 0x590d15, roughness: 0.42, metalness: 0.28 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xeae1cb, roughness: 0.28, metalness: 0.12 });
    const orderedSeats = [11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];

    for (let idx = 0; idx < orderedSeats.length; idx++) {
      const seat = orderedSeats[idx];
      const t = getSeatTransform(seat);
      const isKahya = seat === 11;
      const chair = new THREE.Group();
      chair.position.set(t.x, 0, t.z);
      chair.rotation.y = t.rotY;

      const seatMesh = new THREE.Mesh(
        new THREE.BoxGeometry(isKahya ? 0.88 : 0.68, 0.12, 0.68),
        isKahya ? kahyaThroneMat : chairWoodMat
      );
      seatMesh.position.y = 0.52;
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.56), velvetMat);
      cushion.position.y = 0.6;
      chair.add(seatMesh, cushion);

      const backHeight = isKahya ? 1.72 : 1.18;
      const backMesh = new THREE.Mesh(
        new THREE.BoxGeometry(isKahya ? 0.9 : 0.68, backHeight, 0.12),
        isKahya ? kahyaThroneMat : chairWoodMat
      );
      backMesh.position.set(0, 0.52 + backHeight / 2, -0.29);
      chair.add(backMesh);

      if (isKahya) {
        const crest = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), ringMat);
        crest.position.set(0, 2.25, -0.29);
        chair.add(crest);
      }

      this.scene.add(chair);

      const angle = -Math.PI / 2 + (idx / orderedSeats.length) * Math.PI * 2;
      const px = Math.cos(angle) * 2.55;
      const pz = Math.sin(angle) * 2.55;

      const plate = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.18, 0.045, 20),
        isKahya ? ringMat : plateMat.clone()
      );
      plate.position.set(px, 1.085, pz);
      tableGroup.add(plate);
      this.plateMeshes.set(seat, plate);

      // Her tabağın yanına Altın Orta Çağ Şarap Kadehi (Goblet)
      const gx = Math.cos(angle + 0.11) * 2.38;
      const gz = Math.sin(angle + 0.11) * 2.38;
      const goblet = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.045, 0.2, 10), ringMat);
      goblet.position.set(gx, 1.17, gz);
      tableGroup.add(goblet);
    }

    this.scene.add(tableGroup);
  }

  private buildFireplaceAndEmbers(): void {
    const fpGroup = new THREE.Group();
    fpGroup.position.set(0, 0, -9.1);

    const stoneMat = new THREE.MeshStandardMaterial({
      map: this.stoneWallTex,
      color: 0x5e554b,
      roughness: 0.86
    });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xc2cad6, metalness: 0.9, roughness: 0.22 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd8b258, metalness: 0.85, roughness: 0.28 });

    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.95, 3.3, 1.2), stoneMat);
    leftPillar.position.set(-1.55, 1.65, 0);
    const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.95, 3.3, 1.2), stoneMat);
    rightPillar.position.set(1.55, 1.65, 0);
    const mantel = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.65, 1.4), stoneMat);
    mantel.position.set(0, 3.45, 0);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.5, 0.95), stoneMat);
    chimney.position.set(0, 4.75, -0.1);

    // Şömine Üstü Çapraz Şövalye Kılıçları & Altın Kalkan Arması
    const sword1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 0.04), steelMat);
    sword1.position.set(0, 4.45, 0.42);
    sword1.rotation.z = 0.65;
    const sword2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 0.04), steelMat);
    sword2.position.set(0, 4.45, 0.42);
    sword2.rotation.z = -0.65;
    const crestShield = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.1, 6), goldMat);
    crestShield.rotation.x = Math.PI / 2;
    crestShield.position.set(0, 4.45, 0.46);

    fpGroup.add(leftPillar, rightPillar, mantel, chimney, sword1, sword2, crestShield);

    const fireGeo = new THREE.ConeGeometry(0.78, 1.42, 12);
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff6b1a,
      transparent: true,
      opacity: 0.92
    });
    this.fireplaceCoreMesh = new THREE.Mesh(fireGeo, fireMat);
    this.fireplaceCoreMesh.position.set(0, 0.74, 0.12);
    fpGroup.add(this.fireplaceCoreMesh);

    this.fireplaceLight = new THREE.PointLight(0xff5e1a, 3.3, 19, 1.25);
    this.fireplaceLight.position.set(0, 1.45, -7.8);
    this.scene.add(this.fireplaceLight);

    const count = 90;
    const positions = new Float32Array(count * 3);
    this.emberVelocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 1.6;
      positions[i * 3 + 1] = 0.3 + Math.random() * 2.4;
      positions[i * 3 + 2] = -8.9 + (Math.random() - 0.5) * 0.6;
      this.emberVelocities.push(0.6 + Math.random() * 1.2);
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const emberMat = new THREE.PointsMaterial({
      color: 0xff9b3d,
      size: 0.14,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    this.emberPoints = new THREE.Points(emberGeo, emberMat);
    this.scene.add(this.emberPoints);

    this.scene.add(fpGroup);
  }

  private buildAtmosphereDust(): void {
    const count = 200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 48;
      positions[i * 3 + 1] = 0.6 + Math.random() * 4.6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 58;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xe6cf9e,
      size: 0.085,
      transparent: true,
      opacity: 0.34
    });
    this.dustPoints = new THREE.Points(geo, mat);
    this.scene.add(this.dustPoints);
  }

  public triggerFireplaceFlame(mode: "normal" | "red" | "white"): void {
    this.fireMode = mode;
    this.fireModeTimer = mode === "normal" ? 0 : 14.0;
  }

  public syncDoorStates(doors: Map<string, boolean> | Record<string, boolean>): void {
    const getVal = (id: string): boolean => {
      if (doors instanceof Map) return Boolean(doors.get(id));
      return Boolean((doors as Record<string, boolean>)[id]);
    };
    for (const [id, entry] of this.doorPivots.entries()) {
      const isOpen = getVal(id);
      entry.isOpen = isOpen;
      entry.targetAngle = isOpen ? entry.closedAngle - Math.PI * 0.62 : entry.closedAngle;
    }
  }

  public pickCharacterAt(clientX: number, clientY: number): PickedCharacterInfo | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.pickRaycaster.setFromCamera(this.pickNdc, this.camera);

    const targets: THREE.Object3D[] = [];
    for (const [id, rig] of this.characterRigs.entries()) {
      if (id === "__preview_self__" || !rig.group.visible) continue;
      targets.push(rig.hitCylinder);
      if (rig.labelSprite.visible) {
        targets.push(rig.labelSprite);
      }
    }
    if (targets.length === 0) return null;

    const hits = this.pickRaycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;

    const pickedId = hits[0].object.userData?.sessionId as string | undefined;
    if (!pickedId) return null;
    const rig = this.characterRigs.get(pickedId);
    if (!rig) return null;

    const proj = new THREE.Vector3(
      rig.group.position.x,
      rig.group.position.y + 1.55,
      rig.group.position.z
    ).project(this.camera);

    const screenX = rect.left + ((proj.x + 1) * 0.5) * rect.width;
    const screenY = rect.top + ((-proj.y + 1) * 0.5) * rect.height;

    return {
      sessionId: pickedId,
      seat: rig.lastSeat,
      name: rig.lastName,
      isLocal: rig.isLocal,
      screenX: Number.isFinite(screenX) ? screenX : clientX,
      screenY: Number.isFinite(screenY) ? screenY : clientY
    };
  }

  public pickWorldInteractableAt(clientX: number, clientY: number): PickedWorldInteractable | null {
    if (this.worldInteractableMeshes.length === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.pickRaycaster.setFromCamera(this.pickNdc, this.camera);

    const hits = this.pickRaycaster.intersectObjects(this.worldInteractableMeshes, false);
    if (hits.length === 0) return null;
    return (hits[0].object.userData?.interactable as PickedWorldInteractable | undefined) ?? null;
  }

  public setCharacterChatBubble(sessionId: string, text: string): void {
    const rig = this.characterRigs.get(sessionId);
    if (!rig) return;
    rig.lastChat = text.slice(0, 48);
    rig.chatExpiresAt = performance.now() + 5500;
    this.redrawCharacterLabel(rig);
  }

  public syncCharacters(characters: CharacterVisualState[], dt: number): void {
    const activeIds = new Set<string>();

    for (const [seat, plate] of this.plateMeshes) {
      plate.rotation.x = 0;
      if (seat !== 11) {
        (plate.material as THREE.MeshStandardMaterial).color.setHex(0xeae1cb);
      }
    }

    for (const ch of characters) {
      activeIds.add(ch.sessionId);

      if (!ch.alive && this.plateMeshes.has(ch.seat)) {
        const plate = this.plateMeshes.get(ch.seat)!;
        plate.rotation.x = Math.PI;
        if (ch.seat !== 11) {
          (plate.material as THREE.MeshStandardMaterial).color.setHex(0x4a1620);
        }
      }

      let rig = this.characterRigs.get(ch.sessionId);
      if (!rig) {
        rig = this.createCharacterRig(ch);
        this.characterRigs.set(ch.sessionId, rig);
        this.scene.add(rig.group);
      }

      if (
        rig.lastCoat !== ch.coatColor ||
        rig.lastAccent !== ch.accentColor ||
        rig.lastHat !== ch.hat ||
        rig.lastMask !== ch.mask
      ) {
        this.applyCharacterCosmetics(rig, ch);
      }

      if (rig.lastName !== ch.name || rig.lastSeat !== ch.seat) {
        rig.lastName = ch.name;
        rig.lastSeat = ch.seat;
        this.redrawCharacterLabel(rig);
      }

      if (rig.lastChat && performance.now() > rig.chatExpiresAt) {
        rig.lastChat = "";
        this.redrawCharacterLabel(rig);
      }

      rig.isLocal = Boolean(ch.isLocal);

      const isGhost = !ch.alive || ch.isGhost;
      rig.bodyMat.transparent = isGhost;
      rig.bodyMat.opacity = isGhost ? 0.36 : 1.0;
      rig.accentMat.transparent = isGhost;
      rig.accentMat.opacity = isGhost ? 0.42 : 1.0;
      rig.necklaceMesh.visible = ch.hasGoldNecklace;

      rig.targetPos.set(ch.x, isGhost ? 0.35 : 0, ch.z);
      rig.targetRotY = ch.rotY;

      const dist = rig.group.position.distanceTo(rig.targetPos);
      if (dist > 6 || ch.isLocal) {
        rig.group.position.lerp(rig.targetPos, ch.isLocal ? 0.45 : 1.0);
      } else {
        rig.group.position.lerp(rig.targetPos, Math.min(1, dt * 11));
      }

      // GİZLİ ODA GÖRÜŞ HATTI KORUMASI (Duvar / kapalı kapı arkasındaki karakterler ve isimlikleri gizlenir!)
      const labelMat = rig.labelSprite.material as THREE.SpriteMaterial;
      let hasSecretRoomSight = true;
      if (
        this.activePhase === "DAY" &&
        !ch.isLocal &&
        ch.sessionId !== "__preview_self__" &&
        !this.localPlayerIsGhost &&
        !this.inspectTargetId
      ) {
        hasSecretRoomSight =
          this.hasLineOfSight2D(
            this.localPlayerX,
            this.localPlayerZ,
            rig.group.position.x,
            rig.group.position.z
          ) ||
          this.hasLineOfSight2D(
            this.camera.position.x,
            this.camera.position.z,
            rig.group.position.x,
            rig.group.position.z
          );
      }
      rig.group.visible = hasSecretRoomSight;

      // Ekran kalabalığını önleyen akıllı 3B İsimlik & Konuşma Balonu Görünürlüğü
      const modalHeavyPhase =
        this.activePhase === "LOBBY" ||
        this.activePhase === "ARRIVAL" ||
        this.activePhase === "TRIAL" ||
        this.activePhase === "VOTE" ||
        this.activePhase === "NIGHT" ||
        this.activePhase === "FINAL" ||
        this.activePhase === "RESULT";

      if (!hasSecretRoomSight) {
        rig.labelSprite.visible = false;
      } else if (this.inspectTargetId) {
        rig.labelSprite.visible = this.inspectTargetId === ch.sessionId;
        labelMat.opacity = 0.92;
      } else if (modalHeavyPhase) {
        // Merkezde büyük seçim/lobi paneli açıkken arkadaki isim yığılmasını gizle; sadece konuşan balon görünsün
        rig.labelSprite.visible = Boolean(rig.lastChat);
        labelMat.opacity = 0.9;
      } else if (this.activePhase === "DAY") {
        if (ch.isLocal && !rig.lastChat) {
          rig.labelSprite.visible = false;
        } else {
          const dCam = Math.hypot(
            rig.group.position.x - this.cameraTarget.x,
            rig.group.position.z - this.cameraTarget.z
          );
          const maxD = rig.lastChat ? 16.5 : 12.8;
          const fadeStart = rig.lastChat ? 11.5 : 8.5;
          if (dCam > maxD) {
            rig.labelSprite.visible = false;
          } else {
            rig.labelSprite.visible = true;
            const factor = dCam <= fadeStart ? 1 : 1 - (dCam - fadeStart) / (maxD - fadeStart);
            labelMat.opacity = (rig.lastChat ? 0.96 : 0.88) * Math.max(0, Math.min(1, factor));
          }
        }
      } else {
        // TABLE / FIRE / MORNING: Yuvarlak Sofra etrafında derli toplu görünüm
        rig.labelSprite.visible = !ch.isLocal || Boolean(rig.lastChat);
        labelMat.opacity = rig.lastChat ? 0.96 : 0.84;
      }

      let diffAngle = rig.targetRotY - rig.group.rotation.y;
      while (diffAngle > Math.PI) diffAngle -= Math.PI * 2;
      while (diffAngle < -Math.PI) diffAngle += Math.PI * 2;
      rig.group.rotation.y += diffAngle * Math.min(1, dt * 12);

      const speed = dist / Math.max(dt, 0.008);
      if (speed > 0.25 && !isGhost) {
        rig.walkCycle += dt * 10;
        const swing = Math.sin(rig.walkCycle) * 0.45;
        rig.leftLeg.rotation.x = swing;
        rig.rightLeg.rotation.x = -swing;
        rig.leftArm.rotation.x = -swing * 0.7;
        rig.rightArm.rotation.x = swing * 0.7;
      } else {
        rig.leftLeg.rotation.x *= 0.85;
        rig.rightLeg.rotation.x *= 0.85;
        rig.leftArm.rotation.x *= 0.85;
        rig.rightArm.rotation.x *= 0.85;
      }
    }

    for (const [id, rig] of this.characterRigs.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(rig.group);
        rig.group.remove(rig.hitCylinder);
        rig.labelTexture.dispose();
        (rig.labelSprite.material as THREE.SpriteMaterial).dispose();
        disposeObjectSubtree(rig.group);
        this.characterRigs.delete(id);
      }
    }
  }

  private createCharacterRig(ch: CharacterVisualState): CharacterRig {
    const group = new THREE.Group();
    group.position.set(ch.x, 0, ch.z);
    group.rotation.y = ch.rotY;

    const hitCylinder = new THREE.Mesh(this.sharedHitGeo, this.sharedHitMat);
    hitCylinder.position.set(0, 1.05, 0);
    hitCylinder.userData.sessionId = ch.sessionId;
    group.add(hitCylinder);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ch.coatColor || "#5c1a24"),
      roughness: 0.62,
      metalness: 0.16
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ch.accentColor || "#d4af37"),
      roughness: 0.36,
      metalness: 0.7
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe5c1a3,
      roughness: 0.58
    });
    const leatherBootMat = new THREE.MeshStandardMaterial({
      color: 0x261810,
      roughness: 0.78
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x16141c,
      roughness: 0.8
    });

    // Orta Çağ Deri Çizmeler & Bacaklar
    const legGeo = new THREE.CylinderGeometry(0.11, 0.095, 0.65, 10);
    const leftLeg = new THREE.Mesh(legGeo, leatherBootMat);
    leftLeg.position.set(-0.14, 0.32, 0);
    const rightLeg = new THREE.Mesh(legGeo, leatherBootMat);
    rightLeg.position.set(0.14, 0.32, 0);
    group.add(leftLeg, rightLeg);

    // Orta Çağ Tunik & Pelerin Gövdesi
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 0.84, 14), bodyMat);
    torso.position.y = 0.98;
    torso.castShadow = true;
    group.add(torso);

    // Omuz Pelerini (Medieval Mantle / Shoulder Capelet)
    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.38, 0.24, 14), accentMat);
    mantle.position.y = 1.3;
    group.add(mantle);

    // Kemer & Altın Toka
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.315, 0.1, 14), leatherBootMat);
    belt.position.y = 0.86;
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.08), accentMat);
    buckle.position.set(0, 0.86, 0.29);
    group.add(belt, buckle);

    // Kollar
    const armGeo = new THREE.CylinderGeometry(0.082, 0.072, 0.62, 10);
    const leftArm = new THREE.Mesh(armGeo, bodyMat);
    leftArm.position.set(-0.35, 1.02, 0);
    const rightArm = new THREE.Mesh(armGeo, bodyMat);
    rightArm.position.set(0.35, 1.02, 0);
    group.add(leftArm, rightArm);

    // Baş & Gözler
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), skinMat);
    headMesh.position.y = 1.62;
    headMesh.castShadow = true;
    group.add(headMesh);

    const eyeGeo = new THREE.SphereGeometry(0.032, 8, 8);
    const leftEye = new THREE.Mesh(eyeGeo, darkMat);
    leftEye.position.set(-0.08, 1.65, 0.21);
    const rightEye = new THREE.Mesh(eyeGeo, darkMat);
    rightEye.position.set(0.08, 1.65, 0.21);
    group.add(leftEye, rightEye);

    // Altın Dokunulmazlık Kolyesi
    const necklaceMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.04, 10, 24),
      new THREE.MeshStandardMaterial({
        color: 0xffd700,
        emissive: 0x996515,
        metalness: 0.95,
        roughness: 0.15
      })
    );
    necklaceMesh.rotation.x = Math.PI / 2;
    necklaceMesh.position.y = 1.38;
    necklaceMesh.visible = ch.hasGoldNecklace;
    group.add(necklaceMesh);

    const hatGroup = new THREE.Group();
    hatGroup.position.y = 1.82;
    group.add(hatGroup);

    const maskGroup = new THREE.Group();
    maskGroup.position.y = 1.62;
    group.add(maskGroup);

    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 160;
    const labelCtx = labelCanvas.getContext("2d")!;
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const labelSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false })
    );
    labelSprite.position.set(0, 2.38, 0);
    labelSprite.scale.set(1.56, 0.49, 1);
    labelSprite.userData.sessionId = ch.sessionId;
    group.add(labelSprite);

    const rig: CharacterRig = {
      sessionId: ch.sessionId,
      group,
      hitCylinder,
      bodyMat,
      accentMat,
      headMesh,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      hatGroup,
      maskGroup,
      necklaceMesh,
      labelCanvas,
      labelCtx,
      labelTexture,
      labelSprite,
      lastCoat: "",
      lastAccent: "",
      lastHat: "",
      lastMask: "",
      lastName: ch.name,
      lastSeat: ch.seat,
      lastChat: "",
      chatExpiresAt: 0,
      isLocal: Boolean(ch.isLocal),
      targetPos: new THREE.Vector3(ch.x, 0, ch.z),
      targetRotY: ch.rotY,
      walkCycle: 0
    };

    this.applyCharacterCosmetics(rig, ch);
    this.redrawCharacterLabel(rig);
    return rig;
  }

  private applyCharacterCosmetics(rig: CharacterRig, ch: CharacterVisualState): void {
    rig.lastCoat = ch.coatColor;
    rig.lastAccent = ch.accentColor;
    rig.lastHat = ch.hat;
    rig.lastMask = ch.mask;

    rig.bodyMat.color.set(ch.coatColor || "#5c1a24");
    rig.accentMat.color.set(ch.accentColor || "#d4af37");

    const keepMats = new Set<THREE.Material>([rig.bodyMat, rig.accentMat]);

    // Orta Çağ Başlıkları & Miğferleri (Eski mesh/materyalleri temizle)
    disposeObjectSubtree(rig.hatGroup, keepMats);
    rig.hatGroup.clear();
    const darkHatMat = new THREE.MeshStandardMaterial({ color: 0x1e1922, roughness: 0.68 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xc4ccd8, roughness: 0.24, metalness: 0.9 });

    if (ch.hat === "knight") {
      // Şövalye Miğferi + Kızıl Tüy Sorguç
      const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.34, 14), steelMat);
      dome.position.y = -0.04;
      const crest = new THREE.Mesh(
        new THREE.ConeGeometry(0.1, 0.34, 8),
        new THREE.MeshStandardMaterial({ color: 0xb2161e, roughness: 0.6 })
      );
      crest.position.set(0, 0.24, -0.06);
      crest.rotation.x = -0.35;
      rig.hatGroup.add(dome, crest);
    } else if (ch.hat === "wizard") {
      // Orta Çağ Alim / Simyacı Sivri Külahı
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), rig.bodyMat);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.56, 14), rig.bodyMat);
      cone.position.y = 0.28;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.255, 0.06, 14), rig.accentMat);
      band.position.y = 0.05;
      rig.hatGroup.add(brim, cone, band);
    } else if (ch.hat === "noble") {
      // Asilzade Kadife Beresi + Tüy
      const beret = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.14, 16), rig.bodyMat);
      beret.position.y = 0.05;
      const feather = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 8), rig.accentMat);
      feather.position.set(0.22, 0.22, 0);
      feather.rotation.z = -0.45;
      rig.hatGroup.add(beret, feather);
    } else if (ch.hat === "crown") {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.21, 0.22, 8), rig.accentMat);
      crown.position.y = 0.08;
      rig.hatGroup.add(crown);
    } else if (ch.hat === "hood") {
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.44, 12), rig.bodyMat);
      hood.position.set(0, 0.1, -0.04);
      rig.hatGroup.add(hood);
    } else if (ch.hat === "fedora") {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 16), darkHatMat);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.24, 16), darkHatMat);
      crown.position.y = 0.12;
      rig.hatGroup.add(brim, crown);
    } else if (ch.hat === "bun") {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), darkHatMat);
      bun.position.set(0, 0.06, -0.14);
      rig.hatGroup.add(bun);
    }

    // Orta Çağ Maskeleri & Sakallar
    disposeObjectSubtree(rig.maskGroup, keepMats);
    rig.maskGroup.clear();
    if (ch.mask === "ironmask") {
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.28, 0.12), steelMat);
      visor.position.set(0, -0.02, 0.21);
      rig.maskGroup.add(visor);
    } else if (ch.mask === "royalvisor") {
      const rVisor = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.1), rig.accentMat);
      rVisor.position.set(0, 0.0, 0.22);
      rig.maskGroup.add(rVisor);
    } else if (ch.mask === "domino") {
      const domino = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.08), rig.accentMat);
      domino.position.set(0, 0.03, 0.22);
      rig.maskGroup.add(domino);
    } else if (ch.mask === "plague") {
      const beak = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.38, 10),
        new THREE.MeshStandardMaterial({ color: 0x221f29, roughness: 0.5 })
      );
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, -0.02, 0.36);
      rig.maskGroup.add(beak);
    } else if (ch.mask === "glasses") {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.06), rig.accentMat);
      frame.position.set(0, 0.03, 0.23);
      rig.maskGroup.add(frame);
    } else if (ch.mask === "beard") {
      const beard = new THREE.Mesh(
        new THREE.ConeGeometry(0.19, 0.3, 10),
        new THREE.MeshStandardMaterial({ color: 0x7c746b, roughness: 0.85 })
      );
      beard.rotation.x = Math.PI;
      beard.position.set(0, -0.18, 0.16);
      rig.maskGroup.add(beard);
    }
  }

  private redrawCharacterLabel(rig: CharacterRig): void {
    const ctx = rig.labelCtx;
    ctx.clearRect(0, 0, 512, 160);

    if (rig.lastChat) {
      ctx.fillStyle = "rgba(22, 14, 10, 0.94)";
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(26, 8, 460, 62, 14);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#f7ebd2";
      ctx.font = "bold 24px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText(`"${rig.lastChat}"`, 256, 47);
    }

    ctx.fillStyle = "rgba(14, 10, 8, 0.82)";
    ctx.strokeStyle = "rgba(212, 175, 55, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(86, 84, 340, 56, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#e8c460";
    ctx.font = "bold 25px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(`#${rig.lastSeat} ${rig.lastName}`, 256, 120);

    rig.labelTexture.needsUpdate = true;
  }

  public updateCamera(playerX: number, playerZ: number, dt: number): void {
    this.localPlayerX = playerX;
    this.localPlayerZ = playerZ;

    const smoothLerp = Math.min(1, dt * 13);
    this.cameraDistance += (this.targetCameraDistance - this.cameraDistance) * smoothLerp;
    this.inspectDistance += (this.targetInspectDistance - this.inspectDistance) * smoothLerp;

    // Koşu sırasında dinamik hız hissi veren yumuşak FOV geçişi (duvar arkasına sarkmadan!)
    const targetFovBoost = this.cameraFocusMode === "PLAYER" && this.isSprinting ? 5.5 : 0;
    if (Math.abs(targetFovBoost - this.currentFovBoost) > 0.04) {
      this.currentFovBoost += (targetFovBoost - this.currentFovBoost) * Math.min(1, dt * 9);
      const baseFov = this.camera.aspect < 1 ? 76 : 62;
      this.camera.fov = baseFov + this.currentFovBoost;
      this.camera.updateProjectionMatrix();
    }

    if (this.inspectTargetId) {
      const rig = this.characterRigs.get(this.inspectTargetId);
      if (rig) {
        const focusY = this.inspectDistance < 1.85 ? 1.44 : 1.24;
        const focus = new THREE.Vector3(rig.group.position.x, focusY, rig.group.position.z);
        this.cameraTarget.lerp(focus, Math.min(1, dt * 14));
        this.playerLanternLight.position.set(focus.x, 2.75, focus.z);

        const viewAngle = rig.group.rotation.y + this.inspectOrbitYaw;
        const dist = this.inspectDistance;
        const horizDist = dist * Math.cos(this.inspectPitch);
        const vertDist = dist * Math.sin(this.inspectPitch);
        const rawX = focus.x + Math.sin(viewAngle) * horizDist;
        const rawZ = focus.z + Math.cos(viewAngle) * horizDist;
        const clampT = this.computeCameraWallClamp(focus.x, focus.z, rawX, rawZ);
        const effHoriz = Math.max(0.75, horizDist * clampT);
        const desiredX = focus.x + Math.sin(viewAngle) * effHoriz;
        const desiredZ = focus.z + Math.cos(viewAngle) * effHoriz;
        const desiredY = Math.max(0.95, focus.y + vertDist * Math.max(0.45, clampT));
        this.camera.position.lerp(new THREE.Vector3(desiredX, desiredY, desiredZ), Math.min(1, dt * 15));
        this.camera.lookAt(this.cameraTarget);
        return;
      }
    }

    let target: THREE.Vector3;
    if (this.cameraFocusMode === "FIRE") {
      // Hükmün Şöminesi sinematik cephe açısı (alev + kıvılcımlar üst-ortada net görünür)
      target = new THREE.Vector3(0, 1.18, -8.85);
    } else if (this.cameraFocusMode === "TABLE") {
      // Yuvarlak Masa + #11 Kâhya Tahtı + Kuzey Şöminesi ortak kadrajı + yumuşak sinematik süzülme
      target = new THREE.Vector3(0, 1.25, -1.35);
      if (this.activePhase === "VOTE" || this.activePhase === "TABLE") {
        this.cameraYaw += (0 - this.cameraYaw) * Math.min(1, dt * 3.4);
        this.cameraPitch += (0.36 - this.cameraPitch) * Math.min(1, dt * 3.4);
      } else if (this.activePhase === "NIGHT") {
        this.cameraYaw += dt * 0.055;
      }
    } else {
      target = new THREE.Vector3(playerX, 1.48, playerZ);
    }

    const targetFollowSpeed = this.cameraFocusMode === "PLAYER" ? 24 : 9.5;
    this.cameraTarget.lerp(target, Math.min(1, dt * targetFollowSpeed));
    this.playerLanternLight.position.set(this.cameraTarget.x, 3.0, this.cameraTarget.z);

    const isPortrait = window.innerWidth < window.innerHeight;
    const clampedPitch =
      this.cameraFocusMode === "PLAYER"
        ? Math.max(0.16, Math.min(0.47, this.cameraPitch))
        : this.cameraPitch;
    const distance = this.cameraDistance + (isPortrait ? 0.65 : 0);
    const horizDist = distance * Math.cos(clampedPitch);
    const vertDist = distance * Math.sin(clampedPitch);

    let desiredX = this.cameraTarget.x + Math.sin(this.cameraYaw) * horizDist;
    let desiredZ = this.cameraTarget.z + Math.cos(this.cameraYaw) * horizDist;
    let desiredY = Math.max(1.25, this.cameraTarget.y + vertDist);

    if (this.cameraFocusMode === "PLAYER") {
      // YAYLI DUVAR ÇARPIŞMA KAMERASI (Spring-Arm): Koşarken veya dönerken kamera ASLA duvar/kapalı kapı arkasına geçmez!
      const rawCamX = playerX + Math.sin(this.cameraYaw) * horizDist;
      const rawCamZ = playerZ + Math.cos(this.cameraYaw) * horizDist;
      const wallClampT = this.computeCameraWallClamp(playerX, playerZ, rawCamX, rawCamZ);
      if (wallClampT < this.springArmFactor) {
        // Duvara yaklaşırken anında içeri çek (sıfır duvar arkası sızıntısı)
        this.springArmFactor += (wallClampT - this.springArmFactor) * Math.min(1, dt * 36);
        if (this.springArmFactor - wallClampT < 0.02) this.springArmFactor = wallClampT;
      } else {
        // Açık alana çıkarken yumuşakça geri açıl
        this.springArmFactor += (wallClampT - this.springArmFactor) * Math.min(1, dt * 8.5);
      }

      const safeHoriz = Math.max(0.76, horizDist * this.springArmFactor);
      desiredX = playerX + Math.sin(this.cameraYaw) * safeHoriz;
      desiredZ = playerZ + Math.cos(this.cameraYaw) * safeHoriz;
      desiredY = Math.min(
        4.45,
        Math.max(1.28, this.cameraTarget.y + vertDist * Math.max(0.36, this.springArmFactor))
      );
      desiredX = Math.max(-25.6, Math.min(25.6, desiredX));
      desiredZ = Math.max(-31.6, Math.min(33.6, desiredZ));
    } else {
      // Büyük Şölen Salonu masa/şömine kadraj sınırları
      desiredX = Math.max(-10.8, Math.min(10.8, desiredX));
      desiredZ = Math.max(-8.0, Math.min(9.2, desiredZ));
      desiredY = Math.min(4.88, desiredY);
      if (desiredZ < -7.35 && Math.abs(desiredX) < 2.65) {
        desiredZ = -7.35;
      }
    }

    this.camera.position.set(desiredX, desiredY, desiredZ);
    this.camera.lookAt(this.cameraTarget);
  }

  public render(dt: number, elapsedTime: number): void {
    // Odalar gizli olduğu için taş duvarlar her zaman %100 katı (opak) kalır — duvar arkası asla görünmez!
    const tgtX = this.cameraTarget.x;
    const tgtZ = this.cameraTarget.z;

    // 2. Uzaktaki oda/kapı/istasyon tabelalarını mesafe ve evreye göre gizle (ekran karmaşasını önle)
    const showWorldLabels = this.activePhase === "DAY" && !this.inspectTargetId;
    for (const ws of this.worldSprites) {
      if (ws.dayOnly && !showWorldLabels) {
        ws.sprite.visible = false;
        continue;
      }
      const d = Math.hypot(ws.x - tgtX, ws.z - tgtZ);
      const clearLabelSight =
        this.localPlayerIsGhost || this.hasLineOfSight2D(this.localPlayerX, this.localPlayerZ, ws.x, ws.z);
      if (d > ws.maxDist || !clearLabelSight) {
        ws.sprite.visible = false;
      } else {
        ws.sprite.visible = true;
        const fadeStart = ws.maxDist * 0.62;
        const factor = d <= fadeStart ? 1 : 1 - (d - fadeStart) / (ws.maxDist - fadeStart);
        ws.mat.opacity = 0.88 * Math.max(0, Math.min(1, factor));
      }
    }
    const wasBlackout = this.blackoutTimer > 0;
    if (this.blackoutTimer > 0) {
      this.blackoutTimer = Math.max(0, this.blackoutTimer - dt);
      this.renderer.toneMappingExposure = 0.65;
      this.ambientLight.intensity = 0.16;
      this.hemiLight.intensity = 0.18;
      this.playerLanternLight.intensity = 1.15;
      for (const c of this.candleLights) {
        c.light.intensity = 0.08;
      }
      if (this.blackoutTimer === 0 && wasBlackout) {
        this.applyBrightnessPreset();
      }
    } else if (this.ghostFlickerTimer > 0) {
      this.ghostFlickerTimer = Math.max(0, this.ghostFlickerTimer - dt);
      for (const c of this.candleLights) {
        const pulse = Math.sin(elapsedTime * 38 + c.phase) > 0 ? 0.25 : 1.55;
        c.light.intensity = c.baseIntensity * pulse;
        c.light.color.setHex(this.ghostFlickerTimer > 0.1 ? 0x9ed4ff : 0xffa947);
      }
      if (this.ghostFlickerTimer === 0) {
        for (const c of this.candleLights) {
          c.light.color.setHex(0xffa947);
        }
      }
    } else {
      for (const c of this.candleLights) {
        c.light.intensity =
          c.baseIntensity +
          Math.sin(elapsedTime * 7.5 + c.phase) * 0.18 +
          Math.cos(elapsedTime * 13.0 + c.phase) * 0.08;
      }
    }

    // Duvar ve avize meşale alevlerinin canlı titreşimi
    for (const tf of this.torchFlames) {
      const s = 0.92 + Math.sin(elapsedTime * 14 + tf.phase) * 0.16;
      tf.mesh.scale.set(s, 0.88 + Math.cos(elapsedTime * 19 + tf.phase) * 0.22, s);
      tf.mesh.position.y = tf.baseY + Math.sin(elapsedTime * 12 + tf.phase) * 0.02;
    }

    // Rün kristalleri ve etkileşim tabelaları hafif süzülme
    for (const fr of this.floatingRelics) {
      fr.mesh.position.y = fr.baseY + Math.sin(elapsedTime * 2.4 + fr.phase) * 0.08;
      if ((fr.mesh as THREE.Mesh).isMesh) {
        fr.mesh.rotation.y = elapsedTime * 1.1;
      }
    }

    // Saat Kulesi dev pirinç çarkları dönüyor
    for (const cg of this.clockGears) {
      cg.mesh.rotation.z = elapsedTime * cg.speed;
    }

    if (this.activePhase === "FIRE" && this.fireMode !== "normal") {
      this.fireModeTimer = Math.max(this.fireModeTimer, 1.0);
    } else if (this.fireModeTimer > 0) {
      this.fireModeTimer -= dt;
      if (this.fireModeTimer <= 0) {
        this.fireMode = "normal";
      }
    }

    const coreMat = this.fireplaceCoreMesh.material as THREE.MeshBasicMaterial;
    const emberMat = this.emberPoints.material as THREE.PointsMaterial;
    if (this.fireMode === "red") {
      coreMat.color.setHex(0xff1426);
      emberMat.color.setHex(0xff2a3a);
      this.fireplaceLight.color.setHex(0xff1426);
      this.fireplaceLight.intensity = 5.4 + Math.sin(elapsedTime * 18) * 1.1;
      this.fireplaceCoreMesh.scale.set(1.45, 1.85 + Math.sin(elapsedTime * 16) * 0.25, 1.45);
    } else if (this.fireMode === "white") {
      coreMat.color.setHex(0xd8f0ff);
      emberMat.color.setHex(0x9ed4ff);
      this.fireplaceLight.color.setHex(0xbbe2ff);
      this.fireplaceLight.intensity = 4.8 + Math.sin(elapsedTime * 14) * 0.9;
      this.fireplaceCoreMesh.scale.set(1.3, 1.65 + Math.sin(elapsedTime * 12) * 0.2, 1.3);
    } else {
      coreMat.color.setHex(0xff6b1a);
      emberMat.color.setHex(0xff9b3d);
      this.fireplaceLight.color.setHex(0xff5e1a);
      this.fireplaceLight.intensity = 3.2 + Math.sin(elapsedTime * 9) * 0.4;
      this.fireplaceCoreMesh.scale.set(1.0, 1.0 + Math.sin(elapsedTime * 10) * 0.12, 1.0);
    }

    const emberPos = this.emberPoints.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < emberPos.count; i++) {
      let y = emberPos.getY(i) + this.emberVelocities[i] * dt;
      if (y > 3.2) {
        y = 0.35;
        emberPos.setX(i, (Math.random() - 0.5) * 1.5);
      }
      emberPos.setY(i, y);
    }
    emberPos.needsUpdate = true;

    for (const [, entry] of this.doorPivots) {
      entry.pivot.rotation.y += (entry.targetAngle - entry.pivot.rotation.y) * Math.min(1, dt * 8);
    }

    this.dustPoints.rotation.y = elapsedTime * 0.015;

    this.renderer.render(this.scene, this.camera);
  }
}
