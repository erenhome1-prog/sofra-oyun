import * as THREE from "three";
import {
  CASTLE_WALLS,
  COUNCIL_BOARD_POS,
  DOORS,
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

interface CharacterRig {
  group: THREE.Group;
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
  targetPos: THREE.Vector3;
  targetRotY: number;
  walkCycle: number;
}

export class CastleScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;

  private candleLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[] = [];
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  private playerLanternLight!: THREE.PointLight;
  private brightnessMode = 1; // 0: Atmosferik, 1: Aydınlık (Varsayılan Mobil Dostu), 2: Ekstra Parlak
  private fireplaceLight!: THREE.PointLight;
  private fireplaceCoreMesh!: THREE.Mesh;
  private emberPoints!: THREE.Points;
  private emberVelocities: number[] = [];
  private fireMode: "normal" | "red" | "white" = "normal";
  private fireModeTimer = 0;
  private blackoutTimer = 0;
  private ghostFlickerTimer = 0;

  private dustPoints!: THREE.Points;
  private doorPivots = new Map<string, { pivot: THREE.Group; targetAngle: number; closedAngle: number }>();
  private plateMeshes = new Map<number, THREE.Mesh>();
  private characterRigs = new Map<string, CharacterRig>();

  // Camera & 360° Character Inspect state
  public cameraYaw = 0;
  public cameraPitch = 0.35;
  public inspectTargetId: string | null = null;
  public inspectOrbitYaw = 0;
  private cameraTarget = new THREE.Vector3(0, 1.5, 0);

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b1929);
    this.scene.fog = new THREE.FogExp2(0x1b1929, 0.0085);

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.1,
      140
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 2,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.68;

    container.innerHTML = "";
    container.appendChild(this.renderer.domElement);

    this.buildLighting();
    this.buildCastleArchitecture();
    this.buildRoundTableAndChairs();
    this.buildFireplaceAndEmbers();
    this.buildAtmosphereDust();
    this.onResize();

    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("orientationchange", () => this.forceResize());
    screen.orientation?.addEventListener?.("change", () => this.forceResize());
    window.visualViewport?.addEventListener?.("resize", () => this.onResize());
  }

  public forceResize(): void {
    this.onResize();
    for (const delay of [80, 200, 420, 700]) {
      window.setTimeout(() => this.onResize(), delay);
    }
  }

  private onResize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? 76 : 62;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private buildLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0xe4dcff, 1.35);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x9cb4e8, 0x6e523d, 1.45);
    this.scene.add(this.hemiLight);

    const moonLight = new THREE.DirectionalLight(0xfff1d6, 1.45);
    moonLight.position.set(16, 28, -18);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(1024, 1024);
    moonLight.shadow.camera.near = 2;
    moonLight.shadow.camera.far = 75;
    const d = 28;
    moonLight.shadow.camera.left = -d;
    moonLight.shadow.camera.right = d;
    moonLight.shadow.camera.top = d;
    moonLight.shadow.camera.bottom = -d;
    this.scene.add(moonLight);

    // Oyuncuyu takip eden sıcak El Feneri / Meşale ışığı (her koridoru aydınlatır!)
    this.playerLanternLight = new THREE.PointLight(0xffd28a, 2.8, 20, 1.05);
    this.playerLanternLight.position.set(0, 2.6, 15);
    this.scene.add(this.playerLanternLight);

    // Chandelier above Round Table
    const tableLight = new THREE.PointLight(0xffbb66, 3.8, 28, 1.2);
    tableLight.position.set(0, 5.2, 0);
    tableLight.castShadow = true;
    this.scene.add(tableLight);
    this.candleLights.push({ light: tableLight, baseIntensity: 3.8, phase: 0.2 });

    // Her odanın tam merkezinde güçlü meşale/avize ışıkları
    const candleSpots: [number, number, number, number][] = [
      [0, 3.8, 16, 2.7],       // Antre
      [0, 4.2, 27, 2.5],       // Kargalı Avlu
      [-19, 3.8, -17, 2.8],    // Toplantı & Konsey Salonu
      [19, 3.8, -17, 2.9],     // Etkinlik & Bulmaca Salonu
      [0, 3.8, -15, 2.4],      // Kuzey Koridoru
      [0, 4.4, -26, 2.7],      // Saat Kulesi
      [-14.2, 3.6, -4, 2.5],   // Batı Yatak Koridoru Kuzey
      [-14.2, 3.6, 11, 2.5],   // Batı Yatak Koridoru Güney
      [14.2, 3.6, -4, 2.5],    // Doğu Yatak Koridoru Kuzey
      [14.2, 3.6, 11, 2.5]     // Doğu Yatak Koridoru Güney
    ];
    candleSpots.forEach(([x, y, z, intensity], idx) => {
      const pLight = new THREE.PointLight(0xffae52, intensity, 20, 1.25);
      pLight.position.set(x, y, z);
      this.scene.add(pLight);
      this.candleLights.push({ light: pLight, baseIntensity: intensity, phase: idx * 1.37 });
    });
  }

  public cycleBrightnessBoost(): string {
    this.brightnessMode = (this.brightnessMode + 1) % 3;
    return this.applyBrightnessPreset();
  }

  private applyBrightnessPreset(): string {
    if (this.brightnessMode === 2) {
      this.renderer.toneMappingExposure = 2.35;
      this.ambientLight.intensity = 2.1;
      this.hemiLight.intensity = 2.0;
      this.playerLanternLight.intensity = 3.8;
      return "☀️ Ekstra Parlak";
    } else if (this.brightnessMode === 1) {
      this.renderer.toneMappingExposure = 1.68;
      this.ambientLight.intensity = 1.35;
      this.hemiLight.intensity = 1.45;
      this.playerLanternLight.intensity = 2.8;
      return "💡 Aydınlık";
    } else {
      this.renderer.toneMappingExposure = 1.22;
      this.ambientLight.intensity = 0.85;
      this.hemiLight.intensity = 0.95;
      this.playerLanternLight.intensity = 2.0;
      return "🕯️ Loş Şato";
    }
  }

  public triggerBlackout(durationSec: number): void {
    this.blackoutTimer = Math.max(this.blackoutTimer, durationSec);
  }

  public triggerGhostFlicker(): void {
    this.ghostFlickerTimer = 2.6;
  }

  private buildCastleArchitecture(): void {
    // Main Stone Floor (Yüksek kontrastlı sıcak mermer/taş zemin)
    const floorGeo = new THREE.PlaneGeometry(64, 76, 16, 16);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x423a4c,
      roughness: 0.78,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Room zone carpets / floor highlights
    for (const zone of ROOM_ZONES) {
      const w = (zone.maxX - zone.minX) * 0.88;
      const d = (zone.maxZ - zone.minZ) * 0.88;
      const cx = (zone.minX + zone.maxX) / 2;
      const cz = (zone.minZ + zone.maxZ) / 2;

      const rugGeo = new THREE.PlaneGeometry(w, d);
      const isMain = zone.id === "yemek_salonu";
      const isBed = Boolean(zone.isPrivateBedroom);
      const rugMat = new THREE.MeshStandardMaterial({
        color: isMain ? 0x701c26 : isBed ? 0x3b2d4a : 0x353144,
        roughness: 0.85
      });
      const rug = new THREE.Mesh(rugGeo, rugMat);
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(cx, 0.015, cz);
      rug.receiveShadow = true;
      this.scene.add(rug);

      // Oda İsim Tabelası (Yüksek görünürlüklü)
      const signCanvas = document.createElement("canvas");
      signCanvas.width = 512;
      signCanvas.height = 96;
      const sctx = signCanvas.getContext("2d")!;
      sctx.fillStyle = "rgba(22, 16, 30, 0.82)";
      sctx.strokeStyle = "#e6c15a";
      sctx.lineWidth = 4;
      sctx.beginPath();
      sctx.roundRect(16, 12, 480, 72, 16);
      sctx.fill();
      sctx.stroke();
      sctx.fillStyle = "#ffe394";
      sctx.font = "bold 28px Georgia, serif";
      sctx.textAlign = "center";
      sctx.fillText(zone.name.toUpperCase(), 256, 58);
      const signTex = new THREE.CanvasTexture(signCanvas);
      const signSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: signTex, transparent: true })
      );
      signSprite.position.set(cx, 3.9, cz);
      signSprite.scale.set(4.2, 0.8, 1);
      this.scene.add(signSprite);
    }

    // Castle Stone Walls from shared CASTLE_WALLS (Açık sıcak taş + altın süpürgelik)
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x5d5369,
      roughness: 0.78,
      metalness: 0.12
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xa68246,
      roughness: 0.5,
      metalness: 0.35
    });

    for (const w of CASTLE_WALLS) {
      const sx = w.maxX - w.minX;
      const sz = w.maxZ - w.minZ;
      const cx = (w.minX + w.maxX) / 2;
      const cz = (w.minZ + w.maxZ) / 2;
      const wallHeight = 5.4;

      const geo = new THREE.BoxGeometry(sx, wallHeight, sz);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(cx, wallHeight / 2, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      // Gold/Wood base trim
      const trimGeo = new THREE.BoxGeometry(sx + 0.06, 0.28, sz + 0.06);
      const trim = new THREE.Mesh(trimGeo, trimMat);
      trim.position.set(cx, 0.14, cz);
      this.scene.add(trim);
    }

    // Interactive Bedroom Doors (Parlak meşe + altın kapı kolu + üst meşale)
    const doorWoodMat = new THREE.MeshStandardMaterial({
      color: 0x874c28,
      roughness: 0.62,
      metalness: 0.12
    });
    const doorIronMat = new THREE.MeshStandardMaterial({
      color: 0xf2c968,
      roughness: 0.28,
      metalness: 0.88
    });

    for (const door of DOORS) {
      const pivot = new THREE.Group();
      pivot.position.set(door.x, 0, door.z);

      const leafGroup = new THREE.Group();
      const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.4, 0.16), doorWoodMat);
      doorMesh.position.set(0, 1.7, 0);
      doorMesh.castShadow = true;
      leafGroup.add(doorMesh);

      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), doorIronMat);
      handle.position.set(0.65, 1.6, 0.14);
      leafGroup.add(handle);

      // Kapı üstü parlayan altın fener küresi + Oda Numarası Plakası (#1..#12)
      const sconce = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 12, 12),
        new THREE.MeshBasicMaterial({ color: door.sealedByKahya ? 0xff3b4e : 0xffd470 })
      );
      sconce.position.set(door.x, 3.85, door.z);
      this.scene.add(sconce);

      const badgeCanvas = document.createElement("canvas");
      badgeCanvas.width = 192;
      badgeCanvas.height = 64;
      const bctx = badgeCanvas.getContext("2d")!;
      bctx.fillStyle = door.sealedByKahya ? "rgba(95, 12, 22, 0.92)" : "rgba(22, 16, 32, 0.9)";
      bctx.strokeStyle = door.sealedByKahya ? "#ff5a6b" : "#ffd166";
      bctx.lineWidth = 4;
      bctx.beginPath();
      bctx.roundRect(8, 6, 176, 52, 12);
      bctx.fill();
      bctx.stroke();
      bctx.fillStyle = "#fff1c2";
      bctx.font = "bold 26px Georgia, serif";
      bctx.textAlign = "center";
      bctx.fillText(door.sealedByKahya ? "🔒 #11" : `🗝️ ODA #${door.ownerSeat}`, 96, 41);
      const badgeSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(badgeCanvas), transparent: true })
      );
      badgeSprite.position.set(door.x < 0 ? door.x + 0.55 : door.x - 0.55, 3.45, door.z);
      badgeSprite.scale.set(1.5, 0.5, 1);
      this.scene.add(badgeSprite);

      pivot.add(leafGroup);
      const closedAngle = door.orientation === "vertical" ? Math.PI / 2 : 0;
      pivot.rotation.y = closedAngle;
      this.scene.add(pivot);

      this.doorPivots.set(door.id, {
        pivot,
        targetAngle: closedAngle,
        closedAngle
      });
    }

    // Etkinlik & Bulmaca Salonu: 3 Parlayan Kadim Bulmaca Kürsüsü
    const altarPedMat = new THREE.MeshStandardMaterial({ color: 0x3b2f4a, roughness: 0.5, metalness: 0.3 });
    for (const altar of PUZZLE_ALTARS) {
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.68, 1.15, 16), altarPedMat);
      ped.position.set(altar.x, 0.58, altar.z);
      ped.castShadow = true;
      this.scene.add(ped);

      const orbColor = altar.kind === "RUNE" ? 0x6be2ff : altar.kind === "RIDDLE" ? 0xffd166 : 0xd896ff;
      const orb = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.32, 0),
        new THREE.MeshBasicMaterial({ color: orbColor })
      );
      orb.position.set(altar.x, 1.52, altar.z);
      this.scene.add(orb);
    }

    // Toplantı & Konsey Salonu: Şüphe Tahtası
    const boardStand = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 2.5, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x241d29, roughness: 0.7 })
    );
    boardStand.position.set(COUNCIL_BOARD_POS.x, 1.4, COUNCIL_BOARD_POS.z);
    this.scene.add(boardStand);

    // Stained-glass Moonlight Beams in Yemek Salonu
    const beamGeo = new THREE.ConeGeometry(2.6, 8.5, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x6f92dc,
      transparent: true,
      opacity: 0.07,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const beamPositions: [number, number, number][] = [
      [-6.5, 4.2, -5.5],
      [6.5, 4.2, -5.5],
      [-6.5, 4.2, 5.5],
      [6.5, 4.2, 5.5]
    ];
    for (const [bx, by, bz] of beamPositions) {
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(bx, by, bz);
      beam.rotation.z = bx < 0 ? -0.22 : 0.22;
      this.scene.add(beam);
    }

    // Antre Gold Chest (Hoş Geldin & Altın Kasası)
    const chestGroup = new THREE.Group();
    chestGroup.position.set(0, 0, 17.5);
    const chestBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.9, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x522915, roughness: 0.6 })
    );
    chestBox.position.y = 0.45;
    const chestGold = new THREE.Mesh(
      new THREE.BoxGeometry(1.66, 0.22, 1.06),
      new THREE.MeshStandardMaterial({ color: 0xd8b15a, metalness: 0.85, roughness: 0.25 })
    );
    chestGold.position.y = 0.78;
    chestGroup.add(chestBox, chestGold);
    this.scene.add(chestGroup);
  }

  private buildRoundTableAndChairs(): void {
    const tableGroup = new THREE.Group();

    // Dark Oak Round Table
    const topGeo = new THREE.CylinderGeometry(3.25, 3.1, 0.22, 36);
    const topMat = new THREE.MeshStandardMaterial({
      color: 0x2c160e,
      roughness: 0.55,
      metalness: 0.15
    });
    const topMesh = new THREE.Mesh(topGeo, topMat);
    topMesh.position.y = 0.95;
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    tableGroup.add(topMesh);

    // Gold Inlay Ring on Table
    const ringGeo = new THREE.RingGeometry(2.15, 2.25, 36);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xd4ac54,
      metalness: 0.85,
      roughness: 0.25,
      side: THREE.DoubleSide
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 1.065;
    tableGroup.add(ringMesh);

    // Table Pedestal
    const pedGeo = new THREE.CylinderGeometry(0.85, 1.35, 0.92, 20);
    const pedMesh = new THREE.Mesh(pedGeo, topMat);
    pedMesh.position.y = 0.46;
    tableGroup.add(pedMesh);

    // Center Candelabra
    const candBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.35, 0.65, 16),
      ringMat
    );
    candBase.position.y = 1.38;
    tableGroup.add(candBase);

    // 12 Chairs around Round Table (#1..#10 & #12 Players, #11 Kâhya's Empty Throne)
    const chairWoodMat = new THREE.MeshStandardMaterial({ color: 0x381c11, roughness: 0.65 });
    const kahyaThroneMat = new THREE.MeshStandardMaterial({ color: 0x6b1218, roughness: 0.45, metalness: 0.25 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xe6dec8, roughness: 0.3, metalness: 0.1 });
    const orderedSeats = [11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];

    for (let idx = 0; idx < orderedSeats.length; idx++) {
      const seat = orderedSeats[idx];
      const t = getSeatTransform(seat);
      const isKahya = seat === 11;
      const chair = new THREE.Group();
      chair.position.set(t.x, 0, t.z);
      chair.rotation.y = t.rotY;

      const seatMesh = new THREE.Mesh(
        new THREE.BoxGeometry(isKahya ? 0.82 : 0.65, 0.1, 0.65),
        isKahya ? kahyaThroneMat : chairWoodMat
      );
      seatMesh.position.y = 0.52;
      chair.add(seatMesh);

      const backHeight = isKahya ? 1.55 : 1.05;
      const backMesh = new THREE.Mesh(
        new THREE.BoxGeometry(isKahya ? 0.84 : 0.65, backHeight, 0.1),
        isKahya ? kahyaThroneMat : chairWoodMat
      );
      backMesh.position.set(0, 0.52 + backHeight / 2, -0.28);
      chair.add(backMesh);

      if (isKahya) {
        // Gold crown crest on Chair #11 (Kâhya's Empty Throne)
        const crest = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.18, 0),
          ringMat
        );
        crest.position.set(0, 1.95, -0.28);
        chair.add(crest);
      }

      this.scene.add(chair);

      // Porcelain Plate on the table in front of each seat
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
    }

    this.scene.add(tableGroup);
  }

  private buildFireplaceAndEmbers(): void {
    const fpGroup = new THREE.Group();
    fpGroup.position.set(0, 0, -9.1);

    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x2c2733,
      roughness: 0.85
    });

    // Left & Right Pillars + Mantel
    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.2, 1.1), stoneMat);
    leftPillar.position.set(-1.5, 1.6, 0);
    const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.2, 1.1), stoneMat);
    rightPillar.position.set(1.5, 1.6, 0);
    const mantel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.6, 1.3), stoneMat);
    mantel.position.set(0, 3.4, 0);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.4, 0.9), stoneMat);
    chimney.position.set(0, 4.7, -0.1);

    fpGroup.add(leftPillar, rightPillar, mantel, chimney);

    // Glowing Fire Core
    const fireGeo = new THREE.ConeGeometry(0.75, 1.35, 12);
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff6b1a,
      transparent: true,
      opacity: 0.9
    });
    this.fireplaceCoreMesh = new THREE.Mesh(fireGeo, fireMat);
    this.fireplaceCoreMesh.position.set(0, 0.72, 0.1);
    fpGroup.add(this.fireplaceCoreMesh);

    this.fireplaceLight = new THREE.PointLight(0xff5e1a, 3.2, 18, 1.3);
    this.fireplaceLight.position.set(0, 1.4, -7.8);
    this.scene.add(this.fireplaceLight);

    // Ember Particle System
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
    const count = 180;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 38;
      positions[i * 3 + 1] = 0.6 + Math.random() * 4.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 44;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xd8c398,
      size: 0.08,
      transparent: true,
      opacity: 0.32
    });
    this.dustPoints = new THREE.Points(geo, mat);
    this.scene.add(this.dustPoints);
  }

  public triggerFireplaceFlame(mode: "normal" | "red" | "white"): void {
    this.fireMode = mode;
    this.fireModeTimer = mode === "normal" ? 0 : 7.0;
  }

  public syncDoorStates(doors: Map<string, boolean> | Record<string, boolean>): void {
    const getVal = (id: string): boolean => {
      if (doors instanceof Map) return Boolean(doors.get(id));
      return Boolean((doors as Record<string, boolean>)[id]);
    };
    for (const [id, entry] of this.doorPivots.entries()) {
      const isOpen = getVal(id);
      entry.targetAngle = isOpen ? entry.closedAngle - Math.PI * 0.62 : entry.closedAngle;
    }
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

    // Reset plate inversions first
    for (const [seat, plate] of this.plateMeshes) {
      plate.rotation.x = 0;
      if (seat !== 11) {
        (plate.material as THREE.MeshStandardMaterial).color.setHex(0xe6dec8);
      }
    }

    for (const ch of characters) {
      activeIds.add(ch.sessionId);

      // Invert & darken porcelain plate on the table if this seat was eliminated
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

      // Check if appearance or name changed
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

      // Ghost / Alive visual opacity
      const isGhost = !ch.alive || ch.isGhost;
      rig.bodyMat.transparent = isGhost;
      rig.bodyMat.opacity = isGhost ? 0.36 : 1.0;
      rig.accentMat.transparent = isGhost;
      rig.accentMat.opacity = isGhost ? 0.42 : 1.0;
      rig.necklaceMesh.visible = ch.hasGoldNecklace;

      // Smooth position & rotation interpolation
      rig.targetPos.set(ch.x, isGhost ? 0.35 : 0, ch.z);
      rig.targetRotY = ch.rotY;

      const dist = rig.group.position.distanceTo(rig.targetPos);
      if (dist > 6 || ch.isLocal) {
        rig.group.position.lerp(rig.targetPos, ch.isLocal ? 0.45 : 1.0);
      } else {
        rig.group.position.lerp(rig.targetPos, Math.min(1, dt * 11));
      }

      // Shortest angle lerp for rotation
      let diffAngle = rig.targetRotY - rig.group.rotation.y;
      while (diffAngle > Math.PI) diffAngle -= Math.PI * 2;
      while (diffAngle < -Math.PI) diffAngle += Math.PI * 2;
      rig.group.rotation.y += diffAngle * Math.min(1, dt * 12);

      // Walk animation
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

    // Remove disconnected rigs
    for (const [id, rig] of this.characterRigs.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(rig.group);
        this.characterRigs.delete(id);
      }
    }
  }

  private createCharacterRig(ch: CharacterVisualState): CharacterRig {
    const group = new THREE.Group();
    group.position.set(ch.x, 0, ch.z);
    group.rotation.y = ch.rotY;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ch.coatColor || "#5c1a24"),
      roughness: 0.65,
      metalness: 0.15
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ch.accentColor || "#d4af37"),
      roughness: 0.4,
      metalness: 0.65
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe2bfa3,
      roughness: 0.6
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x16141c,
      roughness: 0.8
    });

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.65, 10);
    const leftLeg = new THREE.Mesh(legGeo, darkMat);
    leftLeg.position.set(-0.14, 0.32, 0);
    const rightLeg = new THREE.Mesh(legGeo, darkMat);
    rightLeg.position.set(0.14, 0.32, 0);
    group.add(leftLeg, rightLeg);

    // Coat / Torso
    const torsoGeo = new THREE.CylinderGeometry(0.24, 0.34, 0.82, 14);
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 0.98;
    torso.castShadow = true;
    group.add(torso);

    // Gold Belt / Accent Collar
    const belt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.31, 0.1, 14),
      accentMat
    );
    belt.position.y = 0.85;
    group.add(belt);

    // Arms
    const armGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.62, 10);
    const leftArm = new THREE.Mesh(armGeo, bodyMat);
    leftArm.position.set(-0.34, 1.02, 0);
    const rightArm = new THREE.Mesh(armGeo, bodyMat);
    rightArm.position.set(0.34, 1.02, 0);
    group.add(leftArm, rightArm);

    // Head
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), skinMat);
    headMesh.position.y = 1.62;
    headMesh.castShadow = true;
    group.add(headMesh);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.032, 8, 8);
    const leftEye = new THREE.Mesh(eyeGeo, darkMat);
    leftEye.position.set(-0.08, 1.65, 0.21);
    const rightEye = new THREE.Mesh(eyeGeo, darkMat);
    rightEye.position.set(0.08, 1.65, 0.21);
    group.add(leftEye, rightEye);

    // Gold Necklace (Immunity Emblem)
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
    necklaceMesh.position.y = 1.37;
    necklaceMesh.visible = ch.hasGoldNecklace;
    group.add(necklaceMesh);

    const hatGroup = new THREE.Group();
    hatGroup.position.y = 1.82;
    group.add(hatGroup);

    const maskGroup = new THREE.Group();
    maskGroup.position.y = 1.62;
    group.add(maskGroup);

    // Overhead Name + Seat + Chat Canvas Sprite
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 160;
    const labelCtx = labelCanvas.getContext("2d")!;
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const labelSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false })
    );
    labelSprite.position.set(0, 2.48, 0);
    labelSprite.scale.set(2.4, 0.75, 1);
    group.add(labelSprite);

    const rig: CharacterRig = {
      group,
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

    // Rebuild Hat
    rig.hatGroup.clear();
    const darkHatMat = new THREE.MeshStandardMaterial({ color: 0x1a1621, roughness: 0.7 });
    if (ch.hat === "fedora") {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 16), darkHatMat);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.24, 16), darkHatMat);
      crown.position.y = 0.12;
      rig.hatGroup.add(brim, crown);
    } else if (ch.hat === "crown") {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.22, 8), rig.accentMat);
      crown.position.y = 0.08;
      rig.hatGroup.add(crown);
    } else if (ch.hat === "hood") {
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.42, 12), rig.bodyMat);
      hood.position.set(0, 0.1, -0.04);
      rig.hatGroup.add(hood);
    } else if (ch.hat === "bun") {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), darkHatMat);
      bun.position.set(0, 0.06, -0.14);
      rig.hatGroup.add(bun);
    }

    // Rebuild Mask
    rig.maskGroup.clear();
    if (ch.mask === "domino") {
      const domino = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.12, 0.08),
        rig.accentMat
      );
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
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.07, 0.06),
        rig.accentMat
      );
      frame.position.set(0, 0.03, 0.23);
      rig.maskGroup.add(frame);
    } else if (ch.mask === "beard") {
      const beard = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.28, 10),
        new THREE.MeshStandardMaterial({ color: 0x7c7885, roughness: 0.85 })
      );
      beard.rotation.x = Math.PI;
      beard.position.set(0, -0.18, 0.16);
      rig.maskGroup.add(beard);
    }
  }

  private redrawCharacterLabel(rig: CharacterRig): void {
    const ctx = rig.labelCtx;
    ctx.clearRect(0, 0, 512, 160);

    // Chat bubble if present
    if (rig.lastChat) {
      ctx.fillStyle = "rgba(18, 14, 24, 0.92)";
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

    // Nameplate
    ctx.fillStyle = "rgba(10, 8, 14, 0.78)";
    ctx.strokeStyle = "rgba(212, 175, 55, 0.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(86, 84, 340, 56, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#e5c158";
    ctx.font = "bold 25px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(`#${rig.lastSeat} ${rig.lastName}`, 256, 120);

    rig.labelTexture.needsUpdate = true;
  }

  public updateCamera(playerX: number, playerZ: number, dt: number): void {
    // 360° KARAKTER İNCELEME MODU: Seçilen karakterin 3D modeline yumuşakça yakınlaş!
    if (this.inspectTargetId) {
      const rig = this.characterRigs.get(this.inspectTargetId);
      if (rig) {
        const focus = new THREE.Vector3(rig.group.position.x, 1.32, rig.group.position.z);
        this.cameraTarget.lerp(focus, Math.min(1, dt * 14));
        this.playerLanternLight.position.set(focus.x, 2.6, focus.z);

        const viewAngle = rig.group.rotation.y + this.inspectOrbitYaw;
        const dist = window.innerWidth < window.innerHeight ? 2.85 : 2.45;
        const desiredX = focus.x + Math.sin(viewAngle) * dist;
        const desiredZ = focus.z + Math.cos(viewAngle) * dist;
        this.camera.position.lerp(new THREE.Vector3(desiredX, 1.68, desiredZ), Math.min(1, dt * 12));
        this.camera.lookAt(this.cameraTarget);
        return;
      }
    }

    const target = new THREE.Vector3(playerX, 1.55, playerZ);
    this.cameraTarget.lerp(target, Math.min(1, dt * 14));
    this.playerLanternLight.position.set(this.cameraTarget.x, 2.8, this.cameraTarget.z);

    const isPortrait = window.innerWidth < window.innerHeight;
    const distance = isPortrait ? 5.3 : 4.6;
    const horizDist = distance * Math.cos(this.cameraPitch);
    const vertDist = distance * Math.sin(this.cameraPitch);

    let desiredX = this.cameraTarget.x + Math.sin(this.cameraYaw) * horizDist;
    let desiredZ = this.cameraTarget.z + Math.cos(this.cameraYaw) * horizDist;
    const desiredY = Math.max(1.2, this.cameraTarget.y + vertDist);

    // Keep camera inside castle outer bounds
    desiredX = Math.max(-27.2, Math.min(27.2, desiredX));
    desiredZ = Math.max(-31.2, Math.min(35.2, desiredZ));

    this.camera.position.set(desiredX, desiredY, desiredZ);
    this.camera.lookAt(this.cameraTarget);
  }

  public render(dt: number, elapsedTime: number): void {
    // Blackout sabotage or Ghost candle haunt effects
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
        c.light.color.setHex(this.ghostFlickerTimer > 0.1 ? 0x9ed4ff : 0xffae52);
      }
      if (this.ghostFlickerTimer === 0) {
        for (const c of this.candleLights) {
          c.light.color.setHex(0xffae52);
        }
      }
    } else {
      // Normal warm candle flicker
      for (const c of this.candleLights) {
        c.light.intensity =
          c.baseIntensity +
          Math.sin(elapsedTime * 7.5 + c.phase) * 0.18 +
          Math.cos(elapsedTime * 13.0 + c.phase) * 0.08;
      }
    }

    // Fireplace mode color & particles
    if (this.fireModeTimer > 0) {
      this.fireModeTimer -= dt;
      if (this.fireModeTimer <= 0) {
        this.fireMode = "normal";
      }
    }

    const coreMat = this.fireplaceCoreMesh.material as THREE.MeshBasicMaterial;
    const emberMat = this.emberPoints.material as THREE.PointsMaterial;
    if (this.fireMode === "red") {
      // HAIN burned -> Blood Crimson Flame!
      coreMat.color.setHex(0xff1426);
      emberMat.color.setHex(0xff2a3a);
      this.fireplaceLight.color.setHex(0xff1426);
      this.fireplaceLight.intensity = 5.4 + Math.sin(elapsedTime * 18) * 1.1;
      this.fireplaceCoreMesh.scale.set(1.45, 1.85 + Math.sin(elapsedTime * 16) * 0.25, 1.45);
    } else if (this.fireMode === "white") {
      // MISAFIR burned -> Spectral White-Blue Flame!
      coreMat.color.setHex(0xd8f0ff);
      emberMat.color.setHex(0x9ed4ff);
      this.fireplaceLight.color.setHex(0xbbe2ff);
      this.fireplaceLight.intensity = 4.8 + Math.sin(elapsedTime * 14) * 0.9;
      this.fireplaceCoreMesh.scale.set(1.3, 1.65 + Math.sin(elapsedTime * 12) * 0.2, 1.3);
    } else {
      coreMat.color.setHex(0xff6b1a);
      emberMat.color.setHex(0xff9b3d);
      this.fireplaceLight.color.setHex(0xff5e1a);
      this.fireplaceLight.intensity = 3.1 + Math.sin(elapsedTime * 9) * 0.4;
      this.fireplaceCoreMesh.scale.set(1.0, 1.0 + Math.sin(elapsedTime * 10) * 0.12, 1.0);
    }

    // Update rising fireplace embers
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

    // Smoothly rotate bedroom doors
    for (const [, entry] of this.doorPivots) {
      entry.pivot.rotation.y += (entry.targetAngle - entry.pivot.rotation.y) * Math.min(1, dt * 8);
    }

    // Slowly drift castle dust motes
    this.dustPoints.rotation.y = elapsedTime * 0.015;

    this.renderer.render(this.scene, this.camera);
  }
}
