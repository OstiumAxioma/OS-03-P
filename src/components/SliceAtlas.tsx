"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { float, texture as textureNode, uniform } from "three/tsl";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import SliceDetails from "@/components/SliceDetails";
import { createSliceLabel, disposeHardware, loadSliceHardware } from "@/lib/sliceHardware";

import { decodeBase64Bytes } from "@/lib/studyClient";
import type { StudyErrorPayload, StudyKind, StudyPayload } from "@/lib/studyTypes";
import {
  DEFAULT_SLICE_THICKNESS_SCALE,
  SLICE_THICKNESS_SCALE_MAX,
  SLICE_THICKNESS_SCALE_MIN,
  SLICE_THICKNESS_SCALE_STEP,
  calculateSliceWorldDimensions,
  clampSliceThicknessScale,
  getBottomAlignedCenterY,
  getVisibleTissueExtrusionThickness
} from "@/lib/sliceGeometry";
import {
  createSliceLayout,
  getSliceStackZ,
  getSliceTarget,
  getSliceVisualState,
  getEntryLift,
  getSelectionWave,
  smoothStep,
  stepSpring,
  type MotionSpring,
  type SliceTransform
} from "@/lib/sliceMotion";
import {
  DEFAULT_VISIBLE_SLICE_COUNT,
  SLICE_TEXTURE_POOL_SIZE,
  clampVisibleSliceCount,
  selectVisibleSliceIndices
} from "@/lib/sliceVisibility";
import { createTissueExtrusionSurface } from "@/lib/tissueExtrusion";

const SLICE_BOTTOM_Y = -3.95 / 2;
const SHADOW_RECEIVER_Y = SLICE_BOTTOM_Y - 0.11;
const CONTACT_SHADOW_Y = SLICE_BOTTOM_Y - 0.095;
// Keep the radiance sampled by transmission in the same range as the studio.
const ACES_BACKGROUND_COMPENSATION = 1;
const GLASS_EDGE_ENVIRONMENT_GAIN = 1.35;
const ACTIVE_GLASS_OPTICAL_THICKNESS_RATIO = 0.24;
const ACRYLIC_TRANSMISSION = 0.9;
const ACRYLIC_OPACITY = 0.44;
const BACKGROUND_GLASS_TRANSMISSION = 0.74;
const BACKGROUND_GLASS_ENVIRONMENT_RATIO = 0.85;
const BACKGROUND_ACRYLIC_OPACITY = 0.5;
const ACRYLIC_EDGE_OPACITY = 0.07;
const ACTIVE_ACRYLIC_EDGE_OPACITY = 0.16;
const TISSUE_SSS_SCALE_BASE = 5.2;
const CONTACT_SHADOW_BASE_OPACITY = 0.082;
const CONTACT_SHADOW_ACTIVE_OPACITY = 0.22;
const CONTACT_SHADOW_INACTIVE_OPACITY = 0.036;
const LIGHT_ROTATION_MIN = 0;
const LIGHT_ROTATION_MAX = 360;
const HDR_INTENSITY_MIN = 0.25;
const HDR_INTENSITY_MAX = 2.5;
const HDR_INTENSITY_STEP = 0.05;
const EXPOSURE_MIN = 0.55;
const EXPOSURE_MAX = 1.65;
const EXPOSURE_STEP = 0.01;
const HDR_KNOB_DOT_COUNT = 30;
const HDR_KNOB_OUTER_TICKS = 60;
const HDR_KNOB_INNER_TICKS = 60;
const HDR_KNOB_DOT_RADIUS = 88;
const LIGHT_SCENE_COLORS = {
  light: { background: "#ffffff", fog: "#ffffff", ground: 0x111111, groundOpacity: 0.18 },
  dark: { background: "#050505", fog: "#050505", ground: 0x050505, groundOpacity: 0.28 }
};

type LightingControls = {
  rotation: number;
  hdrIntensity: number;
  exposure: number;
  darkMode: boolean;
};

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function polarPoint(angleDegrees: number, radius: number) {
  const radians = (angleDegrees * Math.PI) / 180;

  return {
    x: Number((Math.cos(radians) * radius).toFixed(4)),
    y: Number((Math.sin(radians) * radius).toFixed(4))
  };
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 10, 128, 128, 126);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.36)");
    gradient.addColorStop(0.45, "rgba(0, 0, 0, 0.2)");
    gradient.addColorStop(0.78, "rgba(0, 0, 0, 0.045)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

type UploadPhase = "idle" | "uploading" | "processing" | "ready" | "error";

type SliceGroup = THREE.Group & {
  userData: {
    base: SliceTransform;
    sliceIndex: number;
    entranceZ?: number;
  };
};

type FogAwareMaterial = THREE.Material & { fog: boolean };

function setMaterialFog(material: FogAwareMaterial, enabled: boolean) {
  if (material.fog === enabled) return;
  material.fog = enabled;
  material.needsUpdate = true;
}

export default function SliceAtlas() {
  const mountRef = useRef<HTMLDivElement>(null);
  const dicomInputRef = useRef<HTMLInputElement>(null);
  const niftiInputRef = useRef<HTMLInputElement>(null);
  const hdrKnobRef = useRef<HTMLDivElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const activeRef = useRef<number | null>(null);
  const focusedSliceRef = useRef<number | null>(null);
  const inspectionRef = useRef(false);
  const inspectionPanelRef = useRef<HTMLDivElement>(null);
  const observeButtonRef = useRef<HTMLButtonElement>(null);
  const hdrKnobDraggingRef = useRef(false);
  const hdrKnobLastAngleRef = useRef(0);
  const thicknessScaleRef = useRef(DEFAULT_SLICE_THICKNESS_SCALE);
  const visibleSliceCountRef = useRef(DEFAULT_VISIBLE_SLICE_COUNT);
  const lightingRef = useRef<LightingControls>({
    rotation: 0,
    hdrIntensity: 0.65,
    exposure: 1.05,
    darkMode: false
  });
  const [activeSlice, setActiveSlice] = useState<number | null>(null);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [inspectionIndex, setInspectionIndex] = useState(0);
  const [lightingOpen, setLightingOpen] = useState(false);
  const [thicknessScale, setThicknessScale] = useState(DEFAULT_SLICE_THICKNESS_SCALE);
  const [requestedVisibleSliceCount, setRequestedVisibleSliceCount] = useState(DEFAULT_VISIBLE_SLICE_COUNT);
  const [lightingControls, setLightingControls] = useState<LightingControls>(lightingRef.current);
  const [ready, setReady] = useState(false);
  const [study, setStudy] = useState<StudyPayload | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState("选择服务器要处理的医学影像。");
  const slicePoolSize = study?.slices.length || SLICE_TEXTURE_POOL_SIZE;
  const visibleSliceCount = clampVisibleSliceCount(requestedVisibleSliceCount, slicePoolSize);
  const visibleSliceIndices = selectVisibleSliceIndices(slicePoolSize, visibleSliceCount);
  visibleSliceCountRef.current = visibleSliceCount;

  const observeSlice = () => {
    const index = activeRef.current ?? visibleSliceIndices[Math.floor(visibleSliceIndices.length / 2)];
    if (index === undefined || !ready) return;
    focusedSliceRef.current = index;
    activeRef.current = index;
    setActiveSlice(index);
    setInspectionIndex(index);
    inspectionRef.current = true;
    setInspectionOpen(true);
    setLightingOpen(false);
  };

  const closeInspection = () => {
    inspectionRef.current = false;
    setInspectionOpen(false);
    requestAnimationFrame(() => observeButtonRef.current?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    if (!inspectionOpen) return;
    inspectionPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeInspection();
      }
      if (event.key === "Tab") {
        const nodes = Array.from(inspectionPanelRef.current?.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), [tabindex="0"]') ?? []);
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inspectionOpen]);

  const updateLightingControls = (next: Partial<LightingControls>) => {
    lightingRef.current = { ...lightingRef.current, ...next };
    setLightingControls(lightingRef.current);
  };

  const getHdrKnobAngle = (clientX: number, clientY: number) => {
    const node = hdrKnobRef.current;
    if (!node) return 0;
    const rect = node.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
  };

  const handleHdrKnobPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    hdrKnobDraggingRef.current = true;
    hdrKnobLastAngleRef.current = getHdrKnobAngle(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleHdrKnobPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!hdrKnobDraggingRef.current) return;
    const angle = getHdrKnobAngle(event.clientX, event.clientY);
    let delta = angle - hdrKnobLastAngleRef.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    updateLightingControls({ rotation: wrapDegrees(lightingRef.current.rotation + delta) });
    hdrKnobLastAngleRef.current = angle;
  };

  const handleHdrKnobPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    hdrKnobDraggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => {
    const node = hdrKnobRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      updateLightingControls({ rotation: wrapDegrees(lightingRef.current.rotation - event.deltaY / 5) });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

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
    focusedSliceRef.current = null;
    inspectionRef.current = false;
    setInspectionOpen(false);
    setActiveSlice(initialActive);

    const sceneBackground = new THREE.Color(LIGHT_SCENE_COLORS.light.background);
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
    renderer.toneMappingExposure = lightingRef.current.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    renderer.setClearColor(displaySceneBackground, 1);
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const hemisphereLight = new THREE.HemisphereLight(0xfffaf5, 0xb4a18c, 0.65);
    hemisphereLight.position.set(0, 1, 0);
    scene.add(hemisphereLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.1);
    keyLight.position.set(-6, 14, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.00008;
    keyLight.shadow.normalBias = 0.025;
    keyLight.shadow.radius = 3.2;
    keyLight.shadow.camera.left = -6.2;
    keyLight.shadow.camera.right = 6.2;
    keyLight.shadow.camera.top = 5.4;
    keyLight.shadow.camera.bottom = -4.8;
    keyLight.shadow.camera.near = 1.5;
    keyLight.shadow.camera.far = 22;
    keyLight.shadow.camera.updateProjectionMatrix();
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xffeee2, 1.3);
    rimLight.position.set(3, 5, -8);
    scene.add(rimLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.65);
    fillLight.position.set(7, 8, 10);
    scene.add(fillLight);
    const keyLightBasePosition = keyLight.position.clone();
    const rimLightBasePosition = rimLight.position.clone();
    const lightRotationAxis = new THREE.Vector3(0, 1, 0);

    const layout = createSliceLayout(slicePoolCount, 0.62);
    const panelGroups: SliceGroup[] = [];
    const hardwareMounts: THREE.Group[] = [];
    const heightSprings: MotionSpring[] = [];
    const tissueMaterials: THREE.MeshSSSNodeMaterial[] = [];
    const tissueMaterialGroups: THREE.MeshSSSNodeMaterial[][] = [];
    const shellMaterials: THREE.MeshPhysicalNodeMaterial[] = [];
    const shellEdgeMaterials: THREE.LineBasicMaterial[] = [];
    const contactShadowMaterials: THREE.MeshBasicNodeMaterial[] = [];
    const contactShadows: THREE.Mesh[] = [];
    const baseThicknesses: number[] = [];
    const sssScaleNodes: Array<ReturnType<typeof uniform>> = [];
    const dataTextures = new Set<THREE.Texture>();
    const raycastTargets: THREE.Object3D[] = [];
    const contactShadowTexture = createContactShadowTexture();
    dataTextures.add(contactShadowTexture);

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
          getVisibleTissueExtrusionThickness(sliceDimensions.thickness) * thicknessScaleRef.current
        )
      };
      const group = new THREE.Group() as SliceGroup;
      group.position.set(bottomAlignedBase.x, bottomAlignedBase.y, bottomAlignedBase.z);
      group.scale.z = thicknessScaleRef.current;
      group.visible = initialVisibleRank >= 0;
      group.userData = { base: bottomAlignedBase, sliceIndex };
      heightSprings.push({ value: bottomAlignedBase.y, velocity: 0 });
      const hardwareMount = new THREE.Group();
      hardwareMount.scale.set(sliceDimensions.width / 5, sliceDimensions.height / 3.7, getVisibleTissueExtrusionThickness(sliceDimensions.thickness) / 0.5);
      hardwareMounts.push(hardwareMount);
      const label = createSliceLabel(payload?.sourceIndex ?? sliceIndex);
      dataTextures.add((label.material as THREE.MeshBasicNodeMaterial).map!);
      hardwareMount.add(label);
      group.add(hardwareMount);

      const sssScaleNode = uniform(TISSUE_SSS_SCALE_BASE * initialVisual.sssScale);
      const tissueMaterial = new THREE.MeshSSSNodeMaterial({
        color: new THREE.Color().setScalar(initialVisual.tissueIntensity),
        map: diffuseTexture,
        roughnessMap: roughnessTexture,
        roughness: 0.72,
        metalness: 0,
        clearcoat: 0.04,
        clearcoatRoughness: 0.78,
        sheen: 0.28,
        sheenColor: new THREE.Color(0xff6f61),
        sheenRoughness: 0.92,
        transparent: false,
        opacity: 1,
        side: THREE.FrontSide,
        depthWrite: true
      });
      tissueMaterial.thicknessColorNode = textureNode(diffuseTexture).rgb;
      tissueMaterial.thicknessDistortionNode = float(0.48);
      tissueMaterial.thicknessAmbientNode = float(0.018);
      tissueMaterial.thicknessAttenuationNode = textureNode(thicknessTexture).r.mul(float(1.28)).add(float(0.18)) as unknown as typeof tissueMaterial.thicknessAttenuationNode;
      tissueMaterial.thicknessPowerNode = float(1.45);
      tissueMaterial.thicknessScaleNode = sssScaleNode;
      tissueMaterials.push(tissueMaterial);
      const sliceTissueMaterials = [tissueMaterial];
      tissueMaterialGroups.push(sliceTissueMaterials);
      sssScaleNodes.push(sssScaleNode);

      const shellMaterial = new THREE.MeshPhysicalNodeMaterial({
        color: 0xffffff,
        roughness: 0.24,
        metalness: 0,
        transmission: ACRYLIC_TRANSMISSION,
        thickness: sliceDimensions.thickness * thicknessScaleRef.current,
        ior: 1.49,
        attenuationColor: new THREE.Color(0xeee5da),
        attenuationDistance: 3.5,
        dispersion: 0.25,
        opacity: ACRYLIC_OPACITY,
        transparent: true,
        clearcoat: 0.42,
        clearcoatRoughness: 0.13,
        specularIntensity: 0.68,
        specularColor: new THREE.Color(0xffffff),
        iridescence: 0.12,
        iridescenceIOR: 1.62,
        iridescenceThicknessRange: [90, 520],
        side: THREE.FrontSide,
        depthWrite: false,
        envMapIntensity: initialVisual.edgeOpacity * GLASS_EDGE_ENVIRONMENT_GAIN
      });
      shellMaterials.push(shellMaterial);
      baseThicknesses.push(sliceDimensions.thickness);

      if (payload) {
        const surface = createTissueExtrusionSurface({
          width: textureWidth,
          height: textureHeight,
          diffuse: diffuseBytes,
          roughness: roughnessBytes,
          thickness: thicknessBytes
        });
        const tissueGeometry = new THREE.BufferGeometry();
        tissueGeometry.setAttribute("position", new THREE.BufferAttribute(surface.positions, 3));
        tissueGeometry.setAttribute("uv", new THREE.BufferAttribute(surface.uvs, 2));
        tissueGeometry.setAttribute("color", new THREE.BufferAttribute(surface.colors, 3));
        tissueGeometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
        tissueGeometry.computeVertexNormals();
        const tissueVolume = new THREE.Mesh(tissueGeometry, tissueMaterial);
        const tissueDepth = getVisibleTissueExtrusionThickness(sliceDimensions.thickness);

        tissueVolume.scale.set(sliceDimensions.width * 0.79, sliceDimensions.height * 0.79, tissueDepth * 0.8);
        tissueVolume.position.x = sliceDimensions.width * 0.055;
        tissueVolume.castShadow = true;
        tissueVolume.receiveShadow = true;
        tissueVolume.renderOrder = sliceIndex * 2;
        group.add(tissueVolume);

        const tissueFaceMaterial = new THREE.MeshSSSNodeMaterial({
          color: new THREE.Color().setScalar(initialVisual.tissueIntensity),
          map: diffuseTexture,
          roughnessMap: roughnessTexture,
          roughness: 0.7,
          metalness: 0,
          clearcoat: 0.03,
          clearcoatRoughness: 0.82,
          sheen: 0.28,
          sheenColor: new THREE.Color(0xff6f61),
          sheenRoughness: 0.92,
          transparent: false,
          alphaTest: 0.08,
          side: THREE.FrontSide,
          depthWrite: true
        });
        tissueFaceMaterial.thicknessColorNode = textureNode(diffuseTexture).rgb;
        tissueFaceMaterial.thicknessDistortionNode = float(0.42);
        tissueFaceMaterial.thicknessAmbientNode = float(0.02);
        tissueFaceMaterial.thicknessAttenuationNode = textureNode(thicknessTexture).r.mul(float(1.18)).add(float(0.14)) as unknown as typeof tissueFaceMaterial.thicknessAttenuationNode;
        tissueFaceMaterial.thicknessPowerNode = float(1.55);
        tissueFaceMaterial.thicknessScaleNode = sssScaleNode;
        sliceTissueMaterials.push(tissueFaceMaterial);
        const tissueFace = new THREE.Mesh(
          new THREE.PlaneGeometry(sliceDimensions.width * 0.79, sliceDimensions.height * 0.79),
          tissueFaceMaterial
        );
        tissueFace.position.set(sliceDimensions.width * 0.055, 0, tissueDepth * 0.4 + 0.002);
        tissueFace.castShadow = false;
        tissueFace.receiveShadow = true;
        tissueFace.renderOrder = sliceIndex * 2 + 1;
        group.add(tissueFace);
      }

      const shellGeometry = new RoundedBoxGeometry(
        sliceDimensions.width,
        sliceDimensions.height,
        getVisibleTissueExtrusionThickness(sliceDimensions.thickness),
        2,
        Math.min(0.045, sliceDimensions.width * 0.018, sliceDimensions.height * 0.018)
      );
      const shellBox = new THREE.Mesh(shellGeometry, shellMaterial);
      const shellEdgeMaterial = new THREE.LineBasicMaterial({
        color: 0x928e84,
        transparent: true,
        opacity: ACRYLIC_EDGE_OPACITY,
        depthTest: true,
        depthWrite: false
      });
      const shellEdges = new THREE.LineSegments(new THREE.EdgesGeometry(shellGeometry, 32), shellEdgeMaterial);
      shellEdges.renderOrder = sliceIndex * 2 + 3;
      shellEdgeMaterials.push(shellEdgeMaterial);
      shellBox.castShadow = false;
      shellBox.receiveShadow = false;
      shellBox.renderOrder = sliceIndex * 2 + 2;
      shellBox.userData.sliceIndex = sliceIndex;
      group.add(shellBox);
      group.add(shellEdges);

      const contactShadowMaterial = new THREE.MeshBasicNodeMaterial({
        color: 0x050505,
        map: contactShadowTexture,
        transparent: true,
        opacity: initialVisibleRank >= 0 ? CONTACT_SHADOW_BASE_OPACITY : 0,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
      });
      const contactShadow = new THREE.Mesh(
        new THREE.PlaneGeometry(
          sliceDimensions.width * 1.18,
          Math.max(0.72, getVisibleTissueExtrusionThickness(sliceDimensions.thickness) * 7.5)
        ),
        contactShadowMaterial
      );
      contactShadow.rotation.x = -Math.PI / 2;
      contactShadow.position.set(group.position.x, CONTACT_SHADOW_Y, group.position.z);
      contactShadow.renderOrder = 1;
      contactShadow.visible = initialVisibleRank >= 0;
      contactShadowMaterials.push(contactShadowMaterial);
      contactShadows.push(contactShadow);
      scene.add(contactShadow);

      raycastTargets.push(shellBox);
      panelGroups.push(group);
      scene.add(group);
    });

    const groundMaterial = new THREE.ShadowNodeMaterial({ color: LIGHT_SCENE_COLORS.light.ground, opacity: LIGHT_SCENE_COLORS.light.groundOpacity, transparent: true });
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      groundMaterial
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = SHADOW_RECEIVER_Y;
    ground.receiveShadow = true;
    scene.add(ground);

    const pointer = new THREE.Vector2(4, 4);
    const raycaster = new THREE.Raycaster();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const focusSpring = { value: 0, velocity: 0 };
    const cameraSpring = { value: 0, velocity: 0 };
    const cameraAim = new THREE.Vector3(0, 0.1, 0);
    let previousActive: number | null = null;
    let waveAge = 4;
    let waveRank = 0;
    let entranceTime = 0;
    let retainedInspectionIndex = 0;

    const updatePointer = (event: PointerEvent) => {
      if (inspectionRef.current || cameraSpring.value > 0.02 || (!reducedMotion && entranceTime < 1.4)) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const visibleTargets = raycastTargets.filter((target) => target.parent?.visible);
      const hit = raycaster.intersectObjects(visibleTargets, false)[0];
      const hovered = typeof hit?.object.userData.sliceIndex === "number" ? hit.object.userData.sliceIndex : null;
      const next = hovered ?? focusedSliceRef.current;

      if (activeRef.current !== next) {
        activeRef.current = next;
        setActiveSlice(next);
      }
      mount.style.cursor = hovered === null ? "default" : "pointer";
    };

    const clearPointer = () => {
      if (inspectionRef.current) return;
      activeRef.current = focusedSliceRef.current;
      setActiveSlice(focusedSliceRef.current);
      mount.style.cursor = "default";
    };

    const focusActiveSlice = (event: PointerEvent) => {
      if (inspectionRef.current || cameraSpring.value > 0.02) return;
      updatePointer(event);
      if (event.button !== 0 || activeRef.current === null) return;
      focusedSliceRef.current = activeRef.current;
      mount.focus({ preventScroll: true });
    };

    const selectByKeyboard = (event: KeyboardEvent) => {
      if (inspectionRef.current) return;
      if (event.key === "Enter") {
        event.preventDefault();
        observeButtonRef.current?.click();
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const visibleIndices = selectVisibleSliceIndices(slicePoolCount, visibleSliceCountRef.current);
      if (visibleIndices.length === 0) return;
      const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const activeRank = activeRef.current === null ? -1 : visibleIndices.indexOf(activeRef.current);
      const currentRank = activeRank >= 0 ? activeRank : Math.floor(visibleIndices.length / 2);
      const nextRank = Math.min(visibleIndices.length - 1, Math.max(0, currentRank + direction));
      const next = visibleIndices[nextRank];
      activeRef.current = next;
      focusedSliceRef.current = next;
      setActiveSlice(next);
    };

    renderer.domElement.addEventListener("pointermove", updatePointer);
    renderer.domElement.addEventListener("pointerdown", focusActiveSlice);
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
    let previousDarkMode: boolean | null = null;
    const render = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      entranceTime = elapsed;
      const damping = reducedMotion ? 1000 : 6.2;
      const lighting = lightingRef.current;
      const lightingAngle = THREE.MathUtils.degToRad(lighting.rotation);
      const sceneColors = lighting.darkMode ? LIGHT_SCENE_COLORS.dark : LIGHT_SCENE_COLORS.light;
      const sceneColor = new THREE.Color(sceneColors.background).multiplyScalar(ACES_BACKGROUND_COMPENSATION);
      const fogColor = new THREE.Color(sceneColors.fog).multiplyScalar(ACES_BACKGROUND_COMPENSATION);
      const currentVisibleIndices = selectVisibleSliceIndices(slicePoolCount, visibleSliceCountRef.current);
      const focusedSlice = focusedSliceRef.current;
      const focusedVisibleRank = focusedSlice === null ? -1 : currentVisibleIndices.indexOf(focusedSlice);
      if (focusedSlice !== null && focusedVisibleRank < 0) {
        focusedSliceRef.current = null;
      }
      const referenceSliceIndex = focusedVisibleRank >= 0 ? focusedSlice ?? undefined : currentVisibleIndices[0];
      const referenceStackThickness = referenceSliceIndex === undefined
        ? 0
        : getVisibleTissueExtrusionThickness(baseThicknesses[referenceSliceIndex]) * thicknessScaleRef.current;
      const focusedStackOffsetZ = focusedVisibleRank >= 0
        ? getSliceStackZ(focusedVisibleRank, currentVisibleIndices.length, referenceStackThickness)
        : 0;
      if (reducedMotion) focusSpring.value = focusedStackOffsetZ;
      else stepSpring(focusSpring, focusedStackOffsetZ, 5.6, delta);
      if (activeRef.current !== previousActive) {
        previousActive = activeRef.current;
        waveAge = 0;
        waveRank = activeRef.current === null ? -1 : currentVisibleIndices.indexOf(activeRef.current);
      }
      waveAge += delta;
      if (inspectionRef.current && focusedSliceRef.current !== null) retainedInspectionIndex = focusedSliceRef.current;

      if (previousDarkMode !== lighting.darkMode) {
        scene.background = sceneColor;
        if (scene.fog) scene.fog.color.copy(fogColor);
        renderer.setClearColor(sceneColor, 1);
        groundMaterial.color.set(sceneColors.ground);
        groundMaterial.opacity = sceneColors.groundOpacity;
        previousDarkMode = lighting.darkMode;
      }
      renderer.toneMappingExposure = lighting.exposure;
      scene.environmentIntensity = lighting.hdrIntensity;
      scene.environmentRotation.y = lightingAngle;
      keyLight.position.copy(keyLightBasePosition).applyAxisAngle(lightRotationAxis, lightingAngle);
      rimLight.position.copy(rimLightBasePosition).applyAxisAngle(lightRotationAxis, lightingAngle);
      hemisphereLight.intensity = 0.65 * lighting.hdrIntensity / 0.65;
      keyLight.intensity = 2.1 * lighting.hdrIntensity / 0.65;
      rimLight.intensity = 1.3 * lighting.hdrIntensity / 0.65;

      panelGroups.forEach((group, index) => {
        const visibleRank = currentVisibleIndices.indexOf(index);
        const isVisible = visibleRank >= 0;
        const wasVisible = group.visible;
        const inactiveVisual = getSliceVisualState(false);
        const visualThickness = getVisibleTissueExtrusionThickness(baseThicknesses[index]);
        const stackThickness = visualThickness * thicknessScaleRef.current;
        const hasActiveSlice = activeRef.current !== null;
        const contactShadow = contactShadows[index];
        const contactShadowMaterial = contactShadowMaterials[index];

        if (!isVisible) {
          group.visible = false;
          contactShadow.visible = false;
          contactShadowMaterial.opacity = 0;
          group.position.set(
            group.userData.base.x,
            group.userData.base.y,
            getSliceStackZ(index, slicePoolCount, stackThickness)
          );
          group.scale.set(1, 1, thicknessScaleRef.current);
          tissueMaterialGroups[index].forEach((material) => {
            material.color.setScalar(study ? inactiveVisual.tissueIntensity : 0);
            setMaterialFog(material, true);
          });
          sssScaleNodes[index].value = TISSUE_SSS_SCALE_BASE * inactiveVisual.sssScale;
          shellMaterials[index].transmission = study && hasActiveSlice ? BACKGROUND_GLASS_TRANSMISSION : ACRYLIC_TRANSMISSION;
          shellMaterials[index].opacity = study && hasActiveSlice ? BACKGROUND_ACRYLIC_OPACITY : ACRYLIC_OPACITY;
          shellMaterials[index].thickness = visualThickness * thicknessScaleRef.current;
          setMaterialFog(shellMaterials[index], false);
          shellMaterials[index].envMapIntensity = inactiveVisual.edgeOpacity * GLASS_EDGE_ENVIRONMENT_GAIN;
          shellEdgeMaterials[index].color.set(lighting.darkMode ? 0xf7f7f7 : 0x050505);
          shellEdgeMaterials[index].opacity = study && hasActiveSlice ? 0.08 : ACRYLIC_EDGE_OPACITY;
          return;
        }

        const isActive = activeRef.current === index;
        tissueMaterialGroups[index].forEach((material) => setMaterialFog(material, true));
        setMaterialFog(shellMaterials[index], false);
        const dynamicBase = {
          ...group.userData.base,
          z: getSliceStackZ(
            visibleRank,
            currentVisibleIndices.length,
            stackThickness
          ) - focusSpring.value
        };
        const target = getSliceTarget(dynamicBase, isActive, inspectionRef.current && focusedSliceRef.current === index ? 1 : 0);
        const visual = getSliceVisualState(isActive);
        if (!wasVisible) {
          group.position.set(target.x, target.y + (reducedMotion ? 0 : 0.5), target.z);
          heightSprings[index].value = group.position.y;
          heightSprings[index].velocity = 0;
          group.scale.set(1, 1, thicknessScaleRef.current);
        }
        group.visible = true;
        const entryLift = getEntryLift(visibleRank, currentVisibleIndices.length, elapsed, reducedMotion);
        const ripple = reducedMotion || waveRank < 0 ? 0 : getSelectionWave(visibleRank - waveRank, waveAge) * (1 - cameraSpring.value);
        const idle = isActive && !inspectionRef.current && waveAge > 2.5 && !reducedMotion ? 0.025 * Math.sin(elapsed * 0.78) * smoothStep((waveAge - 2.5) / 1.5) : 0;
        if (reducedMotion) heightSprings[index].value = target.y;
        else stepSpring(heightSprings[index], target.y + ripple + idle, 6.2, delta);
        group.position.x = target.x;
        group.position.y = heightSprings[index].value + entryLift;
        const entranceZ = reducedMotion ? 0 : -8 * (1 - smoothStep(elapsed / 2.3));
        group.position.z = THREE.MathUtils.damp(group.position.z - (group.userData.entranceZ ?? 0), target.z, damping, delta);
        // Entrance is a shared track move; extraction remains strictly Y-only.
        group.position.z += entranceZ;
        group.userData.entranceZ = entranceZ;
        const scaleTarget = 1;
        group.scale.x = THREE.MathUtils.damp(group.scale.x, scaleTarget, damping, delta);
        group.scale.y = THREE.MathUtils.damp(group.scale.y, scaleTarget, damping, delta);
        group.scale.z = THREE.MathUtils.damp(
          group.scale.z,
          thicknessScaleRef.current,
          damping,
          delta
        );
        const currentIntensity = tissueMaterials[index].color.r;
        const nextTissueIntensity = THREE.MathUtils.damp(currentIntensity, study ? visual.tissueIntensity : 0, 6.4, delta);
        tissueMaterialGroups[index].forEach((material) => material.color.setScalar(nextTissueIntensity));
        sssScaleNodes[index].value = THREE.MathUtils.damp(
          Number(sssScaleNodes[index].value),
          TISSUE_SSS_SCALE_BASE * visual.sssScale,
          6.4,
          delta
        );
        const targetAcrylicTransmission = hasActiveSlice && !isActive ? BACKGROUND_GLASS_TRANSMISSION : ACRYLIC_TRANSMISSION;
        const targetGlassOpacity = hasActiveSlice && !isActive ? BACKGROUND_ACRYLIC_OPACITY : ACRYLIC_OPACITY;
        const targetEdgeOpacity = isActive ? ACTIVE_ACRYLIC_EDGE_OPACITY : ACRYLIC_EDGE_OPACITY;
        shellMaterials[index].roughness = THREE.MathUtils.damp(shellMaterials[index].roughness, isActive ? 0.055 : 0.24, 5, delta);
        const targetEnvRatio = study && hasActiveSlice && !isActive ? BACKGROUND_GLASS_ENVIRONMENT_RATIO : 1;
        const targetOpticalThickness = visualThickness * thicknessScaleRef.current * (isActive ? ACTIVE_GLASS_OPTICAL_THICKNESS_RATIO : 1);
        const targetContactShadowOpacity = study
          ? isActive
            ? CONTACT_SHADOW_ACTIVE_OPACITY
            : hasActiveSlice
              ? CONTACT_SHADOW_INACTIVE_OPACITY
              : CONTACT_SHADOW_BASE_OPACITY
          : CONTACT_SHADOW_BASE_OPACITY * 0.55;
        shellMaterials[index].transmission = THREE.MathUtils.damp(
          shellMaterials[index].transmission,
          targetAcrylicTransmission,
          6.4,
          delta
        );
        shellMaterials[index].opacity = THREE.MathUtils.damp(
          shellMaterials[index].opacity,
          targetGlassOpacity,
          6.4,
          delta
        );
        shellMaterials[index].thickness = THREE.MathUtils.damp(
          shellMaterials[index].thickness,
          targetOpticalThickness,
          6.4,
          delta
        );
        shellMaterials[index].envMapIntensity = THREE.MathUtils.damp(
          shellMaterials[index].envMapIntensity,
          visual.edgeOpacity * GLASS_EDGE_ENVIRONMENT_GAIN * targetEnvRatio,
          6.4,
          delta
        );
        shellEdgeMaterials[index].color.set(lighting.darkMode ? 0xf7f7f7 : 0x050505);
        shellEdgeMaterials[index].opacity = THREE.MathUtils.damp(
          shellEdgeMaterials[index].opacity,
          targetEdgeOpacity,
          6.4,
          delta
        );
        contactShadow.visible = true;
        contactShadow.position.x = group.position.x;
        contactShadow.position.z = group.position.z;
        contactShadowMaterial.color.set(lighting.darkMode ? 0xf7f7f7 : 0x050505);
        contactShadowMaterial.opacity = THREE.MathUtils.damp(
          contactShadowMaterial.opacity,
          lighting.darkMode ? targetContactShadowOpacity * 0.42 : targetContactShadowOpacity,
          8.4,
          delta
        );
      });

      const width = mount.clientWidth;
      const height = mount.clientHeight;
      const aspect = width / Math.max(1, height);
      const inspected = panelGroups[retainedInspectionIndex];
      const lifted = inspected ? Math.max(0, inspected.position.y - inspected.userData.base.y - 0.4) : 0;
      const detailTarget = smoothStep(lifted / 3.8);
      if (reducedMotion) cameraSpring.value = inspectionRef.current ? 1 : 0;
      else stepSpring(cameraSpring, detailTarget, 6, delta);
      const detail = cameraSpring.value;
      const mobile = aspect < 0.85;
      const baseSpan = mobile ? 13.5 : 9.4;
      const detailSpan = mobile ? 11.8 : Math.max(6.7, 5.8 / Math.max(0.7, aspect * 0.47));
      const span = THREE.MathUtils.lerp(baseSpan, detailSpan, detail);
      const direction = new THREE.Vector3().lerpVectors(new THREE.Vector3(0.58, 0.38, 0.72).normalize(), new THREE.Vector3(0.21, 0.13, 0.97).normalize(), detail).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      const anchorX = THREE.MathUtils.lerp(mobile ? 0.51 : 0.56, mobile ? 0.5 : 0.29, detail);
      const anchorY = THREE.MathUtils.lerp(mobile ? 0.59 : 0.49, mobile ? 0.27 : 0.46, detail);
      const targetAim = new THREE.Vector3(0, 0.05, 0).lerp(inspected?.position ?? new THREE.Vector3(), detail);
      targetAim.addScaledVector(right, (0.5 - anchorX) * span * aspect);
      targetAim.addScaledVector(up, (anchorY - 0.5) * span);
      if (reducedMotion) cameraAim.copy(targetAim);
      else cameraAim.lerp(targetAim, 1 - Math.exp(-delta * 6));
      camera.position.copy(cameraAim).addScaledVector(direction, 22);
      camera.lookAt(cameraAim);
      camera.left = -span * aspect / 2;
      camera.right = span * aspect / 2;
      camera.top = span / 2;
      camera.bottom = -span / 2;
      camera.updateProjectionMatrix();
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = 22 + THREE.MathUtils.lerp(7, 1, detail);
        scene.fog.far = 22 + THREE.MathUtils.lerp(22, 16, detail);
      }
      const panel = inspectionPanelRef.current;
      if (panel) {
        const reveal = inspectionRef.current ? smoothStep((detail - 0.25) / 0.6) : 0;
        panel.style.setProperty("--detail-reveal", String(reveal));
      }
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.render(scene, camera);
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
        scene.environmentIntensity = lightingRef.current.hdrIntensity;
        scene.environmentRotation.y = THREE.MathUtils.degToRad(lightingRef.current.rotation);
        const hardware = await loadSliceHardware();
        if (disposed) {
          disposeHardware(hardware);
          return;
        }
        hardwareMounts.forEach((mount) => mount.add(hardware.clone(true)));
        clock.start();
        setReady(true);
        render();
      } catch (error) {
        console.error("Slice scene initialization failed", error);
        if (!disposed) {
          setUploadPhase("error");
          setUploadMessage("场景初始化失败，请刷新以重新加载渲染器与模型资源。");
        }
      }
    };
    void initializeRenderer();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", updatePointer);
      renderer.domElement.removeEventListener("pointerdown", focusActiveSlice);
      renderer.domElement.removeEventListener("pointerleave", clearPointer);
      mount.removeEventListener("keydown", selectByKeyboard);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      [scene].forEach((targetScene) => {
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
  const hdrKnobValue = (lightingControls.rotation / 360) * 100;
  const hdrKnobFilledDots = Math.round((hdrKnobValue / 100) * HDR_KNOB_DOT_COUNT);

  return (
    <main className={`atlas-shell${lightingControls.darkMode ? " is-dark" : ""}${inspectionOpen ? " is-inspecting" : ""}${ready ? " scene-ready" : ""}`}>
      <header className="atlas-header">
        <a className="brand" href="#viewer" aria-label="OS-03-P medical slice atlas">
          <strong>OS-03-P</strong>
          <span>VOLUMETRIC STUDY</span>
          <span>SLICE <b>ARCHIVE</b></span>
        </a>
        <div className="study-meta">
          <span>
            {study
              ? `${study.modality} / ${study.intensityMapping === "hu" ? "HU TISSUE" : "NORMALIZED"} SSS`
              : "MEDICAL IMAGE ARCHIVE"}
          </span>
          <span>{study ? `${study.dimensions.join(" × ")} · ${study.totalSlices} SLICES` : "SESSION / 001"}</span>
          <button className="lighting-toggle" type="button" aria-expanded={lightingOpen} aria-controls="lighting-controls" onClick={() => setLightingOpen(!lightingOpen)} disabled={inspectionOpen}>场景光照</button>
        </div>
      </header>

      <section className="viewer-copy" aria-labelledby="atlas-title" inert={inspectionOpen} aria-hidden={inspectionOpen}>
        <p className="eyebrow">INTERNAL DATABASE / 组织影像</p>
        <h1 id="atlas-title">
          TISSUE<br />IN LAYERS.
        </h1>
        <p className="intro">逐层浏览，观察组织的空间结构。<br />选择影像，建立你的切片档案。</p>
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
                focusedSliceRef.current = null;
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
        tabIndex={inspectionOpen ? -1 : 0}
        role="application"
        aria-label="三维医学切片查看器。鼠标悬停预览，点击或方向键选择并居中，按 Enter 观察切片。"
      >
        <span className="loading-label">INITIALIZING SSS</span>
      </div>

      <div className="selection-actions" inert={inspectionOpen} aria-hidden={inspectionOpen}>
        <div className="selection-kicker">SELECTED SLICE / 当前切片</div>
        <div className="selection-title">{activeSlice === null ? "选择一张切片" : `SLICE NUMBER: S-${String((study?.slices[activeSlice]?.sourceIndex ?? activeSlice) + 1).padStart(3, "0")}`}</div>
        <button ref={observeButtonRef} className="observe-button" type="button" disabled={!ready} onClick={observeSlice}><span>观察切片</span><span>ACCESS SLICE</span></button>
      </div>

      <SliceDetails study={study} index={inspectionIndex} open={inspectionOpen} panelRef={inspectionPanelRef} onClose={closeInspection} />

      <aside className="slice-readout" aria-live="polite" aria-hidden={inspectionOpen}>
        <span className="readout-label">ARCHIVE / SELECT</span>
        <span className="readout-number">{displaySlice}</span>
        <span className="readout-total">/ {String(visibleSliceCount).padStart(2, "0")}</span>
      </aside>

      <aside id="lighting-controls" className="lighting-panel" aria-label="HDR 光照调试控制" hidden={!lightingOpen}>
        <div className="lighting-panel-header">
          <span>HDR LIGHT</span>
          <label className="mode-toggle">
            <input
              type="checkbox"
              checked={lightingControls.darkMode}
              aria-label="切换黑暗模式"
              onChange={(event) => updateLightingControls({ darkMode: event.currentTarget.checked })}
            />
            <span />
          </label>
        </div>
        <div className="lighting-knob-wrap">
          <div
            ref={hdrKnobRef}
            className="lighting-knob"
            role="slider"
            tabIndex={0}
            aria-label="HDR 光照旋转"
            aria-valuemin={LIGHT_ROTATION_MIN}
            aria-valuemax={LIGHT_ROTATION_MAX}
            aria-valuenow={Math.round(lightingControls.rotation)}
            onPointerDown={handleHdrKnobPointerDown}
            onPointerMove={handleHdrKnobPointerMove}
            onPointerUp={handleHdrKnobPointerUp}
            onPointerCancel={handleHdrKnobPointerUp}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const direction = event.key === "ArrowRight" ? 1 : -1;
              updateLightingControls({
                rotation: wrapDegrees(lightingControls.rotation + direction * 5)
              });
            }}
          >
            <div className="lighting-knob-disc" />
            <svg
              className="lighting-knob-outer"
              viewBox="-120 -120 240 240"
              style={{ transform: `rotate(${lightingControls.rotation}deg)` }}
              aria-hidden="true"
            >
              {Array.from({ length: HDR_KNOB_OUTER_TICKS }).map((_, index) => {
                const angle = (index / HDR_KNOB_OUTER_TICKS) * 360 - 90;
                const isMarker = index === 0;
                const outerRadius = 114;
                const innerRadius = isMarker ? 102 : 108;
                const outer = polarPoint(angle, outerRadius);
                const inner = polarPoint(angle, innerRadius);

                return (
                  <line
                    key={`outer-${index}`}
                    x1={outer.x}
                    y1={outer.y}
                    x2={inner.x}
                    y2={inner.y}
                    strokeWidth={isMarker ? 1.6 : 1}
                    strokeLinecap="round"
                    className={isMarker ? "is-marker" : undefined}
                  />
                );
              })}
            </svg>
            <div className="lighting-knob-face">
              <svg className="lighting-knob-inner" viewBox="-100 -100 200 200" aria-hidden="true">
                {Array.from({ length: HDR_KNOB_INNER_TICKS }).map((_, index) => {
                  const angle = (index / HDR_KNOB_INNER_TICKS) * 360 - 90;
                  const outer = polarPoint(angle, 96);
                  const inner = polarPoint(angle, 93);

                  return (
                    <line
                      key={`inner-${index}`}
                      x1={outer.x}
                      y1={outer.y}
                      x2={inner.x}
                      y2={inner.y}
                      strokeWidth={0.7}
                      strokeLinecap="round"
                    />
                  );
                })}
                {Array.from({ length: HDR_KNOB_DOT_COUNT }).map((_, index) => {
                  const angle = (index / HDR_KNOB_DOT_COUNT) * 360 - 90;
                  const point = polarPoint(angle, HDR_KNOB_DOT_RADIUS);

                  return (
                    <circle
                      key={`idle-dot-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r={1.6}
                      className="is-idle"
                    />
                  );
                })}
                {hdrKnobFilledDots > 1 ? (() => {
                  const endAngle = ((hdrKnobFilledDots - 1) / HDR_KNOB_DOT_COUNT) * 360 - 90;
                  const start = polarPoint(-90, HDR_KNOB_DOT_RADIUS);
                  const end = polarPoint(endAngle, HDR_KNOB_DOT_RADIUS);
                  const largeArc = endAngle + 90 > 180 ? 1 : 0;

                  return (
                    <path
                      d={`M ${start.x} ${start.y} A ${HDR_KNOB_DOT_RADIUS} ${HDR_KNOB_DOT_RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y}`}
                      strokeWidth={0.6}
                      strokeOpacity={0.18}
                      fill="none"
                      strokeLinecap="round"
                      className="is-active-arc"
                    />
                  );
                })() : null}
                {Array.from({ length: hdrKnobFilledDots }).map((_, index) => {
                  const angle = (index / HDR_KNOB_DOT_COUNT) * 360 - 90;
                  const point = polarPoint(angle, HDR_KNOB_DOT_RADIUS);
                  const isLead = index === hdrKnobFilledDots - 1;

                  return (
                    <circle
                      key={`active-dot-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r={isLead ? 3.2 : 2.4}
                      className="is-active"
                    />
                  );
                })}
              </svg>
              <span>ROTATE</span>
              <output>{Math.round(lightingControls.rotation)}°</output>
            </div>
          </div>
        </div>
        <label className="lighting-slider">
          <span>
            HDR INTENSITY
            <output>{lightingControls.hdrIntensity.toFixed(2)}</output>
          </span>
          <input
            type="range"
            min={HDR_INTENSITY_MIN}
            max={HDR_INTENSITY_MAX}
            step={HDR_INTENSITY_STEP}
            value={lightingControls.hdrIntensity}
            aria-label="HDR 强度"
            onChange={(event) => {
              updateLightingControls({
                hdrIntensity: clampRange(Number(event.currentTarget.value), HDR_INTENSITY_MIN, HDR_INTENSITY_MAX)
              });
            }}
          />
        </label>
        <label className="lighting-slider">
          <span>
            EXPOSURE
            <output>{lightingControls.exposure.toFixed(2)}</output>
          </span>
          <input
            type="range"
            min={EXPOSURE_MIN}
            max={EXPOSURE_MAX}
            step={EXPOSURE_STEP}
            value={lightingControls.exposure}
            aria-label="曝光"
            onChange={(event) => {
              updateLightingControls({
                exposure: clampRange(Number(event.currentTarget.value), EXPOSURE_MIN, EXPOSURE_MAX)
              });
            }}
          />
        </label>
      </aside>

      <footer className="atlas-footer">
        <div className="interaction-hint">
          {inspectionOpen ? "ESC 返回阵列" : "悬停预览 / 点击居中 / ENTER 观察切片"}
        </div>
        <div className="slice-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="engine-label">OS-03-P / TISSUE ARCHIVE</span>
      </footer>
    </main>
  );
}
