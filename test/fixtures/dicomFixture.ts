import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DICOM_FIXTURE_SERIES_UID = "1.2.826.0.1.3680043.10.543.100";

const STUDY_UID = "1.2.826.0.1.3680043.10.543.10";
const CT_STORAGE_UID = "1.2.840.10008.5.1.4.1.1.2";

function padded(value: string, pad = 0x20): Buffer {
  const bytes = Buffer.from(value, "ascii");
  return bytes.length % 2 === 0 ? bytes : Buffer.concat([bytes, Buffer.from([pad])]);
}

function ushort(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function ulong(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function element(group: number, tag: number, vr: string, value: Buffer): Buffer {
  const longLengthVr = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UR", "UT", "UN"]);
  const header = Buffer.alloc(longLengthVr.has(vr) ? 12 : 8);
  header.writeUInt16LE(group, 0);
  header.writeUInt16LE(tag, 2);
  header.write(vr, 4, 2, "ascii");
  if (longLengthVr.has(vr)) {
    header.writeUInt32LE(value.length, 8);
  } else {
    header.writeUInt16LE(value.length, 6);
  }
  return Buffer.concat([header, value]);
}

function dicomSlice(instance: number): Buffer {
  const sopUid = `1.2.826.0.1.3680043.10.543.100.${instance}`;
  const metaBody = Buffer.concat([
    element(0x0002, 0x0001, "OB", Buffer.from([0, 1])),
    element(0x0002, 0x0002, "UI", padded(CT_STORAGE_UID, 0)),
    element(0x0002, 0x0003, "UI", padded(sopUid, 0)),
    element(0x0002, 0x0010, "UI", padded("1.2.840.10008.1.2.1", 0)),
    element(0x0002, 0x0012, "UI", padded("1.2.826.0.1.3680043.10.543.999", 0)),
    element(0x0002, 0x0013, "SH", padded("THREEVTK_1"))
  ]);
  const pixels = Buffer.alloc(8);
  [-1000, -100 + instance * 20, 55 + instance * 15, 1200].forEach((value, index) => {
    pixels.writeInt16LE(value, index * 2);
  });
  const dataset = Buffer.concat([
    element(0x0008, 0x0016, "UI", padded(CT_STORAGE_UID, 0)),
    element(0x0008, 0x0018, "UI", padded(sopUid, 0)),
    element(0x0008, 0x0060, "CS", padded("CT")),
    element(0x0008, 0x103e, "LO", padded("Tiny generated CT")),
    element(0x0018, 0x0050, "DS", padded("1")),
    element(0x0020, 0x000d, "UI", padded(STUDY_UID, 0)),
    element(0x0020, 0x000e, "UI", padded(DICOM_FIXTURE_SERIES_UID, 0)),
    element(0x0020, 0x0011, "IS", padded("1")),
    element(0x0020, 0x0013, "IS", padded(String(instance))),
    element(0x0020, 0x0032, "DS", padded(`0\\0\\${instance - 1}`)),
    element(0x0020, 0x0037, "DS", padded("1\\0\\0\\0\\1\\0")),
    element(0x0028, 0x0002, "US", ushort(1)),
    element(0x0028, 0x0004, "CS", padded("MONOCHROME2")),
    element(0x0028, 0x0010, "US", ushort(2)),
    element(0x0028, 0x0011, "US", ushort(2)),
    element(0x0028, 0x0030, "DS", padded("1\\1")),
    element(0x0028, 0x0100, "US", ushort(16)),
    element(0x0028, 0x0101, "US", ushort(16)),
    element(0x0028, 0x0102, "US", ushort(15)),
    element(0x0028, 0x0103, "US", ushort(1)),
    element(0x7fe0, 0x0010, "OW", pixels)
  ]);
  const preamble = Buffer.alloc(132);
  preamble.write("DICM", 128, 4, "ascii");
  return Buffer.concat([preamble, element(0x0002, 0x0000, "UL", ulong(metaBody.length)), metaBody, dataset]);
}

export async function writeDicomFixtureSeries(directory: string): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const filePaths = [join(directory, "slice-1.dcm"), join(directory, "slice-2.dcm")];
  await Promise.all(filePaths.map((filePath, index) => writeFile(filePath, dicomSlice(index + 1))));
  return filePaths;
}
