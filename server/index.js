import { createHash, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { db } from "./db.js";
import { detectImage, packTemplateFiles, parseTemplateArchive } from "./templateArchive.js";

const app = express();
const port = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === "production";
const mediaRoot = resolve(process.env.MEDIA_ROOT || "public/media");
mkdirSync(mediaRoot, { recursive: true });
const sessions = new Map();
const loginAttempts = new Map();
const sessionDuration = 8 * 60 * 60 * 1000;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use("/media", express.static(mediaRoot, { fallthrough: false, index: false }));

class InputError extends Error {}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function text(value, label, maxLength, { required = false } = {}) {
  if (typeof value !== "string") throw new InputError(`قيمة ${label} غير صالحة.`);
  const result = value.trim();
  if (required && !result) throw new InputError(`يرجى إدخال ${label}.`);
  if (result.length > maxLength) throw new InputError(`${label} أطول من المسموح.`);
  return result;
}

function mapLink(value) {
  const link = text(value ?? "", "رابط الموقع", 2000);
  if (!link) return "";
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new InputError("يرجى إدخال رابط موقع صالح يبدأ بـ https://.");
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new InputError("رابط الموقع يجب أن يبدأ بـ https://.");
  }
  return url.href;
}

function imageUrl(value) {
  const image = text(value, "رابط الصورة", 2000, { required: true });
  if (/^\/images\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:svg|png|jpe?g|webp)$/i.test(image)) {
    return image;
  }
  if (/^\/media\/(?:templates|invitations)\/[a-f\d-]+\/[A-Za-z0-9._-]+$/i.test(image)) return image;
  const link = mapLink(image);
  if (!link.startsWith("https://")) throw new InputError("صور الروابط الخارجية يجب أن تستخدم https://.");
  return link;
}

function optionalImageUrl(value) {
  if (!value) return "";
  return imageUrl(value);
}

function color(value) {
  const result = value ?? "#b89460";
  if (typeof result !== "string" || !/^#[\da-fA-F]{6}$/.test(result)) {
    throw new InputError("اللون المختار غير صالح.");
  }
  return result;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour <= 23 && minute <= 59;
}

function safeCompare(actual, expected) {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function invitationFields(snapshot) {
  const core = ["bride_name", "groom_name", "wedding_date", "wedding_time", "venue"];
  const sections = Array.isArray(snapshot?.sections) ? snapshot.sections : [];
  if (!sections.length) return new Set([...core, "bride_family", "groom_family", "message", "maps_url", "primary_color", "font_key", "background_url", "photo_url"]);
  return new Set([...core, ...sections.flatMap((section) => section.editableFields || [])]);
}

function requireAdmin(req, res, next) {
  const token = req.cookies?.farhati_admin;
  const expiresAt = token ? sessions.get(token) : undefined;
  if (!expiresAt || expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return sendError(res, 401, "انتهت الجلسة. سجّل الدخول مرة أخرى.");
  }
  return next();
}

app.use((req, _res, next) => {
  req.cookies = Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf("=");
        return [item.slice(0, separator).trim(), item.slice(separator + 1).trim()];
      }),
  );
  next();
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/templates", (req, res) => {
  const filters = ["active = 1"];
  const values = {};
  if (req.query.style && req.query.style !== "الكل") {
    filters.push("style = @style");
    values.style = String(req.query.style);
  }
  if (req.query.color && req.query.color !== "الكل") {
    filters.push("color = @color");
    values.color = String(req.query.color);
  }
  if (req.query.search) {
    filters.push("(title LIKE @search OR description LIKE @search)");
    values.search = `%${String(req.query.search).slice(0, 80)}%`;
  }
  if (req.query.featured === "true") filters.push("featured = 1");
  if (req.query.price === "free") filters.push("price = 0");
  if (req.query.price === "paid") filters.push("price > 0");
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  res.json(
    db
      .prepare(`SELECT t.*, v.version, v.snapshot_json FROM templates t
        LEFT JOIN template_versions v ON v.id = (SELECT id FROM template_versions WHERE template_id = t.id ORDER BY version DESC LIMIT 1)
        ${where.replaceAll("style", "t.style").replaceAll("color", "t.color").replaceAll("title", "t.title").replaceAll("description", "t.description").replaceAll("featured", "t.featured").replaceAll("price", "t.price")}
        ORDER BY t.featured DESC, t.created_at DESC`)
      .all(values).map((row) => ({ ...row, snapshot: row.snapshot_json ? JSON.parse(row.snapshot_json) : null, snapshot_json: undefined })),
  );
});

app.post("/api/invitations", (req, res) => {
  try {
    const body = req.body || {};
    const templateId = text(body.template_id, "التصميم", 80, { required: true });
    const template = db.prepare(`SELECT t.id, v.id AS template_version_id, v.snapshot_json FROM templates t
      JOIN template_versions v ON v.template_id = t.id
      WHERE t.id = ? AND t.active = 1 ORDER BY v.version DESC LIMIT 1`).get(templateId);
    if (!template) return sendError(res, 404, "التصميم المختار غير موجود.");
    const templateSnapshot = JSON.parse(template.snapshot_json);
    const allowedFields = invitationFields(templateSnapshot);
    const sectionIds = new Set((templateSnapshot.sections || []).map((section) => section.id));
    let customizationJson = JSON.stringify({ sectionVisibility: {} });
    if (body.customization !== undefined) {
      const visibility = body.customization?.sectionVisibility;
      if (!body.customization || typeof body.customization !== "object" || Array.isArray(body.customization)
        || Object.keys(body.customization).some((key) => key !== "sectionVisibility")
        || !visibility || typeof visibility !== "object" || Array.isArray(visibility)
        || Object.keys(visibility).some((id) => !sectionIds.has(id))
        || Object.values(visibility).some((value) => typeof value !== "boolean")) {
        return sendError(res, 400, "إعدادات تخصيص الأقسام غير صالحة.");
      }
      customizationJson = JSON.stringify({ sectionVisibility: visibility });
    }
    const brideName = text(body.bride_name, "اسم العروس", 80, { required: true });
    const groomName = text(body.groom_name, "اسم العريس", 80, { required: true });
    const weddingDate = text(body.wedding_date, "تاريخ الزفاف", 10, { required: true });
    const weddingTime = text(body.wedding_time, "وقت الزفاف", 10, { required: true });
    const bookingName = text(body.customer_name, "اسم صاحب الحجز", 100, { required: true });
    const phone = text(body.customer_phone, "رقم الهاتف", 30, { required: true });
    if (!/^[+\d\s()-]{7,30}$/.test(phone) || phone.replace(/\D/g, "").length < 7) {
      return sendError(res, 400, "يرجى إدخال رقم هاتف صالح.");
    }
    if (!validDate(weddingDate)) {
      return sendError(res, 400, "يرجى اختيار تاريخ زفاف صالح.");
    }
    if (!validTime(weddingTime)) {
      return sendError(res, 400, "يرجى اختيار وقت صالح.");
    }
    const fontKey = body.font_key ?? templateSnapshot.theme?.fontKey ?? "serif";
    if (!["serif", "sans"].includes(fontKey)) {
      return sendError(res, 400, "الخط المختار غير صالح.");
    }
    const editToken = randomBytes(32).toString("base64url");
    const invitation = {
      id: randomUUID(),
      slug: randomBytes(6).toString("base64url"),
      template_id: templateId,
      template_version_id: template.template_version_id,
      edit_token_hash: createHash("sha256").update(editToken).digest("hex"),
      bride_name: brideName,
      groom_name: groomName,
      wedding_date: weddingDate,
      wedding_time: weddingTime,
      venue: text(body.venue, "مكان الحفل", 180, { required: true }),
      maps_url: allowedFields.has("maps_url") ? mapLink(body.maps_url) : "",
      bride_family: allowedFields.has("bride_family") ? text(body.bride_family ?? "", "اسم عائلة العروس", 120) : "",
      groom_family: allowedFields.has("groom_family") ? text(body.groom_family ?? "", "اسم عائلة العريس", 120) : "",
      message: allowedFields.has("message") ? text(body.message ?? "", "الرسالة", 500) : "",
      primary_color: allowedFields.has("primary_color") ? color(body.primary_color ?? templateSnapshot.theme?.accent) : color(templateSnapshot.theme?.accent || "#b89460"),
      font_key: allowedFields.has("font_key") ? fontKey : templateSnapshot.theme?.fontKey || "serif",
      background_url: allowedFields.has("background_url") ? optionalImageUrl(body.background_url) : "",
      photo_url: allowedFields.has("photo_url") ? optionalImageUrl(body.photo_url) : "",
      customization_json: customizationJson,
    };
    const booking = {
      id: randomUUID(),
      order_number: `FH-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`,
      invitation_id: invitation.id,
      customer_name: bookingName,
      customer_phone: phone,
    };
    db.exec("BEGIN");
    try {
      db.prepare(`
        INSERT INTO invitations (
          id, slug, template_id, template_version_id, edit_token_hash, bride_name, groom_name, wedding_date, wedding_time,
          venue, maps_url, bride_family, groom_family, message, primary_color, font_key, customization_json,
          background_url, photo_url
        ) VALUES (
          @id, @slug, @template_id, @template_version_id, @edit_token_hash, @bride_name, @groom_name, @wedding_date, @wedding_time,
          @venue, @maps_url, @bride_family, @groom_family, @message, @primary_color,
          @font_key, @customization_json, @background_url, @photo_url
        )
      `).run(invitation);
      db.prepare(`
        INSERT INTO bookings (id, order_number, invitation_id, customer_name, customer_phone)
        VALUES (@id, @order_number, @invitation_id, @customer_name, @customer_phone)
      `).run(booking);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      slug: invitation.slug,
      invitation_url: `/invite/${invitation.slug}`,
      edit_token: editToken,
      order_number: booking.order_number,
      status: "pending",
    });
  } catch (error) {
    if (error instanceof InputError) {
      return sendError(res, 400, error.message);
    }
    console.error("Could not save invitation:", error);
    return sendError(res, 500, "تعذر حفظ الدعوة الآن. حاول مرة أخرى.");
  }
});

app.get("/api/invitations/:slug", (req, res) => {
  const invitation = db
    .prepare(`
      SELECT i.*, t.title AS template_title, t.image_url AS template_image,
             v.snapshot_json AS template_snapshot
      FROM invitations i JOIN templates t ON t.id = i.template_id
      LEFT JOIN template_versions v ON v.id = i.template_version_id
      WHERE i.slug = ?
    `)
    .get(req.params.slug);
  if (!invitation) return sendError(res, 404, "الدعوة غير موجودة.");
  delete invitation.edit_token_hash;
  if (invitation.template_snapshot) {
    const snapshot = JSON.parse(invitation.template_snapshot);
    invitation.template_title = snapshot.title;
    invitation.template_image = snapshot.image_url;
    invitation.template_snapshot = snapshot;
  } else {
    delete invitation.template_snapshot;
  }
  return res.json(invitation);
});

app.patch("/api/invitations/:slug", (req, res) => {
  const current = db.prepare(`SELECT i.*, v.snapshot_json FROM invitations i
    LEFT JOIN template_versions v ON v.id = i.template_version_id WHERE i.slug = ?`).get(req.params.slug);
  if (!current) return sendError(res, 404, "الدعوة غير موجودة.");
  const token = req.get("x-invitation-edit-token") || "";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  if (!current.edit_token_hash || !token || !safeCompare(tokenHash, current.edit_token_hash)) {
    return sendError(res, 403, "رمز تعديل الدعوة غير صالح.");
  }
  try {
    const snapshot = current.snapshot_json ? JSON.parse(current.snapshot_json) : null;
    const allowed = invitationFields(snapshot);
    const updates = {};
    const body = req.body || {};
    const stringFields = {
      bride_name: ["اسم العروس", 80, true], groom_name: ["اسم العريس", 80, true],
      bride_family: ["اسم عائلة العروس", 120, false], groom_family: ["اسم عائلة العريس", 120, false],
      message: ["الرسالة", 500, false], wedding_date: ["تاريخ الزفاف", 10, true],
      wedding_time: ["وقت الزفاف", 5, true], venue: ["مكان الحفل", 180, true],
    };
    for (const [field, [label, max, required]] of Object.entries(stringFields)) {
      if (body[field] === undefined) continue;
      if (!allowed.has(field)) return sendError(res, 400, `القالب لا يسمح بتعديل ${label}.`);
      updates[field] = text(body[field], label, max, { required });
    }
    if (updates.wedding_date && !validDate(updates.wedding_date)) return sendError(res, 400, "تاريخ الزفاف غير صالح.");
    if (updates.wedding_time && !validTime(updates.wedding_time)) return sendError(res, 400, "وقت الزفاف غير صالح.");
    if (body.maps_url !== undefined) {
      if (!allowed.has("maps_url")) return sendError(res, 400, "القالب لا يسمح بتعديل رابط الخريطة.");
      updates.maps_url = mapLink(body.maps_url);
    }
    if (body.primary_color !== undefined) {
      if (!allowed.has("primary_color")) return sendError(res, 400, "القالب لا يسمح بتعديل اللون.");
      updates.primary_color = color(body.primary_color);
    }
    for (const field of ["background_url", "photo_url"]) {
      if (body[field] === undefined) continue;
      if (!allowed.has(field)) return sendError(res, 400, "القالب لا يسمح بتعديل الصورة.");
      updates[field] = optionalImageUrl(body[field]);
    }
    if (body.customization && typeof body.customization === "object" && !Array.isArray(body.customization)) {
      const validIds = new Set((snapshot?.sections || []).map((section) => section.id));
      const visibility = body.customization.sectionVisibility;
      if (visibility !== undefined) {
        if (!visibility || typeof visibility !== "object" || Array.isArray(visibility)
          || Object.keys(visibility).some((id) => !validIds.has(id))
          || Object.values(visibility).some((value) => typeof value !== "boolean")) {
          return sendError(res, 400, "إعدادات إظهار الأقسام غير صالحة.");
        }
        updates.customization_json = JSON.stringify({ sectionVisibility: visibility });
      }
    } else if (body.customization !== undefined) {
      return sendError(res, 400, "إعدادات التخصيص غير صالحة.");
    }
    if (!Object.keys(updates).length) return sendError(res, 400, "لا توجد تعديلات صالحة للحفظ.");
    const columns = Object.keys(updates);
    const setSql = columns.map((field) => `${field} = @${field}`).join(", ");
    db.prepare(`UPDATE invitations SET ${setSql} WHERE id = @id`).run({ ...updates, id: current.id });
    const saved = db.prepare("SELECT * FROM invitations WHERE id = ?").get(current.id);
    delete saved.edit_token_hash;
    return res.json({ saved: true, invitation: saved });
  } catch (error) {
    if (error instanceof InputError) return sendError(res, 400, error.message);
    return sendError(res, 500, "تعذر حفظ تعديلات الدعوة.");
  }
});

app.get("/api/invitations/:slug/edit", (req, res) => {
  const invitation = db.prepare(`SELECT i.*, t.title AS template_title, t.image_url AS template_image,
      v.snapshot_json AS template_snapshot FROM invitations i
    JOIN templates t ON t.id = i.template_id
    LEFT JOIN template_versions v ON v.id = i.template_version_id
    WHERE i.slug = ?`).get(req.params.slug);
  if (!invitation) return sendError(res, 404, "الدعوة غير موجودة.");
  const token = req.get("x-invitation-edit-token") || "";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  if (!invitation.edit_token_hash || !token || !safeCompare(tokenHash, invitation.edit_token_hash)) return sendError(res, 403, "رمز تعديل الدعوة غير صالح.");
  delete invitation.edit_token_hash;
  if (invitation.template_snapshot) {
    invitation.template_snapshot = JSON.parse(invitation.template_snapshot);
    invitation.template_title = invitation.template_snapshot.title;
    invitation.template_image = invitation.template_snapshot.image_url;
  }
  return res.json(invitation);
});

app.post("/api/invitations/:slug/media", (req, res, next) => {
  express.raw({ type: ["image/png", "image/jpeg", "image/webp", "application/octet-stream"], limit: "8mb" })(req, res, (error) => {
    if (error) return sendError(res, error.status === 413 ? 413 : 400, "حجم الصورة يتجاوز 8 ميجابايت أو نوع الطلب غير صالح.");
    return next();
  });
}, (req, res) => {
  const current = db.prepare(`SELECT i.*, v.snapshot_json FROM invitations i
    LEFT JOIN template_versions v ON v.id = i.template_version_id WHERE i.slug = ?`).get(req.params.slug);
  if (!current) return sendError(res, 404, "الدعوة غير موجودة.");
  const token = req.get("x-invitation-edit-token") || "";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  if (!current.edit_token_hash || !token || !safeCompare(tokenHash, current.edit_token_hash)) return sendError(res, 403, "رمز تعديل الدعوة غير صالح.");
  const field = req.query.field;
  if (!["photo_url", "background_url"].includes(field)) return sendError(res, 400, "حقل الوسيط غير صالح.");
  const snapshot = current.snapshot_json ? JSON.parse(current.snapshot_json) : null;
  if (!invitationFields(snapshot).has(field)) return sendError(res, 400, "القالب لا يسمح بهذا النوع من الصور.");
  const mime = detectImage(req.body || Buffer.alloc(0));
  if (!mime) return sendError(res, 400, "صيغة الصورة الفعلية غير مدعومة؛ استخدم PNG أو JPEG أو WebP.");
  try {
    const directory = resolve(mediaRoot, "invitations", current.id);
    mkdirSync(directory, { recursive: true });
    const extension = mime === "image/jpeg" ? "jpg" : mime.slice(6);
    const filename = `${randomUUID()}.${extension}`;
    const target = resolve(directory, filename);
    writeFileSync(target, req.body, { flag: "wx" });
    const publicUrl = `/media/invitations/${current.id}/${filename}`;
    try { db.prepare(`UPDATE invitations SET ${field} = ? WHERE id = ?`).run(publicUrl, current.id); }
    catch (error) { unlinkSync(target); throw error; }
    return res.status(201).json({ field, url: publicUrl });
  } catch {
    return sendError(res, 500, "تعذر حفظ الصورة.");
  }
});

app.post("/api/admin/login", (req, res) => {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredPassword) {
    return sendError(res, 503, "ضبط كلمة مرور الإدارة أولاً في ملف .env.");
  }
  const address = req.ip || "local";
  const attempts = loginAttempts.get(address) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  if (attempts.resetAt <= Date.now()) {
    attempts.count = 0;
    attempts.resetAt = Date.now() + 15 * 60 * 1000;
  }
  if (attempts.count >= 5) {
    loginAttempts.set(address, attempts);
    return sendError(res, 429, "محاولات كثيرة. حاول بعد 15 دقيقة.");
  }
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!safeCompare(password, configuredPassword)) {
    attempts.count += 1;
    loginAttempts.set(address, attempts);
    return sendError(res, 401, "كلمة المرور غير صحيحة.");
  }
  loginAttempts.delete(address);
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, Date.now() + sessionDuration);
  res.setHeader(
    "Set-Cookie",
    `farhati_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDuration / 1000}${isProduction ? "; Secure" : ""}`,
  );
  return res.json({ authenticated: true });
});

app.get("/api/admin/session", requireAdmin, (_req, res) => {
  res.json({ authenticated: true });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  sessions.delete(req.cookies.farhati_admin);
  res.setHeader("Set-Cookie", "farhati_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ authenticated: false });
});

function readTemplateArchive(req, res, next) {
  express.raw({ type: ["application/zip", "application/octet-stream", "multipart/form-data"], limit: "12mb" })(req, res, (error) => {
    if (error) return sendError(res, error.status === 413 ? 413 : 400, "تعذر قراءة ملف ZIP ضمن الحجم المسموح.");
    if (req.is("multipart/form-data")) {
      try { req.body = multipartFilesAsZip(req.body, req.get("content-type")); }
      catch (cause) { return sendError(res, 400, cause.message || "تعذر قراءة الملفات المرفقة."); }
    }
    next();
  });
}

function multipartFilesAsZip(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/iu.exec(contentType || "")?.slice(1).find(Boolean);
  if (!boundary || !Buffer.isBuffer(body)) throw new Error("طلب الملفات غير صالح.");
  const marker = Buffer.from(`--${boundary}`);
  const files = [];
  const findDelimiter = (from) => {
    let position = from;
    while ((position = body.indexOf(marker, position)) >= 0) {
      const lineStart = position === 0 || body.subarray(position - 2, position).equals(Buffer.from("\r\n"));
      const suffix = body.subarray(position + marker.length, position + marker.length + 2);
      if (lineStart && (suffix.equals(Buffer.from("\r\n")) || suffix.equals(Buffer.from("--")))) return position;
      position += marker.length;
    }
    return -1;
  };
  let cursor = 0;
  while ((cursor = findDelimiter(cursor)) >= 0) {
    cursor += marker.length;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from("--"))) break;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from("\r\n"))) cursor += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd < 0) throw new Error("رؤوس ملف مرفق غير مكتملة.");
    const headers = body.toString("latin1", cursor, headerEnd);
    const filename = /content-disposition:[^\r\n]*\bfilename="([^"]*)"/iu.exec(headers)?.[1];
    const dataStart = headerEnd + 4;
    const delimiter = findDelimiter(dataStart);
    const dataEnd = delimiter - 2;
    if (dataEnd < dataStart) throw new Error("بيانات ملف مرفق غير مكتملة.");
    if (filename !== undefined) {
      const encodedName = /filename\*=UTF-8''([^;\r\n]+)/iu.exec(headers)?.[1];
      let name = filename;
      if (encodedName) { try { name = decodeURIComponent(encodedName); } catch { throw new Error("اسم ملف غير صالح."); } }
      const normalized = name.replaceAll("\\", "/");
      if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`مسار مرفق غير آمن: ${name.slice(0, 100)}.`);
      files.push([normalized, body.subarray(dataStart, dataEnd)]);
    }
    cursor = dataEnd + 2;
  }
  if (!files.length || files.length > 25) throw new Error("أرفق ملفًا واحدًا إلى 25 ملفًا.");
  if (files.length === 1 && files[0][1].subarray(0, 2).equals(Buffer.from([0x50, 0x4b]))) return Buffer.from(files[0][1]);
  for (const file of files) {
    const beginning = file[1].toString("utf8", 0, Math.min(file[1].length, 512)).replace(/^\uFEFF/u, "");
    if (/^\s*(?:<!doctype\s+html|<html\b)/iu.test(beginning)) file[0] = `${file[0].slice(0, Math.max(0, file[0].lastIndexOf("/") + 1))}index.html`;
  }
  return packTemplateFiles(files);
}

app.post("/api/admin/templates/validate", requireAdmin, readTemplateArchive, (req, res) => {
  try {
    const parsed = parseTemplateArchive(req.body);
    const preview = { ...parsed.manifest };
    const cover = parsed.assets.get(preview.cover);
    preview.coverPreview = `data:${cover.mime};base64,${cover.content.toString("base64")}`;
    preview.sections = preview.sections.map((section) => {
      const asset = section.image ? parsed.assets.get(section.image) : null;
      const media = section.asset ? parsed.assets.get(section.asset) : null;
      return {
        ...section,
        imagePreview: asset ? `data:${asset.mime};base64,${asset.content.toString("base64")}` : "",
        assetPreview: media ? `data:${media.mime};base64,${media.content.toString("base64")}` : "",
      };
    });
    return res.json({ valid: true, manifest: preview });
  } catch (error) {
    return sendError(res, error.status || 400, error.message || "تعذر التحقق من القالب.");
  }
});

app.post("/api/admin/templates/convert-legacy/preview", requireAdmin, readTemplateArchive, (req, res) => {
  try {
    const parsed = parseTemplateArchive(req.body, { convertLegacy: true });
    if (!parsed.warnings) return sendError(res, 400, "الملف يحتوي manifest.json بالفعل؛ استخدم الفحص المعتاد بدل التحويل.");
    const preview = { ...parsed.manifest };
    const cover = parsed.assets.get(preview.cover);
    preview.coverPreview = `data:${cover.mime};base64,${cover.content.toString("base64")}`;
    preview.sections = preview.sections.map((section) => {
      const asset = section.image ? parsed.assets.get(section.image) : null;
      const media = section.asset ? parsed.assets.get(section.asset) : null;
      return { ...section, imagePreview: asset ? `data:${asset.mime};base64,${asset.content.toString("base64")}` : "", assetPreview: media ? `data:${media.mime};base64,${media.content.toString("base64")}` : "" };
    });
    return res.json({ valid: true, converted: true, warnings: parsed.warnings, manifest: preview });
  } catch (error) {
    return sendError(res, error.status || 400, error.message || "تعذر تحويل القالب القديم.");
  }
});

app.post("/api/admin/templates/import", requireAdmin, readTemplateArchive, (req, res) => {
  let directory = "";
  const writtenFiles = [];
  try {
    const converted = req.get("x-template-archive-mode") === "legacy-convert";
    const parsed = parseTemplateArchive(req.body, { convertLegacy: converted });
    const { manifest, assets } = parsed;
    const id = randomBytes(12).toString("hex");
    directory = resolve(mediaRoot, "templates", id);
    mkdirSync(directory, { recursive: true });
    const assetPaths = new Map();
    let assetIndex = 0;
    for (const [name, asset] of assets) {
      const filename = `${String(assetIndex).padStart(2, "0")}-${randomUUID()}.${asset.extension}`;
      assetIndex += 1;
      const target = resolve(directory, filename);
      writeFileSync(target, asset.content, { flag: "wx" });
      writtenFiles.push(target);
      assetPaths.set(name, `/media/templates/${id}/${filename}`);
    }
    const sections = manifest.sections.map((section) => ({
      ...section,
      image: section.image ? assetPaths.get(section.image) : "",
      asset: section.asset ? assetPaths.get(section.asset) : "",
    }));
    const template = {
      id,
      title: manifest.title,
      style: manifest.style,
      color: manifest.color,
      price: manifest.price,
      image_url: assetPaths.get(manifest.cover),
      description: manifest.description,
      featured: manifest.featured ? 1 : 0,
      active: 0,
    };
    const snapshot = {
      ...template,
      formatVersion: 1,
      theme: manifest.theme,
      sections,
      editable_fields: [...new Set(sections.flatMap((section) => section.editableFields))],
    };
    db.exec("BEGIN");
    try {
      db.prepare(`INSERT INTO templates (id,title,style,color,price,image_url,description,featured,active)
        VALUES (@id,@title,@style,@color,@price,@image_url,@description,@featured,@active)`).run(template);
      db.prepare(`INSERT INTO template_versions (id,template_id,version,snapshot_json)
        VALUES (?, ?, 1, ?)`).run(randomUUID(), id, JSON.stringify(snapshot));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return res.status(201).json({ ...template, version: 1, snapshot, ...(parsed.warnings ? { conversionWarnings: parsed.warnings } : {}) });
  } catch (error) {
    for (const file of writtenFiles) {
      try { unlinkSync(file); } catch { /* Best-effort rollback of imported media. */ }
    }
    if (directory && existsSync(directory)) {
      try { rmdirSync(directory); } catch { /* Keep errors out of public responses. */ }
    }
    return sendError(res, error.status || 400, error.message || "تعذر استيراد القالب.");
  }
});

app.get("/api/admin/bookings", requireAdmin, (_req, res) => {
  res.json(
    db
      .prepare(`
        SELECT b.*, i.slug, i.bride_name, i.groom_name, i.wedding_date,
               i.wedding_time, i.venue, i.maps_url, i.bride_family, i.groom_family,
               i.message, t.title AS template_title
        FROM bookings b
        JOIN invitations i ON i.id = b.invitation_id
        JOIN templates t ON t.id = i.template_id
        ORDER BY b.created_at DESC
      `)
      .all(),
  );
});

app.patch("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  const body = req.body || {};
  const current = db
    .prepare(`
      SELECT b.id, b.status, i.id AS invitation_id, i.bride_name, i.groom_name,
             i.wedding_date, i.wedding_time, i.venue, i.maps_url, i.bride_family,
             i.groom_family, i.message
      FROM bookings b JOIN invitations i ON i.id = b.invitation_id
      WHERE b.id = ?
    `)
    .get(req.params.id);
  if (!current) return sendError(res, 404, "الحجز غير موجود.");
  const status = body.status ?? current.status;
  if (!["pending", "confirmed", "completed"].includes(status)) {
    return sendError(res, 400, "حالة الحجز غير صالحة.");
  }
  try {
    const brideName = text(body.bride_name ?? current.bride_name, "اسم العروس", 80, { required: true });
    const groomName = text(body.groom_name ?? current.groom_name, "اسم العريس", 80, { required: true });
    const venue = text(body.venue ?? current.venue, "مكان الحفل", 180, { required: true });
    const weddingDate = text(body.wedding_date ?? current.wedding_date, "تاريخ الزفاف", 10, { required: true });
    const weddingTime = text(body.wedding_time ?? current.wedding_time, "وقت الزفاف", 5, { required: true });
    const mapsUrl = mapLink(body.maps_url ?? current.maps_url);
    const brideFamily = text(body.bride_family ?? current.bride_family, "اسم عائلة العروس", 120);
    const groomFamily = text(body.groom_family ?? current.groom_family, "اسم عائلة العريس", 120);
    const message = text(body.message ?? current.message, "الرسالة", 500);
    if (!validDate(weddingDate)) {
      return sendError(res, 400, "يرجى اختيار تاريخ زفاف صالح.");
    }
    if (!validTime(weddingTime)) {
      return sendError(res, 400, "يرجى اختيار وقت صالح.");
    }
    db.exec("BEGIN");
    try {
      db.prepare(`
        UPDATE invitations
        SET bride_name = ?, groom_name = ?, wedding_date = ?, wedding_time = ?,
            venue = ?, maps_url = ?, bride_family = ?, groom_family = ?, message = ?
        WHERE id = ?
      `).run(
        brideName, groomName, weddingDate, weddingTime, venue, mapsUrl,
        brideFamily, groomFamily, message, current.invitation_id,
      );
      db.prepare("UPDATE bookings SET status = ? WHERE id = ?").run(status, current.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({
      id: current.id,
      status,
      bride_name: brideName,
      groom_name: groomName,
      wedding_date: weddingDate,
      wedding_time: weddingTime,
      venue,
      maps_url: mapsUrl,
      bride_family: brideFamily,
      groom_family: groomFamily,
      message,
    });
  } catch (error) {
    if (error instanceof InputError) return sendError(res, 400, error.message);
    console.error("Could not update booking:", error);
    return sendError(res, 500, "تعذر تحديث الحجز الآن.");
  }
});

app.get("/api/admin/templates", requireAdmin, (_req, res) => {
  res.json(db.prepare(`SELECT t.*, COALESCE(MAX(v.version), 0) AS version
    FROM templates t LEFT JOIN template_versions v ON v.template_id = t.id
    GROUP BY t.id ORDER BY t.created_at DESC`).all());
});

app.get("/api/admin/templates/:id/versions", requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT id, template_id, version, created_at FROM template_versions
    WHERE template_id = ? ORDER BY version DESC`).all(req.params.id));
});

app.post("/api/admin/templates", requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const template = {
      id: randomBytes(8).toString("hex"),
      title: text(body.title, "اسم التصميم", 100, { required: true }),
      style: text(body.style, "نمط التصميم", 40, { required: true }),
      color: text(body.color, "لون التصميم", 40, { required: true }),
      price: Number(body.price),
      image_url: imageUrl(body.image_url),
      description: text(body.description ?? "", "الوصف", 300),
      featured: body.featured === true ? 1 : 0,
      active: 1,
    };
    if (!Number.isSafeInteger(template.price) || template.price < 0 || !template.image_url) {
      return sendError(res, 400, "يرجى إدخال سعر صحيح ورابط صورة صالح.");
    }
    db.exec("BEGIN");
    try {
      db.prepare(`
        INSERT INTO templates (id, title, style, color, price, image_url, description, featured, active)
        VALUES (@id, @title, @style, @color, @price, @image_url, @description, @featured, @active)
      `).run(template);
      db.prepare(`INSERT INTO template_versions (id, template_id, version, snapshot_json)
        VALUES (?, ?, 1, ?)`).run(randomUUID(), template.id, JSON.stringify({ ...template, sections: [] }));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.status(201).json(template);
  } catch (error) {
    if (error instanceof InputError) return sendError(res, 400, error.message);
    console.error("Could not create template:", error);
    return sendError(res, 500, "تعذر إضافة التصميم الآن.");
  }
});

app.patch("/api/admin/templates/:id", requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const current = db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id);
    if (!current) return sendError(res, 404, "التصميم غير موجود.");
    const template = {
      id: current.id,
      title: text(body.title ?? current.title, "اسم التصميم", 100, { required: true }),
      style: text(body.style ?? current.style, "نمط التصميم", 40, { required: true }),
      color: text(body.color ?? current.color, "لون التصميم", 40, { required: true }),
      price: Number(body.price ?? current.price),
      image_url: imageUrl(body.image_url ?? current.image_url),
      description: text(body.description ?? current.description, "الوصف", 300),
      featured: body.featured === undefined ? current.featured : body.featured === true ? 1 : 0,
      active: body.active === undefined ? current.active : body.active === true ? 1 : 0,
    };
    if (!Number.isSafeInteger(template.price) || template.price < 0 || !template.image_url) {
      return sendError(res, 400, "يرجى إدخال سعر صحيح ورابط صورة صالح.");
    }
    db.exec("BEGIN");
    try {
      db.prepare(`
        UPDATE templates
        SET title = @title, style = @style, color = @color, price = @price,
            image_url = @image_url, description = @description, featured = @featured, active = @active
        WHERE id = @id
      `).run(template);
      const nextVersion = db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM template_versions WHERE template_id = ?").get(template.id).version;
      const previousSnapshotRow = db.prepare("SELECT snapshot_json FROM template_versions WHERE template_id = ? ORDER BY version DESC LIMIT 1").get(template.id);
      const previousSnapshot = previousSnapshotRow ? JSON.parse(previousSnapshotRow.snapshot_json) : { sections: [] };
      db.prepare(`INSERT INTO template_versions (id, template_id, version, snapshot_json)
        VALUES (?, ?, ?, ?)`).run(randomUUID(), template.id, nextVersion, JSON.stringify({ ...previousSnapshot, ...template }));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json(template);
  } catch (error) {
    if (error instanceof InputError) return sendError(res, 400, error.message);
    console.error("Could not update template:", error);
    return sendError(res, 500, "تعذر تحديث التصميم الآن.");
  }
});

app.delete("/api/admin/templates/:id", requireAdmin, (req, res) => {
  const used = db.prepare("SELECT 1 FROM invitations WHERE template_id = ? LIMIT 1").get(req.params.id);
  if (used) return sendError(res, 409, "لا يمكن حذف تصميم مرتبط بدعوة. يمكنكم تعديل بياناته بدلاً من ذلك.");
  const versions = db.prepare("SELECT snapshot_json FROM template_versions WHERE template_id = ?").all(req.params.id);
  const template = db.prepare("SELECT id FROM templates WHERE id = ?").get(req.params.id);
  const result = db.prepare("DELETE FROM templates WHERE id = ?").run(req.params.id);
  if (!result.changes) return sendError(res, 404, "التصميم غير موجود.");
  if (template) {
    const directory = resolve(mediaRoot, "templates", template.id);
    const prefix = `/media/templates/${template.id}/`;
    const paths = new Set();
    for (const row of versions) {
      try {
        const snapshot = JSON.parse(row.snapshot_json);
        for (const url of [snapshot.image_url, ...(snapshot.sections || []).flatMap((section) => [section.image, section.asset])]) {
          if (typeof url === "string" && url.startsWith(prefix)) {
            const filename = url.slice(prefix.length);
            if (/^[A-Za-z0-9._-]+$/.test(filename)) paths.add(resolve(directory, filename));
          }
        }
      } catch { /* Skip malformed historical snapshots while preserving the database operation. */ }
    }
    for (const file of paths) {
      if (resolve(file).startsWith(`${directory}${process.platform === "win32" ? "\\" : "/"}`)) {
        try { unlinkSync(file); } catch { /* Best-effort cleanup of unused template media. */ }
      }
    }
    try { rmdirSync(directory); } catch { /* The directory may contain unreferenced files. */ }
  }
  res.status(204).end();
});

if (isProduction) {
  const distPath = resolve("dist");
  if (!existsSync(distPath)) {
    console.error("Production build not found. Run npm run build first.");
    process.exitCode = 1;
  } else {
    app.use(express.static(distPath));
    app.get("/{*path}", (_req, res) => res.sendFile(resolve(distPath, "index.html")));
  }
}

export const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Farhati API listening on 0.0.0.0:${port}`);
});
