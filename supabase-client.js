(function () {
  const config = window.HocBongAoSupabaseConfig || {};

  function isEnabled() {
    return Boolean(config.url && config.anonKey && config.url.startsWith("https://"));
  }

  function getAccessToken() {
    return localStorage.getItem("hoc-bong-ao-supabase-access-token") || "";
  }

  function isSignedIn() {
    return Boolean(getAccessToken());
  }

  function getAuthEmail() {
    return localStorage.getItem("hoc-bong-ao-supabase-email") || "";
  }

  async function request(path, options = {}) {
    if (!isEnabled()) throw new Error("Supabase chưa được cấu hình.");
    const token = getAccessToken() || config.anonKey;
    const response = await fetch(`${config.url}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Supabase error ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function signIn(email, password) {
    if (!isEnabled()) throw new Error("Supabase chưa được cấu hình.");
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Không đăng nhập được Supabase.");
    }
    const session = await response.json();
    localStorage.setItem("hoc-bong-ao-supabase-access-token", session.access_token);
    localStorage.setItem("hoc-bong-ao-supabase-refresh-token", session.refresh_token || "");
    localStorage.setItem("hoc-bong-ao-supabase-email", email);
    return session;
  }

  function signOut() {
    localStorage.removeItem("hoc-bong-ao-supabase-access-token");
    localStorage.removeItem("hoc-bong-ao-supabase-refresh-token");
    localStorage.removeItem("hoc-bong-ao-supabase-email");
  }

  function fromLeadRow(row, leadType) {
    return {
      id: row.id,
      leadType,
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      program: row.program || "",
      status: row.status || "Mới",
      owner: row.owner || "Chưa phân công",
      dueDate: row.due_date || "",
      note: row.note || "",
      source: row.source || "Landing page",
      submittedAt: row.submitted_at || row.created_at,
      documents: row.documents || [],
    };
  }

  function toLeadRow(profile) {
    return {
      id: profile.id,
      name: profile.name || "",
      email: profile.email || "",
      phone: profile.phone || "",
      program: profile.program || "",
      status: profile.status || "Mới",
      owner: profile.owner || "Chưa phân công",
      due_date: profile.dueDate || null,
      note: profile.note || "",
      source: profile.source || "Admin",
      submitted_at: profile.submittedAt || new Date().toISOString(),
      documents: profile.documents || [],
    };
  }

  function fromUser(row) {
    return {
      id: row.id,
      name: row.name || "",
      email: row.email || "",
      role: row.role || "viewer",
      status: row.status || "Hoạt động",
      note: row.note || "",
    };
  }

  function toUser(row) {
    return {
      id: row.id,
      name: row.name || "",
      email: row.email || "",
      role: row.role || "viewer",
      status: row.status || "Hoạt động",
      note: row.note || "",
    };
  }

  function fromContent(row) {
    return {
      id: row.id,
      slot: row.slot || "",
      title: row.title || "",
      body: row.body || "",
      status: row.status || "Bản nháp",
    };
  }

  function toContent(row) {
    return {
      id: row.id,
      slot: row.slot || "",
      title: row.title || "",
      body: row.body || "",
      status: row.status || "Bản nháp",
    };
  }

  function fromSettings(row, fallbackSettings, fallbackRoles) {
    if (!row) return { settings: fallbackSettings, roles: fallbackRoles };
    return {
      settings: {
        programName: row.program_name || fallbackSettings.programName,
        hotline: row.hotline || fallbackSettings.hotline,
        email: row.email || fallbackSettings.email,
        address: row.address || fallbackSettings.address,
        deadline: row.deadline || fallbackSettings.deadline,
        quota: row.quota || fallbackSettings.quota,
        internalNote: row.internal_note || fallbackSettings.internalNote,
      },
      roles: row.roles || fallbackRoles,
    };
  }

  function toSettings(settings, roles) {
    return {
      id: "main",
      program_name: settings.programName || "",
      hotline: settings.hotline || "",
      email: settings.email || "",
      address: settings.address || "",
      deadline: settings.deadline || null,
      quota: Number(settings.quota || 0),
      internal_note: settings.internalNote || "",
      roles,
    };
  }

  async function replaceTable(table, rows) {
    await request(`${table}?id=not.is.null`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    if (!rows.length) return;
    await request(table, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
  }

  // Cập nhật theo từng bản ghi (KHÔNG xoá cả bảng) — tránh mất hồ sơ mới
  // do ứng viên gửi sau khi admin đã mở trang. Dựa trên khoá chính id.
  async function upsertTable(table, rows) {
    if (!rows.length) return;
    await request(table, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  }

  async function loadState(defaultState) {
    if (!isEnabled()) return null;
    const [consultations, applications, users, contentBlocks, reviewItems, settingsRows, activityRows] = await Promise.all([
      request("consultations?select=*&order=created_at.desc"),
      request("applications?select=*&order=created_at.desc"),
      request("admin_users?select=*&order=created_at.desc"),
      request("content_blocks?select=*&order=created_at.desc"),
      request("review_items?select=*&order=id.asc"),
      request("app_settings?select=*&id=eq.main&limit=1"),
      request("activity_logs?select=*&order=created_at.desc&limit=8"),
    ]);
    const settingsData = fromSettings(settingsRows[0], defaultState.settings, defaultState.roles);
    return {
      isEmpty: !consultations.length && !applications.length && !users.length && !contentBlocks.length && !reviewItems.length && !settingsRows.length,
      profiles: [
        ...consultations.map((row) => fromLeadRow(row, "consultation")),
        ...applications.map((row) => fromLeadRow(row, "application")),
      ],
      users: users.map(fromUser),
      contentBlocks: contentBlocks.map(fromContent),
      reviewItems: reviewItems.length ? reviewItems.map((item) => ({ id: item.id, label: item.label, done: item.done })) : defaultState.reviewItems,
      settings: settingsData.settings,
      roles: settingsData.roles,
      activity: activityRows.map((item) => item.message),
    };
  }

  async function saveState(state) {
    if (!isEnabled()) return;
    await Promise.all([
      // upsert (không xoá cả bảng) cho dữ liệu quan trọng → không mất hồ sơ
      upsertTable("consultations", state.profiles.filter((item) => item.leadType === "consultation").map(toLeadRow)),
      upsertTable("applications", state.profiles.filter((item) => item.leadType === "application").map(toLeadRow)),
      upsertTable("admin_users", state.users.map(toUser)),
      upsertTable("content_blocks", state.contentBlocks.map(toContent)),
      upsertTable("review_items", state.reviewItems.map((item) => ({ id: item.id, label: item.label, done: item.done }))),
      // activity_logs là nhật ký hiển thị (giữ 8 mục) — thay thế bản hiển thị là chấp nhận được
      replaceTable("activity_logs", state.activity.map((message) => ({ id: crypto.randomUUID(), message }))),
      request("app_settings?id=eq.main", { method: "DELETE", headers: { Prefer: "return=minimal" } }).then(() =>
        request("app_settings", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(toSettings(state.settings, state.roles)),
        })
      ),
    ]);
  }

  async function submitLead(profile) {
    if (!isEnabled()) return;
    const table = profile.leadType === "application" ? "applications" : "consultations";
    await request(table, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(toLeadRow(profile)),
    });
  }

  window.HocBongAoBackend = {
    isEnabled,
    isSignedIn,
    getAuthEmail,
    signIn,
    signOut,
    loadState,
    saveState,
    submitLead,
  };
})();
