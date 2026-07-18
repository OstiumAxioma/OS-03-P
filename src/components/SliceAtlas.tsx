"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { createMedicalVolume, createSliceTextureData, selectSliceIndices, toVtkImageData } from "@/lib/medicalVolume";
import { createSliceLayout, getSliceTarget, getSliceVisualState, type SliceTransform } from "@/lib/sliceMotion";

const SLICE_COUNT = 7;

type SliceGroup = THREE.Group & {
  userData: {
    base: SliceTransform;
    sliceIndex: number;
  };
};

export default function SliceAtlas() {
  const mountRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<number | null>(3);
  const [activeSlice, setActiveSlice] = useState<number | null>(3);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x53ffba);
    scene.fog = new THREE.Fog(0x53ffba, 13, 25);

    const camera = new THREE.OrthographicCamera(-6.7, 6.7, 4.7, -4.7, 0.1, 60);
    camera.position.set(8.8, 5.8, 11.5);
    camera.lookAt(0, 0.12, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xf3fff9, 0x164a3f, 2.15));

    const keyLight = new THREE.DirectionalLight(0xffffff, 5.5);
    keyLight.position.set(-4, 8, 9);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xbaffec, 4.2);
    rimLight.position.set(8, 1, -7);
    scene.add(rimLight);

    const volume = createMedicalVolume(104, 88, 56);
    const vtkImage = toVtkImageData(volume);
    const indices = selectSliceIndices(volume.dimensions[2], SLICE_COUNT);
    const layout = createSliceLayout(SLICE_COUNT, 0.62);
    const panelGroups: SliceGroup[] = [];
    const glassMaterials: THREE.MeshPhysicalMaterial[] = [];
    const imageMaterials: THREE.MeshStandardMaterial[] = [];
    const edgeMaterials: THREE.MeshPhysicalMaterial[] = [];
    const raycastTargets: THREE.Object3D[] = [];

    const ribPixels = new Uint8Array(128 * 4);
    for (let x = 0; x < 128; x += 1) {
      const stripe = 0.52 + Math.cos((x / 128) * Math.PI * 32) * 0.32;
      const hueShift = Math.sin((x / 128) * Math.PI * 6);
      ribPixels[x * 4] = Math.round(205 + stripe * 45 + Math.max(0, hueShift) * 5);
      ribPixels[x * 4 + 1] = Math.round(225 + stripe * 27);
      ribPixels[x * 4 + 2] = Math.round(220 + stripe * 25 + Math.max(0, -hueShift) * 10);
      ribPixels[x * 4 + 3] = 255;
    }
    const ribTexture = new THREE.DataTexture(ribPixels, 128, 1, THREE.RGBAFormat);
    ribTexture.colorSpace = THREE.SRGBColorSpace;
    ribTexture.wrapS = THREE.RepeatWrapping;
    ribTexture.repeat.set(1.6, 1);
    ribTexture.needsUpdate = true;

    indices.forEach((volumeSlice, sliceIndex) => {
      const textureData = createSliceTextureData(vtkImage, volumeSlice);
      const diffuseTexture = new THREE.DataTexture(
        textureData.diffuse,
        textureData.width,
        textureData.height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      );
      diffuseTexture.colorSpace = THREE.SRGBColorSpace;
      diffuseTexture.minFilter = THREE.LinearFilter;
      diffuseTexture.magFilter = THREE.LinearFilter;
      diffuseTexture.needsUpdate = true;

      const roughnessTexture = new THREE.DataTexture(
        textureData.roughness,
        textureData.width,
        textureData.height,
        THREE.RedFormat,
        THREE.UnsignedByteType
      );
      roughnessTexture.minFilter = THREE.LinearFilter;
      roughnessTexture.magFilter = THREE.LinearFilter;
      roughnessTexture.needsUpdate = true;

      const base = layout[sliceIndex];
      const initialVisual = getSliceVisualState(sliceIndex === activeRef.current);
      const group = new THREE.Group() as SliceGroup;
      group.position.set(base.x, base.y, base.z);
      group.rotation.y = base.rotationY;
      group.userData = { base, sliceIndex };

      const glassGeometry = new RoundedBoxGeometry(5.1, 3.95, 0.18, 7, 0.14);
      const glassMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xd9fff3,
        metalness: 0,
        roughness: 0.52,
        roughnessMap: roughnessTexture,
        transmission: 0.28,
        thickness: 1.1,
        ior: 1.46,
        transparent: true,
        opacity: initialVisual.glassOpacity,
        clearcoat: 0.62,
        clearcoatRoughness: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const glass = new THREE.Mesh(glassGeometry, glassMaterial);
      glass.castShadow = true;
      glass.receiveShadow = true;
      glass.userData.sliceIndex = sliceIndex;
      group.add(glass);
      glassMaterials.push(glassMaterial);

      const imageMaterial = new THREE.MeshStandardMaterial({
        map: diffuseTexture,
        roughnessMap: roughnessTexture,
        roughness: 0.7,
        metalness: 0,
        transparent: true,
        opacity: initialVisual.imageOpacity,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const imagePlane = new THREE.Mesh(new THREE.PlaneGeometry(4.72, 3.54), imageMaterial);
      imagePlane.position.z = 0.018;
      imagePlane.userData.sliceIndex = sliceIndex;
      group.add(imagePlane);
      imageMaterials.push(imageMaterial);

      const edgeMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xeafff8,
        map: ribTexture,
        roughness: 0.12,
        metalness: 0.02,
        transmission: 0.7,
        thickness: 0.8,
        ior: 1.5,
        transparent: true,
        opacity: initialVisual.edgeOpacity,
        iridescence: 0.62,
        iridescenceIOR: 1.27,
        iridescenceThicknessRange: [120, 610],
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        depthWrite: false
      });
      edgeMaterials.push(edgeMaterial);

      const horizontalEdgeGeometry = new RoundedBoxGeometry(5.14, 0.085, 0.27, 4, 0.04);
      const verticalEdgeGeometry = new RoundedBoxGeometry(0.085, 3.93, 0.27, 4, 0.04);
      const edgePositions: Array<[THREE.BufferGeometry, number, number]> = [
        [horizontalEdgeGeometry, 0, 1.945],
        [horizontalEdgeGeometry, 0, -1.945],
        [verticalEdgeGeometry, 2.555, 0],
        [verticalEdgeGeometry, -2.555, 0]
      ];
      edgePositions.forEach(([geometry, x, y]) => {
        const edge = new THREE.Mesh(geometry, edgeMaterial);
        edge.position.set(x, y, 0.015);
        edge.userData.sliceIndex = sliceIndex;
        group.add(edge);
      });

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(glassGeometry, 28),
        new THREE.LineBasicMaterial({ color: 0x103b34, transparent: true, opacity: 0.15 })
      );
      outline.userData.sliceIndex = sliceIndex;
      group.add(outline);

      group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          raycastTargets.push(object);
        }
      });
      panelGroups.push(group);
      scene.add(group);
    });

    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x176a57,
      transparent: true,
      opacity: 0.11,
      depthWrite: false
    });
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(4.3, 64), shadowMaterial);
    shadow.scale.set(1.65, 0.42, 1);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0.4, -2.34, 0.1);
    scene.add(shadow);

    const pointer = new THREE.Vector2(4, 4);
    const raycaster = new THREE.Raycaster();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(raycastTargets, false)[0];
      const next = typeof hit?.object.userData.sliceIndex === "number" ? hit.object.userData.sliceIndex : null;

      if (activeRef.current !== next) {
        activeRef.current = next;
        setActiveSlice(next);
      }
      mount.style.cursor = next === null ? "default" : "pointer";
    };

    const clearPointer = () => {
      activeRef.current = null;
      setActiveSlice(null);
      mount.style.cursor = "default";
    };

    const selectByKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const current = activeRef.current ?? Math.floor(SLICE_COUNT / 2);
      const next = Math.min(SLICE_COUNT - 1, Math.max(0, current + direction));
      activeRef.current = next;
      setActiveSlice(next);
    };

    renderer.domElement.addEventListener("pointermove", updatePointer);
    renderer.domElement.addEventListener("pointerdown", updatePointer);
    renderer.domElement.addEventListener("pointerleave", clearPointer);
    mount.addEventListener("keydown", selectByKeyboard);

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      const aspect = width / Math.max(height, 1);
      const vertical = aspect < 0.8 ? 6.4 : 4.7;
      camera.left = -vertical * aspect;
      camera.right = vertical * aspect;
      camera.top = vertical;
      camera.bottom = -vertical;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    const clock = new THREE.Clock();
    let frame = 0;
    let animationFrame = 0;
    const render = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      const damping = reducedMotion ? 30 : 7.8;

      panelGroups.forEach((group, index) => {
        const isActive = activeRef.current === index;
        const target = getSliceTarget(group.userData.base, isActive);
        const visual = getSliceVisualState(isActive);
        group.position.x = THREE.MathUtils.damp(group.position.x, target.x, damping, delta);
        group.position.y = THREE.MathUtils.damp(
          group.position.y,
          target.y + (isActive && !reducedMotion ? Math.sin(elapsed * 2.2) * 0.025 : 0),
          damping,
          delta
        );
        group.position.z = THREE.MathUtils.damp(group.position.z, target.z, damping, delta);
        group.rotation.y = THREE.MathUtils.damp(group.rotation.y, target.rotationY, damping, delta);
        const scaleTarget = isActive ? 1.018 : 1;
        const scale = THREE.MathUtils.damp(group.scale.x, scaleTarget, damping, delta);
        group.scale.setScalar(scale);
        imageMaterials[index].opacity = THREE.MathUtils.damp(imageMaterials[index].opacity, visual.imageOpacity, 6.4, delta);
        glassMaterials[index].opacity = THREE.MathUtils.damp(glassMaterials[index].opacity, visual.glassOpacity, 6.4, delta);
        edgeMaterials[index].opacity = THREE.MathUtils.damp(edgeMaterials[index].opacity, visual.edgeOpacity, 6.4, delta);
      });

      frame += 1;
      ribTexture.offset.x = frame * 0.00016;
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };

    setReady(true);
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", updatePointer);
      renderer.domElement.removeEventListener("pointerdown", updatePointer);
      renderer.domElement.removeEventListener("pointerleave", clearPointer);
      mount.removeEventListener("keydown", selectByKeyboard);
      panelGroups.forEach((group) => {
        group.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          }
        });
      });
      ribTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const displaySlice = activeSlice === null ? "—" : String(activeSlice + 1).padStart(2, "0");
  const progress = activeSlice === null ? 50 : ((activeSlice + 1) / SLICE_COUNT) * 100;

  return (
    <main className="atlas-shell">
      <header className="atlas-header">
        <a className="brand" href="#viewer" aria-label="Lumen medical slice atlas">
          <span className="brand-mark" aria-hidden="true" />
          <span>LUMEN</span>
        </a>
        <div className="study-meta">
          <span>AXIAL / CT</span>
          <span>SYNTHETIC STUDY · 2026</span>
        </div>
      </header>

      <section className="viewer-copy" aria-labelledby="atlas-title">
        <p className="eyebrow">VOLUMETRIC STUDY 01</p>
        <h1 id="atlas-title">
          Tissue,
          <br />in layers.
        </h1>
        <p className="intro">将体数据拆成可触摸的玻璃层片。移动指针，抽出一层观察。</p>
      </section>

      <div
        id="viewer"
        ref={mountRef}
        className={`webgl-stage${ready ? " is-ready" : ""}`}
        tabIndex={0}
        role="application"
        aria-label="三维医学切片查看器。使用鼠标悬停，或用左右方向键选择切片。"
      >
        <span className="loading-label">ASSEMBLING VOLUME</span>
      </div>

      <aside className="slice-readout" aria-live="polite">
        <span className="readout-label">ACTIVE PLANE</span>
        <span className="readout-number">{displaySlice}</span>
        <span className="readout-total">/ {String(SLICE_COUNT).padStart(2, "0")}</span>
      </aside>

      <footer className="atlas-footer">
        <div className="interaction-hint">
          <span className="cursor-icon" aria-hidden="true" />
          HOVER TO ISOLATE · ARROW KEYS TO STEP
        </div>
        <div className="slice-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="engine-label">VTK.JS × THREE.JS</span>
      </footer>
    </main>
  );
}
