import * as THREE from 'three';
import type { HeistState } from '@blackout/shared';
import { GUARD } from '@blackout/shared';

/**
 * Top-down 3D renderer (orthographic camera) for low-poly stylized look.
 * Maintains a 1:1 visual map between Colyseus state and Three.js objects.
 */
export class Renderer {
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;

  private floor!: THREE.Mesh;
  private wallGroup = new THREE.Group();
  private doorMeshes = new Map<string, THREE.Object3D>();
  private playerMeshes = new Map<string, THREE.Object3D>();
  private guardMeshes = new Map<string, THREE.Object3D>();
  private guardCones = new Map<string, THREE.Mesh>();
  private lootMeshes = new Map<string, THREE.Object3D>();
  private extractionMeshes = new Map<string, THREE.Object3D>();
  private localPlayerId: string | null = null;
  private alarmTint = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x07090d);

    const aspect = window.innerWidth / window.innerHeight;
    const viewSize = 24;
    this.camera = new THREE.OrthographicCamera(-viewSize * aspect, viewSize * aspect, viewSize, -viewSize, 0.1, 200);
    this.camera.position.set(0, 60, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0x4a5360, 0.7);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(20, 60, 10);
    this.scene.add(dir);

    this.scene.add(this.wallGroup);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setLocalPlayerId(id: string) { this.localPlayerId = id; }

  /** Build static geometry (floor + walls) when the room map is first received. */
  buildStatic(state: HeistState) {
    // Floor
    if (this.floor) this.scene.remove(this.floor);
    const fw = state.mapData.width, fh = state.mapData.height;
    const floorGeo = new THREE.PlaneGeometry(fw, fh);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.9 });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(fw / 2, 0, fh / 2);
    this.scene.add(this.floor);

    // Grid lines for atmosphere
    const grid = new THREE.GridHelper(Math.max(fw, fh), Math.max(fw, fh) / 2, 0x1f242d, 0x1a1f29);
    grid.position.set(fw / 2, 0.01, fh / 2);
    this.scene.add(grid);

    // Walls
    this.wallGroup.clear();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a313d, roughness: 0.8 });
    state.mapData.walls.forEach((w) => {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) return;
      const geo = new THREE.BoxGeometry(len, 1.4, 0.15);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set((w.x1 + w.x2) / 2, 0.7, (w.y1 + w.y2) / 2);
      mesh.rotation.y = -Math.atan2(dy, dx);
      this.wallGroup.add(mesh);
    });
  }

  rebuildDoors(state: HeistState) {
    // Doors handled dynamically each frame in update().
    state.doors.forEach((d) => {
      if (this.doorMeshes.has(d.id)) return;
      const geo = new THREE.BoxGeometry(1.8, 1.2, 0.12);
      const mat = new THREE.MeshStandardMaterial({ color: d.requiresKeycard ? 0xa55a2b : 0x4f5d72 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(d.x, 0.6, d.y);
      mesh.rotation.y = -d.angle;
      this.scene.add(mesh);
      this.doorMeshes.set(d.id, mesh);
    });
  }

  rebuildExtraction(state: HeistState) {
    state.extractionZones.forEach((z) => {
      if (this.extractionMeshes.has(z.id)) return;
      const ringGeo = new THREE.RingGeometry(z.radius - 0.1, z.radius, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x36e2c2, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(z.x, 0.02, z.y);
      this.scene.add(ring);
      const fillGeo = new THREE.CircleGeometry(z.radius, 48);
      const fillMat = new THREE.MeshBasicMaterial({ color: 0x36e2c2, transparent: true, opacity: 0.08 });
      const fill = new THREE.Mesh(fillGeo, fillMat);
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(z.x, 0.015, z.y);
      this.scene.add(fill);
      const group = new THREE.Group();
      group.add(ring); group.add(fill);
      this.extractionMeshes.set(z.id, group);
    });
  }

  update(state: HeistState, _alpha = 1) {
    this.rebuildDoors(state);
    this.rebuildExtraction(state);
    this.updateDoors(state);
    this.updatePlayers(state);
    this.updateGuards(state);
    this.updateLoot(state);
    this.updateCamera(state);
    this.updateAlarm(state);
  }

  private updateDoors(state: HeistState) {
    state.doors.forEach((d) => {
      const mesh = this.doorMeshes.get(d.id);
      if (!mesh) return;
      // Visual cue: rotate door open by 80deg pivoted near its end.
      const openAngle = d.open ? Math.PI * 0.45 : 0;
      mesh.rotation.y = -d.angle + (d.open ? openAngle : 0);
      mesh.position.y = d.open ? 0.4 : 0.6;
      (mesh as THREE.Mesh).material = new THREE.MeshStandardMaterial({
        color: d.locked ? 0xa55a2b : d.open ? 0x2a3a4a : 0x4f5d72,
      });
    });
  }

  private updatePlayers(state: HeistState) {
    const seen = new Set<string>();
    state.players.forEach((p) => {
      seen.add(p.id);
      let mesh = this.playerMeshes.get(p.id);
      if (!mesh) {
        mesh = this.createPlayerMesh(p.id === this.localPlayerId);
        this.scene.add(mesh);
        this.playerMeshes.set(p.id, mesh);
      }
      // Smooth via lerp for visual stability between snapshots.
      mesh.position.x += (p.x - mesh.position.x) * 0.35;
      mesh.position.z += (p.y - mesh.position.z) * 0.35;
      mesh.position.y = 0.45;
      const angle = Math.atan2(p.dirX, p.dirY);
      mesh.rotation.y = angle;

      // Tint by state
      const body = mesh.getObjectByName('body') as THREE.Mesh | undefined;
      if (body) {
        const mat = body.material as THREE.MeshStandardMaterial;
        if (p.state === 'down') mat.color.setHex(0x844a2b);
        else if (p.state === 'dead') mat.color.setHex(0x1c1f25);
        else if (p.state === 'extracted') mat.color.setHex(0x36e2c2);
        else mat.color.setHex(p.id === this.localPlayerId ? 0x36e2c2 : 0xf5b042);
      }
      mesh.visible = p.connected;
    });
    for (const [id, mesh] of this.playerMeshes) {
      if (!seen.has(id)) { this.scene.remove(mesh); this.playerMeshes.delete(id); }
    }
  }

  private updateGuards(state: HeistState) {
    const seen = new Set<string>();
    state.guards.forEach((g) => {
      seen.add(g.id);
      let mesh = this.guardMeshes.get(g.id);
      let cone = this.guardCones.get(g.id);
      if (!mesh) {
        mesh = this.createGuardMesh();
        this.scene.add(mesh);
        this.guardMeshes.set(g.id, mesh);
        cone = this.createVisionCone();
        this.scene.add(cone);
        this.guardCones.set(g.id, cone);
      }
      mesh.position.x += (g.x - mesh.position.x) * 0.35;
      mesh.position.z += (g.y - mesh.position.z) * 0.35;
      mesh.position.y = 0.45;
      mesh.rotation.y = Math.atan2(g.dirX, g.dirY);
      const body = mesh.getObjectByName('body') as THREE.Mesh;
      const mat = body.material as THREE.MeshStandardMaterial;
      if (g.state === 'chase' || g.state === 'attack') mat.color.setHex(0xff4d6a);
      else if (g.state === 'investigate') mat.color.setHex(0xf5b042);
      else if (g.state === 'dead') mat.color.setHex(0x1c1f25);
      else mat.color.setHex(0x8a93a3);

      if (cone) {
        cone.position.copy(mesh.position);
        cone.rotation.y = mesh.rotation.y;
        const coneMat = cone.material as THREE.MeshBasicMaterial;
        if (g.state === 'chase' || g.state === 'attack') coneMat.color.setHex(0xff4d6a);
        else if (g.state === 'investigate') coneMat.color.setHex(0xf5b042);
        else coneMat.color.setHex(0x36e2c2);
        coneMat.opacity = 0.08 + (g.alertLevel / 100) * 0.22;
        cone.visible = g.state !== 'dead';
      }
    });
    for (const [id, mesh] of this.guardMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        const c = this.guardCones.get(id); if (c) { this.scene.remove(c); this.guardCones.delete(id); }
        this.guardMeshes.delete(id);
      }
    }
  }

  private updateLoot(state: HeistState) {
    const seen = new Set<string>();
    state.loot.forEach((l) => {
      seen.add(l.id);
      let mesh = this.lootMeshes.get(l.id);
      if (!mesh) {
        mesh = this.createLootMesh(l.id.startsWith('kc_'));
        this.scene.add(mesh);
        this.lootMeshes.set(l.id, mesh);
      }
      if (l.collected) { mesh.visible = false; return; }
      if (l.carrierId) {
        // Hide world loot when carried (carrier mesh has its own indicator).
        mesh.visible = false;
      } else {
        mesh.visible = true;
        mesh.position.set(l.x, 0.4, l.y);
        mesh.rotation.y += 0.03;
      }
    });
    for (const [id, mesh] of this.lootMeshes) {
      if (!seen.has(id)) { this.scene.remove(mesh); this.lootMeshes.delete(id); }
    }
  }

  private updateCamera(state: HeistState) {
    const me = this.localPlayerId ? state.players.get(this.localPlayerId) : null;
    if (me) {
      const tx = me.x;
      const tz = me.y;
      this.camera.position.x += (tx - this.camera.position.x) * 0.12;
      this.camera.position.z += (tz - this.camera.position.z) * 0.12;
      this.camera.lookAt(this.camera.position.x, 0, this.camera.position.z);
    }
  }

  private updateAlarm(state: HeistState) {
    const target = state.alarmActive ? 1 : 0;
    this.alarmTint += (target - this.alarmTint) * 0.1;
    const r = 7 / 255 + this.alarmTint * 0.2;
    const g = 9 / 255;
    const b = 13 / 255;
    this.renderer.setClearColor(new THREE.Color(r, g, b));
  }

  private createPlayerMesh(isLocal: boolean): THREE.Object3D {
    const group = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.9, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: isLocal ? 0x36e2c2 : 0xf5b042 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.name = 'body';
    group.add(body);
    // Direction indicator
    const armGeo = new THREE.BoxGeometry(0.15, 0.15, 0.7);
    const arm = new THREE.Mesh(armGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
    arm.position.set(0, 0.1, 0.45);
    group.add(arm);
    return group;
  }

  private createGuardMesh(): THREE.Object3D {
    const group = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.0, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a93a3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.name = 'body';
    group.add(body);
    const armGeo = new THREE.BoxGeometry(0.2, 0.2, 0.8);
    const arm = new THREE.Mesh(armGeo, new THREE.MeshStandardMaterial({ color: 0x1c1f25 }));
    arm.position.set(0, 0.05, 0.5);
    group.add(arm);
    return group;
  }

  private createVisionCone(): THREE.Mesh {
    const halfFov = (GUARD.VISION_FOV_DEG * Math.PI / 180) / 2;
    const range = GUARD.VISION_RANGE;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    const segments = 12;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = -halfFov + t * (halfFov * 2);
      const x = Math.sin(angle) * range;
      const y = Math.cos(angle) * range;
      shape.lineTo(x, y);
    }
    shape.lineTo(0, 0);
    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshBasicMaterial({ color: 0x36e2c2, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    return mesh;
  }

  private createLootMesh(isKeycard: boolean): THREE.Object3D {
    const geo = isKeycard
      ? new THREE.BoxGeometry(0.4, 0.08, 0.6)
      : new THREE.IcosahedronGeometry(0.35, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: isKeycard ? 0xf5b042 : 0xfff066,
      emissive: isKeycard ? 0x553c10 : 0x4a4400,
      emissiveIntensity: 0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.4;
    return mesh;
  }

  /** Convert a screen pixel coordinate to world XZ plane. */
  screenToWorld(x: number, y: number): { x: number; y: number } {
    const ndcX = (x / window.innerWidth) * 2 - 1;
    const ndcY = -(y / window.innerHeight) * 2 + 1;
    const ray = new THREE.Vector3(ndcX, ndcY, 0).unproject(this.camera);
    const dir = new THREE.Vector3(0, -1, 0);
    // For ortho cam: ray origin is at the unprojected point with cam direction.
    const camDir = new THREE.Vector3(); this.camera.getWorldDirection(camDir);
    // Solve for intersection with y=0 plane
    const t = -ray.y / camDir.y;
    const hit = ray.clone().add(camDir.multiplyScalar(t));
    return { x: hit.x, y: hit.z };
  }

  render() { this.renderer.render(this.scene, this.camera); }

  resize() {
    const aspect = window.innerWidth / window.innerHeight;
    const viewSize = 18;
    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
}
