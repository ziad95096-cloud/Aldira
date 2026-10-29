import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const databasePath = resolve(process.env.DATABASE_PATH || "data/farhati.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    style TEXT NOT NULL,
    color TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
    image_url TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    featured INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    template_id TEXT NOT NULL,
    bride_name TEXT NOT NULL,
    groom_name TEXT NOT NULL,
    wedding_date TEXT NOT NULL,
    wedding_time TEXT NOT NULL,
    venue TEXT NOT NULL,
    maps_url TEXT NOT NULL DEFAULT '',
    bride_family TEXT NOT NULL DEFAULT '',
    groom_family TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    primary_color TEXT NOT NULL DEFAULT '#b89460',
    font_key TEXT NOT NULL DEFAULT 'serif',
    background_url TEXT NOT NULL DEFAULT '',
    photo_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES templates(id)
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    invitation_id TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'confirmed', 'completed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE
  );
`);

// Additive migration: keep every existing row and pin each invitation to an
// immutable template snapshot. The seed data below remains backward compatible.
const invitationColumns = new Set(db.prepare("PRAGMA table_info(invitations)").all().map((column) => column.name));
if (!invitationColumns.has("template_version_id")) {
  db.exec("ALTER TABLE invitations ADD COLUMN template_version_id TEXT");
}
if (!invitationColumns.has("customization_json")) {
  db.exec("ALTER TABLE invitations ADD COLUMN customization_json TEXT NOT NULL DEFAULT '{}'");
}
if (!invitationColumns.has("edit_token_hash")) {
  db.exec("ALTER TABLE invitations ADD COLUMN edit_token_hash TEXT");
}
const templateColumns = new Set(db.prepare("PRAGMA table_info(templates)").all().map((column) => column.name));
if (!templateColumns.has("active")) db.exec("ALTER TABLE templates ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))");
db.exec(`
  CREATE TABLE IF NOT EXISTS template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (template_id, version),
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_template_versions_template ON template_versions(template_id, version);
`);

const seedTemplates = [
  {
    id: "classic-ivory",
    title: "حكاية من حرير",
    style: "كلاسيكي",
    color: "عاجي وذهبي",
    price: 250,
    image_url: "/images/classic-ivory.svg",
    description: "أناقة كلاسيكية بتفاصيل ذهبية ناعمة.",
    featured: 1,
  },
  {
    id: "garden-rose",
    title: "حديقة الورد",
    style: "رومانسي",
    color: "وردي",
    price: 300,
    image_url: "/images/garden-rose.svg",
    description: "ورود رقيقة وألوان تحكي عن الحب.",
    featured: 1,
  },
  {
    id: "modern-sand",
    title: "دفء الحكاية",
    style: "عصري",
    color: "رملي",
    price: 200,
    image_url: "/images/modern-sand.svg",
    description: "خطوط بسيطة ولمسة دافئة مميزة.",
    featured: 1,
  },
  {
    id: "olive-evening",
    title: "ليلة زيتونية",
    style: "عصري",
    color: "أخضر",
    price: 220,
    image_url: "/images/olive-evening.svg",
    description: "درجات طبيعية لأمسية لا تُنسى.",
    featured: 0,
  },
  {
    id: "golden-night",
    title: "ليلة من ذهب",
    style: "فاخر",
    color: "ذهبي",
    price: 350,
    image_url: "/images/golden-night.svg",
    description: "فخامة هادئة تليق بليلتكم الكبيرة.",
    featured: 0,
  },
  {
    id: "blue-dream",
    title: "حلم أزرق",
    style: "كلاسيكي",
    color: "أزرق",
    price: 240,
    image_url: "/images/blue-dream.svg",
    description: "هدوء السماء في دعوة بطابع أنيق.",
    featured: 0,
  },
];

const insertTemplate = db.prepare(`
  INSERT OR IGNORE INTO templates
    (id, title, style, color, price, image_url, description, featured)
  VALUES
    (@id, @title, @style, @color, @price, @image_url, @description, @featured)
`);

for (const template of seedTemplates) insertTemplate.run(template);

for (const template of seedTemplates) {
  db.prepare(`
    UPDATE templates SET image_url = @image_url
    WHERE id = @id AND image_url LIKE 'https://images.unsplash.com/%'
  `).run({ id: template.id, image_url: template.image_url });
}

const templates = db.prepare("SELECT * FROM templates").all();
const insertVersion = db.prepare(`
  INSERT OR IGNORE INTO template_versions (id, template_id, version, snapshot_json)
  VALUES (?, ?, 1, ?)
`);
for (const template of templates) {
  const version = db.prepare("SELECT id FROM template_versions WHERE template_id = ? ORDER BY version DESC LIMIT 1").get(template.id);
  if (!version) {
    const id = randomUUID();
    insertVersion.run(id, template.id, JSON.stringify({ ...template, sections: [] }));
    db.prepare("UPDATE invitations SET template_version_id = ? WHERE template_id = ? AND template_version_id IS NULL").run(id, template.id);
  }
}
