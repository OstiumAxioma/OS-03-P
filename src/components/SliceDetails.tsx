"use client";

import { useRef, useState, type RefObject } from "react";
import type { StudyPayload } from "@/lib/studyTypes";

type Props = {
  study: StudyPayload | null;
  index: number;
  open: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
};

export default function SliceDetails({ study, index, open, panelRef, onClose }: Props) {
  const [tab, setTab] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const slice = study?.slices[index];
  const sourceIndex = slice?.sourceIndex ?? index;
  const serial = String(sourceIndex + 1).padStart(3, "0");
  const mm = (value: number) => `${value.toFixed(2)} mm`;
  const tabs = ["切片概述", "采样参数", "显示说明"];

  return (
    <div className="inspection-ui" ref={panelRef} data-open={open} inert={!open} aria-hidden={!open} role="dialog" aria-modal={open ? true : undefined} aria-labelledby="slice-detail-title">
      <button className="inspection-back" type="button" onClick={onClose}>返回阵列 <kbd>ESC</kbd></button>
      <div className="object-caption"><span>S-{serial}</span><p>OS-03-P / {study?.modality ?? "EMPTY CASSETTE"}</p><small>{study ? "TISSUE SLICE · AXIAL PLANE" : "等待载入组织影像"}</small></div>
      <section className="inspection-content" aria-labelledby="slice-detail-title">
        <div className="detail-kicker"><span>SLICE ARCHIVE / 切片档案</span><span>{study ? "IMAGE LOADED" : "EMPTY CASSETTE"}</span></div>
        <h2 id="slice-detail-title">{study?.modality ?? "TISSUE"} / SLICE {serial}</h2>
        <div className="detail-title-cn">{study ? "轴向组织切片" : "组织切片载体"}<span>{study?.sourceType.toUpperCase() ?? "PREVIEW"}</span></div>
        <div className="detail-rule" />
        <dl className="detail-metadata">
          <div><dt>SLICE INDEX / 原始层号</dt><dd>{study ? `${sourceIndex + 1} / ${study.totalSlices}` : "未载入影像"}</dd></div>
          <div><dt>DIMENSIONS / 原始尺寸</dt><dd>{study ? `${study.dimensions[0]} × ${study.dimensions[1]} px` : "—"}</dd></div>
          <div><dt>SPACING / 层间距</dt><dd>{study ? mm(study.spacing[2]) : "—"}</dd></div>
          <div><dt>OFFSET / 序列相对位置</dt><dd>{study ? mm(sourceIndex * study.spacing[2]) : "—"}</dd></div>
        </dl>
        <div className="detail-tabs" role="tablist" aria-label="切片信息分类">
          {tabs.map((label, i) => <button key={label} ref={(node) => { tabRefs.current[i] = node; }} id={`slice-tab-${i}`} type="button" role="tab" aria-selected={tab === i} aria-controls={`slice-panel-${i}`} tabIndex={tab === i ? 0 : -1} onClick={() => setTab(i)} onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (i + (event.key === "ArrowRight" ? 1 : 2)) % 3;
            setTab(next);
            tabRefs.current[next]?.focus();
          }}><span>0{i + 1}</span>{label}</button>)}
        </div>
        <div className="detail-tab-panel" role="tabpanel" id={`slice-panel-${tab}`} aria-labelledby={`slice-tab-${tab}`} tabIndex={0}>
          <span className="panel-label">{["OVERVIEW", "SAMPLING PARAMETERS", "DISPLAY NOTES"][tab]}</span>
          {tab === 0 && <p>{study ? `当前为 ${study.totalSlices} 层影像中的第 ${sourceIndex + 1} 层，以透明载体呈现组织结构。${study.intensityMapping === "hu" ? "组织颜色根据 CT 的 HU 强度连续映射，空气区域透明显示。" : "组织颜色按影像强度范围归一化映射，不代表 HU 值。"}` : "这是用于承载医学影像的玻璃切片盒。返回阵列后上传 DICOM 或 NIfTI，即可在此查看当前层的组织结构与采样信息。"}</p>}
          {tab === 1 && <dl className="detail-sampling"><div><dt>像素间距 X / Y</dt><dd>{study ? `${study.spacing[0].toFixed(3)} / ${study.spacing[1].toFixed(3)} mm` : "—"}</dd></div><div><dt>物理宽度 / 高度</dt><dd>{study ? `${(study.dimensions[0] * study.spacing[0]).toFixed(2)} / ${(study.dimensions[1] * study.spacing[1]).toFixed(2)} mm` : "—"}</dd></div><div><dt>显示纹理尺寸</dt><dd>{slice ? `${slice.width} × ${slice.height} px` : "—"}</dd></div><div><dt>强度映射</dt><dd>{study ? study.intensityMapping === "hu" ? "HU / CT" : "NORMALIZED" : "—"}</dd></div></dl>}
          {tab === 2 && <p>厚度倍率仅改变可视化中的厚度，不改变原始采样间距。相对位置按原始层索引与层间距计算，以序列首层为零点；不表示患者坐标。组织着色与半透明效果用于观察，不是诊断分割结果。</p>}
        </div>
        <div className="detail-footnote"><span>OS-03-P / VOLUMETRIC STUDY</span><span>{study ? `${study.slices.length} SLICES DECODED` : "NO STUDY LOADED"}</span></div>
      </section>
    </div>
  );
}
