// Reads and writes the "my own questions" spreadsheet (.xlsx, which is a zip of XML files).
// JSZip is passed in, so the page can load it on demand and tests can load it directly.

import { CUSTOM_COLUMNS, MAX_POINTS, questionToRow } from "./custom-questions.js";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const QUESTIONS_SHEET = "Questions";
export const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_XML_CHARS = 25 * 1024 * 1024;
const LAST_ROW = 5000;

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Column widths and whether the column is plain text (so Excel can't turn "5-7" into a date)
const COLUMN_LAYOUT = [
  { width: 18, style: 2 },
  { width: 10, style: 3 },
  { width: 12, style: 2 },
  { width: 9, style: 3 },
  { width: 60, style: 4 },
  { width: 40, style: 4 },
];

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnLetter(index) {
  return String.fromCharCode(65 + index);
}

function textCell(column, row, value, style) {
  return `<c r="${columnLetter(column)}${row}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function numberCell(column, row, value, style) {
  return `<c r="${columnLetter(column)}${row}" s="${style}"><v>${Number(value)}</v></c>`;
}

function sheetXml({ columns, rows, validations = "", frozen = false, selected = false }) {
  const cols = columns
    .map((col, index) => `<col min="${index + 1}" max="${index + 1}" width="${col.width}" style="${col.style}" customWidth="1"/>`)
    .join("");
  const pane = frozen ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : "";
  return (
    XML_HEAD +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${rows}</sheetData>${validations}</worksheet>`
  );
}

function questionsSheet(questions, bookCount) {
  const header = CUSTOM_COLUMNS.map((name, column) => textCell(column, 1, name, 1)).join("");
  let rows = `<row r="1" ht="22" customHeight="1">${header}</row>`;
  questions.forEach((question, index) => {
    const number = index + 2;
    const cells = questionToRow(question).map((value, column) => {
      if (value === "" || value == null) {
        return "";
      }
      // Chapter and points are numbers; everything else (including "5-7" verses) is text
      return column === 1 || column === 3
        ? numberCell(column, number, value, COLUMN_LAYOUT[column].style)
        : textCell(column, number, value, COLUMN_LAYOUT[column].style);
    });
    rows += `<row r="${number}">${cells.join("")}</row>`;
  });

  const validations =
    `<dataValidations count="3">` +
    `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Book" error="Pick a book from the list, or leave it empty." sqref="A2:A${LAST_ROW}"><formula1>Lists!$A$2:$A$${bookCount + 1}</formula1></dataValidation>` +
    `<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Chapter" error="Use a whole chapter number." sqref="B2:B${LAST_ROW}"><formula1>0</formula1><formula2>150</formula2></dataValidation>` +
    `<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Points" error="Use a whole number of points from 1 to ${MAX_POINTS}." sqref="D2:D${LAST_ROW}"><formula1>1</formula1><formula2>${MAX_POINTS}</formula2></dataValidation>` +
    `</dataValidations>`;

  return sheetXml({ columns: COLUMN_LAYOUT, rows, validations, frozen: true, selected: true });
}

const INSTRUCTIONS = [
  "Add your own questions to the PBE Quiz Builder",
  "",
  "1. Type one question per row on the Questions sheet.",
  "2. Question, Answer and Points are all you need. Book, Chapter and Verse(s) are optional.",
  "3. Save the file, then choose it under \"My own questions\" on the Quiz Builder page.",
  "",
  "Question: the whole question, as it should be read out.",
  "Answer: the answer people should give.",
  "Points: a whole number from 1 to " + MAX_POINTS + ". One point is easy, two is medium, three or more is hard.",
  "Book, Chapter: pick the book from the list and type the chapter number (0 is a book's introduction).",
  "Verse(s): a single verse such as 5, or a range such as 5-7. Leave it empty if the question covers the whole chapter.",
  "",
  "A question with no book and chapter still works in quizzes, printouts and slides, but it can't be picked by chapter,",
  "and it has no verse text to show with its answer.",
  "",
  "Your questions stay on this device. You can upload the same file again after editing it: questions that are already",
  "there are updated rather than added twice.",
];

function instructionsSheet() {
  const rows = INSTRUCTIONS.map((line, index) =>
    line ? `<row r="${index + 1}">${textCell(0, index + 1, line, index === 0 ? 1 : 4)}</row>` : ""
  ).join("");
  return sheetXml({ columns: [{ width: 110, style: 4 }], rows });
}

function listsSheet(bookNames) {
  const rows = [`<row r="1">${textCell(0, 1, "Books", 1)}</row>`]
    .concat(bookNames.map((name, index) => `<row r="${index + 2}">${textCell(0, index + 2, name, 4)}</row>`))
    .join("");
  return sheetXml({ columns: [{ width: 24, style: 4 }], rows });
}

const STYLES_XML =
  XML_HEAD +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFA3123A"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
  // 2: text (Book, Verse(s)), so "5-7" stays "5-7"
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  // 3: numbers (Chapter, Points)
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' +
  // 4: long text (Question, Answer)
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '</cellXfs></styleSheet>';

// `manifest` supplies the book list; `questions` pre-fills the Questions sheet (none for the blank template)
export async function buildWorkbook(JSZip, { manifest, questions = [] }) {
  const bookNames = (manifest?.books || []).map((book) => book.name);
  const zip = new JSZip();
  const sheets = [
    { name: QUESTIONS_SHEET, xml: questionsSheet(questions, bookNames.length), state: "" },
    { name: "How to fill this in", xml: instructionsSheet(), state: "" },
    { name: "Lists", xml: listsSheet(bookNames), state: ' state="hidden"' },
  ];

  zip.file(
    "[Content_Types].xml",
    XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("") +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>"
  );
  zip.file(
    "_rels/.rels",
    XML_HEAD +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  zip.file(
    "xl/workbook.xml",
    XML_HEAD +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>` +
      sheets.map((sheet, i) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}"${sheet.state} r:id="rId${i + 1}"/>`).join("") +
      "</sheets></workbook>"
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_TYPE}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL_TYPE}/styles" Target="styles.xml"/>` +
      "</Relationships>"
  );
  zip.file("xl/styles.xml", STYLES_XML);
  sheets.forEach((sheet, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheet.xml));

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: XLSX_MIME });
}

// --- Reading ---

function parseXml(text) {
  if (text.length > MAX_XML_CHARS) {
    throw new Error("That spreadsheet is too large.");
  }
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("That file isn't a readable spreadsheet.");
  }
  return doc;
}

// Matches by tag name without its prefix, since other programs write <x:c> as well as <c>.
// Names are compared in lower case so a parser that treats the file as HTML still works.
function elements(parent, localName) {
  const wanted = localName.toLowerCase();
  return Array.from(parent.getElementsByTagName("*")).filter(
    (node) => (node.localName || node.nodeName.split(":").pop()).toLowerCase() === wanted
  );
}

function attribute(node, name) {
  return node.getAttribute(name) ?? node.getAttribute(name.toLowerCase());
}

function textOf(node) {
  return elements(node, "t")
    .map((part) => part.textContent)
    .join("");
}

function columnIndex(ref) {
  let index = 0;
  for (const char of /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() || "") {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

async function readText(zip, path) {
  const file = zip.file(path);
  return file ? file.async("string") : null;
}

// Resolves "worksheets/sheet1.xml" or "/xl/worksheets/sheet1.xml" to a zip path
function sheetPath(target) {
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

// The cells of the "Questions" sheet (or the first visible one) as a grid of text, row 1 first
export async function readWorkbookRows(JSZip, buffer) {
  if (buffer.byteLength > MAX_XLSX_BYTES) {
    throw new Error("That spreadsheet is too large (over 5 MB).");
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("That file isn't an Excel spreadsheet (.xlsx).");
  }

  const workbookText = await readText(zip, "xl/workbook.xml");
  const relsText = await readText(zip, "xl/_rels/workbook.xml.rels");
  if (!workbookText || !relsText) {
    throw new Error("That file isn't an Excel spreadsheet (.xlsx).");
  }

  const targets = new Map(
    elements(parseXml(relsText), "Relationship").map((rel) => [attribute(rel, "Id"), attribute(rel, "Target")])
  );
  const sheets = elements(parseXml(workbookText), "sheet").map((sheet) => ({
    name: attribute(sheet, "name") || "",
    hidden: Boolean(attribute(sheet, "state")),
    target: targets.get(attribute(sheet, "r:id") ?? sheet.getAttributeNS(NS_REL, "id")),
  }));
  const chosen =
    sheets.find((sheet) => sheet.name.toLowerCase() === QUESTIONS_SHEET.toLowerCase()) ||
    sheets.find((sheet) => !sheet.hidden && sheet.target);
  if (!chosen?.target) {
    throw new Error("That spreadsheet has no sheets.");
  }

  const sharedText = await readText(zip, "xl/sharedStrings.xml");
  const shared = sharedText ? elements(parseXml(sharedText), "si").map(textOf) : [];

  const sheetText = await readText(zip, sheetPath(chosen.target));
  if (!sheetText) {
    throw new Error("Couldn't read the sheet in that spreadsheet.");
  }

  const rows = [];
  for (const rowNode of elements(parseXml(sheetText), "row")) {
    const rowIndex = Number(rowNode.getAttribute("r")) - 1;
    const cells = [];
    let next = 0;
    for (const cell of elements(rowNode, "c")) {
      const ref = cell.getAttribute("r");
      const column = ref ? columnIndex(ref) : next;
      next = column + 1;
      const type = cell.getAttribute("t");
      const valueNode = elements(cell, "v")[0];
      const value = valueNode ? valueNode.textContent : "";
      cells[column] =
        type === "s"
          ? shared[Number(value)] ?? ""
          : type === "inlineStr"
            ? textOf(cell)
            : type === "b"
              ? value === "1" ? "TRUE" : "FALSE"
              : type === "e"
                ? ""
                : value;
    }
    rows[Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : rows.length] = Array.from(cells, (c) => c ?? "");
  }
  return Array.from(rows, (row) => row || []);
}
