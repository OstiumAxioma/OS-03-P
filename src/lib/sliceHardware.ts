import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Reference assembly in a 5 × 3.7 × 0.32 envelope, centered on the slice. */
export async function loadSliceHardware(): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().loadAsync("/assets/slice-hardware.glb");
  const hardware = new THREE.Group();
  hardware.name = "Slice cassette / reference hardware without optical coils";
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.material as THREE.MeshStandardMaterial;
    const part = object.userData.assemblyPart as string;
    const name = source.name.replace(/\.\d+$/, "");
    // The medical tissue replaces both optical assemblies and the cover.
    if (part.startsWith("optical-") || name === "Frosted_Polymer") return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld).translate(0, -1.85, 0);
    const material = new THREE.MeshPhysicalNodeMaterial({
      color: source.color,
      metalness: source.metalness,
      roughness: source.roughness,
      envMapIntensity: 1.1
    });
    if (part === "carrier" || part === "substrate") {
      material.color.set("#e9e3da");
      material.transmission = 0.65;
      material.opacity = part === "substrate" ? 0.12 : 0.38;
      material.transparent = true;
      material.depthWrite = false;
      material.thickness = 0.03;
      material.roughness = 0.32;
    }
    if (name === "Amber_Lightguide") {
      material.color.set("#c6ac79");
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -2;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = object.name;
    mesh.receiveShadow = true;
    hardware.add(mesh);
  });
  // Release the loader's originals. All retained geometry is baked and copied.
  const sourceMaterials = new Set<THREE.Material>();
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => sourceMaterials.add(m));
  });
  sourceMaterials.forEach((m) => m.dispose());

  const titanium = new THREE.MeshPhysicalNodeMaterial({
    color: "#9da2a2", metalness: 0.88, roughness: 0.24, clearcoat: 0.3
  });
  const pillarGeometry = new THREE.CylinderGeometry(0.052, 0.052, 0.27, 20).rotateX(Math.PI / 2);
  for (const x of [-2.34, 2.34]) {
    for (const y of [-1.68, 1.68]) {
      const pillar = new THREE.Mesh(pillarGeometry, titanium);
      pillar.name = "Titanium corner pillar";
      pillar.position.set(x, y, 0.045);
      hardware.add(pillar);
    }
  }

  // The narrow left-hand board leaves the central medical image unobstructed.
  const boardMaterial = new THREE.MeshStandardNodeMaterial({ color: "#aaa58c", roughness: 0.64, metalness: 0.18 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.32, 0.024), boardMaterial);
  board.name = "Left circuit board";
  board.position.set(-2.05, -0.15, 0.09);
  hardware.add(board);
  const traces = new THREE.MeshStandardNodeMaterial({ color: "#d1bb85", roughness: 0.34, metalness: 0.72 });
  const chipMaterial = new THREE.MeshStandardNodeMaterial({ color: "#55584f", roughness: 0.66, metalness: 0.16 });
  const addBox = (name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    hardware.add(mesh);
  };
  for (let i = 0; i < 4; i++) {
    addBox("Circuit trace", [0.009, 2.12, 0.004], [-2.18 + i * 0.08, -0.15, 0.105], traces);
  }
  for (let i = 0; i < 5; i++) {
    const y = -0.97 + i * 0.42;
    addBox("Board microchip", [0.14, 0.18, 0.028], [-2.05, y, 0.12], chipMaterial);
    for (const side of [-1, 1]) {
      for (let pin = 0; pin < 4; pin++) {
        addBox("Board solder contact", [0.055, 0.012, 0.012], [-2.05 + side * 0.09, y - 0.06 + pin * 0.04, 0.118], titanium);
      }
    }
  }
  // Batch repeated pins/traces/pillars once; every slice shares these buffers.
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  hardware.children.forEach((object) => {
    const mesh = object as THREE.Mesh;
    const material = mesh.material as THREE.Material;
    const batch = batches.get(material) ?? [];
    batch.push(mesh);
    batches.set(material, batch);
  });
  for (const [material, meshes] of batches) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      return mesh.geometry.clone().applyMatrix4(mesh.matrix);
    });
    const geometry = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!geometry) continue;
    new Set(meshes.map((m) => m.geometry)).forEach((g) => g.dispose());
    meshes.forEach((m) => hardware.remove(m));
    const merged = new THREE.Mesh(geometry, material);
    merged.name = meshes[0].name;
    merged.receiveShadow = true;
    hardware.add(merged);
  }
  return hardware;
}

export function disposeHardware(hardware: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  hardware.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m));
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

export function createSliceLabel(index: number): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#eae6dc";
    ctx.fillRect(0, 0, 512, 192);
    ctx.fillStyle = "#20211f";
    ctx.fillRect(18, 16, 476, 3);
    ctx.font = "600 30px Arial";
    ctx.fillText("OS-03-P / TISSUE ARCHIVE", 18, 56);
    ctx.font = "18px Arial";
    ctx.fillText("VOLUMETRIC STUDY", 18, 88);
    ctx.font = "52px Arial";
    ctx.fillText(`S-${String(index + 1).padStart(3, "0")}`, 18, 153);
    ctx.fillRect(18, 176, 476, 2);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.99, 0.41), new THREE.MeshBasicNodeMaterial({ map }));
  label.name = "Slice identity label";
  label.position.set(-1.36, 1.19, 0.224);
  return label;
}
