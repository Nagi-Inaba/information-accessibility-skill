import { inflateRawSync } from "node:zlib";
import { worksheetHeader, validateGrid, outcomes, evidenceTypes, worksheetLimit } from "./human-review-worksheet.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = (bytes) => { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };

// Validate compressed input before the general-purpose workbook reader sees it.
// Nothing is extracted or executed; XML-only, bounded, single-workbook input.
export function validateWorksheetZip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > worksheetLimit || bytes.length < 22) throw new Error("XLSX input exceeds the compressed size limit or is invalid.");
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0) throw new Error("XLSX ZIP end record is missing.");
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count > 256 || start + size !== end) throw new Error("Unsupported XLSX archive layout, ZIP64, or entry count.");
  const names = new Set(), ranges = []; let at = start, total = 0;
  const extras = (offset, length) => {
    const limit = offset + length;
    while (offset < limit) {
      if (offset + 4 > limit) throw new Error("Malformed XLSX ZIP extra field.");
      const kind = bytes.readUInt16LE(offset), n = bytes.readUInt16LE(offset + 2);
      if ([1, 0x7075, 0x6375].includes(kind) || offset + 4 + n > limit) throw new Error("Unsupported ZIP64 or alternate ZIP name metadata.");
      offset += 4 + n;
    }
  };
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new Error("Invalid XLSX central directory.");
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10), crc = bytes.readUInt32LE(at + 16);
    const compressed = bytes.readUInt32LE(at + 20), expanded = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28), extraLength = bytes.readUInt16LE(at + 30), commentLength = bytes.readUInt16LE(at + 32), offset = bytes.readUInt32LE(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    // Bits 1/2 are legitimate DEFLATE compression hints used by Excel itself.
    if (next > end || flags & ~0x80e || (method === 0 && flags & 6) || ![0, 8].includes(method) || bytes.readUInt16LE(at + 34) || expanded > 8 * 1024 * 1024 || offset + 30 > start) throw new Error("Unsupported or oversized XLSX entry.");
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = decoder.decode(nameBytes);
    if (!/^(?:\[Content_Types\]\.xml|(?:_rels|docProps|xl)(?:\/[A-Za-z0-9_.-]+)*\/?)(?:)$/u.test(name) || name.includes("..") || names.has(name)
        || /(?:vba|externalLinks|connections|embeddings|activeX|customXml)/iu.test(name) || (!name.endsWith("/") && !/\.(?:xml|rels)$/u.test(name))) throw new Error(`Unsupported or duplicate XLSX part: ${name}`);
    names.add(name); extras(at + 46 + nameLength, extraLength);
    if (bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method) throw new Error("XLSX local ZIP header mismatch.");
    const localNameLength = bytes.readUInt16LE(offset + 26), localExtraLength = bytes.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
    if (dataEnd > start || !bytes.subarray(offset + 30, offset + 30 + localNameLength).equals(nameBytes)) throw new Error("XLSX entry bounds or local name mismatch.");
    extras(offset + 30 + localNameLength, localExtraLength);
    if (!(flags & 8) && (bytes.readUInt32LE(offset + 14) !== crc || bytes.readUInt32LE(offset + 18) !== compressed || bytes.readUInt32LE(offset + 22) !== expanded)) throw new Error("XLSX entry size or checksum metadata mismatch.");
    if (ranges.some(([a, b]) => offset < b && dataEnd > a)) throw new Error("Overlapping XLSX entries.");
    ranges.push([offset, dataEnd]);
    const data = method === 0 ? bytes.subarray(dataStart, dataEnd) : inflateRawSync(bytes.subarray(dataStart, dataEnd), { maxOutputLength: 8 * 1024 * 1024 });
    total += data.length;
    if (data.length !== expanded || total > 32 * 1024 * 1024 || crc32(data) !== crc) throw new Error("XLSX uncompressed size or checksum mismatch.");
    if (!name.endsWith("/")) {
      const xml = decoder.decode(data);
      if (xml.includes("\0") || /<!\s*(?:DOCTYPE|ENTITY)|<\s*(?:[\w.-]+:)?f(?:\s|\/?>)|TargetMode\s*=|macroEnabled|vbaProject/iu.test(xml)) throw new Error("XLSX formulas, external relationships, macros and XML entities are not accepted.");
      if (/^xl\/worksheets\/sheet\d+\.xml$/u.test(name)) {
        for (const match of xml.matchAll(/<(?:[\w.-]+:)?(row|c)\b[^>]*\br\s*=\s*["']([^"']+)["']/gu)) {
          if (match[1] === "row" ? !/^[1-9]\d{0,4}$/u.test(match[2]) || Number(match[2]) > 12000 : !/^[A-F][1-9]\d{0,4}$/u.test(match[2]) || Number(match[2].slice(1)) > 12000) throw new Error("XLSX cell address exceeds worksheet bounds.");
        }
      }
    } else if (data.length) throw new Error("XLSX directory entry contains data.");
    at = next;
  }
  if (at !== end || !names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) throw new Error("XLSX workbook parts are missing or malformed.");
}

async function workbook() {
  try { const { default: ExcelJS } = await import("exceljs"); return new ExcelJS.Workbook(); }
  catch (error) { if (error.code === "ERR_MODULE_NOT_FOUND") throw new Error("XLSX support requires the packaged exceljs dependency. Run npm install --ignore-scripts in the skill directory, or use CSV/Markdown."); throw error; }
}

export async function encodeXlsx(rows) {
  validateGrid(rows);
  const book = await workbook(); book.creator = "accessibility-audit";
  const sheet = book.addWorksheet("人手レビュー", { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  sheet.columns = [24, 38, 10, 24, 86, 64].map((width) => ({ width }));
  for (const [index, values] of rows.entries()) {
    const row = sheet.addRow(values);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.numFmt = "@";
      cell.font = { name: "Yu Gothic", size: 11, color: { argb: "FF172B3A" } };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index === 0 ? "FF16384B" : values[2] === "入力" && col === 5 ? "FFFFF4C4" : "FFF1F5F8" } };
      if (index === 0) cell.font = { ...cell.font, bold: true, color: { argb: "FFFFFFFF" } };
      cell.protection = { locked: !(values[2] === "入力" && col === 5) };
    });
    const key = values[0], choices = key.endsWith(".outcome") ? outcomes : key.endsWith(".finding.priority") ? ["P0", "P1", "P2"] : key.endsWith(".type") && values[2] === "入力" ? evidenceTypes : null;
    if (choices) row.getCell(5).dataValidation = { type: "list", allowBlank: true, formulae: [`"${choices.join(",")}"`], showErrorMessage: true, errorTitle: "選択肢から入力", error: "記載された値を選択してください。", errorStyle: "stop" };
    row.height = Math.min(240, Math.max(34, 18 * Math.max(...values.slice(3).map((value) => value.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 38)), 0)))));
  }
  sheet.getColumn(1).hidden = true;
  sheet.autoFilter = { from: "B1", to: "F1" };
  sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };
  // Protection is an editing aid, never a signature or authenticity boundary.
  await sheet.protect("", { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, formatRows: true, spinCount: 1000 });
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  validateWorksheetZip(bytes);
  return bytes;
}

export async function decodeXlsx(bytes) {
  validateWorksheetZip(bytes);
  const book = await workbook(); await book.xlsx.load(bytes);
  if (book.worksheets.length !== 1 || book.worksheets[0].name !== "人手レビュー") throw new Error("XLSX must contain exactly the exported review worksheet.");
  const sheet = book.worksheets[0];
  if (sheet.rowCount > 12000 || sheet.columnCount !== worksheetHeader.length || sheet.model.merges?.length) throw new Error("XLSX row/column bounds or merged cells are unsupported.");
  const rows = [];
  for (let index = 1; index <= sheet.rowCount; index++) {
    const row = [];
    for (let col = 1; col <= worksheetHeader.length; col++) {
      const value = sheet.getCell(index, col).value;
      if (value !== null && typeof value !== "string") throw new Error(`XLSX cells must be plain text (no formulas, dates, numbers, hyperlinks or rich text): row ${index}, column ${col}`);
      row.push(value ?? "");
    }
    rows.push(row);
  }
  validateGrid(rows); return rows;
}
