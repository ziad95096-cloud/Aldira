import { inflateRawSync } from "node:zlib";

const MAX_ARCHIVE = 12 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_FILES = 25;
const allowedTypes = new Set(["hero", "families", "message", "event", "venue", "gallery", "video", "music"]);

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[n] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function packTemplateFiles(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name, "utf8"); const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, filename); offset += local.length + filename.length + data.length;
  }
  const centralOffset = offset; const centralSize = centrals.reduce((sum, item) => sum + item.length, 0); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function normalizeZipPath(name) {
  if (typeof name !== "string" || !name || name.length > 240 || name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name) || /[\u0000-\u001f\u007f:?*<>|"]/u.test(name)) return "";
  const normalized = name.replaceAll("\\", "/");
  const directory = normalized.endsWith("/");
  const parts = (directory ? normalized.slice(0, -1) : normalized).split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.length > 100)) return "";
  return `${parts.join("/")}${directory ? "/" : ""}`;
}

function safeName(name, directory = false) {
  const normalized = normalizeZipPath(name);
  if (!normalized || normalized !== name.replaceAll("\\", "/")) return false;
  if (directory) return true;
  const rooted = normalized.startsWith("assets/") ? normalized : normalized.replace(/^[^/]+\//u, "");
  return rooted === "manifest.json" || /^assets\/(?:[\p{L}\p{N}][\p{L}\p{N}._ -]{0,99}\/)*[\p{L}\p{N}][\p{L}\p{N}._ -]{0,99}\.(png|jpe?g|webp|mp3|mp4|webm)$/iu.test(rooted);
}

function safeLegacyName(name) {
  const normalized = normalizeZipPath(name);
  if (!normalized || normalized.endsWith("/")) return false;
  const extension = normalized.split(".").pop().toLowerCase();
  return ["html", "htm", "css", "js", "jsx", "ts", "tsx", "woff", "woff2", "ttf", "otf", "png", "jpg", "jpeg", "webp", "mp3", "mp4", "webm"].includes(extension)
    || (extension === "json" && /(?:^|\/)package\.json$/iu.test(normalized));
}

function normalizeAssetReference(value) {
  if (typeof value !== "string" || value.length > 240 || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) return "";
  const normalized = value.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
  if (!normalized.startsWith("assets/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return normalized;
}

export function detectImage(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

function detectAsset(buffer) {
  const image = detectImage(buffer);
  if (image) return { mime: image, kind: "image" };
  if (buffer.length > 3 && (buffer.toString("ascii", 0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))) return { mime: "audio/mpeg", kind: "audio" };
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") return { mime: "video/mp4", kind: "video" };
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0x1a45dfa3) return { mime: "video/webm", kind: "video" };
  return null;
}

function validateManifest(manifest, assets) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("manifest.json يجب أن يحتوي كائن JSON.");
  const manifestKeys = new Set(["formatVersion", "title", "style", "color", "description", "cover", "price", "featured", "theme", "sections"]);
  if (Object.keys(manifest).some((key) => !manifestKeys.has(key))) fail("manifest.json يحتوي حقولاً غير معروفة.");
  if (manifest.formatVersion !== 1) fail("إصدار manifest غير مدعوم؛ المطلوب formatVersion=1.");
  const requiredText = (key, max) => {
    if (typeof manifest[key] !== "string" || !manifest[key].trim() || manifest[key].length > max) fail(`قيمة ${key} مطلوبة وبحد أقصى ${max} حرفاً.`);
    return manifest[key].trim();
  };
  const cover = normalizeAssetReference(requiredText("cover", 240));
  if (!cover) fail("مسار صورة الغلاف غير آمن؛ استخدم مساراً نسبياً يبدأ بـ assets/.");
  if (assets.get(cover)?.kind !== "image") fail("صورة الغلاف المشار إليها غير موجودة أو ليست صورة PNG/JPEG/WebP.");
  const sections = manifest.sections;
  if (!Array.isArray(sections) || sections.length < 1 || sections.length > 12) fail("يجب تعريف قسم واحد إلى 12 قسماً.");
  const seenIds = new Set();
  const cleanSections = sections.map((section, index) => {
    if (!section || typeof section !== "object" || !allowedTypes.has(section.type)) fail(`نوع القسم رقم ${index + 1} غير مسموح.`);
    if (Object.keys(section).some((key) => !["id", "type", "visible", "order", "title", "text", "image", "asset", "editableFields"].includes(key))) fail(`القسم رقم ${index + 1} يحتوي حقولاً غير مسموحة.`);
    if (typeof section.id !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(section.id) || seenIds.has(section.id)) fail("معرّفات الأقسام غير صالحة أو مكررة.");
    if (section.visible !== undefined && typeof section.visible !== "boolean") fail(`قيمة visible في القسم ${section.id} يجب أن تكون true أو false.`);
    if (section.order !== undefined && (!Number.isInteger(section.order) || section.order < 0 || section.order > 100)) fail(`ترتيب القسم ${section.id} غير صالح.`);
    seenIds.add(section.id);
    const image = section.image ? normalizeAssetReference(section.image) : "";
    if (section.image && !image) fail(`مسار صورة القسم ${section.id} غير آمن.`);
    if (image && !assets.has(image)) fail(`وسيط القسم ${section.id} غير موجود داخل الأرشيف؛ تحقق من المسار النسبي وحالة الأحرف.`);
    if (image && assets.get(image)?.kind !== "image") fail(`صورة القسم ${section.id} ليست صورة صالحة.`);
    if (["music", "video"].includes(section.type)) {
      const assetPath = normalizeAssetReference(section.asset);
      if (!assetPath) fail(`مسار ملف الوسيط للقسم ${section.id} غير آمن.`);
      const asset = assets.get(assetPath);
      if (!asset || (section.type === "music" && asset.kind !== "audio") || (section.type === "video" && asset.kind !== "video")) fail(`ملف الوسيط للقسم ${section.id} غير موجود أو نوعه غير مناسب.`);
    } else if (section.asset !== undefined) fail(`القسم ${section.id} لا يقبل ملفاً صوتياً أو فيديو.`);
    const editableFields = section.editableFields ?? [];
    if (!Array.isArray(editableFields) || editableFields.some((field) => !["bride_name", "groom_name", "bride_family", "groom_family", "message", "wedding_date", "wedding_time", "venue", "maps_url", "primary_color", "font_key", "photo_url", "background_url"].includes(field))) fail(`قائمة الحقول القابلة للتعديل في ${section.id} غير صالحة.`);
    return {
      id: section.id,
      type: section.type,
      visible: section.visible !== false,
      order: Number.isInteger(section.order) ? section.order : index,
      title: typeof section.title === "string" ? section.title.slice(0, 80) : "",
      text: typeof section.text === "string" ? section.text.slice(0, 500) : "",
      image,
      asset: section.asset ? normalizeAssetReference(section.asset) : "",
      editableFields: [...new Set(editableFields)],
    };
  }).sort((a, b) => a.order - b.order);
  const price = Number(manifest.price ?? 0);
  if (!Number.isSafeInteger(price) || price < 0 || price > 10000000) fail("السعر يجب أن يكون عدداً صحيحاً غير سالب.");
  const theme = manifest.theme ?? {};
  if (!theme || typeof theme !== "object" || Array.isArray(theme)
    || Object.keys(theme).some((key) => !["accent", "background", "fontKey"].includes(key))) fail("إعدادات theme غير صالحة.");
  for (const key of ["accent", "background"]) {
    if (theme[key] !== undefined && (typeof theme[key] !== "string" || !/^#[\da-fA-F]{6}$/.test(theme[key]))) fail(`لون theme.${key} غير صالح.`);
  }
  if (theme.fontKey !== undefined && !["serif", "sans"].includes(theme.fontKey)) fail("قيمة theme.fontKey غير مدعومة.");
  return {
    formatVersion: 1,
    title: requiredText("title", 100),
    style: requiredText("style", 40),
    color: requiredText("color", 40),
    description: typeof manifest.description === "string" ? manifest.description.slice(0, 300) : "",
    cover,
    price,
    featured: manifest.featured === true,
    theme: { accent: theme.accent || "#b89460", background: theme.background || "#fffdf9", fontKey: theme.fontKey || "serif" },
    sections: cleanSections,
  };
}

function decodeHtmlText(value) {
  return value.replace(/<[^>]*>/gu, " ").replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&").replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<").replace(/&gt;/giu, ">")
    .replace(/&#(\d+);/gu, (_match, number) => String.fromCodePoint(Math.min(Number(number), 0x10ffff)))
    .replace(/&#x([\da-f]+);/giu, (_match, hex) => String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff)))
    .replace(/\s+/gu, " ").trim();
}

function resolveLegacyReference(sourcePath, reference, rootPrefix) {
  if (typeof reference !== "string" || !reference || /^(?:#|\?|data:|https?:|\/\/|mailto:|javascript:)/iu.test(reference)) return "";
  let decoded;
  try { decoded = decodeURIComponent(reference); } catch { return ""; }
  const clean = decoded.split(/[?#]/u, 1)[0].replaceAll("\\", "/");
  if (!clean || clean.startsWith("/") || /^[A-Za-z]:/u.test(clean)) return "";
  // ZIP paths are already rooted at the archive root. Resolve from the actual
  // HTML/CSS directory and permit ../ only while it stays inside that root.
  const parts = sourcePath.split("/").slice(0, -1);
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return "";
      parts.pop();
    } else parts.push(segment);
  }
  return parts.join("/");
}

function convertLegacyArchiveFiles(files) {
  const htmlPaths = [...files.keys()].filter((name) => /^(?:[^/]+\/)?index\.html?$/iu.test(name));
  if (htmlPaths.length !== 1) fail("تعذر تحديد index.html واحد في جذر القالب القديم. ضع صفحة الدخول في الجذر أو داخل مجلد رئيسي واحد.");
  const htmlPath = htmlPaths[0];
  const rootPrefix = htmlPath === "index.html" || htmlPath === "index.htm" ? "" : htmlPath.slice(0, htmlPath.lastIndexOf("/") + 1);
  const projectFile = [...files.keys()].find((name) => /(?:^|\/)package\.json$/iu.test(name));
  const html = files.get(htmlPath).content.toString("utf8");
  if (html.includes("\u0000")) fail("ترميز index.html غير مدعوم؛ احفظه كنص UTF-8 قبل التحويل.");
  const cssFiles = [...files.entries()].filter(([name, file]) => /\.css$/iu.test(name) && file.kind === "source");
  const inlineCss = [
    ...(html.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu) || []).map((block) => block.replace(/^<style\b[^>]*>|<\/style\s*>$/giu, "")),
    ...(html.match(/\bstyle\s*=\s*(["'])(.*?)\1/giu) || []).map((attribute) => attribute.replace(/^\bstyle\s*=\s*["']|["']$/giu, "")),
  ];
  const cssSources = [...cssFiles.map(([name, file]) => [name, file.content.toString("utf8")]), ...inlineCss.map((content) => [htmlPath, content])];
  const css = cssSources.map(([, content]) => content).join("\n");
  const textHtml = html.replace(/<!--[\s\S]*?-->/gu, " ").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ");
  const warnings = [];
  if (projectFile) {
    let packageInfo = {};
    try { packageInfo = JSON.parse(files.get(projectFile).content.toString("utf8")); } catch { /* Report malformed project metadata without executing it. */ }
    const dependencies = Object.keys({ ...(packageInfo.dependencies || {}), ...(packageInfo.devDependencies || {}) });
    warnings.push(`اكتُشف مشروع واجهة ويب عبر ${projectFile}${dependencies.length ? ` يعتمد على مكتبات: ${dependencies.slice(0, 12).join(", ")}${dependencies.length > 12 ? "، وغيرها" : ""}` : ""}. لم يتم تثبيت الحزم أو تشغيل أوامر البناء؛ يلزم تصدير HTML/CSS/وسائط ثابتة أو تحويل يدوي.`);
  }
  const scriptCount = [...files.values()].filter((file) => file.kind === "script").length + (html.match(/<script\b/giu) || []).length;
  if (scriptCount) warnings.push(`${scriptCount} ملفاً أو كتلة JavaScript لم تُنفّذ أو تُنقل؛ راجع الوظائف التفاعلية يدويًا.`);
  const fontFiles = [...files.keys()].filter((name) => /\.(?:woff2?|ttf|otf)$/iu.test(name));
  if (fontFiles.length) warnings.push(`${fontFiles.length} ملف خط لم يُضمّن لأن صيغة المنصة لا تسمح برفع الخطوط؛ اختر خط serif أو sans المتاح يدويًا.`);
  if (/@import\b|https?:\/\/[^\s)]+/iu.test(css) || /<link\b[^>]*href\s*=\s*["']https?:/iu.test(html)) warnings.push("الخطوط والموارد الخارجية لا تُضمّن؛ أعد اختيار خط متاح وأضف الأصول محليًا إذا كانت مرخّصة.");
  if (/linear-gradient|radial-gradient|box-shadow|animation\s*:|transform\s*:/iu.test(css)) warnings.push("التدرجات والظلال والحركات والتحويلات وتخطيط CSS التفصيلي لا ينتقل إلى مكوّنات React؛ يلزم ضبطها يدويًا.");

  const localReferences = [];
  for (const match of html.matchAll(/<(?:img|source|video|audio|image)\b[^>]*?\b(?:src|poster)\s*=\s*(["'])(.*?)\1/giu)) localReferences.push([htmlPath, match[2]]);
  for (const [path, file] of cssFiles) {
    const content = file.content.toString("utf8");
    for (const match of content.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)) localReferences.push([path, match[1].trim()]);
  }
  for (const content of inlineCss) for (const match of content.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)) localReferences.push([htmlPath, match[1].trim()]);
  const mediaByPath = new Map([...files.entries()].filter(([, file]) => !["source", "script", "font", "project"].includes(file.kind)));
  const referenced = new Set();
  const unresolvedReferences = [];
  for (const [source, reference] of localReferences) {
    const path = resolveLegacyReference(source, reference, rootPrefix);
    if (path && mediaByPath.has(path)) referenced.add(path);
    else if (!/^(?:#|\?|data:|https?:|\/\/|mailto:|javascript:)/iu.test(reference)) {
      const note = `المورد المحلي «${reference.slice(0, 120)}» المشار إليه من «${source}» ${path ? "غير موجود داخل الأرشيف أو نوع محتواه غير مدعوم" : "مطلق أو يتجاوز جذر الأرشيف ولذلك لم يُحمّل"}.`;
      warnings.push(note);
      unresolvedReferences.push(reference.slice(0, 120));
    }
  }
  const allImages = [...mediaByPath.entries()].filter(([, file]) => file.kind === "image");
  for (const [name] of allImages) if (!referenced.has(name)) warnings.push(`الصورة «${name.slice(rootPrefix.length).slice(0, 80)}» لم تظهر ضمن روابط HTML/CSS الثابتة؛ قد تكون مستخدمة من JavaScript وتحتاج ربطًا يدويًا.`);
  const imageEntries = allImages.filter(([name]) => referenced.has(name));
  if (!imageEntries.length) fail(`لم يعثر التحويل على صورة محلية صالحة مرتبطة بـHTML/CSS لتكون غلافًا.${unresolvedReferences.length ? ` الموارد التي تعذر ربطها: ${[...new Set(unresolvedReferences)].join("، ")}.` : " اربط صورة PNG/JPEG/WebP محلية ثم أعد الفحص."}`);

  const assets = new Map();
  const copiedPath = new Map();
  let assetIndex = 0;
  for (const name of referenced) {
    const file = mediaByPath.get(name);
    if (!file) continue;
    const newPath = `assets/legacy-${String(++assetIndex).padStart(2, "0")}.${file.extension}`;
    assets.set(newPath, file);
    copiedPath.set(name, newPath);
  }
  const titleMatch = textHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu);
  const headingTexts = [...textHtml.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/giu)].map((match) => decodeHtmlText(match[1])).filter(Boolean);
  const paragraphTexts = [...textHtml.matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)\s*>/giu)].map((match) => decodeHtmlText(match[1])).filter(Boolean);
  const title = (decodeHtmlText(titleMatch?.[1] || "") || headingTexts[0] || "قالب محوّل").slice(0, 100);
  const colorTokens = [...new Set((`${css}\n${html}`.match(/#[\da-f]{6}\b/giu) || []).map((color) => color.toLowerCase()))];
  const bodyRule = css.match(/body\s*\{[^}]*?background(?:-color)?\s*:\s*(#[\da-f]{6})/iu);
  const headingColor = css.match(/h[1-6]\s*\{[^}]*?\bcolor\s*:\s*(#[\da-f]{6})/iu);
  const background = bodyRule?.[1]?.toLowerCase() || "#fffdf9";
  const accent = headingColor?.[1]?.toLowerCase() || colorTokens.find((color) => color !== background) || "#b89460";
  const fontMatch = css.match(/font-family\s*:\s*([^;}]+)/iu);
  const fontFamily = fontMatch?.[1]?.trim() || "";
  const fontKey = /serif|georgia|times/i.test(fontFamily) ? "serif" : "sans";
  if (fontFamily && !/^(?:serif|sans-serif|georgia|times(?: new roman)?,?\s*(?:serif)?)$/iu.test(fontFamily)) warnings.push(`الخط «${fontFamily.slice(0, 60)}» اختُزل إلى خيار ${fontKey}؛ عائلة الخط الأصلية تحتاج اختيارًا يدويًا.`);
  if (colorTokens.length > 2) warnings.push(`عُثر على ${colorTokens.length} ألوان ثابتة؛ القالب الجديد يحفظ لون إبراز وخلفية أساسيين فقط، وتحتاج بقية درجات الألوان إلى ضبط يدوي.`);

  const backgroundRule = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/gu)].find((match) => /(?:body|header|\.hero|#hero)/iu.test(match[1]) && /background\s*:/iu.test(match[2]) && /url\(/iu.test(match[2]));
  const bodyBackgroundReference = backgroundRule?.[2].match(/url\(\s*["']?([^"')]+)["']?\s*\)/iu)?.[1];
  let bodyBackgroundPath = "";
  if (bodyBackgroundReference) {
    const cssSource = cssSources.find(([, content]) => content.includes(backgroundRule[0].trim()))?.[0] || htmlPath;
    bodyBackgroundPath = resolveLegacyReference(cssSource, bodyBackgroundReference, rootPrefix);
  }
  const coverEntry = imageEntries.find(([name]) => name === bodyBackgroundPath) || imageEntries[0];
  const sections = [{ id: "hero", type: "hero", title: (headingTexts[0] || "بكل الحب ندعوكم").slice(0, 80), image: copiedPath.get(coverEntry[0]), visible: true, order: 0, editableFields: ["bride_name", "groom_name", "wedding_date", "photo_url"] }];
  const addSection = (id, type, titleText, editableFields = []) => {
    if (sections.some((section) => section.type === type) || sections.length >= 12) return;
    sections.push({ id, type, title: (titleText || "").slice(0, 80), visible: true, order: sections.length, editableFields });
  };
  const unrepresentedHeadings = [];
  for (const heading of headingTexts.slice(1)) {
    const previousCount = sections.length;
    if (/عائل|أسر|parents|family/iu.test(heading)) addSection("families", "families", heading, ["bride_family", "groom_family"]);
    else if (/موعد|تاريخ|وقت|date|time|event/iu.test(heading)) addSection("event", "event", heading, ["wedding_date", "wedding_time"]);
    else if (/مكان|قاعة|عنوان|location|venue/iu.test(heading)) addSection("venue", "venue", heading, ["venue", "maps_url"]);
    else addSection(`section-${sections.length + 1}`, "message", heading, ["message"]);
    if (sections.length === previousCount && unrepresentedHeadings.length < 8) unrepresentedHeadings.push(heading.slice(0, 100));
  }
  if (unrepresentedHeadings.length) warnings.push(`عناوين لم تتحول إلى أقسام مستقلة ويجب مراجعتها يدويًا: ${unrepresentedHeadings.map((heading) => `«${heading}»`).join("، ")}${headingTexts.length - 1 > unrepresentedHeadings.length + 11 ? "، وعناوين أخرى" : ""}.`);
  if (paragraphTexts.length) {
    addSection("message", "message", headingTexts.find((heading) => /رسالة|دعوة|message|invite/iu.test(heading)) || "رسالة الدعوة", ["message"]);
    const messageSection = sections.find((section) => section.type === "message");
    if (messageSection) messageSection.text = paragraphTexts[0].slice(0, 500);
  }
  for (const [name] of imageEntries.slice(1)) {
    if (sections.length >= 12) { warnings.push("تجاوز عدد الصور حد الأقسام المدعوم؛ أضف الصور المتبقية يدويًا."); break; }
    sections.push({ id: `gallery-${sections.length + 1}`, type: "gallery", title: "صورة من القالب", image: copiedPath.get(name), visible: true, order: sections.length, editableFields: [] });
  }
  for (const [name, file] of mediaByPath) {
    if (!referenced.has(name)) {
      if (file.kind !== "image") warnings.push(`ملف الوسيط «${name}» غير مستخدم في مراجع HTML/CSS الثابتة؛ قد يعتمد على JavaScript أو يحتاج ربطًا يدويًا.`);
      continue;
    }
    if (file.kind === "image") continue;
    if (file.kind === "audio" && sections.length < 12 && !sections.some((section) => section.type === "music")) {
      sections.push({ id: "music", type: "music", title: "موسيقى الدعوة", asset: copiedPath.get(name), visible: true, order: sections.length, editableFields: [] });
    } else if (file.kind === "video" && sections.length < 12 && !sections.some((section) => section.type === "video")) {
      sections.push({ id: "video", type: "video", title: "فيديو الدعوة", asset: copiedPath.get(name), visible: true, order: sections.length, editableFields: [] });
    }
  }
  if (headingTexts.length > 11) warnings.push("بعض العناوين الإضافية لم يمكن تمثيلها كأقسام مستقلة؛ انقل محتواها يدويًا إلى الرسالة أو أقسام الدعوة.");
  if (paragraphTexts.length > 1) {
    const omittedParagraphs = paragraphTexts.slice(1, 5).map((paragraph) => `«${paragraph.slice(0, 100)}»`);
    warnings.push(`نُقلت فقرة واحدة إلى قسم الرسالة؛ فقرات لم تنتقل: ${omittedParagraphs.join("، ")}${paragraphTexts.length > 5 ? "، وفقرات أخرى" : ""}.`);
  }
  warnings.push("عناصر HTML/CSS الأصلية لم تُعرض كما هي؛ أعيد تمثيل المحتوى عبر الأقسام المسجلة فقط. راجع المقاسات والمحاذاة والتخطيط في المعاينة.");
  const usedAssets = new Set([copiedPath.get(coverEntry[0]), ...sections.flatMap((section) => [section.image, section.asset])].filter(Boolean));
  for (const name of assets.keys()) if (!usedAssets.has(name)) assets.delete(name);
  const manifest = validateManifest({
    formatVersion: 1, title, style: "قالب محوّل", color: colorTokens.join("، ").slice(0, 40) || "مخصص",
    description: "تحويل ساكن لقالب HTML قديم؛ راجع ملاحظات التحويل قبل التفعيل.", cover: copiedPath.get(coverEntry[0]),
    price: 0, featured: false, theme: { accent, background, fontKey }, sections,
  }, assets);
  return { manifest, assets, warnings };
}

export function parseTemplateArchive(input, { convertLegacy = false } = {}) {
  if (!Buffer.isBuffer(input) || input.length < 22 || input.length > MAX_ARCHIVE) fail("حجم ZIP غير صالح (الحد الأقصى 12 ميجابايت).");
  let eocd = -1;
  for (let offset = input.length - 22; offset >= Math.max(0, input.length - 65557); offset -= 1) {
    if (input.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) fail("ملف ZIP تالف: لم يُعثر على سجل النهاية.");
  const disk = input.readUInt16LE(eocd + 4);
  const centralDisk = input.readUInt16LE(eocd + 6);
  const entries = input.readUInt16LE(eocd + 10);
  const commentLength = input.readUInt16LE(eocd + 20);
  const centralSize = input.readUInt32LE(eocd + 12);
  const centralOffset = input.readUInt32LE(eocd + 16);
  if (entries > MAX_FILES) fail(`يحتوي ZIP على ${entries} مدخلًا، والحد ${MAX_FILES}. قد يكون مشروع واجهة يعتمد على حزم أو مخرجات بناء؛ لا تُشغّل أو تثبّت محتواه. صدّر ملفات HTML/CSS والأصول الثابتة أو استخدم قالب manifest ضمن الحدود.`);
  if (disk || centralDisk || entries !== input.readUInt16LE(eocd + 8) || entries < 1 || centralOffset + centralSize !== eocd || eocd + 22 + commentLength !== input.length) fail("أرشيف ZIP متعدد الأقراص أو يتجاوز حدود البنية المسموحة.");
  const files = new Map();
  const seenNames = new Set();
  let cursor = centralOffset;
  let expanded = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > input.length || input.readUInt32LE(cursor) !== 0x02014b50) fail("سجل ملفات ZIP المركزي تالف.");
    const madeBy = input.readUInt16LE(cursor + 4);
    const flags = input.readUInt16LE(cursor + 8);
    const method = input.readUInt16LE(cursor + 10);
    const checksum = input.readUInt32LE(cursor + 16);
    const compressedSize = input.readUInt32LE(cursor + 20);
    const size = input.readUInt32LE(cursor + 24);
    const nameLength = input.readUInt16LE(cursor + 28);
    const extraLength = input.readUInt16LE(cursor + 30);
    const commentLength = input.readUInt16LE(cursor + 32);
    const externalAttributes = input.readUInt32LE(cursor + 38);
    const localOffset = input.readUInt32LE(cursor + 42);
    const rawName = input.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const name = rawName.replaceAll("\\", "/");
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    const isDirectory = name.endsWith("/");
    if (!convertLegacy && normalizeZipPath(name) && /^(?:[^/]+\/)?index\.html$/iu.test(name)) fail("هذا أرشيف HTML قديم. لا يتم تشغيل HTML/JavaScript داخل لوحة الإدارة؛ استخدم أداة التحويل الآمن أولاً.");
    if (next > input.length || !(safeName(name, isDirectory) || (convertLegacy && safeLegacyName(name))) || seenNames.has(name)) {
      if (convertLegacy && /\.svg$/iu.test(name)) fail(`SVG غير مسموح في التحويل الآمن («${name.slice(0, 90)}»)؛ صدّره يدويًا إلى PNG أو JPEG أو WebP بعد مراجعة محتواه.`);
      const displayName = name.replace(/[\u0000-\u001f\u007f]/gu, "?").slice(0, 120) || `المدخل ${index + 1}`;
      fail(`اسم أو مسار ZIP غير مسموح في المدخل «${displayName}». استخدم manifest.json مع مجلد assets/ وملفات PNG/JPEG/WebP/MP3/MP4/WebM، وتجنب المسارات المطلقة أو ../.`);
    }
    seenNames.add(name);
    const unixMode = madeBy >> 8 === 3 ? externalAttributes >>> 16 : 0;
    if ((unixMode & 0xf000) === 0xa000) fail("الروابط الرمزية غير مسموحة في ZIP.");
    if (flags & 1 || flags & 0x40 || ![0, 8].includes(method) || size > MAX_FILE || compressedSize > MAX_ARCHIVE) fail("ملف مضغوط أو طريقة ضغط أو حجم غير مدعوم.");
    if (localOffset + 30 > input.length || input.readUInt32LE(localOffset) !== 0x04034b50) fail("رأس ملف ZIP المحلي تالف.");
    const localNameLength = input.readUInt16LE(localOffset + 26);
    const localExtraLength = input.readUInt16LE(localOffset + 28);
    const localName = input.toString("utf8", localOffset + 30, localOffset + 30 + localNameLength);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (localName !== rawName || input.readUInt16LE(localOffset + 6) & 1 || input.readUInt16LE(localOffset + 8) !== method || dataOffset + compressedSize > input.length) fail("بيانات رأس ملف ZIP المحلي غير متطابقة أو مبتورة.");
    const compressed = input.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    try { content = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_FILE }); }
    catch { fail("تعذر فك ضغط أحد الملفات ضمن الحدود الآمنة."); }
    if (content.length !== size || crc32(content) !== checksum) fail("حجم أو بصمة CRC لأحد الملفات غير مطابق.");
    if (isDirectory) {
      if (size !== 0) fail("مدخل المجلد في ZIP يجب أن يكون فارغاً.");
      cursor = next;
      continue;
    }
    expanded += content.length;
    if (expanded > MAX_TOTAL) fail("الحجم الإجمالي بعد فك الضغط يتجاوز 32 ميجابايت.");
    if (convertLegacy && /(?:\.(?:html?|css|js|jsx|ts|tsx|woff2?|ttf|otf)$|(?:^|\/)package\.json$)/iu.test(name)) {
      const isFont = /\.(?:woff2?|ttf|otf)$/iu.test(name);
      if (!isFont && content.length > 512 * 1024) fail(`ملف المصدر «${name.slice(0, 100)}» أكبر من حد التحويل 512 كيلوبايت.`);
      files.set(name, { content: isFont ? Buffer.alloc(0) : content, kind: isFont ? "font" : /\.(?:js|jsx|ts|tsx)$/iu.test(name) ? "script" : /(?:^|\/)package\.json$/iu.test(name) ? "project" : "source", mime: "text/plain" });
    } else if (!/(?:^|\/)manifest\.json$/u.test(name)) {
      const detected = detectAsset(content);
      if (!detected) fail(`نوع الوسيط الفعلي غير مسموح: ${name}. استخدم PNG/JPEG/WebP أو MP3 أو MP4 أو WebM للقسم المناسب.`);
      const extension = detected.mime === "image/jpeg" ? "jpg" : detected.mime.split("/")[1].replace("mpeg", "mp3");
      const declaredExtension = name.split(".").pop().toLowerCase();
      if (!(detected.mime === "image/jpeg" && declaredExtension === "jpeg") && declaredExtension !== extension) fail(`امتداد الملف لا يطابق نوعه الفعلي: ${name}.`);
      files.set(name, { content, mime: detected.mime, kind: detected.kind, extension });
    } else {
      if (content.length > 256 * 1024) fail("manifest.json أكبر من الحد المسموح.");
      files.set(name, { content, mime: "application/json" });
    }
    cursor = next;
  }
  if (cursor !== centralOffset + centralSize) fail("حجم سجل ZIP المركزي غير متطابق.");
  const manifests = [...files.entries()].filter(([name]) => name === "manifest.json" || /^[^/]+\/manifest\.json$/u.test(name));
  if (manifests.length !== 1) {
    const legacy = [...files.keys()].some((name) => /(?:^|\/)index\.html?$/iu.test(name));
    if (legacy && convertLegacy) return convertLegacyArchiveFiles(files);
    if (legacy) fail("هذا أرشيف HTML قديم. النظام لا يشغّل HTML/JavaScript؛ استخدم أداة التحويل الآمن ثم راجع تقرير التحويل.");
    const project = convertLegacy ? [...files.entries()].find(([, file]) => file.kind === "project") : null;
    if (project) {
      let dependencies = [];
      try { const metadata = JSON.parse(project[1].content.toString("utf8")); dependencies = Object.keys({ ...(metadata.dependencies || {}), ...(metadata.devDependencies || {}) }); } catch { /* Keep malformed project metadata inert and report it as an incomplete static project. */ }
      fail(`اكتُشف مشروع واجهة عبر ${project[0]}${dependencies.length ? ` بتبعيات ${dependencies.slice(0, 10).join("، ")}` : ""}، لكنه لا يحتوي index.html ثابتًا أو manifest متوافقًا. لم يتم تشغيله أو تثبيت تبعياته؛ صدّر نسخة HTML/CSS ثابتة أو حوّله يدويًا إلى مخطط القالب.`);
    }
    fail("لم يُعثر على manifest.json في جذر ZIP أو داخل مجلد رئيسي واحد. إذا كان الأرشيف داخل مجلد index/ فضع manifest.json والأصول تحته.");
  }
  const [manifestPath, manifestFile] = manifests[0];
  const rootPrefix = manifestPath === "manifest.json" ? "" : manifestPath.slice(0, -"manifest.json".length);
  if ([...files.keys()].some((name) => !name.startsWith(rootPrefix))) fail("يجب أن تكون جميع ملفات القالب داخل جذر واحد: جذر ZIP أو مجلد رئيسي واحد.");
  const normalizedFiles = new Map();
  for (const [name, file] of files) {
    const relative = name.slice(rootPrefix.length);
    if (relative !== "manifest.json" && !relative.startsWith("assets/")) {
      fail(`الملف «${relative.slice(0, 100)}» خارج manifest.json وassets/ وغير مسموح.`);
    }
    normalizedFiles.set(relative, file);
  }
  let rawManifest;
  try { rawManifest = JSON.parse(manifestFile.content.toString("utf8")); }
  catch { fail("manifest.json ليس JSON صالحاً."); }
  const assets = new Map([...normalizedFiles].filter(([name]) => name !== "manifest.json"));
  const manifest = validateManifest(rawManifest, assets);
  for (const [name] of assets) {
    if (name !== manifest.cover && !manifest.sections.some((section) => section.image === name || section.asset === name)) fail(`ملف غير مستخدم في manifest: ${name}.`);
  }
  return { manifest, assets };
}
