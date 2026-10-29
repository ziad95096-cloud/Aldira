import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Heart,
  ImagePlus,
  LockKeyhole,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  Plus,
  Search,
  Share2,
  Sparkles,
  X,
} from "lucide-react";

const colors = {
  gold: "#b89460",
  rose: "#b87877",
  ink: "#302d28",
};

const defaultMessage =
  "بكل الحب والفرح، يسعدنا أن تشاركونا أجمل لحظاتنا.";

function routeNow() {
  const hashPath = window.location.hash.slice(1);
  if (hashPath) {
    const [path = "/", query = ""] = hashPath.split("?");
    return { path: path || "/", params: new URLSearchParams(query) };
  }
  const directPath = window.location.pathname;
  if (directPath.startsWith("/invite/")) {
    return { path: directPath, params: new URLSearchParams() };
  }
  return { path: "/", params: new URLSearchParams() };
}

function invitationUrl(slug) {
  return new URL(`/invite/${encodeURIComponent(slug)}`, window.location.origin).href;
}

function navigate(path) {
  window.location.hash = path;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goToSection(id) {
  const target = document.getElementById(id);
  if (target) {
    target.scrollIntoView({ behavior: "smooth" });
    return;
  }
  window.location.hash = "#/";
  window.setTimeout(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, 100);
}

async function api(url, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "حصل خطأ غير متوقع.");
  return result;
}

function formatPrice(price) {
  return price === 0 ? "مجاناً" : `${Number(price).toLocaleString("ar-EG")} ج.م`;
}

function formatDate(value) {
  if (!value) return "حددوا الموعد";
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function App() {
  const [route, setRoute] = useState(routeNow);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const updateRoute = () => setRoute(routeNow());
    window.addEventListener("hashchange", updateRoute);
    if (!window.location.hash && !window.location.pathname.startsWith("/invite/")) navigate("/");
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 3400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const notify = (message) => setToast(message);
  const isInvitation = route.path.startsWith("/invite/");
  const slug = isInvitation ? route.path.split("/")[2] : "";

  return (
    <>
      {!isInvitation && <Header />}
      {route.path === "/" && <Home notify={notify} />}
      {route.path === "/templates" && (
        <Gallery
          notify={notify}
          initialStyle={route.params.get("style") || "الكل"}
        />
      )}
      {route.path === "/build" && (
        <Builder
          initialTemplate={route.params.get("template") || ""}
          notify={notify}
        />
      )}
      {route.path.startsWith("/edit/") && (
        <Builder initialTemplate="" initialEditSlug={route.path.split("/")[2]} notify={notify} />
      )}
      {isInvitation && <Invitation slug={slug} notify={notify} />}
      {route.path === "/admin" && <Admin notify={notify} />}
      {!["/", "/templates", "/build", "/admin"].includes(route.path) &&
        !route.path.startsWith("/edit/") && !isInvitation && <NotFound />}
      {!isInvitation && <Footer />}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          <span>{toast}</span>
          <button type="button" onClick={() => setToast("")} aria-label="إغلاق">
            <X size={17} />
          </button>
        </div>
      )}
    </>
  );
}

function Brand({ light = false }) {
  return (
    <a className={`brand${light ? " brand-light" : ""}`} href="#/" aria-label="فرحتي، الرئيسية">
      <span className="brand-symbol"><Heart size={20} strokeWidth={1.6} /></span>
      <span>فرحتي</span>
    </a>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Brand />
        <nav className={`main-nav${menuOpen ? " main-nav-open" : ""}`} aria-label="القائمة الرئيسية">
          <a href="#/" onClick={() => setMenuOpen(false)}>الرئيسية</a>
          <a href="#/templates" onClick={() => setMenuOpen(false)}>التصميمات</a>
          <a href="#/" onClick={(event) => {
            event.preventDefault();
            setMenuOpen(false);
            goToSection("how-it-works");
          }}>كيف تعمل؟</a>
        </nav>
        <div className="header-actions">
          <a className="button button-dark button-small header-cta" href="#/templates">
            صمم دعوتك <ArrowLeft size={16} />
          </a>
          <button
            className="icon-button mobile-menu"
            type="button"
            aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  );
}

function Home({ notify }) {
  const [templates, setTemplates] = useState([]);
  const [templateError, setTemplateError] = useState("");
  useEffect(() => {
    api("/api/templates?featured=true")
      .then(setTemplates)
      .catch((cause) => setTemplateError(cause.message));
  }, []);

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-line" /> لكل حكاية بداية جميلة</span>
          <h1>دعوة تشبه<br />حكايتكم <span>وتبقى.</span></h1>
          <p>تفاصيل صغيرة، مشاعر كبيرة. صمموا دعوتكم الرقمية بكل حب وشاركوها مع كل اللي بتحبوهم.</p>
          <div className="hero-actions">
            <a className="button button-dark" href="#/templates">
              اكتشفوا التصميمات <ArrowLeft size={17} />
            </a>
            <a className="text-link" href="#/" onClick={(event) => {
              event.preventDefault();
              goToSection("how-it-works");
            }}>
              اعرفوا أكثر <ArrowDown size={16} />
            </a>
          </div>
          <div className="hero-note">
            <span className="avatar-stack" aria-hidden="true">
              <span>م</span><span>ن</span><span>ر</span>
            </span>
            <span>لحظاتكم تستحق دعوة مميزة</span>
            <Sparkles size={16} />
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-image" role="img" aria-label="باقة زهور زفاف أنيقة" />
          <div className="hero-card">
            <span className="mini-flower">✳</span>
            <span className="hero-card-small">فرحة العمر</span>
            <strong>مريم <i>&amp;</i> يوسف</strong>
            <span className="hero-card-rule" />
            <span className="hero-card-small">١٢ · ١٢ · ٢٠٢٦</span>
            <Heart className="hero-card-heart" size={16} />
          </div>
          <span className="hero-sparkle sparkle-one">✳</span>
          <span className="hero-sparkle sparkle-two">✳</span>
          <div className="hero-image-caption"><span /> مصممة بكل حب، خصيصاً لكم</div>
        </div>
        <div className="hero-bottom-note">01 — 06 <span /></div>
      </section>

      <section className="category-section page-section" id="collections">
        <div className="section-heading">
          <div>
            <span className="eyebrow">لكل ذوق حكاية</span>
            <h2>اختاروا أسلوبكم</h2>
          </div>
          <a className="text-link" href="#/templates">كل التصميمات <ArrowLeft size={16} /></a>
        </div>
        <div className="category-grid">
          {[
            ["كلاسيكي", "أناقة لا يغيّرها الزمن", "/images/classic-ivory.svg"],
            ["رومانسي", "تفاصيل من القلب", "/images/garden-rose.svg"],
            ["عصري", "للحكايات المختلفة", "/images/modern-sand.svg"],
          ].map(([title, caption, image]) => (
            <a className="category-card" href={`#/templates?style=${encodeURIComponent(title)}`} key={title}>
              <img src={image} alt="" loading="lazy" />
              <span className="category-shade" />
              <span className="category-card-content">
                <span>{caption}</span><strong>{title}</strong>
                <span className="category-arrow"><ArrowUpRight size={16} /></span>
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="featured-section page-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">اختيارات بحب</span>
            <h2>تصميمات اختارناها لكم</h2>
          </div>
          <a className="text-link" href="#/templates">شوفوا المجموعة <ArrowLeft size={16} /></a>
        </div>
        <div className="template-grid">
          {templates.slice(0, 3).map((template) => (
            <TemplateCard key={template.id} template={template} notify={notify} />
          ))}
        </div>
        {templateError && <div className="inline-error" role="alert">{templateError}</div>}
        {!templates.length && !templateError && <p className="empty-note">جاري تجهيز التصميمات المميزة لكم.</p>}
      </section>

      <section className="story-section" id="how-it-works">
        <div className="story-photo" role="img" aria-label="لحظة احتفال جميلة" />
        <div className="story-copy">
          <span className="eyebrow">من اختياركم إلى أحبابكم</span>
          <h2>حكايتكم تبدأ<br />من هنا.</h2>
          <p>ما بين أول كلمة «مبروك» وآخر رقصة في ليلتكم، خلي كل تفصيلة تحكي عنكم. إحنا هنا عشان نسهّل البداية.</p>
          <div className="steps-list">
            {[
              ["01", "اختاروا تصميمكم", "تصميمات بلمسات مختلفة، اختاروا الأقرب لحكايتكم."],
              ["02", "ضيفوا تفاصيلكم", "أسماؤكم، موعدكم، وكل التفاصيل اللي بتحبوها."],
              ["03", "شاركوها بفرحة", "رابط خاص بدعوتكم، جاهز يتبعت لكل أحبابكم."],
            ].map(([number, title, caption]) => (
              <div className="step-item" key={number}>
                <span className="step-number">{number}</span>
                <div><strong>{title}</strong><p>{caption}</p></div>
              </div>
            ))}
          </div>
          <a className="button button-dark" href="#/templates">ابدأوا حكايتكم <ArrowLeft size={16} /></a>
        </div>
      </section>

      <section className="closing-quote">
        <span className="quote-flower">✳</span>
        <span className="eyebrow">أجمل لحظة، تستاهل أجمل دعوة</span>
        <h2>حكاية حبكم<br /><span>تستحق أن تُروى.</span></h2>
        <a className="button button-light" href="#/templates">صمموا دعوتكم الآن <ArrowLeft size={16} /></a>
      </section>
    </main>
  );
}

function TemplateCard({ template, notify, onPreview }) {
  const [showPreview, setShowPreview] = useState(false);
  const previewOpen = onPreview || (() => setShowPreview(true));
  return (
    <>
      <article className="template-card">
        <button className="template-image-button" type="button" onClick={previewOpen} aria-label={`معاينة ${template.title}`}>
          <img src={template.image_url} alt={`تصميم ${template.title}`} loading="lazy" />
          <span className="template-image-tag">{template.style}</span>
          <span className="template-preview-hint">معاينة التصميم <ArrowUpRight size={14} /></span>
        </button>
        <div className="template-card-info">
          <div><h3>{template.title}</h3><span>{template.color}</span></div>
          <strong>{formatPrice(template.price)}</strong>
        </div>
        <div className="template-card-bottom">
          <p>{template.description}</p>
          <button
            className="text-link"
            type="button"
            onClick={() => {
              if (notify) notify(`اختيار رائع! ${template.title} في انتظار تفاصيلكم.`);
              navigate(`/build?template=${encodeURIComponent(template.id)}`);
            }}
          >
            اختاروا التصميم <ArrowLeft size={15} />
          </button>
        </div>
      </article>
      {showPreview && (
        <TemplatePreview
          template={template}
          close={() => setShowPreview(false)}
          choose={() => navigate(`/build?template=${encodeURIComponent(template.id)}`)}
        />
      )}
    </>
  );
}

function TemplatePreview({ template, close, choose }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className="preview-modal" role="dialog" aria-modal="true" aria-label={`معاينة ${template.title}`}>
        <button className="modal-close" type="button" onClick={close} aria-label="إغلاق"><X size={20} /></button>
        <img src={template.image_url} alt={`تصميم ${template.title}`} />
        <div className="preview-modal-copy">
          <span className="eyebrow">{template.style} · {template.color}</span>
          <h2>{template.title}</h2>
          <p>{template.description}</p>
          <div className="preview-modal-bottom">
            <strong>{formatPrice(template.price)}</strong>
            <button type="button" className="button button-dark" onClick={choose}>صمموا على هذا النمط <ArrowLeft size={16} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Gallery({ notify, initialStyle }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: "",
    style: initialStyle,
    color: "الكل",
    price: "الكل",
  });
  const [activePreview, setActivePreview] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setFilters((current) => ({ ...current, style: initialStyle }));
  }, [initialStyle]);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "الكل") params.set(key, value);
    });
    setLoading(true);
    api(`/api/templates?${params}`)
      .then((data) => { setTemplates(data); setError(""); })
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, [filters]);

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const reset = () => setFilters({ search: "", style: "الكل", color: "الكل", price: "الكل" });

  return (
    <main className="gallery-page">
      <section className="gallery-intro page-section">
        <span className="eyebrow">مجموعة فرحتي</span>
        <h1>دعوة تليق <span>بحكايتكم.</span></h1>
        <p>كل تصميم معمول بحب، عشان يومكم الكبير يبدأ بتفصيلة شبهكم.</p>
        <div className="breadcrumb"><a href="#/">الرئيسية</a><span>/</span><span>التصميمات</span></div>
      </section>
      <section className="gallery-content page-section">
        <div className="gallery-toolbar">
          <label className="search-field">
            <Search size={18} />
            <input
              type="search"
              placeholder="دوروا على تصميم..."
              value={filters.search}
              onChange={(event) => setFilter("search", event.target.value)}
            />
          </label>
          <div className="filter-group">
            <label className="select-field">
              <span>الأسلوب</span>
              <select value={filters.style} onChange={(event) => setFilter("style", event.target.value)}>
                <option>الكل</option><option>كلاسيكي</option><option>رومانسي</option><option>عصري</option><option>فاخر</option>
              </select><ChevronDown size={15} />
            </label>
            <label className="select-field">
              <span>اللون</span>
              <select value={filters.color} onChange={(event) => setFilter("color", event.target.value)}>
                <option>الكل</option><option>عاجي وذهبي</option><option>وردي</option><option>رملي</option><option>أخضر</option><option>ذهبي</option><option>أزرق</option>
              </select><ChevronDown size={15} />
            </label>
            <label className="select-field">
              <span>السعر</span>
              <select value={filters.price} onChange={(event) => setFilter("price", event.target.value)}>
                <option>الكل</option><option value="free">مجاناً</option><option value="paid">مدفوع</option>
              </select><ChevronDown size={15} />
            </label>
          </div>
        </div>
        <div className="gallery-results">
          <span>{loading ? "بنجهّز لكم التصميمات..." : `${templates.length} تصميمات`}</span>
          <button className="text-link" type="button" onClick={reset}>إعادة الفلاتر <Minus size={14} /></button>
        </div>
        {error && <div className="inline-error" role="alert">{error}</div>}
        {!loading && !error && templates.length > 0 && (
          <div className="template-grid gallery-grid">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                notify={notify}
                onPreview={() => setActivePreview(template)}
              />
            ))}
          </div>
        )}
        {!loading && !error && templates.length === 0 && (
          <div className="empty-state"><Search size={25} /><h2>ما لقيناش تصميم بالمواصفات دي</h2><p>جربوا تغيّروا البحث أو شيلوا بعض الفلاتر.</p><button className="button button-outline" onClick={reset} type="button">عرض كل التصميمات</button></div>
        )}
      </section>
      {activePreview && (
        <TemplatePreview
          template={activePreview}
          close={() => setActivePreview(null)}
          choose={() => navigate(`/build?template=${encodeURIComponent(activePreview.id)}`)}
        />
      )}
    </main>
  );
}

const initialForm = {
  bride_name: "",
  groom_name: "",
  wedding_date: "",
  wedding_time: "20:00",
  venue: "",
  maps_url: "",
  bride_family: "",
  groom_family: "",
  message: defaultMessage,
  primary_color: colors.gold,
  font_key: "serif",
  background_url: "",
  photo_url: "",
  customer_name: "",
  customer_phone: "",
};

function Builder({ initialTemplate, initialEditSlug = "", notify }) {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(initialTemplate);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [editToken, setEditToken] = useState("");
  const [manualEditToken, setManualEditToken] = useState("");
  const [editLoaded, setEditLoaded] = useState(false);
  const [sectionVisibility, setSectionVisibility] = useState({});
  const [templateOverride, setTemplateOverride] = useState(null);

  const loadEditInvitation = async (token) => {
    try {
      const invitation = await api(`/api/invitations/${encodeURIComponent(initialEditSlug)}/edit`, {
        headers: { "X-Invitation-Edit-Token": token },
      });
      setForm((current) => ({ ...current, ...invitation }));
      setTemplateId(invitation.template_id);
      setTemplateOverride({ id: invitation.template_id, title: invitation.template_title, image_url: invitation.template_image, snapshot: invitation.template_snapshot });
      try { setSectionVisibility(JSON.parse(invitation.customization_json || "{}").sectionVisibility || {}); } catch { setSectionVisibility({}); }
      setTemplates((items) => items.map((template) => template.id === invitation.template_id
        ? { ...template, title: invitation.template_title, image_url: invitation.template_image, snapshot: invitation.template_snapshot }
        : template));
      setEditLoaded(true);
      setError("");
    } catch (cause) { setEditToken(""); setEditLoaded(false); setError(cause.message); }
  };

  useEffect(() => {
    api("/api/templates")
      .then((data) => {
        setTemplates(data);
        setTemplateId((current) => initialEditSlug || data.some((item) => item.id === current) ? current : data[0]?.id || "");
        if (!initialEditSlug) {
          const selected = data.find((item) => item.id === initialTemplate) || data[0];
          if (selected?.snapshot?.theme) setForm((current) => ({
            ...current,
            primary_color: selected.snapshot.theme.accent || current.primary_color,
            font_key: selected.snapshot.theme.fontKey || current.font_key,
          }));
        }
      })
      .catch((cause) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!initialEditSlug) return;
    let token = "";
    try { token = sessionStorage.getItem(`farhati-edit-${initialEditSlug}`) || ""; } catch { /* Allow manual capability entry when storage is unavailable. */ }
    if (!token) {
      setError("أدخلوا رمز التعديل السري الذي ظهر عند إنشاء الدعوة.");
      return;
    }
    setEditToken(token);
    loadEditInvitation(token);
  }, [initialEditSlug]);

  const selectedTemplate = templateOverride?.id === templateId ? templateOverride : templates.find((item) => item.id === templateId);
  const canCustomize = (field) => ["bride_name", "groom_name", "wedding_date", "wedding_time", "venue"].includes(field)
    || !selectedTemplate?.snapshot?.sections?.length
    || selectedTemplate.snapshot.editable_fields?.includes(field);
  const localOnly = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const updateValue = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const uploadInvitationMedia = async (field, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError("حجم الصورة يجب ألا يتجاوز 8 ميجابايت."); return; }
    setError("");
    try {
      const result = await api(`/api/invitations/${encodeURIComponent(initialEditSlug)}/media?field=${field}`, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream", "X-Invitation-Edit-Token": editToken },
      });
      setForm((current) => ({ ...current, [field]: result.url }));
      notify("تم رفع الصورة وحفظها لهذه الدعوة.");
    } catch (cause) { setError(cause.message); }
  };
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (initialEditSlug) {
        const editablePayload = Object.fromEntries(
          ["bride_name", "groom_name", "wedding_date", "wedding_time", "venue", "bride_family", "groom_family", "message", "maps_url", "primary_color", "font_key", "background_url", "photo_url"]
            .filter((field) => canCustomize(field))
            .map((field) => [field, form[field]]),
        );
        await api(`/api/invitations/${encodeURIComponent(initialEditSlug)}`, {
          method: "PATCH",
          headers: { "X-Invitation-Edit-Token": editToken },
          body: JSON.stringify({ ...editablePayload, customization: { sectionVisibility } }),
        });
        notify("تم حفظ تعديلات دعوتكم.");
      } else {
        const result = await api("/api/invitations", {
          method: "POST",
          body: JSON.stringify({ ...form, template_id: templateId, customization: { sectionVisibility } }),
        });
        setEditToken(result.edit_token);
        try { sessionStorage.setItem(`farhati-edit-${result.slug}`, result.edit_token); } catch { /* The success screen still exposes a copyable recovery code. */ }
        setCreated(result);
        notify("اتحفظت دعوتكم، ومستنية تشاركوها مع أحبابكم!");
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="builder-page">
      <section className="builder-heading page-section">
        <div><span className="eyebrow">خطوة صغيرة لفرحة كبيرة</span><h1>{initialEditSlug ? "عدّلوا " : "صمموا "}<span>دعوتكم.</span></h1></div>
        <p>املأوا التفاصيل وشوفوا دعوتكم وهي بتتشكّل قدامكم.</p>
      </section>
      {created ? (
        <section className="success-panel page-section">
          <span className="success-icon"><Check size={31} /></span>
          <span className="eyebrow">كل تفصيلة اتحفظت بحب</span>
          <h2>دعوتكم بقت جاهزة!</h2>
          <p>شاركوا الرابط مع أحبابكم، واحتفظوا برقم الحجز للمتابعة.</p>
          <div className="share-link-box" dir="ltr">
            <span>{invitationUrl(created.slug)}</span>
            <button className="button button-dark button-small" type="button" onClick={async () => {
              try {
                await navigator.clipboard.writeText(invitationUrl(created.slug));
                notify("نسخنا رابط دعوتكم!");
              } catch {
                notify("انسخوا الرابط يدوياً من الخانة.");
              }
            }}><Copy size={15} /> نسخ</button>
          </div>
          <div className="order-reference"><span>رقم الحجز</span><strong>{created.order_number}</strong><span>الحالة: قيد المراجعة</span></div>
          <div className="edit-capability-note">
            <strong>رمز تعديل الدعوة</strong>
            <code dir="ltr">{created.edit_token}</code>
            <span>احتفظوا بهذا الرمز؛ هو إثبات صلاحية التعديل ولا يظهر مرة أخرى.</span>
            <button className="button button-outline button-small" type="button" onClick={async () => {
              try { await navigator.clipboard.writeText(created.edit_token); notify("تم نسخ رمز التعديل السري."); }
              catch { notify("يمكنكم نسخ رمز التعديل الظاهر يدوياً."); }
            }}>نسخ الرمز <Copy size={14} /></button>
          </div>
          {localOnly && (
            <p className="local-link-warning">
              الموقع حالياً على هذا الجهاز فقط؛ لمشاركة الرابط مع الآخرين، انشروا الموقع على نطاق إنترنت عام أولاً.
            </p>
          )}
          <div className="success-actions">
            <a className="button button-dark" href={invitationUrl(created.slug)}>شوفوا دعوتكم <ArrowLeft size={16} /></a>
            <button className="button button-outline" type="button" onClick={() => navigate(`/edit/${created.slug}`)}>تعديل الدعوة لاحقاً</button>
            <button className="button button-outline" type="button" onClick={() => setCreated(null)}>تعديل التفاصيل</button>
          </div>
        </section>
      ) : (
        <div className="builder-layout page-section">
          <form className="builder-form" onSubmit={submit}>
            {initialEditSlug && !editToken && <div className="edit-token-entry">
              <label className="form-field"><span>رمز التعديل السري</span><input type="password" autoComplete="off" value={manualEditToken} onChange={(event) => setManualEditToken(event.target.value)} /></label>
              <button className="button button-dark" type="button" disabled={!manualEditToken.trim()} onClick={() => {
                const token = manualEditToken.trim();
                setEditToken(token);
                try { sessionStorage.setItem(`farhati-edit-${initialEditSlug}`, token); } catch { /* Token remains in this page's component state. */ }
                loadEditInvitation(token);
              }}>فتح محرر الدعوة</button>
            </div>}
            {initialEditSlug && editToken && !editLoaded && <p className="empty-note">جاري التحقق من رمز التعديل...</p>}
            {!initialEditSlug && <div className="builder-step">
              <span className="builder-step-number">١</span>
              <div className="builder-step-content">
                <h2>اختاروا التصميم</h2>
                <p>اختاروا الخلفية الأقرب لذوقكم.</p>
                <div className="design-choice-list">
                  {templates.map((template) => (
                    <button
                      className={`design-choice${template.id === templateId ? " design-choice-active" : ""}`}
                      key={template.id}
                      type="button"
                      onClick={() => {
                        setTemplateId(template.id);
                        setForm((current) => ({
                          ...current,
                          primary_color: template.snapshot?.theme?.accent || current.primary_color,
                          font_key: template.snapshot?.theme?.fontKey || current.font_key,
                        }));
                      }}
                    >
                      <img src={template.image_url} alt="" />
                      <span><strong>{template.title}</strong><small>{template.style}</small></span>
                      <span className="design-price">{formatPrice(template.price)}</span>
                      {template.id === templateId && <CheckCircle2 size={19} />}
                    </button>
                  ))}
                </div>
              </div>
            </div>}
            <div className="builder-step">
              <span className="builder-step-number">٢</span>
              <div className="builder-step-content">
                <h2>حكايتكم وتفاصيلكم</h2>
                <p>كل معلومة هتظهر في دعوتكم الرقمية.</p>
                <div className="form-grid">
                  <label className="form-field"><span>اسم العروس <i>*</i></span><input required maxLength={80} value={form.bride_name} onChange={update("bride_name")} placeholder="مريم" /></label>
                  <label className="form-field"><span>اسم العريس <i>*</i></span><input required maxLength={80} value={form.groom_name} onChange={update("groom_name")} placeholder="يوسف" /></label>
                  <label className="form-field"><span>تاريخ الفرح <i>*</i></span><input required type="date" min={!initialEditSlug ? new Date().toISOString().slice(0, 10) : undefined} value={form.wedding_date} onChange={update("wedding_date")} /></label>
                  <label className="form-field"><span>وقت الفرح <i>*</i></span><input required type="time" value={form.wedding_time} onChange={update("wedding_time")} /></label>
                  <label className="form-field form-field-wide"><span>مكان الحفل <i>*</i></span><input required maxLength={180} value={form.venue} onChange={update("venue")} placeholder="مثال: قاعة لافندر — القاهرة" /></label>
                  {canCustomize("maps_url") && <label className="form-field form-field-wide"><span>رابط الموقع على خرائط Google</span><input type="url" maxLength={2000} value={form.maps_url} onChange={update("maps_url")} placeholder="https://maps.google.com/..." /></label>}
                  {canCustomize("bride_family") && <label className="form-field"><span>اسم عائلة العروس</span><input maxLength={120} value={form.bride_family} onChange={update("bride_family")} placeholder="عائلة الورداني" /></label>}
                  {canCustomize("groom_family") && <label className="form-field"><span>اسم عائلة العريس</span><input maxLength={120} value={form.groom_family} onChange={update("groom_family")} placeholder="عائلة المنسي" /></label>}
                  {canCustomize("message") && <label className="form-field form-field-wide"><span>رسالتكم لأحبابكم</span><textarea rows={3} maxLength={500} value={form.message} onChange={update("message")} /></label>}
                </div>
              </div>
            </div>
            <div className="builder-step">
              <span className="builder-step-number">٣</span>
              <div className="builder-step-content">
                <h2>لمستكم الخاصة</h2>
                <p>اختاروا اللون والصورة اللي بتحبوها.</p>
                <div className="form-grid customization-grid">
                  {canCustomize("primary_color") && <label className="form-field color-picker-field"><span>لون التفاصيل</span><span className="color-control"><input type="color" value={form.primary_color} onChange={update("primary_color")} /><span>{form.primary_color}</span></span></label>}
                  {canCustomize("font_key") && <label className="form-field"><span>الخط</span><select value={form.font_key} onChange={update("font_key")}><option value="serif">خط عربي أنيق</option><option value="sans">خط بسيط</option></select></label>}
                  {canCustomize("photo_url") && <>
                    <label className="form-field form-field-wide"><span>رابط صورة الغلاف <small>(اختياري)</small></span><input type="url" value={form.photo_url} maxLength={2000} onChange={update("photo_url")} placeholder="https://..." /></label>
                    {initialEditSlug && <label className="form-field form-field-wide"><span>أو ارفعوا صورة PNG أو JPEG أو WebP</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadInvitationMedia("photo_url", event)} /></label>}
                  </>}
                </div>
                {selectedTemplate?.snapshot?.sections?.length > 0 && <fieldset className="section-visibility-fields">
                  <legend>الأقسام الظاهرة في دعوتكم</legend>
                  {selectedTemplate.snapshot.sections.map((section) => <label key={section.id}>
                    <input type="checkbox" checked={sectionVisibility[section.id] ?? section.visible !== false}
                      onChange={(event) => setSectionVisibility((current) => ({ ...current, [section.id]: event.target.checked }))} />
                    {section.title || ({ hero: "الغلاف", families: "العائلات", message: "رسالة الدعوة", event: "الموعد والعد التنازلي", venue: "المكان والخريطة", gallery: "معرض الصور" })[section.type]}
                  </label>)}
                </fieldset>}
                {canCustomize("background_url") && <details className="advanced-options">
                  <summary><ImagePlus size={16} /> تخصيصات إضافية <ChevronDown size={15} /></summary>
                  <label className="form-field"><span>رابط خلفية مخصصة <small>(اختياري)</small></span><input type="url" value={form.background_url} maxLength={2000} onChange={update("background_url")} placeholder="https://..." /></label>
                  {initialEditSlug && <label className="form-field"><span>أو ارفعوا خلفية PNG أو JPEG أو WebP</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadInvitationMedia("background_url", event)} /></label>}
                </details>}
              </div>
            </div>
            {!initialEditSlug && <div className="builder-step">
              <span className="builder-step-number">٤</span>
              <div className="builder-step-content">
                <h2>بيانات التواصل</h2>
                <p>عشان نتابع طلبكم ونجهز دعوتكم.</p>
                <div className="form-grid">
                  <label className="form-field"><span>اسم صاحب الحجز <i>*</i></span><input required maxLength={100} value={form.customer_name} onChange={update("customer_name")} placeholder="اسمكم" autoComplete="name" /></label>
                  <label className="form-field"><span>رقم الهاتف <i>*</i></span><input required type="tel" maxLength={30} value={form.customer_phone} onChange={update("customer_phone")} placeholder="+20 100 000 0000" autoComplete="tel" /></label>
                </div>
              </div>
            </div>}
            {error && <div className="inline-error" role="alert">{error}</div>}
            <div className="builder-submit">
              <div><span>التصميم المختار</span><strong>{selectedTemplate?.title || "اختاروا تصميمكم"}</strong></div>
              <button className="button button-dark" type="submit" disabled={saving || !templateId || (initialEditSlug && (!editToken || !editLoaded))}>
                {saving ? "بنحفظ دعوتكم..." : initialEditSlug ? "حفظ تعديلاتكم" : "إنشاء دعوتكم"} <ArrowLeft size={16} />
              </button>
            </div>
            <p className="form-privacy"><LockKeyhole size={13} /> بياناتكم تُستخدم لإنشاء الدعوة ومتابعة الحجز فقط.</p>
          </form>
          <aside className="builder-preview">
            <div className="preview-sticky">
              <div className="preview-heading"><span>معاينة مباشرة</span><span className="live-dot" /> <small>تتحدث مع كل تعديل</small></div>
              {selectedTemplate?.snapshot?.sections?.length ? (
                <TemplateSections snapshot={selectedTemplate.snapshot} invitation={{
                  ...form,
                  customization_json: JSON.stringify({ sectionVisibility }),
                  bride_name: form.bride_name || "اسم العروس",
                  groom_name: form.groom_name || "اسم العريس",
                  template_image: form.photo_url || form.background_url || selectedTemplate?.image_url,
                  template_title: selectedTemplate?.title,
                }} />
              ) : <InvitationCard invitation={{
                ...form,
                bride_name: form.bride_name || "اسم العروس",
                groom_name: form.groom_name || "اسم العريس",
                template_image: form.photo_url || form.background_url || selectedTemplate?.image_url,
                template_title: selectedTemplate?.title,
              }} />}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function InvitationCard({ invitation, full = false }) {
  const [opened, setOpened] = useState(false);
  const isSans = invitation.font_key === "sans";
  const date = formatDate(invitation.wedding_date);
  return (
    <div className={`invitation-card${full ? " invitation-card-full" : ""}${opened ? " invitation-card-opened" : ""}${isSans ? " invitation-sans" : ""}`}>
      <div className="invitation-card-cover" style={{
        "--invite-image": `url("${invitation.photo_url || invitation.background_url || invitation.template_image || ""}")`,
        "--invite-color": invitation.primary_color || colors.gold,
      }}>
        <div className="invitation-card-cover-inner">
          <span className="invitation-ornament">✳</span>
          <span className="invitation-small-label">بكل الحب، ندعوكم لمشاركتنا</span>
          {invitation.bride_family && invitation.groom_family && (
            <span className="invite-families">{invitation.bride_family} &nbsp;·&nbsp; {invitation.groom_family}</span>
          )}
          <h2>{invitation.bride_name} <i>&amp;</i> {invitation.groom_name}</h2>
          <span className="invitation-date">{date}</span>
          <span className="invitation-ornament invitation-ornament-bottom">❧</span>
          {!full && (
            <button className="invitation-open-button" type="button" onClick={() => setOpened(!opened)}>
              {opened ? "رجوع للغلاف" : "افتحوا دعوتكم"} <Plus size={15} />
            </button>
          )}
        </div>
      </div>
      {full && (
        <div className="invitation-card-detail">
          <span className="eyebrow">يوم من أجمل أيام العمر</span>
          <p className="invitation-message">{invitation.message || defaultMessage}</p>
          <div className="invite-detail-line"><Clock3 size={17} /><span>{invitation.wedding_time || "20:00"}</span></div>
          <div className="invite-detail-line"><MapPin size={17} /><span>{invitation.venue || "مكان الحفل"}</span></div>
        </div>
      )}
      {!full && opened && (
        <div className="invitation-card-detail">
          <p className="invitation-message">{invitation.message || defaultMessage}</p>
          <div className="invite-detail-line"><Clock3 size={16} />{invitation.wedding_time || "20:00"}</div>
          <div className="invite-detail-line"><MapPin size={16} />{invitation.venue || "مكان الحفل"}</div>
        </div>
      )}
    </div>
  );
}

function TemplateSections({ snapshot, invitation, remaining }) {
  const sections = Array.isArray(snapshot?.sections) ? snapshot.sections : [];
  let visibility = {};
  try { visibility = JSON.parse(invitation?.customization_json || "{}").sectionVisibility || {}; } catch { /* Legacy invitations use manifest defaults. */ }
  const data = invitation || {};
  const cover = data.photo_url || data.background_url || snapshot?.image_url;
  return (
    <div className={`template-sections${(data.font_key || snapshot?.theme?.fontKey) === "sans" ? " template-sections-sans" : ""}`} style={{ "--template-accent": data.primary_color || snapshot?.theme?.accent || "#b89460", "--template-background": snapshot?.theme?.background || "#fffdf9" }}>
      {sections.filter((section) => visibility[section.id] ?? section.visible !== false).map((section) => {
        const image = section.imagePreview || section.image || cover;
        switch (section.type) {
          case "hero": return <section className="template-section template-section-hero" key={section.id} style={image ? { "--section-cover": `url("${image}")` } : undefined}>
            <span className="eyebrow">{section.title || "بكل الحب ندعوكم"}</span>
            <h1>{data.bride_name || "اسم العروس"}<i>&amp;</i>{data.groom_name || "اسم العريس"}</h1>
            <p>{formatDate(data.wedding_date)}</p>
          </section>;
          case "families": return <section className="template-section template-section-copy" key={section.id}>
            <span className="eyebrow">{section.title || "عائلتا العروسين"}</span>
            <h2>{data.bride_family || ""}{data.bride_family && data.groom_family ? " · " : ""}{data.groom_family || ""}</h2>
          </section>;
          case "message": return <section className="template-section template-section-copy" key={section.id}>
            <span className="eyebrow">{section.title || "رسالة من القلب"}</span>
            <p>{data.message || defaultMessage}</p>
            {section.text && <p className="template-section-static-copy">{section.text}</p>}
          </section>;
          case "event": return <section className="template-section template-section-copy" key={section.id}>
            <span className="eyebrow">{section.title || "موعد فرحتنا"}</span>
            <h2>{formatDate(data.wedding_date)}</h2><p>{data.wedding_time || ""}</p>
            {remaining && <div className="countdown">{[["days", "يوم"], ["hours", "ساعة"], ["minutes", "دقيقة"], ["seconds", "ثانية"]].map(([key, label]) => <div className="countdown-unit" key={key}><strong>{String(remaining[key]).padStart(2, "0")}</strong><span>{label}</span></div>)}</div>}
          </section>;
          case "venue": return <section className="template-section template-section-copy" key={section.id}>
            <span className="eyebrow">{section.title || "مكان اللقاء"}</span><h2>{data.venue || "مكان الحفل"}</h2>
            {data.maps_url && <a className="button button-outline" href={data.maps_url} target="_blank" rel="noreferrer">افتحوا الموقع على الخريطة <ArrowUpRight size={15} /></a>}
          </section>;
          case "gallery": return <section className="template-section template-section-gallery" key={section.id}>
            {section.title && <h2>{section.title}</h2>}
            {image ? <img src={image} alt={section.title || "صورة من الدعوة"} loading="lazy" /> : <p>يمكن إضافة صورة لهذه الدعوة.</p>}
          </section>;
          case "video": return <section className="template-section template-section-gallery" key={section.id}>
            {section.title && <h2>{section.title}</h2>}
            <video controls preload="none" poster={section.imagePreview || section.image || undefined} src={section.assetPreview || section.asset} />
          </section>;
          case "music": return <section className="template-section template-section-copy" key={section.id}>
            <span className="eyebrow">{section.title || "موسيقى الدعوة"}</span>
            <audio controls preload="none" src={section.assetPreview || section.asset} />
          </section>;
          default: return null;
        }
      })}
    </div>
  );
}

function Invitation({ slug, notify }) {
  const [invitation, setInvitation] = useState(null);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    api(`/api/invitations/${encodeURIComponent(slug)}`)
      .then((data) => { setInvitation(data); setError(""); })
      .catch((cause) => setError(cause.message));
  }, [slug]);

  useEffect(() => {
    if (!invitation) return undefined;
    const originalTitle = document.title;
    const description = document.querySelector('meta[name="description"]');
    const originalDescription = description?.content;
    document.title = `${invitation.bride_name} & ${invitation.groom_name} — دعوة فرحتي`;
    if (description) description.content = `يسعد ${invitation.bride_name} و${invitation.groom_name} أن تشاركوهم فرحتهم.`;
    return () => {
      document.title = originalTitle;
      if (description && originalDescription) description.content = originalDescription;
    };
  }, [invitation]);

  useEffect(() => {
    if (!invitation?.wedding_date) return undefined;
    const updateCountdown = () => {
      const target = new Date(`${invitation.wedding_date}T${invitation.wedding_time || "20:00"}:00`).getTime();
      const distance = target - Date.now();
      setRemaining(distance > 0 ? {
        days: Math.floor(distance / 86400000),
        hours: Math.floor((distance % 86400000) / 3600000),
        minutes: Math.floor((distance % 3600000) / 60000),
        seconds: Math.floor((distance % 60000) / 1000),
      } : null);
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [invitation]);

  if (error) return <main className="invite-error"><Brand /><h1>الدعوة دي مش موجودة</h1><p>{error}</p><a className="button button-dark" href="#/templates">اكتشفوا دعوات فرحتي</a></main>;
  if (!invitation) return <main className="invite-loading"><span className="loading-flower">✳</span><p>بنفتح لكم الدعوة بكل حب...</p></main>;
  const shareUrl = invitationUrl(invitation.slug);
  const whatsappText = `يسعدنا أن تشاركونا فرحتنا 💛\n${invitation.bride_name} & ${invitation.groom_name}\n${shareUrl}`;

  return (
    <main className="digital-invitation" style={{ "--invite-accent": invitation.primary_color }}>
      <div className="digital-topbar"><Brand /><span>دعوة من القلب <Heart size={14} /></span></div>
      {invitation.template_snapshot?.sections?.length
        ? <TemplateSections snapshot={invitation.template_snapshot} invitation={invitation} remaining={remaining} />
        : <>
      <section className="digital-hero">
        <div className="digital-backdrop" aria-hidden="true">
          <img src={invitation.background_url || invitation.template_image} alt="" />
        </div>
        <span className="digital-bloom bloom-one">✳</span><span className="digital-bloom bloom-two">✳</span>
        <div className="digital-hero-content">
          <span className="eyebrow">بسم الله نبدأ أجمل حكاية</span>
          {(invitation.bride_family || invitation.groom_family) && (
            <p className="digital-family">
              {invitation.bride_family && invitation.groom_family
                ? `عائلتا ${invitation.bride_family} و${invitation.groom_family} تتشرفان بدعوتكم`
                : `عائلة ${invitation.bride_family || invitation.groom_family} تتشرف بدعوتكم`}
            </p>
          )}
          <h1>{invitation.bride_name}<i>&amp;</i>{invitation.groom_name}</h1>
          <span className="digital-rule" />
          <p className="digital-date">{formatDate(invitation.wedding_date)}</p>
          {invitation.photo_url && <div className="digital-photo"><img src={invitation.photo_url} alt={`العروسان ${invitation.bride_name} و${invitation.groom_name}`} /></div>}
          <p className="digital-message">{invitation.message || defaultMessage}</p>
          {remaining ? (
            <div className="countdown" aria-label="الوقت المتبقي حتى موعد الزفاف">
              {[["days", "يوم"], ["hours", "ساعة"], ["minutes", "دقيقة"], ["seconds", "ثانية"]].map(([key, label]) => (
                <div className="countdown-unit" key={key}><strong>{String(remaining[key]).padStart(2, "0")}</strong><span>{label}</span></div>
              ))}
            </div>
          ) : <p className="past-event">فرحتنا أجمل بوجودكم 🤍</p>}
        </div>
      </section>
      <section className="digital-details">
        <span className="eyebrow">مستنينكم بكل حب</span>
        <h2>الفرحة تكمل بوجودكم</h2>
        <div className="digital-info-grid">
          <div className="digital-info"><span className="digital-info-icon"><Clock3 size={19} /></span><span>الموعد</span><strong>{formatDate(invitation.wedding_date)}</strong><small>{invitation.wedding_time}</small></div>
          <div className="digital-info"><span className="digital-info-icon"><MapPin size={19} /></span><span>المكان</span><strong>{invitation.venue}</strong><small>شرفونا في فرحتنا</small></div>
        </div>
        {invitation.maps_url && <a className="button button-outline" href={invitation.maps_url} target="_blank" rel="noreferrer">افتحوا الموقع على الخريطة <ArrowUpRight size={16} /></a>}
      </section>
        </>}
      <div className="digital-actions">
        <button className="button button-whatsapp" type="button" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(whatsappText)}`, "_blank", "noopener,noreferrer")}><MessageCircle size={17} /> شاركوا الدعوة على واتساب</button>
        <button className="icon-button share-icon" type="button" aria-label="نسخ رابط الدعوة" onClick={async () => {
          try { await navigator.clipboard.writeText(shareUrl); notify("نسخنا رابط الدعوة!"); }
          catch { notify("انسخوا الرابط من شريط العنوان."); }
        }}><Share2 size={19} /></button>
      </div>
      <footer className="digital-footer"><Brand /><span>اتعملت بكل حب على فرحتي</span><Heart size={13} /></footer>
    </main>
  );
}

function Admin({ notify }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState("bookings");
  const [bookings, setBookings] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [archiveFile, setArchiveFile] = useState(null);
  const [archiveFiles, setArchiveFiles] = useState([]);
  const [zipPreview, setZipPreview] = useState(null);
  const [importedDraft, setImportedDraft] = useState(null);
  const [archiveMode, setArchiveMode] = useState("template");

  useEffect(() => {
    api("/api/admin/session").then(() => setAuthenticated(true)).catch(() => {}).finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!authenticated) return undefined;
    setLoading(true);
    const endpoint = tab === "bookings" ? "/api/admin/bookings" : "/api/admin/templates";
    api(endpoint)
      .then(tab === "bookings" ? setBookings : setTemplates)
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
    return undefined;
  }, [authenticated, tab]);

  const login = async (event) => {
    event.preventDefault();
    setError("");
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
      setAuthenticated(true);
      setPassword("");
    } catch (cause) {
      setError(cause.message);
    }
  };

  const changeBooking = async (id, patch) => {
    try {
      const result = await api(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setBookings((items) => items.map((item) => item.id === id ? { ...item, ...result } : item));
      setEditing(null);
      notify("تم تحديث الحجز.");
    } catch (cause) {
      setError(cause.message);
    }
  };

  const saveTemplate = async (event) => {
    event.preventDefault();
    const payload = {
      title: editing.title,
      style: editing.style,
      color: editing.color,
      price: Number(editing.price),
      image_url: editing.image_url,
      description: editing.description,
      featured: editing.featured,
    };
    try {
      const result = await api(creating ? "/api/admin/templates" : `/api/admin/templates/${editing.id}`, {
        method: creating ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      });
      setTemplates((items) => creating ? [result, ...items] : items.map((item) => item.id === result.id ? result : item));
      setCreating(false);
      setEditing(null);
      notify(creating ? "أضفنا التصميم الجديد." : "تم حفظ تعديلات التصميم.");
    } catch (cause) {
      setError(cause.message);
    }
  };

  const previewArchive = async (mode = "template") => {
    const files = archiveFiles.length ? archiveFiles : archiveFile ? [archiveFile] : [];
    setZipPreview(null);
    setImportedDraft(null);
    setArchiveMode(mode);
    setError("");
    if (!files.length) return;
    try {
      const route = mode === "legacy" ? "/api/admin/templates/convert-legacy/preview" : "/api/admin/templates/validate";
      const form = new FormData(); files.forEach((file) => form.append("files", file, file.webkitRelativePath || file.name));
      const result = await api(route, {
        method: "POST",
        body: form,
      });
      setZipPreview({ ...result.manifest, warnings: result.warnings || [] });
      notify(mode === "legacy" ? "اكتمل التحويل الساكن. راجع المعاينة وملاحظات التعديل اليدوي." : "نجح الفحص. راجع المعاينة ثم أكد الاستيراد كمسودة.");
    } catch (cause) {
      setError(cause.message);
    }
  };

  const importArchive = async () => {
    const files = archiveFiles.length ? archiveFiles : archiveFile ? [archiveFile] : [];
    if (!files.length || !zipPreview) return;
    setError("");
    try {
      const form = new FormData(); files.forEach((file) => form.append("files", file, file.webkitRelativePath || file.name));
      const template = await api("/api/admin/templates/import", {
        method: "POST",
        body: form,
        headers: { ...(archiveMode === "legacy" ? { "X-Template-Archive-Mode": "legacy-convert" } : {}) },
      });
      setTemplates((items) => [template, ...items]);
      setImportedDraft(template);
      setZipPreview(null);
      notify("تم حفظ القالب كمسودة غير منشورة. فعّله من قائمة القوالب عند الجاهزية.");
    } catch (cause) {
      setError(cause.message);
    }
  };

  const toggleTemplateActive = async (template) => {
    try {
      const updated = await api(`/api/admin/templates/${template.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !Boolean(template.active) }),
      });
      setTemplates((items) => items.map((item) => item.id === template.id ? { ...item, ...updated } : item));
      notify(updated.active ? "تم تفعيل القالب." : "تم إيقاف إتاحة القالب للدعوات الجديدة.");
    } catch (cause) { setError(cause.message); }
  };

  const logout = async () => {
    try { await api("/api/admin/logout", { method: "POST" }); }
    catch (cause) { setError(cause.message); return; }
    setAuthenticated(false);
    notify("تم تسجيل الخروج.");
  };

  if (!checked) return <main className="admin-loading"><span className="loading-flower">✳</span></main>;
  if (!authenticated) {
    return (
      <main className="admin-login-page">
        <form className="admin-login-card" onSubmit={login}>
          <Brand />
          <span className="eyebrow">مساحة خاصة</span>
          <h1>أهلاً بعودتكم</h1>
          <p>سجّلوا الدخول لإدارة الحجوزات والتصميمات.</p>
          <label className="form-field"><span>كلمة مرور الإدارة</span><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="button button-dark" type="submit">تسجيل الدخول <ArrowLeft size={16} /></button>
          <a className="login-back-link" href="#/">العودة للموقع</a>
        </form>
      </main>
    );
  }

  const startNewTemplate = () => {
    setCreating(true);
    setEditing({ title: "", style: "عصري", color: "عاجي", price: 0, image_url: "", description: "", featured: false });
  };

  return (
    <main className="admin-page page-section">
      <div className="admin-heading">
        <div><span className="eyebrow">لوحة التحكم</span><h1>إدارة فرحتي</h1><p>كل تفاصيل الحجوزات والتصميمات في مكان واحد.</p></div>
        <button className="button button-outline" type="button" onClick={logout}>تسجيل الخروج <ArrowLeft size={16} /></button>
      </div>
      <div className="admin-tabs" role="tablist">
        <button className={tab === "bookings" ? "admin-tab-active" : ""} type="button" onClick={() => { setTab("bookings"); setError(""); }}>الحجوزات <span>{bookings.length}</span></button>
        <button className={tab === "templates" ? "admin-tab-active" : ""} type="button" onClick={() => { setTab("templates"); setError(""); }}>التصميمات <span>{templates.length}</span></button>
        {tab === "templates" && <button className="button button-dark button-small" type="button" onClick={startNewTemplate}><Plus size={15} /> تصميم جديد</button>}
      </div>
      {tab === "templates" && <section className="template-import-panel">
        <div><span className="eyebrow">استيراد قالب</span><h2>ارفع ZIP أو HTML وموارده</h2><p>اختر ZIP للمحافظة على المسارات، أو HTML وCSS والصور والخطوط والوسائط المحلية معًا. رفع HTML وحده قد لا يعرض موارده غير المرفقة. اختيار الملفات لا يحفظها ولا يفعّلها.</p><small>الفحص والتحويل ساكنان؛ لا يُشغّل JavaScript ولا تُثبّت تبعيات المشروع.</small></div>
        <label className="template-import-file"><span>{archiveFiles.length ? `${archiveFiles.length} ملفات محددة` : archiveFile?.name || "اختيار ZIP أو عدة ملفات"}</span><input type="file" multiple accept=".zip,.html,.htm,.css,.js,.woff,.woff2,.ttf,.otf,.png,.jpg,.jpeg,.webp,.mp3,.mp4,.webm,application/zip,text/html,text/css,image/png,image/jpeg,image/webp,audio/mpeg,video/mp4,video/webm" onChange={(event) => { const selected = [...(event.target.files || [])]; setArchiveFiles(selected); setArchiveFile(selected.length === 1 ? selected[0] : null); setZipPreview(null); setImportedDraft(null); setArchiveMode("template"); setError(""); }} /></label>
        <label className="template-import-file"><span>اختيار مجلد كامل مع المسارات النسبية</span><input type="file" multiple webkitdirectory="" onChange={(event) => { const selected = [...(event.target.files || [])]; setArchiveFiles(selected); setArchiveFile(null); setZipPreview(null); setImportedDraft(null); setArchiveMode("legacy"); setError(""); }} /></label>
        <div className="template-import-actions"><button className="button button-outline button-small" type="button" disabled={!archiveFiles.length && !archiveFile} onClick={() => previewArchive("template")}>فحص قالب manifest</button><button className="button button-outline button-small" type="button" disabled={!archiveFiles.length && !archiveFile} onClick={() => previewArchive("legacy")}>تحليل HTML قديم ومعاينته</button></div>
        {importedDraft && <div className="import-draft-result" role="status"><strong>حُفظ «{importedDraft.title}» كمسودة غير منشورة.</strong><span>استخدم زر «تفعيل» في صف القالب لنشره للعملاء بعد المراجعة.</span></div>}
        {zipPreview && <div className="template-import-preview">
          <TemplateSections snapshot={{ ...zipPreview, image_url: zipPreview.coverPreview }} invitation={{ bride_name: "مريم", groom_name: "يوسف", bride_family: "عائلة العروس", groom_family: "عائلة العريس", wedding_date: "2030-06-12", wedding_time: "19:30", venue: "قاعة فرحتي", message: defaultMessage, primary_color: "#b89460" }} />
          <div className="template-import-summary"><strong>{zipPreview.title}</strong><span>{zipPreview.sections.length} أقسام · {formatPrice(zipPreview.price)}</span><span>{zipPreview.description}</span>{zipPreview.warnings?.length > 0 && <div className="conversion-warnings"><strong>ملاحظات التحويل والمراجعة اليدوية</strong><ul>{zipPreview.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></div>}<button className="button button-dark button-small" type="button" onClick={importArchive}>تأكيد الاستيراد كمسودة <Check size={15} /></button></div>
        </div>}
      </section>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      {loading ? <div className="empty-state"><span className="loading-flower">✳</span><p>جاري تحميل البيانات...</p></div> : tab === "bookings" ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>رقم الحجز</th><th>العروسان</th><th>تاريخ المناسبة</th><th>صاحب الحجز</th><th>الحالة</th><th>إجراءات</th></tr></thead>
            <tbody>{bookings.map((booking) => (
              <tr key={booking.id}>
                <td><strong>{booking.order_number}</strong><small>{booking.template_title}</small></td>
                <td>{booking.bride_name} &amp; {booking.groom_name}<small>{booking.venue}</small></td>
                <td>{formatDate(booking.wedding_date)}</td>
                <td>{booking.customer_name}<small>{booking.customer_phone}</small></td>
                <td><span className={`status-badge status-${booking.status}`}>{statusLabel(booking.status)}</span></td>
                <td><button className="table-action" type="button" onClick={() => setEditing(booking)}>تعديل <ArrowUpRight size={14} /></button><a className="table-action" href={invitationUrl(booking.slug)} target="_blank" rel="noreferrer">عرض الدعوة <ArrowUpRight size={14} /></a></td>
              </tr>
            ))}</tbody>
          </table>
          {!bookings.length && <div className="empty-state"><Heart size={24} /><h2>لسه مفيش حجوزات</h2><p>لما حد ينشئ دعوته، هتظهر هنا.</p></div>}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>التصميم</th><th>الأسلوب واللون</th><th>السعر</th><th>مميز</th><th>إجراءات</th></tr></thead>
            <tbody>{templates.map((template) => (
              <tr key={template.id}>
                <td><div className="admin-template-name"><img src={template.image_url} alt="" /><span><strong>{template.title}</strong><small>{template.description}</small></span></div></td>
                <td>{template.style}<small>{template.color}</small></td>
                <td>{formatPrice(template.price)}</td>
                <td>{template.featured ? "نعم" : "—"}</td>
                <td><button className="table-action" type="button" onClick={() => { setCreating(false); setEditing(template); }}>تعديل <ArrowUpRight size={14} /></button><button className="table-action" type="button" onClick={() => toggleTemplateActive(template)}>{template.active ? "إيقاف" : "تفعيل"}</button><button className="table-action table-action-danger" type="button" onClick={async () => {
                  if (!window.confirm(`حذف تصميم «${template.title}»؟`)) return;
                  try {
                    await api(`/api/admin/templates/${template.id}`, { method: "DELETE" });
                    setTemplates((items) => items.filter((item) => item.id !== template.id));
                    notify("تم حذف التصميم.");
                  } catch (cause) { setError(cause.message); }
                }}>حذف <X size={14} /></button></td>
              </tr>
            ))}</tbody>
          </table>
          {!templates.length && <div className="empty-state"><ImagePlus size={24} /><h2>مافيش تصميمات لسه</h2></div>}
        </div>
      )}
      {editing && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) { setEditing(null); setCreating(false); }
        }}>
          <form className="admin-edit-modal" onSubmit={tab === "bookings" ? (event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            changeBooking(editing.id, Object.fromEntries(formData.entries()));
          } : saveTemplate}>
            <button className="modal-close" type="button" onClick={() => { setEditing(null); setCreating(false); }} aria-label="إغلاق"><X size={20} /></button>
            <span className="eyebrow">{tab === "bookings" ? editing.order_number : creating ? "تصميم جديد" : "تعديل التصميم"}</span>
            <h2>{tab === "bookings" ? "تعديل تفاصيل الحجز" : "بيانات التصميم"}</h2>
            {tab === "bookings" ? (
              <div className="form-grid">
                <label className="form-field"><span>اسم العروس</span><input name="bride_name" defaultValue={editing.bride_name} required maxLength={80} /></label>
                <label className="form-field"><span>اسم العريس</span><input name="groom_name" defaultValue={editing.groom_name} required maxLength={80} /></label>
                <label className="form-field"><span>التاريخ</span><input name="wedding_date" type="date" defaultValue={editing.wedding_date} required /></label>
                <label className="form-field"><span>الوقت</span><input name="wedding_time" type="time" defaultValue={editing.wedding_time} required /></label>
                <label className="form-field"><span>الحالة</span><select name="status" defaultValue={editing.status}><option value="pending">قيد المراجعة</option><option value="confirmed">مؤكد</option><option value="completed">مكتمل</option></select></label>
                <label className="form-field form-field-wide"><span>المكان</span><input name="venue" defaultValue={editing.venue} required maxLength={180} /></label>
                <label className="form-field form-field-wide"><span>رابط الموقع على الخريطة</span><input name="maps_url" type="url" defaultValue={editing.maps_url} maxLength={2000} /></label>
                <label className="form-field"><span>عائلة العروس</span><input name="bride_family" defaultValue={editing.bride_family} maxLength={120} /></label>
                <label className="form-field"><span>عائلة العريس</span><input name="groom_family" defaultValue={editing.groom_family} maxLength={120} /></label>
                <label className="form-field form-field-wide"><span>الرسالة</span><textarea name="message" defaultValue={editing.message} rows={3} maxLength={500} /></label>
              </div>
            ) : (
              <div className="form-grid">
                <label className="form-field form-field-wide"><span>اسم التصميم</span><input required maxLength={100} value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
                <label className="form-field"><span>الأسلوب</span><input required maxLength={40} value={editing.style} onChange={(event) => setEditing({ ...editing, style: event.target.value })} /></label>
                <label className="form-field"><span>اللون</span><input required maxLength={40} value={editing.color} onChange={(event) => setEditing({ ...editing, color: event.target.value })} /></label>
                <label className="form-field"><span>السعر بالجنيه</span><input required min="0" step="1" type="number" value={editing.price} onChange={(event) => setEditing({ ...editing, price: event.target.value })} /></label>
                <label className="form-field form-field-wide"><span>رابط صورة التصميم</span><input required type="url" value={editing.image_url} onChange={(event) => setEditing({ ...editing, image_url: event.target.value })} /></label>
                <label className="form-field form-field-wide"><span>الوصف</span><input maxLength={300} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>
                <label className="admin-checkbox"><input type="checkbox" checked={Boolean(editing.featured)} onChange={(event) => setEditing({ ...editing, featured: event.target.checked })} /> أظهروا التصميم في الرئيسية</label>
              </div>
            )}
            <div className="admin-modal-actions"><button className="button button-dark" type="submit">حفظ التعديلات <Check size={16} /></button><button className="button button-outline" type="button" onClick={() => { setEditing(null); setCreating(false); }}>إلغاء</button></div>
          </form>
        </div>
      )}
    </main>
  );
}

function statusLabel(status) {
  return ({ pending: "قيد المراجعة", confirmed: "مؤكد", completed: "مكتمل" })[status] || status;
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div><Brand /><p>دعوة تشبه حكايتكم<br />وتبقى في القلب.</p></div>
        <div className="footer-links"><a href="#/templates">التصميمات</a><a href="#/" onClick={(event) => {
          event.preventDefault();
          goToSection("how-it-works");
        }}>كيف تعمل؟</a><a href="#/admin">إدارة الموقع</a></div>
        <div className="footer-note"><Sparkles size={17} /><span>كل حكاية حب<br />تستاهل بداية جميلة.</span><img className="company-logo" src="/images/aldira-company-logo.jpg" alt="الديرة Aldira" /></div>
      </div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} فرحتي. بكل حب.</span><span>صُنع لأجمل حكاية</span></div>
    </footer>
  );
}

function NotFound() {
  return <main className="not-found"><span className="loading-flower">✳</span><h1>الصفحة مش موجودة</h1><a className="button button-dark" href="#/">ارجعوا للرئيسية</a></main>;
}

export default App;
