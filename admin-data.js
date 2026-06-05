/* ============================================================
 * PNE — Học bổng Điều dưỡng Áo · Lớp dữ liệu cho admin-v2 + landing
 * Nối thẳng PostgREST + Auth + Storage của Supabase.
 * Mô hình: bản ghi đầy đủ lưu ở cột JSONB `data`; các cột
 * name/email/phone/status/owner được mirror để truy vấn & landing insert.
 * ============================================================ */
(function () {
  const cfg = window.HocBongAoSupabaseConfig || {};
  const K = { tok: "pne_tok", ref: "pne_ref", email: "pne_email", role: "pne_role", name: "pne_name" };

  const enabled = () => Boolean(cfg.url && cfg.anonKey && cfg.url.startsWith("https://"));
  const token = () => localStorage.getItem(K.tok) || "";
  const session = () => (token() ? { email: localStorage.getItem(K.email) || "", role: localStorage.getItem(K.role) || "", name: localStorage.getItem(K.name) || "" } : null);

  async function rest(path, options = {}) {
    if (!enabled()) throw new Error("Supabase chưa cấu hình.");
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${token() || cfg.anonKey}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error((await res.text()) || `REST ${res.status}`);
    if (res.status === 204) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  // upsert theo khóa chính id (cần quyền update — dùng cho admin đã đăng nhập)
  function upsert(table, rows) {
    const arr = Array.isArray(rows) ? rows : [rows];
    if (!arr.length) return Promise.resolve();
    return rest(table, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(arr),
    });
  }
  // insert thuần (chỉ thêm mới) — dùng cho khách gửi đăng ký từ landing (anon)
  function insertRow(table, row) {
    return rest(table, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  }

  /* ---------- Auth ---------- */
  async function signIn(email, password) {
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error("Email hoặc mật khẩu không đúng.");
    const s = await res.json();
    localStorage.setItem(K.tok, s.access_token);
    localStorage.setItem(K.ref, s.refresh_token || "");
    localStorage.setItem(K.email, email);
    // lấy vai trò từ admin_users
    let role = "", name = "";
    try {
      const me = await rest(`admin_users?select=role,name,status&email=eq.${encodeURIComponent(email)}&limit=1`);
      if (me && me[0] && me[0].status === "Hoạt động") { role = me[0].role || ""; name = me[0].name || ""; }
    } catch (e) {}
    localStorage.setItem(K.role, role);
    localStorage.setItem(K.name, name);
    if (!role) { signOut(); throw new Error("Tài khoản chưa được cấp quyền (chưa có trong admin_users hoặc đang bị khóa)."); }
    return { email, role, name };
  }
  function signOut() { Object.values(K).forEach((k) => localStorage.removeItem(k)); }

  /* ---------- Map bản ghi ⇄ row ---------- */
  function consultToRow(r) {
    return { id: r.id, name: r.name || "", email: r.email || "", phone: r.phone || "",
      program: r.need || "", status: r.status || "Mới", owner: r.owner || "Chưa phân công",
      source: r.source || "Landing page", data: r };
  }
  function rowToConsult(row) {
    const d = row.data || {};
    return { id: row.id, name: row.name || d.name || "", phone: row.phone || d.phone || "",
      email: row.email || d.email || "", need: d.need || row.program || "",
      status: row.status || "Mới", owner: row.owner || "Chưa phân công",
      last: d.last || "", notes: Array.isArray(d.notes) ? d.notes : [],
      submittedAt: row.submitted_at || row.created_at || "" };
  }
  function applyToRow(r) {
    return { id: r.id, name: r.name || "", email: r.email || "", phone: r.phone || "",
      status: r.status || "Chờ kiểm tra hồ sơ", owner: r.owner || "Chưa phân công",
      source: r.source || "Landing page", data: r };
  }
  function rowToApply(row, docDefaults) {
    const d = row.data || {};
    return { id: row.id, name: row.name || d.name || "", phone: row.phone || d.phone || "",
      email: row.email || d.email || "", province: d.province || "", level: d.level || "Chưa có",
      status: row.status || "Chờ kiểm tra hồ sơ", owner: row.owner || "Chưa phân công",
      due: d.due || "", docs: Array.isArray(d.docs) && d.docs.length ? d.docs : (docDefaults || []).map((n) => ({ name: n, uploaded: false, path: "" })),
      notes: Array.isArray(d.notes) ? d.notes : [],
      submittedAt: row.submitted_at || row.created_at || "" };
  }

  /* ---------- Đọc / ghi ---------- */
  const listConsult = async () => (await rest("consultations?select=*&order=created_at.desc") || []).map(rowToConsult);
  const listApply = async (docDefaults) => (await rest("applications?select=*&order=created_at.desc") || []).map((r) => rowToApply(r, docDefaults));
  const saveConsult = (rec) => upsert("consultations", consultToRow(rec));
  const saveApply = (rec) => upsert("applications", applyToRow(rec));
  const submitConsult = (rec) => insertRow("consultations", consultToRow(rec)); // landing (anon)
  const submitApply = (rec) => insertRow("applications", applyToRow(rec));       // landing (anon)
  const delConsult = (id) => rest(`consultations?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  const delApply = (id) => rest(`applications?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });

  const listUsers = async () => (await rest("admin_users?select=*&order=created_at.desc") || []).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status }));
  const saveUser = (u) => upsert("admin_users", { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status });
  // Tạo TÀI KHOẢN ĐĂNG NHẬP (email+mật khẩu) + gán vai trò — qua Edge Function (giữ service_role ở máy chủ)
  async function createAdminUser(payload) {
    const res = await fetch(`${cfg.url}/functions/v1/create-admin-user`, {
      method: "POST",
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token() || cfg.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let j = {};
    try { j = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(j.error || `Lỗi ${res.status}`);
    return j;
  }

  /* ---------- CMS landing_content ---------- */
  async function cmsGet(id) {
    const rows = await rest(`landing_content?id=eq.${id}&select=data&limit=1`);
    return rows && rows[0] ? rows[0].data : null;
  }
  const cmsSaveDraft = (data) => upsert("landing_content", { id: "draft", data, updated_by: (session() || {}).email || "", updated_at: new Date().toISOString() });
  const cmsPublish = (data) => upsert("landing_content", [
    { id: "draft", data, updated_by: (session() || {}).email || "", updated_at: new Date().toISOString() },
    { id: "published", data, updated_by: (session() || {}).email || "", updated_at: new Date().toISOString() },
  ]);

  /* ---------- Storage ---------- */
  // bucket 'ho-so' (private): tài liệu ứng viên ; bucket 'landing' (public): ảnh landing
  async function uploadFile(bucket, path, file) {
    const res = await fetch(`${cfg.url}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
      method: "POST",
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token() || cfg.anonKey}`, "x-upsert": "true", "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!res.ok) throw new Error((await res.text()) || "Tải tệp thất bại.");
    return path;
  }
  const publicUrl = (path) => `${cfg.url}/storage/v1/object/public/landing/${encodeURI(path)}`;
  async function signedUrl(path, expires = 3600) {
    const res = await fetch(`${cfg.url}/storage/v1/object/sign/ho-so/${encodeURI(path)}`, {
      method: "POST",
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token() || cfg.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: expires }),
    });
    if (!res.ok) throw new Error("Không tạo được link xem tài liệu.");
    const j = await res.json();
    return `${cfg.url}/storage/v1${j.signedURL}`;
  }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id" + Date.now() + Math.random().toString(16).slice(2));

  window.PNE = {
    enabled, session, signIn, signOut,
    listConsult, listApply, saveConsult, saveApply, submitConsult, submitApply, delConsult, delApply,
    listUsers, saveUser, createAdminUser,
    cmsGetDraft: () => cmsGet("draft"), cmsGetPublished: () => cmsGet("published"), cmsSaveDraft, cmsPublish,
    uploadHoSo: (path, file) => uploadFile("ho-so", path, file),
    uploadLanding: (path, file) => uploadFile("landing", path, file),
    publicUrl, signedUrl, uid,
  };
})();
