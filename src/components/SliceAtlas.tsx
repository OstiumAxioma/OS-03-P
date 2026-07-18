"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { decodeBase64Bytes } from "@/lib/studyClient";
import type { StudyErrorPayload, StudyKind, StudyPayload } from "@/lib/studyTypes";
import { createSliceLayout, getSliceTarget, getSliceVisualState, type SliceTransform } from "@/lib/sliceMotion";

const PLACEHOLDER_SLICE_COUNT = 7;

type UploadPhase = "idle" | "uploading" | "processing" | "ready" | "error";

type SliceGroup = THREE.Group & {
  userData: {
    base: SliceTransform;
    sliceIndex: number;
  };
};

function createAxisLabel(text: string, position: THREE.Vector3): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#061f18";
    context.font = "700 26px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(0.64, 0.32, 1);
  return sprite;
}

export default function SliceAtlas() {
  const mountRef = useRef<HTMLDivElement>(null);
  const dicomInputRef = useRef<HTMLInputElement>(null);
  const niftiInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const activeRef = useRef<number | null>(null);
  const [activeSlice, setActiveSlice] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [study, setStudy] = useState<StudyPayload | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState("选择服务器要处理的医学影像。");

  useEffect(() => () => xhrRef.current?.abort(), []);

  const uploadStudy = (kind: StudyKind, selected: FileList | null) => {
    const files = selected ? Array.from(selected) : [];
    if (files.length === 0) return;

    xhrRef.current?.abort();
    const request = new XMLHttpRequest();
    const formData = new FormData();
    formData.set("kind", kind);
    files.forEach((file) => formData.append("files", file));
    xhrRef.current = request;
    setUploadPhase("uploading");
    setUploadProgress(0);
    setUploadMessage("正在上传到处理服务器…");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.upload.onload = () => {
      setUploadPhase("processing");
      setUploadProgress(100);
      setUploadMessage("服务器正在解析并生成玻璃切片纹理…");
    };
    request.onerror = () => {
      setUploadPhase("error");
      setUploadMessage("网络连接失败，影像未完成处理。");
    };
    request.onload = () => {
      try {
        const body = JSON.parse(request.responseText) as StudyPayload | StudyErrorPayload;
        if (request.status < 200 || request.status >= 300 || "code" in body) {
          const error = body as StudyErrorPayload;
          setUploadPhase("error");
          setUploadMessage(error.message || "服务器无法解析该影像。");
          return;
        }
        const payload = body as StudyPayload;
        setStudy(payload);
        setUploadPhase("ready");
        setUploadMessage(`已生成 ${payload.slices.length} 层纹理，原始上传文件已从临时目录删除。`);
      } catch {
        setUploadPhase("error");
        setUploadMessage("服务器返回了无法识别的响应。");
      }
    };
    request.open("POST", "/api/studies");
    request.send(formData);
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    setReady(false);
    const sliceCount = study?.slices.length || PLACEHOLDER_SLICE_COUNT;
    const initialActive = study ? Math.floor(sliceCount / 2) : null;
    activeRef.current = initialActive;
    setActiveSlice(initialActive);

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
    renderer.autoClear = false;
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

    const axisScene = new THREE.Scene();
    const axisCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    axisCamera.position.copy(camera.position).normalize().multiplyScalar(4.2);
    axisCamera.lookAt(0, 0, 0);
    const axisColor = 0x061f18;
    const origin = new THREE.Vector3(-0.25, -0.25, -0.25);
    const axes: Array<[THREE.Vector3, string]> = [
      [new THREE.Vector3(1, 0, 0), "X"],
      [new THREE.Vector3(0, 1, 0), "Y"],
      [new THREE.Vector3(0, 0, 1), "Z+"]
    ];
    axes.forEach(([direction, label]) => {
      const arrow = new THREE.ArrowHelper(direction, origin, 1.18, axisColor, 0.2, 0.13);
      arrow.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            material.depthTest = false;
            material.depthWrite = false;
          });
        }
      });
      axisScene.add(arrow);
      axisScene.add(createAxisLabel(label, origin.clone().add(direction.clone().multiplyScalar(1.42))));
    });

    const layout = createSliceLayout(sliceCount, 0.62);
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

    layout.forEach((base, sliceIndex) => {
      const payload = study?.slices[sliceIndex];
      const diffuseBytes = payload ? decodeBase64Bytes(payload.diffuseBase64) : new Uint8Array([224, 255, 244, 0]);
      const roughnessBytes = payload ? decodeBase64Bytes(payload.roughnessBase64) : new Uint8Array([232]);
      const textureWidth = payload?.width ?? 1;
      const textureHeight = payload?.height ?? 1;
      const diffuseTexture = new THREE.DataTexture(
        diffuseBytes,
        textureWidth,
        textureHeight,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      );
      diffuseTexture.colorSpace = THREE.SRGBColorSpace;
      diffuseTexture.minFilter = THREE.LinearFilter;
      diffuseTexture.magFilter = THREE.LinearFilter;
      diffuseTexture.needsUpdate = true;

      const roughnessTexture = new THREE.DataTexture(
        roughnessBytes,
        textureWidth,
        textureHeight,
        THREE.RedFormat,
        THREE.UnsignedByteType
      );
      roughnessTexture.minFilter = THREE.LinearFilter;
      roughnessTexture.magFilter = THREE.LinearFilter;
      roughnessTexture.needsUpdate = true;

      const initialVisual = getSliceVisualState(sliceIndex === initialActive);
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
        opacity: payload ? initialVisual.imageOpacity : 0,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const availableWidth = 4.72;
      const availableHeight = 3.54;
      const aspect = textureWidth / textureHeight;
      const planeWidth = aspect > availableWidth / availableHeight ? availableWidth : availableHeight * aspect;
      const planeHeight = aspect > availableWidth / availableHeight ? availableWidth / aspect : availableHeight;
      const imagePlane = new THREE.Mesh(new THREE.PlaneGeometry(planeWidth, planeHeight), imageMaterial);
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

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(4.3, 64),
      new THREE.MeshBasicMaterial({ color: 0x176a57, transparent: true, opacity: 0.11, depthWrite: false })
    );
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
      const next = study && typeof hit?.object.userData.sliceIndex === "number" ? hit.object.userData.sliceIndex : null;

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
      if (!study || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const current = activeRef.current ?? Math.floor(sliceCount / 2);
      const next = Math.min(sliceCount - 1, Math.max(0, current + direction));
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
        const lateralWave = isActive && !reducedMotion ? Math.sin(elapsed * 2.2) * 0.025 : 0;
        group.position.x = THREE.MathUtils.damp(group.position.x, target.x + lateralWave, damping, delta);
        group.position.y = THREE.MathUtils.damp(group.position.y, target.y, damping, delta);
        group.position.z = THREE.MathUtils.damp(group.position.z, target.z, damping, delta);
        group.rotation.y = THREE.MathUtils.damp(group.rotation.y, target.rotationY, damping, delta);
        const scaleTarget = isActive ? 1.018 : 1;
        const scale = THREE.MathUtils.damp(group.scale.x, scaleTarget, damping, delta);
        group.scale.setScalar(scale);
        imageMaterials[index].opacity = THREE.MathUtils.damp(
          imageMaterials[index].opacity,
          study ? visual.imageOpacity : 0,
          6.4,
          delta
        );
        glassMaterials[index].opacity = THREE.MathUtils.damp(glassMaterials[index].opacity, visual.glassOpacity, 6.4, delta);
        edgeMaterials[index].opacity = THREE.MathUtils.damp(edgeMaterials[index].opacity, visual.edgeOpacity, 6.4, delta);
      });

      frame += 1;
      ribTexture.offset.x = frame * 0.00016;
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.clearDepth();
      const axisSize = Math.round(THREE.MathUtils.clamp(width * 0.105, 88, 116));
      renderer.setViewport(width - axisSize - 26, 76, axisSize, axisSize);
      renderer.setScissor(width - axisSize - 26, 76, axisSize, axisSize);
      renderer.setScissorTest(true);
      renderer.render(axisScene, axisCamera);
      renderer.setScissorTest(false);
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
      [scene, axisScene].forEach((targetScene) => {
        targetScene.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          }
          if (object instanceof THREE.Sprite) {
            object.material.map?.dispose();
            object.material.dispose();
          }
        });
      });
      ribTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [study]);

  const sliceCount = study?.slices.length || PLACEHOLDER_SLICE_COUNT;
  const displaySlice = activeSlice === null ? "—" : String(activeSlice + 1).padStart(2, "0");
  const progress = activeSlice === null ? 0 : ((activeSlice + 1) / sliceCount) * 100;
  const busy = uploadPhase === "uploading" || uploadPhase === "processing";

  return (
    <main className="atlas-shell">
      <header className="atlas-header">
        <a className="brand" href="#viewer" aria-label="Lumen medical slice atlas">
          <span className="brand-mark" aria-hidden="true" />
          <span>LUMEN</span>
        </a>
        <div className="study-meta">
          <span>{study ? `${study.modality} / ${study.sourceType.toUpperCase()}` : "NO STUDY LOADED"}</span>
          <span>{study ? `${study.dimensions.join(" × ")} · ${study.totalSlices} SLICES` : "SERVER-SIDE ITK PROCESSING"}</span>
        </div>
      </header>

      <section className="viewer-copy" aria-labelledby="atlas-title">
        <p className="eyebrow">VOLUMETRIC STUDY</p>
        <h1 id="atlas-title">
          Tissue,
          <br />in layers.
        </h1>
        <p className="intro">上传 DICOM 或 NIfTI，服务器解析后生成可抽出的玻璃层片。</p>
        <div className="upload-panel">
          <input
            ref={dicomInputRef}
            className="file-input"
            type="file"
            multiple
            accept=".dcm,.dicom,.ima,.zip,application/dicom,application/zip"
            onChange={(event) => {
              uploadStudy("dicom", event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={niftiInputRef}
            className="file-input"
            type="file"
            accept=".nii,.nii.gz,application/gzip"
            onChange={(event) => {
              uploadStudy("nifti", event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <div className="upload-actions">
            <button type="button" disabled={busy} onClick={() => dicomInputRef.current?.click()}>
              上传 DICOM
            </button>
            <button type="button" disabled={busy} onClick={() => niftiInputRef.current?.click()}>
              上传 NIfTI
            </button>
          </div>
          <div className={`upload-status is-${uploadPhase}`} aria-live="polite">
            <span>{uploadMessage}</span>
            {busy ? <span>{uploadPhase === "uploading" ? `${uploadProgress}%` : "PROCESSING"}</span> : null}
          </div>
          {busy ? (
            <div className="upload-progress" aria-hidden="true">
              <span style={{ width: `${uploadPhase === "processing" ? 100 : uploadProgress}%` }} />
            </div>
          ) : null}
        </div>
      </section>

      <div
        id="viewer"
        ref={mountRef}
        className={`webgl-stage${ready ? " is-ready" : ""}`}
        tabIndex={0}
        role="application"
        aria-label="三维医学切片查看器。上传影像后使用鼠标悬停，或用左右方向键选择切片。"
      >
        <span className="loading-label">ASSEMBLING GLASS</span>
      </div>

      <aside className="slice-readout" aria-live="polite">
        <span className="readout-label">ACTIVE PLANE</span>
        <span className="readout-number">{displaySlice}</span>
        <span className="readout-total">/ {String(sliceCount).padStart(2, "0")}</span>
      </aside>

      <footer className="atlas-footer">
        <div className="interaction-hint">
          <span className="cursor-icon" aria-hidden="true" />
          {study ? "HOVER TO ISOLATE · Z+ PULL" : "UPLOAD A STUDY TO BEGIN"}
        </div>
        <div className="slice-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="engine-label">ITK-WASM × VTK.JS × THREE.JS</span>
      </footer>
    </main>
  );
}
