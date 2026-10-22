const SLIDE_W_16x9 = 12192000; // EMUs
const ANSWER_RED = "FF0000";
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
// `text` is a string or an array of { text, color } runs; `size` (1/100 pt) overrides font size
function xmlRuns(text, size) {
  const runs = Array.isArray(text) ? text : [{ text }];
  const sz = size ? ` sz="${size}"` : "";
  return runs
    .map(
      (run) =>
        `<a:r><a:rPr lang="en-US"${sz}>${run.color ? `<a:solidFill><a:srgbClr val="${run.color}"/></a:solidFill>` : ""}</a:rPr><a:t>${xmlEscape(run.text)}</a:t></a:r>`
    )
    .join("");
}

function xmlPara(text, spaceBefore = "0", size = null) {
  return (
    `<a:p><a:pPr marL="0" lvl="0" indent="0" algn="l" rtl="0">` +
    `<a:spcBef><a:spcPts val="${spaceBefore}"/></a:spcBef>` +
    `<a:spcAft><a:spcPts val="0"/></a:spcAft>` +
    `<a:buClr><a:schemeClr val="dk1"/></a:buClr>` +
    `<a:buSzPts val="3200"/><a:buFont typeface="Georgia"/><a:buNone/></a:pPr>` +
    xmlRuns(text, size) +
    `<a:endParaRPr/></a:p>`
  );
}

// Split verse text into runs, coloring red the first case-insensitive match of the answer
function redAnswerRuns(text, answer) {
  const needle = safeText(answer).trim();
  const index = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (index < 0) {
    return [{ text }];
  }
  return [
    { text: text.slice(0, index) },
    { text: text.slice(index, index + needle.length), color: ANSWER_RED },
    { text: text.slice(index + needle.length) },
  ].filter((run) => run.text);
}

// Bible API text can carry inline markup such as <i>…</i> and HTML entities
function cleanVerseText(text) {
  return safeText(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function verseTextRuns(verses, answer) {
  const full = verses.map((v) => `${v.verse} ${cleanVerseText(v.text)}`).join(" ");
  return redAnswerRuns(full, answer);
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
    .map((line, i) => {
      if (line === "") return xmlEmptyPara();
      const spec = line.runs ? line : { runs: line };
      return xmlPara(spec.runs, i === 0 ? "0" : "640", spec.size);
    })
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

// --- Countdown timer ---
// The template ships a fixed 30 s timer: 31 stacked number boxes plus an
// animation that hides one box per second. Rebuild it for any length instead.

const TIMER_BOX_RE =
  /<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<a:off x="7955280" y="91440"\/>(?:(?!<\/p:sp>)[\s\S])*?<\/p:sp>/g;
const TIMER_ID_BASE = 3000;
const TIMER_YELLOW_AT = 10; // seconds remaining at which digits turn yellow

function removeTimer(slideXml) {
  return slideXml
    .replace(TIMER_BOX_RE, "")
    .replace(/<p:timing>[\s\S]*?<\/p:timing>/, "");
}

function secondsForQuestion(question, timer) {
  const points = Math.max(1, Number(question.points) || 1);
  return Math.max(1, timer.first + (points - 1) * timer.additional);
}

function timerBoxXml(n, seconds) {
  const wide = seconds >= 100;
  const cx = wide ? 1600000 : 1076770;
  const x = wide ? SLIDE_W_16x9 - cx - 100000 : TIMER_X_16x9;
  const color = n <= TIMER_YELLOW_AT ? '<a:srgbClr val="FFFF00"/>' : '<a:schemeClr val="dk1"/>';
  const id = TIMER_ID_BASE + n;
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Timer ${n}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="91440"/><a:ext cx="${cx}" cy="1015663"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4F5581"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr spcFirstLastPara="1" wrap="square" lIns="91425" tIns="45700" rIns="91425" bIns="45700" anchor="t" anchorCtr="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:pPr marL="0" marR="0" lvl="0" indent="0" algn="ctr" rtl="0"><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buNone/></a:pPr>` +
    `<a:r><a:rPr lang="en-US" sz="6000" b="1" i="0" u="none" strike="noStrike" cap="none"><a:solidFill>${color}</a:solidFill>` +
    `<a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/><a:sym typeface="Arial"/></a:rPr>` +
    `<a:t>${String(n).padStart(2, "0")}</a:t></a:r><a:endParaRPr/></a:p></p:txBody></p:sp>`
  );
}

// One "hide" step per second: step 0 starts on click, the rest chain after the previous one
function timerHideStep(step, nodeType, spid, ids) {
  const outer = ids.next();
  const effect = ids.next();
  const set = ids.next();
  return (
    `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="${step}"/></p:stCondLst><p:childTnLst>` +
    `<p:par><p:cTn id="${effect}" presetID="1" presetClass="exit" presetSubtype="0" fill="hold" nodeType="${nodeType}">` +
    `<p:stCondLst><p:cond delay="1000"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr>` +
    `<p:cTn id="${set}" dur="1" fill="hold"><p:stCondLst><p:cond delay="1"/></p:stCondLst></p:cTn>` +
    `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>` +
    `<p:to><p:strVal val="hidden"/></p:to></p:set></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`
  );
}

function timerTimingXml(seconds) {
  let next = 4;
  const ids = { next: () => next++ };
  const steps = [];
  for (let step = 0; step < seconds; step += 1) {
    steps.push(
      timerHideStep(step, step === 0 ? "clickEffect" : "afterEffect", TIMER_ID_BASE + seconds - step, ids)
    );
  }
  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>` +
    `<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>` +
    steps.join("") +
    `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`
  );
}

// Replace the template timer with one that counts down from `seconds`; null removes it.
// Boxes are stacked 00 (bottom) to N (top); each second the top one is hidden.
function applyTimer(slideXml, seconds) {
  let xml = removeTimer(slideXml);
  if (!seconds) {
    return xml;
  }

  const boxes = [];
  for (let n = 0; n <= seconds; n += 1) {
    boxes.push(timerBoxXml(n, seconds));
  }
  xml = xml.replace("</p:spTree>", `${boxes.join("")}</p:spTree>`);
  return xml.replace("</p:sld>", `${timerTimingXml(seconds)}</p:sld>`);
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

// Keep slide1, skip slide2 (disclaimer), keep slide3, then the generated Q/A slides
function buildSlideList(presentationXml, generatedSlides) {
  const entries = Array.from(
    presentationXml.matchAll(/<p:sldId[^>]*\/>/g)
  ).map((m) => m[0]);

  const generated = generatedSlides.map(
    (slide) => `<p:sldId id="${slide.id}" r:id="${slide.rId}"/>`
  );

  return presentationXml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${[entries[0], entries[2], ...generated].join("")}</p:sldIdLst>`
  );
}

// Generated slides get fresh part names, relationship ids and slide ids so the
// deck is not limited by how many slides the template happens to contain.
const NEW_SLIDE_BASE = 1000;
const SLIDE_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const SLIDE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

function newSlide(offset) {
  const n = NEW_SLIDE_BASE + offset;
  return { n, id: n, rId: `rId${n}`, path: `ppt/slides/slide${n}.xml` };
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

// `verses[i]` is the array of { verse, text } for questions[i]; may be empty
// `timer` is { first, additional } in seconds, or null for no timer
export async function exportPowerPoint({ questions, verses = [], yearName, timer = null }) {
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

  const generatedSlides = [];

  for (let i = 0; i < questions.length; i += 1) {
    const index = i + 1;
    const question = questions[i];
    const ref = verseRef(question);
    const qSlide = newSlide(i * 2);
    const aSlide = newSlide(i * 2 + 1);
    generatedSlides.push(qSlide, aSlide);

    // Question slide layout:
    //   Line 1: "According to {ref}"
    //   Line 2: empty
    //   Line 3: "(N Pt.) full question text"
    let qXml = tmplQ;
    qXml = setSlideLabel(qXml, "QUESTION", index);
    qXml = centerQuestionTitle(qXml);
    qXml = widenTitlePlaceholder(qXml);
    qXml = widenBodyPlaceholder(qXml);
    qXml = applyTimer(qXml, timer ? secondsForQuestion(question, timer) : 0);
    qXml = setBodyContent(qXml, [
      `According to ${ref}`,
      "",
      questionLabel(question),
    ]);
    zip.file(qSlide.path, qXml);
    zip.file(`ppt/slides/_rels/slide${qSlide.n}.xml.rels`, qRels);

    // Answer slide layout:
    //   Line 1: full question text
    //   Line 2: empty
    //   Line 3: "Answer: {answer}"
    //   Line 4: empty
    //   Line 5: verse reference
    //   Line 6: full Bible text with the answer in red (when verses loaded)
    let aXml = tmplA;
    aXml = setSlideLabel(aXml, "ANSWER", index);
    aXml = centerQuestionTitle(aXml);
    aXml = widenTitlePlaceholder(aXml);
    aXml = widenBodyPlaceholder(aXml);
    aXml = setBodyContent(aXml, [
      questionLabel(question),
      "",
      `Answer: ${safeText(question.answer, "")}`,
      "",
      ref,
      ...(verses[i]?.length
        ? [{ runs: verseTextRuns(verses[i], question.answer), size: 2400 }]
        : []),
    ]);
    zip.file(aSlide.path, aXml);
    zip.file(`ppt/slides/_rels/slide${aSlide.n}.xml.rels`, aRels);
  }

  // Update presentation: trim slide list, set 16:9
  let presXml = await zip.file("ppt/presentation.xml").async("string");
  presXml = buildSlideList(presXml, generatedSlides);
  presXml = convertTo16x9(presXml);
  zip.file("ppt/presentation.xml", presXml);

  let presRels = await zip.file("ppt/_rels/presentation.xml.rels").async("string");
  presRels = presRels.replace(
    "</Relationships>",
    generatedSlides
      .map(
        (slide) =>
          `<Relationship Id="${slide.rId}" Type="${SLIDE_REL_TYPE}" Target="slides/slide${slide.n}.xml"/>`
      )
      .join("") + "</Relationships>"
  );
  zip.file("ppt/_rels/presentation.xml.rels", presRels);

  let contentTypes = await zip.file("[Content_Types].xml").async("string");
  contentTypes = contentTypes.replace(
    "</Types>",
    generatedSlides
      .map(
        (slide) =>
          `<Override PartName="/${slide.path}" ContentType="${SLIDE_CONTENT_TYPE}"/>`
      )
      .join("") + "</Types>"
  );
  zip.file("[Content_Types].xml", contentTypes);

  const datePart = new Date().toISOString().slice(0, 10);
  const slug = (value) => safeText(value).replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
  const nameParts = [slug(safeText(yearName, "2026-2027"))];
  const fileName = `PBE-Quiz-${nameParts.join("-")}-${datePart}.pptx`;
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, fileName);
}
