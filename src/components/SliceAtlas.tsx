"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { float, texture as textureNode, uniform } from "three/tsl";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { decodeBase64Bytes } from "@/lib/studyClient";
import type { StudyErrorPayload, StudyKind, StudyPayload } from "@/lib/studyTypes";
import {
  SLICE_THICKNESS_SCALE_MAX,
  SLICE_THICKNESS_SCALE_MIN,
  SLICE_THICKNESS_SCALE_STEP,
  calculateSliceWorldDimensions,
  clampSliceThicknessScale,
  getBottomAlignedCenterY
} from "@/lib/sliceGeometry";
import {
  createSliceLayout,
  getSliceStackZ,
  getSliceTarget,
  getSliceVisualState,
  type SliceTransform
} from "@/lib/sliceMotion";
import { readSceneBackgroundColor } from "@/lib/sceneTheme";
import {
  DEFAULT_VISIBLE_SLICE_COUNT,
  SLICE_TEXTURE_POOL_SIZE,
  clampVisibleSliceCount,
  selectVisibleSliceIndices
} from "@/lib/sliceVisibility";

const SLICE_BOTTOM_Y = -3.95 / 2;
const ACES_BACKGROUND_COMPENSATION = 12;

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
  const thicknessScaleRef = useRef(1);
  const visibleSliceCountRef = useRef(DEFAULT_VISIBLE_SLICE_COUNT);
  const [activeSlice, setActiveSlice] = useState<number | null>(null);
  const [thicknessScale, setThicknessScale] = useState(1);
  const [requestedVisibleSliceCount, setRequestedVisibleSliceCount] = useState(DEFAULT_VISIBLE_SLICE_COUNT);
  const [ready, setReady] = useState(false);
  const [study, setStudy] = useState<StudyPayload | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState("选择服务器要处理的医学影像。");
  const slicePoolSize = study?.slices.length || SLICE_TEXTURE_POOL_SIZE;
  const visibleSliceCount = clampVisibleSliceCount(requestedVisibleSliceCount, slicePoolSize);
  const visibleSliceIndices = selectVisibleSliceIndices(slicePoolSize, visibleSliceCount);
  visibleSliceCountRef.current = visibleSliceCount;

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
      setUploadMessage("服务器正在解析并生成组织颜色与 SSS 厚度纹理…");
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
        setUploadMessage(
          `已生成 ${payload.slices.length} 层 ${payload.intensityMapping === "hu" ? "HU" : "归一化"} 组织纹理，原始上传文件已删除。`
        );
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
    const slicePoolCount = study?.slices.length || SLICE_TEXTURE_POOL_SIZE;
    const initialVisibleIndices = selectVisibleSliceIndices(slicePoolCount, visibleSliceCountRef.current);
    const initialActive: number | null = null;
    activeRef.current = initialActive;
    setActiveSlice(initialActive);

    const sceneBackground = new THREE.Color(
      readSceneBackgroundColor(window.getComputedStyle(document.documentElement))
    );
    const displaySceneBackground = sceneBackground.clone().multiplyScalar(ACES_BACKGROUND_COMPENSATION);
    const scene = new THREE.Scene();
    scene.background = displaySceneBackground;
    scene.fog = new THREE.Fog(displaySceneBackground, 13, 25);

    const camera = new THREE.OrthographicCamera(-6.7, 6.7, 4.7, -4.7, 0.1, 60);
    camera.position.set(8.8, 5.8, 11.5);
    camera.lookAt(0, 0.1, 0);

    const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    renderer.setClearColor(displaySceneBackground, 1);
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const hemisphereLight = new THREE.HemisphereLight(0xfff6ef, 0x164a3f, 1.3);
    hemisphereLight.position.set(0, 1, 0);
    scene.add(hemisphereLight);

    const keyLight = new THREE.DirectionalLight(0xfff4ec, 3.8);
    keyLight.position.set(-4, 9, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xff8068, 2.4);
    rimLight.position.set(7, 3, -4);
    scene.add(rimLight);

    const axisScene = new THREE.Scene();
    const axisCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    axisCamera.position.copy(camera.position).normalize().multiplyScalar(4.2);
    axisCamera.lookAt(0, 0, 0);
    const axisColor = 0x061f18;
    const origin = new THREE.Vector3(-0.25, -0.25, -0.25);
    const axes: Array<[THREE.Vector3, string]> = [
      [new THREE.Vector3(1, 0, 0), "X"],
      [new THREE.Vector3(0, 1, 0), "Y+"],
      [new THREE.Vector3(0, 0, 1), "Z"]
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

    const layout = createSliceLayout(slicePoolCount, 0.62);
    const panelGroups: SliceGroup[] = [];
    const tissueMaterials: THREE.MeshSSSNodeMaterial[] = [];
    const glassMaterials: THREE.MeshPhysicalNodeMaterial[] = [];
    const baseThicknesses: number[] = [];
    const sssScaleNodes: Array<ReturnType<typeof uniform>> = [];
    const dataTextures = new Set<THREE.Texture>();
    const raycastTargets: THREE.Object3D[] = [];

    layout.forEach((base, sliceIndex) => {
      const payload = study?.slices[sliceIndex];
      const diffuseBytes = payload ? decodeBase64Bytes(payload.diffuseBase64) : new Uint8Array([0, 0, 0, 0]);
      const roughnessBytes = payload ? decodeBase64Bytes(payload.roughnessBase64) : new Uint8Array([232]);
      const thicknessBytes = payload ? decodeBase64Bytes(payload.thicknessBase64) : new Uint8Array([0]);
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
      diffuseTexture.generateMipmaps = false;
      diffuseTexture.needsUpdate = true;
      dataTextures.add(diffuseTexture);

      const roughnessTexture = new THREE.DataTexture(
        roughnessBytes,
        textureWidth,
        textureHeight,
        THREE.RedFormat,
        THREE.UnsignedByteType
      );
      roughnessTexture.minFilter = THREE.LinearFilter;
      roughnessTexture.magFilter = THREE.LinearFilter;
      roughnessTexture.generateMipmaps = false;
      roughnessTexture.needsUpdate = true;
      dataTextures.add(roughnessTexture);

      const thicknessTexture = new THREE.DataTexture(
        thicknessBytes,
        textureWidth,
        textureHeight,
        THREE.RedFormat,
        THREE.UnsignedByteType
      );
      thicknessTexture.minFilter = THREE.LinearFilter;
      thicknessTexture.magFilter = THREE.LinearFilter;
      thicknessTexture.generateMipmaps = false;
      thicknessTexture.needsUpdate = true;
      dataTextures.add(thicknessTexture);

      const initialVisual = getSliceVisualState(sliceIndex === initialActive);
      const initialVisibleRank = initialVisibleIndices.indexOf(sliceIndex);
      const sliceDimensions = payload && study
        ? calculateSliceWorldDimensions(study.dimensions[0], study.dimensions[1], study.spacing, 5.1, 3.95)
        : { width: 4.15, height: 3.95, thickness: 0.16, worldUnitsPerMillimeter: 0.16 };
      const bottomAlignedBase = {
        ...base,
        y: getBottomAlignedCenterY(sliceDimensions.height, SLICE_BOTTOM_Y),
        z: getSliceStackZ(
          initialVisibleRank >= 0 ? initialVisibleRank : sliceIndex,
          initialVisibleRank >= 0 ? initialVisibleIndices.length : slicePoolCount,
          sliceDimensions.thickness * thicknessScaleRef.current
        )
      };
      const group = new THREE.Group() as SliceGroup;
      group.position.set(bottomAlignedBase.x, bottomAlignedBase.y, bottomAlignedBase.z);
      group.scale.z = thicknessScaleRef.current;
      group.visible = initialVisibleRank >= 0;
      group.userData = { base: bottomAlignedBase, sliceIndex };

      const sssScaleNode = uniform(11 * initialVisual.sssScale);
      const tissueMaterial = new THREE.MeshSSSNodeMaterial({
        color: new THREE.Color().setScalar(initialVisual.tissueIntensity),
        map: diffuseTexture,
        roughnessMap: roughnessTexture,
        roughness: 0.62,
        metalness: 0,
        clearcoat: 0.08,
        clearcoatRoughness: 0.56,
        sheen: 0.16,
        sheenColor: new THREE.Color(0xff6f61),
        sheenRoughness: 0.82,
        transparent: true,
        opacity: 1,
        alphaTest: 0.01,
        side: THREE.FrontSide,
        depthWrite: false
      });
      tissueMaterial.thicknessColorNode = textureNode(diffuseTexture).rgb;
      tissueMaterial.thicknessDistortionNode = float(0.16);
      tissueMaterial.thicknessAmbientNode = float(0.08);
      tissueMaterial.thicknessAttenuationNode = textureNode(thicknessTexture).r.mul(float(0.72)) as unknown as typeof tissueMaterial.thicknessAttenuationNode;
      tissueMaterial.thicknessPowerNode = float(2.1);
      tissueMaterial.thicknessScaleNode = sssScaleNode;
      tissueMaterials.push(tissueMaterial);
      sssScaleNodes.push(sssScaleNode);

      const glassMaterial = new THREE.MeshPhysicalNodeMaterial({
        color: 0xf2fffb,
        roughness: 0.18,
        metalness: 0,
        transmission: 1,
        thickness: sliceDimensions.thickness * thicknessScaleRef.current,
        ior: 1.5,
        attenuationColor: new THREE.Color(0xffffff),
        attenuationDistance: Number.POSITIVE_INFINITY,
        dispersion: 0.035,
        opacity: 1,
        transparent: true,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        specularIntensity: 1,
        specularColor: new THREE.Color(0xffffff),
        iridescence: 0.08,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [120, 420],
        side: THREE.FrontSide,
        depthWrite: false,
        envMapIntensity: initialVisual.edgeOpacity * 2.4
      });
      glassMaterials.push(glassMaterial);
      baseThicknesses.push(sliceDimensions.thickness);

      if (payload) {
        const tissueGeometry = new THREE.BoxGeometry(
          sliceDimensions.width * 0.965,
          sliceDimensions.height * 0.965,
          sliceDimensions.thickness
        );
        const tissueVolume = new THREE.Mesh(tissueGeometry, tissueMaterial);
        tissueVolume.castShadow = true;
        tissueVolume.receiveShadow = true;
        tissueVolume.renderOrder = sliceIndex * 2;
        group.add(tissueVolume);
      }

      const glassGeometry = new THREE.BoxGeometry(
        sliceDimensions.width,
        sliceDimensions.height,
        sliceDimensions.thickness
      );
      const glassBox = new THREE.Mesh(glassGeometry, glassMaterial);
      glassBox.castShadow = true;
      glassBox.receiveShadow = false;
      glassBox.renderOrder = sliceIndex * 2 + 1;
      glassBox.userData.sliceIndex = sliceIndex;
      group.add(glassBox);
      raycastTargets.push(glassBox);
      panelGroups.push(group);
      scene.add(group);
    });

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.ShadowNodeMaterial({ color: 0x176a57, opacity: 0.14, transparent: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.36;
    ground.receiveShadow = true;
    scene.add(ground);

    const pointer = new THREE.Vector2(4, 4);
    const raycaster = new THREE.Raycaster();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const visibleTargets = raycastTargets.filter((target) => target.parent?.visible);
      const hit = raycaster.intersectObjects(visibleTargets, false)[0];
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
      const visibleIndices = selectVisibleSliceIndices(slicePoolCount, visibleSliceCountRef.current);
      if (visibleIndices.length === 0) return;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const activeRank = activeRef.current === null ? -1 : visibleIndices.indexOf(activeRef.current);
      const currentRank = activeRank >= 0 ? activeRank : Math.floor(visibleIndices.length / 2);
      const nextRank = Math.min(visibleIndices.length - 1, Math.max(0, currentRank + direction));
      const next = visibleIndices[nextRank];
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
    let animationFrame = 0;
    let disposed = false;
    let environmentTarget: THREE.RenderTarget | null = null;
    let visibleLayoutKey = initialVisibleIndices.join(",");
    const render = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      const damping = reducedMotion ? 30 : 7.8;
      const currentVisibleIndices = selectVisibleSliceIndices(slicePoolCount, visibleSliceCountRef.current);
      const nextVisibleLayoutKey = currentVisibleIndices.join(",");
      const shouldSnapVisibleLayout = nextVisibleLayoutKey !== visibleLayoutKey;

      panelGroups.forEach((group, index) => {
        const visibleRank = currentVisibleIndices.indexOf(index);
        const isVisible = visibleRank >= 0;
        const wasVisible = group.visible;
        const inactiveVisual = getSliceVisualState(false);
        const scaledThickness = baseThicknesses[index] * thicknessScaleRef.current;
        glassMaterials[index].thickness = scaledThickness;

        if (!isVisible) {
          group.visible = false;
          group.position.set(
            group.userData.base.x,
            group.userData.base.y,
            getSliceStackZ(index, slicePoolCount, scaledThickness)
          );
          group.scale.set(1, 1, thicknessScaleRef.current);
          tissueMaterials[index].color.setScalar(study ? inactiveVisual.tissueIntensity : 0);
          sssScaleNodes[index].value = 11 * inactiveVisual.sssScale;
          glassMaterials[index].envMapIntensity = inactiveVisual.edgeOpacity * 2.4;
          return;
        }

        const isActive = activeRef.current === index;
        const dynamicBase = {
          ...group.userData.base,
          z: getSliceStackZ(
            visibleRank,
            currentVisibleIndices.length,
            scaledThickness
          )
        };
        const target = getSliceTarget(dynamicBase, isActive);
        const visual = getSliceVisualState(isActive);
        if (!wasVisible || shouldSnapVisibleLayout) {
          group.position.set(target.x, target.y, target.z);
          group.scale.set(1, 1, thicknessScaleRef.current);
        }
        group.visible = true;
        const lateralWave = isActive && !reducedMotion ? Math.sin(elapsed * 2.2) * 0.025 : 0;
        group.position.x = THREE.MathUtils.damp(group.position.x, target.x + lateralWave, damping, delta);
        group.position.y = THREE.MathUtils.damp(group.position.y, target.y, damping, delta);
        group.position.z = THREE.MathUtils.damp(group.position.z, target.z, damping, delta);
        const scaleTarget = isActive ? 1.018 : 1;
        group.scale.x = THREE.MathUtils.damp(group.scale.x, scaleTarget, damping, delta);
        group.scale.y = THREE.MathUtils.damp(group.scale.y, scaleTarget, damping, delta);
        group.scale.z = THREE.MathUtils.damp(
          group.scale.z,
          thicknessScaleRef.current,
          damping,
          delta
        );
        const currentIntensity = tissueMaterials[index].color.r;
        tissueMaterials[index].color.setScalar(
          THREE.MathUtils.damp(currentIntensity, study ? visual.tissueIntensity : 0, 6.4, delta)
        );
        sssScaleNodes[index].value = THREE.MathUtils.damp(
          Number(sssScaleNodes[index].value),
          11 * visual.sssScale,
          6.4,
          delta
        );
        glassMaterials[index].envMapIntensity = THREE.MathUtils.damp(
          glassMaterials[index].envMapIntensity,
          visual.edgeOpacity * 2.4,
          6.4,
          delta
        );
      });
      visibleLayoutKey = nextVisibleLayoutKey;

      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.clearDepth();
      const axisSize = Math.round(THREE.MathUtils.clamp(width * 0.105, 88, 116));
      renderer.setViewport(width - axisSize - 26, 88, axisSize, axisSize);
      renderer.setScissor(width - axisSize - 26, 88, axisSize, axisSize);
      renderer.setScissorTest(true);
      renderer.render(axisScene, axisCamera);
      renderer.setScissorTest(false);
      animationFrame = window.requestAnimationFrame(render);
    };

    const initializeRenderer = async () => {
      try {
        await renderer.init();
        if (disposed) {
          renderer.dispose();
          return;
        }

        const roomEnvironment = new RoomEnvironment();
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        try {
          environmentTarget = await pmremGenerator.fromSceneAsync(roomEnvironment, 0.04);
        } finally {
          pmremGenerator.dispose();
          roomEnvironment.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.geometry.dispose();
              const materials = Array.isArray(object.material) ? object.material : [object.material];
              materials.forEach((material) => material.dispose());
            }
          });
        }
        if (disposed) {
          environmentTarget.dispose();
          renderer.dispose();
          return;
        }

        scene.environment = environmentTarget.texture;
        setReady(true);
        render();
      } catch {
        if (!disposed) {
          setUploadPhase("error");
          setUploadMessage("当前浏览器无法初始化 WebGPU 或 WebGL2 SSS 渲染器。");
        }
      }
    };
    void initializeRenderer();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", updatePointer);
      renderer.domElement.removeEventListener("pointerdown", updatePointer);
      renderer.domElement.removeEventListener("pointerleave", clearPointer);
      mount.removeEventListener("keydown", selectByKeyboard);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      [scene, axisScene].forEach((targetScene) => {
        targetScene.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
            geometries.add(object.geometry);
            const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
            objectMaterials.forEach((material) => materials.add(material));
          }
          if (object instanceof THREE.Sprite) {
            if (object.material.map) dataTextures.add(object.material.map);
            materials.add(object.material);
          }
        });
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      dataTextures.forEach((texture) => texture.dispose());
      environmentTarget?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [study]);

  const activeVisibleRank = activeSlice === null ? -1 : visibleSliceIndices.indexOf(activeSlice);
  const displaySlice = activeVisibleRank < 0 ? "—" : String(activeVisibleRank + 1).padStart(2, "0");
  const progress = activeVisibleRank < 0 ? 0 : ((activeVisibleRank + 1) / visibleSliceCount) * 100;
  const busy = uploadPhase === "uploading" || uploadPhase === "processing";

  return (
    <main className="atlas-shell">
      <header className="atlas-header">
        <a className="brand" href="#viewer" aria-label="Lumen medical slice atlas">
          <span className="brand-mark" aria-hidden="true" />
          <span>LUMEN</span>
        </a>
        <div className="study-meta">
          <span>
            {study
              ? `${study.modality} / ${study.intensityMapping === "hu" ? "HU TISSUE" : "NORMALIZED"} SSS`
              : "NO STUDY LOADED"}
          </span>
          <span>{study ? `${study.dimensions.join(" × ")} · ${study.totalSlices} SLICES` : "SERVER-SIDE ITK PROCESSING"}</span>
        </div>
      </header>

      <section className="viewer-copy" aria-labelledby="atlas-title">
        <p className="eyebrow">VOLUMETRIC STUDY</p>
        <h1 id="atlas-title">
          Tissue,
          <br />in layers.
        </h1>
        <p className="intro">上传 DICOM 或 NIfTI，服务器将空气透明化，并生成可抽出的组织盒切片。</p>
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
          <label className="viewer-control">
            <span className="viewer-control-label">
              <span>SLICE THICKNESS</span>
              <output>{thicknessScale.toFixed(2)}×</output>
            </span>
            <input
              type="range"
              min={SLICE_THICKNESS_SCALE_MIN}
              max={SLICE_THICKNESS_SCALE_MAX}
              step={SLICE_THICKNESS_SCALE_STEP}
              value={thicknessScale}
              aria-label="切片厚度倍率"
              onChange={(event) => {
                const next = clampSliceThicknessScale(Number(event.currentTarget.value));
                thicknessScaleRef.current = next;
                setThicknessScale(next);
              }}
            />
          </label>
          <label className="viewer-control">
            <span className="viewer-control-label">
              <span>VISIBLE SLICES</span>
              <output>{visibleSliceCount} / {slicePoolSize}</output>
            </span>
            <input
              type="range"
              min={1}
              max={slicePoolSize}
              step={1}
              value={visibleSliceCount}
              aria-label="显示切片数量"
              onChange={(event) => {
                const next = clampVisibleSliceCount(Number(event.currentTarget.value), slicePoolSize);
                visibleSliceCountRef.current = next;
                setRequestedVisibleSliceCount(next);
                activeRef.current = null;
                setActiveSlice(null);
              }}
            />
          </label>
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
        <span className="loading-label">INITIALIZING SSS</span>
      </div>

      <aside className="slice-readout" aria-live="polite">
        <span className="readout-label">ACTIVE PLANE</span>
        <span className="readout-number">{displaySlice}</span>
        <span className="readout-total">/ {String(visibleSliceCount).padStart(2, "0")}</span>
      </aside>

      <footer className="atlas-footer">
        <div className="interaction-hint">
          <span className="cursor-icon" aria-hidden="true" />
          {study ? "HOVER TO ISOLATE · Y+ PULL" : "UPLOAD A STUDY TO BEGIN"}
        </div>
        <div className="slice-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="engine-label">ITK-WASM × HU COLOR × WEBGPU SSS</span>
      </footer>
    </main>
  );
}
