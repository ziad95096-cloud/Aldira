import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { deflateRawSync } from "node:zlib";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { after, before, test } from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adminPassword = "Local-test-password-only";
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
function zipFile(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, source] of entries) {
    const filename = Buffer.from(name);
    const content = Buffer.from(source);
    const compressed = deflateRawSync(content);
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const centralOffset = offset;
  const centralSize = centrals.reduce((size, item) => size + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16)]);
const manifest = {
  formatVersion: 1, title: "قالب اختبار", style: "عصري", color: "عاجي", price: 0,
  description: "قالب محلي للاختبار", cover: "assets/cover.png",
  theme: { accent: "#c07676", background: "#fffaf5", fontKey: "sans" },
  sections: [
    { id: "hero", type: "hero", visible: true, order: 0 },
    { id: "message", type: "message", visible: true, order: 1, editableFields: ["message", "primary_color", "photo_url"] },
    { id: "venue", type: "venue", visible: true, order: 2, editableFields: ["maps_url"] },
    { id: "music", type: "music", title: "موسيقى هادئة", asset: "assets/theme.mp3", visible: true, order: 3 },
  ],
};
const mp3 = Buffer.from("ID3" + "\x04\x00\x00\x00\x00\x00\x00");
const validZip = zipFile([["manifest.json", JSON.stringify(manifest)], ["assets/cover.png", png], ["assets/theme.mp3", mp3]]);
const nestedManifest = { ...manifest, cover: "assets/photos/صورة الغلاف.png", sections: manifest.sections.map((section) => section.id === "hero" ? { ...section, image: "assets/photos/صورة الغلاف.png" } : section) };
const nestedRootZip = zipFile([["index/manifest.json", JSON.stringify(nestedManifest)], ["index/assets/photos/صورة الغلاف.png", png], ["index/assets/theme.mp3", mp3], ["index/assets/", Buffer.alloc(0)], ["index/", Buffer.alloc(0)]]);
const backslashManifest = { ...manifest, cover: "assets\\cover.png", sections: manifest.sections.map((section) => section.id === "hero" ? { ...section, image: "assets\\cover.png" } : section) };
const backslashZip = zipFile([["manifest.json", JSON.stringify(backslashManifest)], ["assets\\cover.png", png], ["assets\\theme.mp3", mp3]]);
const traversalZip = zipFile([["manifest.json", JSON.stringify(manifest)], ["../escape.png", png], ["assets/cover.png", png], ["assets/theme.mp3", mp3]]);
const absolutePathZip = zipFile([["manifest.json", JSON.stringify(manifest)], ["/assets/cover.png", png], ["assets/theme.mp3", mp3]]);
const invalidNameZip = zipFile([["manifest.json", JSON.stringify(manifest)], ["assets/bad?.png", png], ["assets/theme.mp3", mp3]]);
const unregisteredZip = zipFile([["manifest.json", JSON.stringify(manifest)], ["assets/cover.png", png], ["assets/theme.mp3", mp3], ["assets/unused.png", png]]);
const oldHtmlZip = zipFile([["index.html", "<script>alert(1)</script>"]]);
const oldTemplateZip = zipFile([
  ["old/index.html", '<!doctype html><html><head><title>ليلة ورد</title><link rel="stylesheet" href="css/main.css"><script src="js/site.js"></script></head><body><header><h1>ليلة ورد</h1><img src="images/cover.png"></header><section><h2>عائلتا العروسين</h2><p>نص قديم</p></section><section><h2>موعد الحفل</h2><p>١٢ يونيو</p></section><script>window.oldTemplate = true</script></body></html>'],
  ["old/css/main.css", "body { background-color: #fffaf6; color: #493128; font-family: Georgia, serif; } header { background: url('../images/background.png'); } h1 { color: #a86e76; text-shadow: 0 1px #fff; }"],
  ["old/js/site.js", "throw new Error('must never execute')"],
  ["old/images/cover.png", png], ["old/images/background.png", png],
]);
const archiveRootAssetZip = zipFile([
  ["site/index.html", '<html><head><title>دعوة</title><link rel="stylesheet" href="site/css/main.css"></head><body><h1>دعوة</h1><img src="shared/cover.png"><p>أهلًا</p></body></html>'],
  ["site/css/main.css", "body { background-image: url('../../shared/background.png'); }"] ,
  ["shared/cover.png", png], ["shared/background.png", png],
]);
const projectZip = zipFile([
  ["site/index.html", "<html><head><title>مشروع</title></head><body><h1>مشروع</h1><img src='../cover.png'></body></html>"],
  ["site/package.json", JSON.stringify({ dependencies: { react: "^19.0.0", vite: "^6.0.0" } })], ["cover.png", png],
]);
const projectWithoutStaticEntryZip = zipFile([["package.json", JSON.stringify({ dependencies: { react: "^19.0.0" } })], ["src/main.jsx", "export default function App() { return null; }"]]);
const missingImageZip = zipFile([["index.html", '<html><head><title>ناقصة</title></head><body><h1>ناقصة</h1><img src="images/not-here.png"></body></html>'], ["cover.png", png]]);
const badManifestZip = zipFile([["manifest.json", JSON.stringify({ ...manifest, formatVersion: 8 })], ["assets/cover.png", png], ["assets/theme.mp3", mp3]]);
const corruptZip = Buffer.from(validZip); corruptZip[35] ^= 0xff;
const unsafeSectionZip = zipFile([["manifest.json", JSON.stringify({ ...manifest, sections: [{ id: "script", type: "script" }] })], ["assets/cover.png", png], ["assets/theme.mp3", mp3]]);
const extensionMismatchZip = zipFile([["manifest.json", JSON.stringify(manifest)], ["assets/cover.png", png], ["assets/theme.png", mp3]]);
let tempRoot;
let apiProcess;
let baseUrl;
let adminCookie;
let databasePath;
let mediaRoot;
let template;

before(async () => {
  tempRoot = await mkdtemp(resolve(tmpdir(), "farhati-integration-"));
  databasePath = resolve(tempRoot, "test.sqlite");
  mediaRoot = resolve(tempRoot, "media");
  const probe = net.createServer();
  await new Promise((done) => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  baseUrl = `http://127.0.0.1:${port}`;
  apiProcess = spawn(process.execPath, ["server/index.js"], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: databasePath, MEDIA_ROOT: mediaRoot, ADMIN_PASSWORD: adminPassword, PORT: String(port) },
    stdio: "ignore",
  });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) { ready = true; break; } } catch { /* Await isolated server startup. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(ready, true, "isolated API starts");
});

after(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill();
    await once(apiProcess, "exit");
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

async function login() {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: adminPassword }),
  });
  assert.equal(response.status, 200);
  adminCookie = response.headers.get("set-cookie").split(";")[0];
}
const adminHeaders = (extra = {}) => ({ cookie: adminCookie, ...extra });
function invitationBody(templateId, brideName, message) {
  return {
    template_id: templateId, bride_name: brideName, groom_name: "يوسف",
    wedding_date: "2030-06-12", wedding_time: "19:30", venue: "قاعة الاختبار",
    message, primary_color: "#456789", customer_name: "عميل اختباري",
    customer_phone: "+201000000000",
    customization: { sectionVisibility: { message: true, venue: true } },
  };
}

test("safe template import, pinned rendering, invitation capability and per-invite media", async () => {
  const unauthorized = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", body: validZip, headers: { "content-type": "application/zip" } });
  assert.equal(unauthorized.status, 401);
  await login();

  const legacyTemplates = await (await fetch(`${baseUrl}/api/templates`)).json();
  assert.equal(legacyTemplates.length, 6);
  assert.equal((await fetch(`${baseUrl}/api/invitations/not-a-real-slug`)).status, 404);
  const legacyTemplate = legacyTemplates.find((item) => item.id === "classic-ivory");
  const legacyCreate = await fetch(`${baseUrl}/api/invitations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...invitationBody(legacyTemplate.id, "دعوة قديمة", ""), customization: { sectionVisibility: {} } }) });
  assert.equal(legacyCreate.status, 201);
  const legacy = await legacyCreate.json();
  const legacyData = await (await fetch(`${baseUrl}/api/invitations/${legacy.slug}`)).json();
  assert.equal(legacyData.template_snapshot.sections.length, 0, "legacy invitation keeps its legacy renderer snapshot");
  assert.equal(legacyData.template_image, legacyTemplate.image_url);

  const brokenPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: Buffer.from("not a zip") });
  assert.equal(brokenPreview.status, 400);
  const traversalPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: traversalZip });
  assert.equal(traversalPreview.status, 400);
  const absolutePreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: absolutePathZip });
  assert.equal(absolutePreview.status, 400, "absolute paths are rejected");
  const invalidNamePreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: invalidNameZip });
  assert.equal(invalidNamePreview.status, 400, "unsafe filename characters are rejected");
  const unregisteredPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: unregisteredZip });
  assert.equal(unregisteredPreview.status, 400, "unregistered assets are rejected");
  const badManifestPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: badManifestZip });
  assert.match((await badManifestPreview.json()).error, /formatVersion/u);
  const corruptPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: corruptZip });
  assert.equal(corruptPreview.status, 400, "corrupt ZIP/CRC is rejected");
  const oldHtmlPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: oldHtmlZip });
  assert.match((await oldHtmlPreview.json()).error, /HTML قديم/u);
  const legacyConversionPreview = await fetch(`${baseUrl}/api/admin/templates/convert-legacy/preview`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: oldTemplateZip });
  assert.equal(legacyConversionPreview.status, 200);
  const legacyConverted = await legacyConversionPreview.json();
  assert.equal(legacyConverted.converted, true);
  assert.equal(legacyConverted.manifest.title, "ليلة ورد");
  assert.equal(legacyConverted.manifest.theme.background, "#fffaf6");
  assert.equal(legacyConverted.manifest.theme.accent, "#a86e76");
  assert.ok(legacyConverted.manifest.sections.some((section) => section.type === "families"));
  assert.equal(legacyConverted.manifest.sections.find((section) => section.type === "message").text, "نص قديم");
  assert.equal(legacyConverted.manifest.sections.find((section) => section.type === "hero").image, legacyConverted.manifest.cover, "legacy header background is used as hero cover");
  assert.equal(legacyConverted.manifest.cover, "assets/legacy-02.png", "CSS header background takes priority for the hero image");
  assert.ok(legacyConverted.warnings.some((warning) => warning.includes("JavaScript")));
  const multipartLegacy = new FormData();
  multipartLegacy.append("files", new Blob(['<html><head><title>ملف HTML</title></head><body><h1>العروسان</h1><img src="images/cover.png"><p>دعوة سعيدة</p></body></html>'], { type: "text/html" }), "index.html");
  multipartLegacy.append("files", new Blob([png], { type: "image/png" }), "images/cover.png");
  const multipartPreview = await fetch(`${baseUrl}/api/admin/templates/convert-legacy/preview`, { method: "POST", headers: adminHeaders(), body: multipartLegacy });
  assert.equal(multipartPreview.status, 200, `single HTML plus a relative local image can be checked: ${JSON.stringify(await multipartPreview.clone().json())}`);
  assert.match((await multipartPreview.json()).manifest.coverPreview, /^data:image\/png;base64,/u);
  const inlineCssForm = new FormData();
  inlineCssForm.append("files", new Blob(['<html><head><title>خلفية</title><style>.hero { background-image: url("cover.png"); }</style></head><body><h1>خلفية</h1></body></html>'], { type: "text/html" }), "renamed.txt");
  inlineCssForm.append("files", new Blob([png], { type: "image/png" }), "cover.png");
  const inlineCssPreview = await fetch(`${baseUrl}/api/admin/templates/convert-legacy/preview`, { method: "POST", headers: adminHeaders(), body: inlineCssForm });
  assert.equal(inlineCssPreview.status, 200, `HTML inline CSS image URLs are resolved: ${JSON.stringify(await inlineCssPreview.clone().json())}`);
  assert.match((await inlineCssPreview.json()).manifest.coverPreview, /^data:image\/png;base64,/u);
  const disguisedZipForm = new FormData();
  disguisedZipForm.append("files", new Blob([validZip], { type: "text/plain" }), "template.html");
  const disguisedZipPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders(), body: disguisedZipForm });
  assert.equal(disguisedZipPreview.status, 200, "ZIP source type is detected from its signature rather than the uploaded filename");
  const missingMultipart = new FormData();
  missingMultipart.append("files", new Blob(['<html><head><title>ملف ناقص</title></head><body><h1>ناقص</h1><img src="assets/missing.png"></body></html>'], { type: "text/html" }), "index.html");
  const missingMultipartPreview = await fetch(`${baseUrl}/api/admin/templates/convert-legacy/preview`, { method: "POST", headers: adminHeaders(), body: missingMultipart });
  assert.equal(missingMultipartPreview.status, 400);
  assert.match((await missingMultipartPreview.json()).error, /assets\/missing\.png/u);
  const rootAssetPreview = await fetch(`${baseUrl}/api/admin/templates/convert-legacy/preview`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: archiveRootAssetZip });
  assert.equal(rootAssetPreview.status, 200, "safe ../ references may resolve to assets elsewhere inside the archive root");
  const rootAssetResult = await rootAssetPreview.json();
  assert.ok(rootAssetResult.manifest.sections.some((section) => section.image === rootAssetResult.manifest.cover));
  const projectPreview = await fetch(`${baseUrl}/api/admin/templates/convert-legacy/preview`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: projectZip });
  assert.equal(projectPreview.status, 200, "static project archives can be analyzed without running them");
  assert.ok((await projectPreview.json()).warnings.some((warning) => warning.includes("react") && warning.includes("لم يتم تثبيت")));
  const nonStaticProjectPreview = await fetch(`${baseUrl}/api/admin/templates/convert-legacy/preview`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: projectWithoutStaticEntryZip });
  assert.match((await nonStaticProjectPreview.json()).error, /اكتُشف مشروع واجهة/u);
  const missingImagePreview = await fetch(`${baseUrl}/api/admin/templates/convert-legacy/preview`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: missingImageZip });
  assert.equal(missingImagePreview.status, 400);
  assert.match((await missingImagePreview.json()).error, /صورة محلية/u);
  assert.equal((await (await fetch(`${baseUrl}/api/templates`)).json()).length, 6, "legacy conversion preview is read-only");
  const unsafeSectionPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: unsafeSectionZip });
  assert.equal(unsafeSectionPreview.status, 400, "unregistered renderer sections are rejected");
  const wrongExtensionPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: extensionMismatchZip });
  assert.equal(wrongExtensionPreview.status, 400, "file extension must agree with detected media type");
  const oversizedArchive = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: Buffer.alloc(12 * 1024 * 1024 + 1) });
  assert.equal(oversizedArchive.status, 413, "ZIP request size is capped");

  const previewResponse = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: validZip });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.valid, true);
  assert.match(preview.manifest.coverPreview, /^data:image\/png;base64,/);
  assert.equal((await (await fetch(`${baseUrl}/api/templates`)).json()).length, 6, "preview does not persist a template");
  const nestedPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: nestedRootZip });
  assert.equal(nestedPreview.status, 200, `single wrapped folder and nested Arabic asset paths are supported: ${JSON.stringify(await nestedPreview.clone().json())}`);
  assert.equal((await nestedPreview.json()).manifest.cover, "assets/photos/صورة الغلاف.png");
  const backslashPreview = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: backslashZip });
  assert.equal(backslashPreview.status, 200, "safe Windows separators are normalized to ZIP relative paths");
  const perFileLimitZip = zipFile([["manifest.json", JSON.stringify(manifest)], ["assets/cover.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(9 * 1024 * 1024)])], ["assets/theme.mp3", mp3]]);
  const perFileLimit = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: perFileLimitZip });
  assert.equal(perFileLimit.status, 400, "individual expanded files are capped at 8 MiB");
  const expandedLimitZip = zipFile([
    ["manifest.json", JSON.stringify(manifest)], ["assets/cover.png", png], ["assets/theme.mp3", mp3],
    ...Array.from({ length: 5 }, (_, index) => [`assets/large${index}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(7 * 1024 * 1024)])]),
  ]);
  const expandedLimit = await fetch(`${baseUrl}/api/admin/templates/validate`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: expandedLimitZip });
  assert.equal(expandedLimit.status, 400, "expanded archive total is capped before unregistered file checks");

  const failedImport = await fetch(`${baseUrl}/api/admin/templates/import`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: Buffer.from("invalid archive") });
  assert.equal(failedImport.status, 400);
  assert.equal((await (await fetch(`${baseUrl}/api/templates`)).json()).length, 6, "failed import rolls back database state");

  const { DatabaseSync } = await import("node:sqlite");
  const triggerDb = new DatabaseSync(databasePath);
  triggerDb.exec(`CREATE TRIGGER reject_import BEFORE INSERT ON templates WHEN NEW.title = 'قالب اختبار' BEGIN SELECT RAISE(ABORT, 'forced rollback test'); END`);
  const databaseFailure = await fetch(`${baseUrl}/api/admin/templates/import`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: validZip });
  assert.equal(databaseFailure.status, 400, "database failure is returned as a rejected import");
  triggerDb.exec("DROP TRIGGER reject_import");
  const templateMediaDir = resolve(mediaRoot, "templates");
  let leftoverDirectories = [];
  try { leftoverDirectories = await readdir(templateMediaDir); } catch { /* Import rollback removed the generated directory. */ }
  assert.deepEqual(leftoverDirectories, [], "failed database commit removes media written by the import");
  assert.equal((await (await fetch(`${baseUrl}/api/templates`)).json()).length, 6);
  triggerDb.close();

  const importedResponse = await fetch(`${baseUrl}/api/admin/templates/import`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip" }), body: validZip });
  assert.equal(importedResponse.status, 201);
  template = await importedResponse.json();
  assert.equal(template.active, 0, "import creates an unpublished draft");
  assert.equal((await (await fetch(`${baseUrl}/api/templates`)).json()).length, 6, "draft is not published before explicit activation");
  const activateImported = await fetch(`${baseUrl}/api/admin/templates/${template.id}`, { method: "PATCH", headers: adminHeaders({ "content-type": "application/json" }), body: JSON.stringify({ active: true }) });
  assert.equal(activateImported.status, 200);
  template.active = 1;
  const legacyImportResponse = await fetch(`${baseUrl}/api/admin/templates/import`, { method: "POST", headers: adminHeaders({ "content-type": "application/zip", "x-template-archive-mode": "legacy-convert" }), body: oldTemplateZip });
  assert.equal(legacyImportResponse.status, 201);
  const legacyImported = await legacyImportResponse.json();
  assert.equal(legacyImported.active, 0, "converted legacy templates also remain drafts");
  assert.ok(legacyImported.conversionWarnings.length > 0);
  assert.equal((await (await fetch(`${baseUrl}/api/templates`)).json()).length, 7);
  assert.equal(template.snapshot.sections.length, 4);
  assert.equal(template.snapshot.theme.fontKey, "sans");
  assert.equal(template.version, 1);
  const assetResponse = await fetch(`${baseUrl}${template.image_url}`);
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get("content-type"), "image/png");
  const audioAsset = template.snapshot.sections.find((section) => section.type === "music").asset;
  const audioResponse = await fetch(`${baseUrl}${audioAsset}`);
  assert.equal(audioResponse.status, 200);
  assert.equal(audioResponse.headers.get("content-type"), "audio/mpeg");

  const create = async (brideName, message) => {
    const response = await fetch(`${baseUrl}/api/invitations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invitationBody(template.id, brideName, message)) });
    assert.equal(response.status, 201);
    return response.json();
  };
  const first = await create("مريم", "رسالة أولى");
  const second = await create("ليلى", "رسالة ثانية");
  assert.ok(first.edit_token && second.edit_token && first.edit_token !== second.edit_token);

  const unauthorizedEdit = await fetch(`${baseUrl}/api/invitations/${first.slug}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ bride_name: "مرفوض" }) });
  assert.equal(unauthorizedEdit.status, 403);
  const crossInviteEdit = await fetch(`${baseUrl}/api/invitations/${first.slug}`, { method: "PATCH", headers: { "content-type": "application/json", "x-invitation-edit-token": second.edit_token }, body: JSON.stringify({ bride_name: "مرفوض" }) });
  assert.equal(crossInviteEdit.status, 403);
  const edited = await fetch(`${baseUrl}/api/invitations/${first.slug}`, { method: "PATCH", headers: { "content-type": "application/json", "x-invitation-edit-token": first.edit_token }, body: JSON.stringify({ bride_name: "مريم المعدلة", message: "رسالة معدلة", customization: { sectionVisibility: { message: false } } }) });
  assert.equal(edited.status, 200);

  const firstData = await (await fetch(`${baseUrl}/api/invitations/${first.slug}`)).json();
  const secondData = await (await fetch(`${baseUrl}/api/invitations/${second.slug}`)).json();
  assert.equal(firstData.bride_name, "مريم المعدلة");
  assert.equal(firstData.message, "رسالة معدلة");
  assert.equal(secondData.bride_name, "ليلى");
  assert.equal(secondData.message, "رسالة ثانية");
  assert.equal(firstData.template_version_id, secondData.template_version_id);
  assert.equal("edit_token_hash" in firstData, false);

  const photoUpload = await fetch(`${baseUrl}/api/invitations/${first.slug}/media?field=photo_url`, { method: "POST", headers: { "content-type": "image/png", "x-invitation-edit-token": first.edit_token }, body: png });
  assert.equal(photoUpload.status, 201);
  const uploaded = await photoUpload.json();
  assert.match(uploaded.url, new RegExp(`/media/invitations/${firstData.id}/`));
  const badMedia = await fetch(`${baseUrl}/api/invitations/${first.slug}/media?field=photo_url`, { method: "POST", headers: { "content-type": "image/png", "x-invitation-edit-token": first.edit_token }, body: Buffer.from("not image") });
  assert.equal(badMedia.status, 400);
  const oversizedMedia = await fetch(`${baseUrl}/api/invitations/${first.slug}/media?field=photo_url`, { method: "POST", headers: { "content-type": "image/png", "x-invitation-edit-token": first.edit_token }, body: Buffer.alloc(8 * 1024 * 1024 + 1) });
  assert.equal(oversizedMedia.status, 413, "invitation media request size is capped");

  const updateTemplate = await fetch(`${baseUrl}/api/admin/templates/${template.id}`, { method: "PATCH", headers: adminHeaders({ "content-type": "application/json" }), body: JSON.stringify({ title: "قالب اختبار - إصدار 2" }) });
  assert.equal(updateTemplate.status, 200);
  const versions = await (await fetch(`${baseUrl}/api/admin/templates/${template.id}/versions`, { headers: adminHeaders() })).json();
  assert.deepEqual(versions.map((item) => item.version), [3, 2, 1]);
  const oldAfterUpdate = await (await fetch(`${baseUrl}/api/invitations/${first.slug}`)).json();
  assert.equal(oldAfterUpdate.template_title, "قالب اختبار");
  const newest = await create("نور", "إصدار جديد");
  assert.equal((await (await fetch(`${baseUrl}/api/invitations/${newest.slug}`)).json()).template_title, "قالب اختبار - إصدار 2");

  const deactivate = await fetch(`${baseUrl}/api/admin/templates/${template.id}`, { method: "PATCH", headers: adminHeaders({ "content-type": "application/json" }), body: JSON.stringify({ active: false }) });
  assert.equal(deactivate.status, 200);
  assert.equal((await (await fetch(`${baseUrl}/api/templates`)).json()).some((item) => item.id === template.id), false);
  assert.equal((await fetch(`${baseUrl}/api/invitations/${first.slug}`)).status, 200);
  const createInactive = await fetch(`${baseUrl}/api/invitations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invitationBody(template.id, "مرفوض", "")) });
  assert.equal(createInactive.status, 404);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.deepEqual(["templates", "invitations", "bookings"].map((name) => db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n), [8, 4, 4]);
  db.close();
});
