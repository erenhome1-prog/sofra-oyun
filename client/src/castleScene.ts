import * as THREE from "three";
import {
  CASTLE_WALLS,
  DOORS,
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
  private fireplaceLight!: THREE.PointLight;
  private fireplaceCoreMesh!: THREE.Mesh;
  private emberPoints!: THREE.Points;
  private emberVelocities: number[] = [];
  private fireMode: "normal" | "red" | "white" = "normal";
  private fireModeTimer = 0;

  private dustPoints!: THREE.Points;
  private doorPivots = new Map<string, { pivot: THREE.Group; targetAngle: number; closedAngle: number }>();
  private plateMeshes = new Map<number, THREE.Mesh>();
  private characterRigs = new Map<string, CharacterRig>();

  // Camera state
  public cameraYaw = 0;
  public cameraPitch = 0.35;
  private cameraTarget = new THREE.Vector3(0, 1.5, 0);

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060508);
    this.scene.fog = new THREE.FogExp2(0x060508, 0.024);

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
    this.renderer.toneMappingExposure = 1.15;

    container.innerHTML = "";
    container.appendChild(this.renderer.domElement);

    this.buildLighting();
    this.buildCastleArchitecture();
    this.buildRoundTableAndChairs();
    this.buildFireplaceAndEmbers();
    this.buildAtmosphereDust();
    this.onResize();

    window.addEventListener("resize", () => this.onResize());
  }

  private onResize(): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? 76 : 62;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private buildLighting(): void {
    const hemi = new THREE.HemisphereLight(0x28324e, 0x160f0c, 0.65);
    this.scene.add(hemi);

    const moonLight = new THREE.DirectionalLight(0x6e85b7, 0.7);
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

    // Chandelier above Round Table
    const tableLight = new THREE.PointLight(0xffaa4c, 2.8, 22, 1.4);
    tableLight.position.set(0, 5.2, 0);
    tableLight.castShadow = true;
    this.scene.add(tableLight);
    this.candleLights.push({ light: tableLight, baseIntensity: 2.8, phase: 0.2 });

    // Room ambient candles
    const candleSpots: [number, number, number, number][] = [
      [0, 3.6, 17, 1.6],     // Antre
      [-15, 3.6, 0, 1.4],    // Kütüphane
      [15, 3.6, 0, 1.4],     // Mutfak
      [0, 3.6, -15, 1.3],    // Kuzey Koridoru
      [0, 4.2, -25, 1.6],    // Saat Kulesi
      [-13, 3.2, -12, 1.0],  // Yatak 1
      [-13, 3.2, -20, 1.0],  // Yatak 2
      [13, 3.2, -12, 1.0],   // Yatak 3
      [13, 3.2, -20, 1.0]    // Yatak 4
    ];
    candleSpots.forEach(([x, y, z, intensity], idx) => {
      const pLight = new THREE.PointLight(0xff9d42, intensity, 14, 1.6);
      pLight.position.set(x, y, z);
      this.scene.add(pLight);
      this.candleLights.push({ light: pLight, baseIntensity: intensity, phase: idx * 1.37 });
    });
  }

  private buildCastleArchitecture(): void {
    // Main Stone Floor
    const floorGeo = new THREE.PlaneGeometry(64, 76, 16, 16);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x18151c,
      roughness: 0.88,
      metalness: 0.12
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
      const rugMat = new THREE.MeshStandardMaterial({
        color: isMain ? 0x3b1116 : 0x221c26,
        roughness: 0.92
      });
      const rug = new THREE.Mesh(rugGeo, rugMat);
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(cx, 0.015, cz);
      rug.receiveShadow = true;
      this.scene.add(rug);
    }

    // Castle Stone Walls from shared CASTLE_WALLS
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x231f29,
      roughness: 0.85,
      metalness: 0.15
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x3a2e25,
      roughness: 0.7
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
      const trimGeo = new THREE.BoxGeometry(sx + 0.06, 0.25, sz + 0.06);
      const trim = new THREE.Mesh(trimGeo, trimMat);
      trim.position.set(cx, 0.125, cz);
      this.scene.add(trim);
    }

    // Interactive Bedroom Doors
    const doorWoodMat = new THREE.MeshStandardMaterial({
      color: 0x4b2816,
      roughness: 0.72,
      metalness: 0.1
    });
    const doorIronMat = new THREE.MeshStandardMaterial({
      color: 0xc9a24b,
      roughness: 0.35,
      metalness: 0.85
    });

    for (const door of DOORS) {
      const pivot = new THREE.Group();
      pivot.position.set(door.x, 0, door.z);

      const leafGroup = new THREE.Group();
      const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.4, 0.16), doorWoodMat);
      doorMesh.position.set(0, 1.7, 0);
      doorMesh.castShadow = true;
      leafGroup.add(doorMesh);

      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), doorIronMat);
      handle.position.set(0.65, 1.6, 0.12);
      leafGroup.add(handle);

      pivot.add(leafGroup);
      const closedAngle = Math.PI / 2;
      pivot.rotation.y = closedAngle;
      this.scene.add(pivot);

      this.doorPivots.set(door.id, {
        pivot,
        targetAngle: closedAngle,
        closedAngle
      });
    }

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

    // 11 Chairs around Round Table (#1..#10 Players, #11 Kâhya's Empty Throne)
    const chairWoodMat = new THREE.MeshStandardMaterial({ color: 0x381c11, roughness: 0.65 });
    const kahyaThroneMat = new THREE.MeshStandardMaterial({ color: 0x6b1218, roughness: 0.45, metalness: 0.25 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xe6dec8, roughness: 0.3, metalness: 0.1 });

    for (let seat = 1; seat <= 11; seat++) {
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

      // Porcelain Plate & Goblet on the table in front of each seat
      const angle = ((seat - 1) / 11) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(angle) * 2.55;
      const pz = Math.sin(angle) * 2.55;

      const plate = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.18, 0.045, 20),
        isKahya ? ringMat : plateMat
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
    for (const [, plate] of this.plateMeshes) {
      plate.rotation.x = 0;
    }

    for (const ch of characters) {
      activeIds.add(ch.sessionId);

      // Invert plate on the table if this seat was eliminated
      if (!ch.alive && this.plateMeshes.has(ch.seat)) {
        const plate = this.plateMeshes.get(ch.seat)!;
        plate.rotation.x = Math.PI;
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
    const target = new THREE.Vector3(playerX, 1.55, playerZ);
    this.cameraTarget.lerp(target, Math.min(1, dt * 14));

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
    // Flicker candles
    for (const c of this.candleLights) {
      c.light.intensity =
        c.baseIntensity +
        Math.sin(elapsedTime * 7.5 + c.phase) * 0.18 +
        Math.cos(elapsedTime * 13.0 + c.phase) * 0.08;
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
