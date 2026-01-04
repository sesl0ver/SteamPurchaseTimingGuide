/* Admin - User Manager
 * - Uses existing Admin token (query token) and sends it via X-Admin-Token header.
 * - Minimal dependencies (vanilla JS)
 */

(function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    search: $('userSearch'),
    searchBtn: $('userSearchBtn'),
    tbody: $('userTbody'),
    prev: $('userPrev'),
    next: $('userNext'),
    pageNav: $('userPageNav'),
    pagerInfo: $('userPagerInfo'),
  };

  const state = {
    page: 1,
    perPage: 20,
    totalPages: 1,
    q: '',
  };

  function tokenHeader() {
    const t = (window.__ADMIN_TOKEN || '').trim();
    return t ? { 'X-Admin-Token': t } : {};
  }

  async function apiFetch(path, options) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...tokenHeader(),
        ...(options && options.headers ? options.headers : {}),
      },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    if (!res.ok) {
      const msg = (json && (json.message || json.error)) ? (json.message || json.error) : (text || ('HTTP ' + res.status));
      throw new Error(msg);
    }
    return json;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderPageNav(current, total) {
    const c = Math.max(1, Number(current || 1));
    const t = Math.max(1, Number(total || 1));

    const pages = [];
    const push = (p) => pages.push(p);

    if (t <= 9) {
      for (let i = 1; i <= t; i++) push(i);
    } else {
      push(1);
      const start = Math.max(2, c - 2);
      const end = Math.min(t - 1, c + 2);
      if (start > 2) pages.push('…');
      for (let i = start; i <= end; i++) push(i);
      if (end < t - 1) pages.push('…');
      push(t);
    }

    els.pageNav.innerHTML = pages.map((p) => {
      if (p === '…') {
        return '<span class="px-2 text-white/40">…</span>';
      }
      const active = (p === c);
      return `
        <button
          type="button"
          data-page="${p}"
          class="user-page min-w-9 rounded-lg border border-white/10 px-3 py-1.5 text-sm ${active ? 'bg-white/10' : 'bg-white/[0.04] hover:bg-white/[0.08]'}"
        >${p}</button>
      `;
    }).join('');
  }

  function showToast(msg) {
    const div = document.createElement('div');
    div.className = 'fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] rounded-xl border border-white/10 bg-neutral-950/80 backdrop-blur px-4 py-2 text-sm';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 2200);
  }

  async function loadList() {
    els.tbody.innerHTML = '<tr><td class="py-4 px-4 text-white/60" colspan="7">로딩 중…</td></tr>';
    const qs = new URLSearchParams();
    qs.set('page', String(state.page));
    qs.set('per_page', String(state.perPage));
    if (state.q) qs.set('q', state.q);

    const json = await apiFetch('/admin/api/user?' + qs.toString(), { method: 'GET' });
    const data = json.data;

    state.totalPages = data.total_pages || 1;
    els.pagerInfo.textContent = `총 ${data.total}명 · 페이지 ${data.page}/${data.total_pages}`;
    els.prev.disabled = (data.page <= 1);
    els.next.disabled = (data.page >= data.total_pages);
    els.prev.classList.toggle('opacity-40', els.prev.disabled);
    els.next.classList.toggle('opacity-40', els.next.disabled);

    renderPageNav(data.page || 1, data.total_pages || 1);

    if (!data.items || data.items.length === 0) {
      els.tbody.innerHTML = '<tr><td class="py-4 px-4 text-white/60" colspan="7">데이터가 없습니다.</td></tr>';
      return;
    }

    els.tbody.innerHTML = data.items.map((it) => {
      const createdAt = it.created_at ? esc(it.created_at.split(' ')[0]) : '-';
      const lastLoginAt = it.last_login_at ? esc(it.last_login_at.split(' ')[0]) : '-';
      const steamId = esc(it.steam_id);
      const name = esc(it.persona_name);
      const id = esc(it.id);
      const avatar = it.avatar_medium ? esc(it.avatar_medium) : '';
      const profileUrl = it.profile_url ? esc(it.profile_url) : '#';

      return `
        <tr>
          <td class="py-3 px-4 font-mono text-xs text-white/40">${id}</td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-2">
              ${avatar ? `<img src="${avatar}" class="size-6 rounded-full bg-white/10" alt="">` : `<div class="size-6 rounded-full bg-white/10"></div>`}
              <span class="text-xs font-medium">${name}</span>
            </div>
          </td>
          <td class="py-3 px-4 font-mono text-xs text-white/60">
            <a href="${profileUrl}" target="_blank" class="hover:underline">${steamId}</a>
          </td>
          <td class="py-3 px-4 text-xs text-white/50">${createdAt}</td>
          <td class="py-3 px-4 text-xs text-white/50">${lastLoginAt}</td>
          <td class="py-3 px-4 text-right">
            <button data-id="${id}" data-name="${name}" class="user-delete rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20">삭제</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function del(id, name) {
    if (!confirm(`정말 이 사용자를 삭제하시겠습니까?\nID: ${id}\n이름: ${name}\n\n※ 삭제 시 찜 목록 등 모든 연관 데이터가 영구 삭제됩니다.`)) return;
    const json = await apiFetch('/admin/api/user/' + encodeURIComponent(id), { method: 'DELETE' });
    showToast(`삭제 완료 (${json.data.deleted}건)`);
    await loadList();
  }

  // Events
  els.searchBtn.addEventListener('click', async () => {
    state.q = (els.search.value || '').trim();
    state.page = 1;
    await loadList();
  });
  els.search.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      els.searchBtn.click();
    }
  });
  els.prev.addEventListener('click', async () => {
    if (state.page > 1) { state.page -= 1; await loadList(); }
  });
  els.next.addEventListener('click', async () => {
    if (state.page < state.totalPages) { state.page += 1; await loadList(); }
  });
  els.pageNav.addEventListener('click', async (e) => {
    const btn = e.target.closest('.user-page');
    if (!btn) return;
    const p = parseInt(btn.getAttribute('data-page') || '0', 10);
    if (!p || p === state.page) return;
    state.page = p;
    await loadList();
  });

  els.tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.user-delete');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const name = btn.getAttribute('data-name');
    try { await del(id, name); } catch (err) { alert(err.message); }
  });

  // Initial load
  loadList().catch((e) => {
    els.tbody.innerHTML = '<tr><td class="py-4 px-4 text-rose-300" colspan="7">로드 실패: ' + esc(e.message) + '</td></tr>';
  });
})();
