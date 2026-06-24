const SLIDE_W_16x9 = 12192000; // EMUs
const TIMER_X_16x9 = 10992000; // leaves ~1.2" for timer at top-right in 16:9

function hasZipLib() {
  return typeof window.JSZip === "function";
}

function safeText(value, fallback = "") {
  return (value || fallback).toString();
}

function xmlEscape(value) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function questionLabel(question) {
  const points = Number(question.points) || 1;
  const pointWord = points === 1 ? "Pt." : "Pts.";
  return `(${points} ${pointWord}) ${question.question}`;
}

function verseRef(question) {
  const suffix =
    question.endVerse && question.endVerse !== question.startVerse
      ? `-${question.endVerse}`
      : "";
  return `${question.book} ${question.chapter}:${question.startVerse}${suffix}`;
}

// Single body paragraph in the template's Georgia style
function xmlPara(text, spaceBefore = "0") {
  return (
    `<a:p><a:pPr marL="0" lvl="0" indent="0" algn="l" rtl="0">` +
    `<a:spcBef><a:spcPts val="${spaceBefore}"/></a:spcBef>` +
    `<a:spcAft><a:spcPts val="0"/></a:spcAft>` +
    `<a:buClr><a:schemeClr val="dk1"/></a:buClr>` +
    `<a:buSzPts val="3200"/><a:buFont typeface="Georgia"/><a:buNone/></a:pPr>` +
    `<a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(text)}</a:t></a:r>` +
    `<a:endParaRPr/></a:p>`
  );
}

function xmlEmptyPara() {
  return (
    `<a:p><a:pPr marL="0" lvl="0" indent="0" algn="l" rtl="0">` +
    `<a:spcBef><a:spcPts val="640"/></a:spcBef>` +
    `<a:spcAft><a:spcPts val="0"/></a:spcAft><a:buNone/></a:pPr>` +
    `<a:endParaRPr/></a:p>`
  );
}

// Replace body placeholder content; empty string entries produce blank paragraphs
function setBodyContent(slideXml, lines) {
  const paragraphs = lines
    .map((line, i) =>
      line === "" ? xmlEmptyPara() : xmlPara(line, i === 0 ? "0" : "640")
    )
    .join("");

  return slideXml.replace(
    /(<p:ph type="body" idx="1"\/>[\s\S]*?<p:txBody><a:bodyPr[\s\S]*?<a:lstStyle\/>)[\s\S]*?(<\/p:txBody>)/,
    `$1${paragraphs}$2`
  );
}

function setSlideLabel(slideXml, prefix, number) {
  return slideXml.replace(/QUESTION #\d+/, `${prefix} #${number}`);
}

// No autofit change needed — layout mismatch was the real cause of
// inconsistent font sizes; that is fixed by copying the template rels file.

// Center the QUESTION # heading; template uses algn="l" in title placeholder
function centerQuestionTitle(slideXml) {
  return slideXml.replace(
    /(<p:ph type="title"\/>[\s\S]*?<a:pPr[^>]*)algn="l"([^>]*>)/,
    '$1algn="ctr"$2'
  );
}

// Widen title placeholder to span slide minus timer area
// Template: x=2590800 y=520699 cx=6096000 cy=1143000
function widenTitlePlaceholder(slideXml) {
  return slideXml
    .replace('x="2590800" y="520699"', 'x="0" y="520699"')
    .replace('cx="6096000" cy="1143000"', `cx="${TIMER_X_16x9}" cy="1143000"`);
}

// Scale body placeholder for 16:9 canvas
// Template: x=457200 y=1873252 cx=8229600 cy=4561417
function widenBodyPlaceholder(slideXml) {
  return slideXml
    .replace('x="457200" y="1873252"', 'x="609600" y="1873252"')
    .replace('cx="8229600" cy="4561417"', 'cx="10972800" cy="4561417"');
}

// Move all countdown timer boxes to top-right of 16:9 slide
// Template positions them at x="7955280" y="91440"
function moveTimerToTopRight(slideXml) {
  return slideXml.replace(/x="7955280" y="91440"/g, `x="${TIMER_X_16x9}" y="91440"`);
}

// --- Title slide (slide1) ---

// Remove only the subTitle sp block without crossing into ctrTitle.
// The negative lookahead (?!<\/p:sp>) prevents the match from consuming
// a </p:sp> before reaching the subTitle placeholder, keeping ctrTitle intact.
function removeTitleSubtitle(slideXml) {
  return slideXml.replace(
    /<p:sp>(?:(?!<\/p:sp>)[\s\S])*<p:ph type="subTitle"[\s\S]*?<\/p:sp>/,
    ""
  );
}

// Widen ctrTitle to full 16:9 width (text already algn="ctr" in template)
// Template: x=158751 y=1799167 cx=8815917 cy=2497667
function widenTitleCoverShape(slideXml) {
  return slideXml
    .replace('x="158751" y="1799167"', 'x="0" y="1799167"')
    .replace('cx="8815917" cy="2497667"', `cx="${SLIDE_W_16x9}" cy="2497667"`);
}

// --- Slide 3 (ABC reference) ---

// Template: x=726141 y=1717612 cx=7691718 cy=3422775
function centerSlide3Shape(slideXml) {
  return slideXml
    .replace('x="726141" y="1717612"', 'x="0" y="1717612"')
    .replace('cx="7691718" cy="3422775"', `cx="${SLIDE_W_16x9}" cy="3422775"`);
}

// --- Presentation XML ---

function convertTo16x9(presentationXml) {
  return presentationXml.replace(
    /<p:sldSz[^>]*\/>/,
    '<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>'
  );
}

// Keep slide1, skip slide2 (disclaimer), keep slide3, then Q/A pairs
function trimSlideList(presentationXml, questionCount) {
  const entries = Array.from(
    presentationXml.matchAll(/<p:sldId[^>]*\/>/g)
  ).map((m) => m[0]);

  const needed = 3 + questionCount * 2;
  if (needed > entries.length) {
    throw new Error(
      `Template only supports up to ${Math.floor((entries.length - 3) / 2)} questions.`
    );
  }

  const kept = [
    entries[0], // slide1 – title
    // entries[1] removed – slide2 disclaimer
    entries[2], // slide3 – ABC reference
    ...entries.slice(3, 3 + questionCount * 2),
  ];

  return presentationXml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${kept.join("")}</p:sldIdLst>`
  );
}

// --- Download ---

function triggerDownload(blob, fileName) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

function base64ToUint8Array(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function loadTemplateZip() {
  const embedded = window.PBE_TEMPLATE_PPTX_BASE64;
  if (typeof embedded === "string" && embedded.length > 0) {
    return window.JSZip.loadAsync(base64ToUint8Array(embedded));
  }

  try {
    const response = await fetch("2023-NAD-PBE-Practice-Test.pptx");
    if (!response.ok) throw new Error();
    const buffer = await response.arrayBuffer();
    return window.JSZip.loadAsync(buffer);
  } catch {
    throw new Error(
      "Failed to load template PPTX. Run: node scripts/build-local-bundle.mjs"
    );
  }
}

export async function exportPowerPoint({ questions, yearName }) {
  if (!hasZipLib()) {
    throw new Error("JSZip library not loaded. Ensure assets/vendor/jszip.min.js is present.");
  }

  if (!questions.length) {
    throw new Error("No generated questions to export.");
  }

  const zip = await loadTemplateZip();

  // Title slide: remove subtitle block, widen ctrTitle for 16:9
  let slide1Xml = await zip.file("ppt/slides/slide1.xml").async("string");
  slide1Xml = removeTitleSubtitle(slide1Xml);
  slide1Xml = widenTitleCoverShape(slide1Xml);
  zip.file("ppt/slides/slide1.xml", slide1Xml);

  // Slide 3: center/widen text shape for 16:9
  let slide3Xml = await zip.file("ppt/slides/slide3.xml").async("string");
  slide3Xml = centerSlide3Shape(slide3Xml);
  zip.file("ppt/slides/slide3.xml", slide3Xml);

  // Clone template question/answer slides
  const tmplQ = await zip.file("ppt/slides/slide100.xml").async("string");
  const tmplA = await zip.file("ppt/slides/slide101.xml").async("string");
  // Minimal rels: only the slideLayout relationship (slideLayout2 is used by
  // the template question/answer slides). Omit the notes slide reference to
  // avoid broken back-references when the same notes file is reused.
  const slideRels = (layout) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/${layout}"/>` +
    `</Relationships>`;
  const qRels = slideRels("slideLayout2.xml");
  const aRels = slideRels("slideLayout2.xml");

  for (let i = 0; i < questions.length; i += 1) {
    const index = i + 1;
    const question = questions[i];
    const ref = verseRef(question);
    const qSlideNum = 4 + i * 2;
    const aSlideNum = qSlideNum + 1;

    // Question slide layout:
    //   Line 1: "According to {ref}"
    //   Line 2: empty
    //   Line 3: "(N Pt.) full question text"
    let qXml = tmplQ;
    qXml = setSlideLabel(qXml, "QUESTION", index);
    qXml = centerQuestionTitle(qXml);
    qXml = widenTitlePlaceholder(qXml);
    qXml = widenBodyPlaceholder(qXml);
    qXml = moveTimerToTopRight(qXml);
    qXml = setBodyContent(qXml, [
      `According to ${ref}`,
      "",
      questionLabel(question),
    ]);
    zip.file(`ppt/slides/slide${qSlideNum}.xml`, qXml);
    zip.file(`ppt/slides/_rels/slide${qSlideNum}.xml.rels`, qRels);

    // Answer slide layout:
    //   Line 1: full question text
    //   Line 2: empty
    //   Line 3: "Answer: {answer}"
    //   Line 4: empty
    //   Line 5: verse reference
    let aXml = tmplA;
    aXml = setSlideLabel(aXml, "ANSWER", index);
    aXml = centerQuestionTitle(aXml);
    aXml = widenTitlePlaceholder(aXml);
    aXml = widenBodyPlaceholder(aXml);
    aXml = moveTimerToTopRight(aXml);
    aXml = setBodyContent(aXml, [
      questionLabel(question),
      "",
      `Answer: ${safeText(question.answer, "")}`,
      "",
      ref,
    ]);
    zip.file(`ppt/slides/slide${aSlideNum}.xml`, aXml);
    zip.file(`ppt/slides/_rels/slide${aSlideNum}.xml.rels`, aRels);
  }

  // Update presentation: trim slide list, set 16:9
  let presXml = await zip.file("ppt/presentation.xml").async("string");
  presXml = trimSlideList(presXml, questions.length);
  presXml = convertTo16x9(presXml);
  zip.file("ppt/presentation.xml", presXml);

  const datePart = new Date().toISOString().slice(0, 10);
  const fileName = `PBE-Quiz-${safeText(yearName, "2026-2027").replace(/\s+/g, "-")}-${datePart}.pptx`;
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, fileName);
}
