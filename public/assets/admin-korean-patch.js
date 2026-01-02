/* Admin - Korean Patch Manager
 * - Uses existing Admin token (query token) and sends it via X-Admin-Token header.
 * - Minimal dependencies (vanilla JS)
 */

(function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    search: $('kpSearch'),
    searchBtn: $('kpSearchBtn'),
    newBtn: $('kpNewBtn'),
    tbody: $('kpTbody'),
    prev: $('kpPrev'),
    next: $('kpNext'),
    pageNav: $('kpPageNav'),
    pagerInfo: $('kpPagerInfo'),
    modal: $('kpModal'),
    modalTitle: $('kpModalTitle'),
    modalClose: $('kpModalClose'),
    modalSave: $('kpModalSave'),
    modalDelete: $('kpModalDelete'),
    modalHint: $('kpModalHint'),
    appIds: $('kpAppIds'),
    patchText: $('kpPatchText'),
  };

  const state = {
    page: 1,
    perPage: 20,
    totalPages: 1,
    q: '',
    editingAppId: null,
  };

  function oneLine(text, maxLen = 140) {
    const s = String(text || '')
      .replace(/\r\n|\n|\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1) + '…';
  }

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
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function oneLine(text) {
    const t = (text == null) ? '' : String(text);
    return t
      .replace(/\r\n|\n|\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function truncate(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, Math.max(0, max - 1)) + '…';
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
          class="kp-page min-w-9 rounded-lg border border-white/10 px-3 py-1.5 text-sm ${active ? 'bg-white/10' : 'bg-white/[0.04] hover:bg-white/[0.08]'}"
        >${p}</button>
      `;
    }).join('');
  }

  function showToast(msg) {
    // super-light toast
    const div = document.createElement('div');
    div.className = 'fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] rounded-xl border border-white/10 bg-neutral-950/80 backdrop-blur px-4 py-2 text-sm';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 2200);
  }

  function openModal(mode, row) {
    state.editingAppId = (mode === 'edit') ? row.app_id : null;
    els.modal.classList.remove('hidden');
    els.modalTitle.textContent = (mode === 'edit') ? ('수정 #' + row.app_id) : '신규 등록';
    els.modalHint.textContent = (mode === 'edit')
      ? 'AppID는 수정 모드에서 그대로 유지하는 것을 권장합니다. (원하면 변경 가능)'
      : '여러 AppID를 입력하면 동일한 patch_text로 일괄 등록/수정됩니다.';

    if (mode === 'edit') {
      els.appIds.value = String(row.app_id);
      els.patchText.value = row.patch_text || '';
      els.modalDelete.classList.remove('hidden');
      els.modalDelete.dataset.appId = String(row.app_id);
    } else {
      els.appIds.value = '';
      els.patchText.value = '';
      els.modalDelete.classList.add('hidden');
      delete els.modalDelete.dataset.appId;
    }
  }

  function closeModal() {
    els.modal.classList.add('hidden');
    state.editingAppId = null;
  }

  async function loadList() {
    els.tbody.innerHTML = '<tr><td class="py-4 px-4 text-white/60" colspan="6">로딩 중…</td></tr>';
    const qs = new URLSearchParams();
    qs.set('page', String(state.page));
    qs.set('per_page', String(state.perPage));
    if (state.q) qs.set('q', state.q);

    const json = await apiFetch('/admin/api/korean-patch?' + qs.toString(), { method: 'GET' });
    const data = json.data;

    state.totalPages = data.total_pages || 1;
    els.pagerInfo.textContent = `총 ${data.total}개 · 페이지 ${data.page}/${data.total_pages}`;
    els.prev.disabled = (data.page <= 1);
    els.next.disabled = (data.page >= data.total_pages);
    els.prev.classList.toggle('opacity-40', els.prev.disabled);
    els.next.classList.toggle('opacity-40', els.next.disabled);

    renderPageNav(data.page || 1, data.total_pages || 1);

    if (!data.items || data.items.length === 0) {
      els.tbody.innerHTML = '<tr><td class="py-4 px-4 text-white/60" colspan="6">데이터가 없습니다.</td></tr>';
      return;
    }

    els.tbody.innerHTML = data.items.map((it) => {
      const dt = it.updated_at ? esc(it.updated_at) : '-';
      const appId = esc(it.app_id);
      const name = esc(it.name);
      const previewRaw = truncate(oneLine(it.patch_text || ''), 140);
      const preview = esc(previewRaw);
      return `
        <tr>
          <td class="py-3 px-4 font-mono text-xs">${appId}</td>
          <td class="py-3 px-4 text-xs text-white/60">${name}</td>
          <td class="py-3 px-4 text-xs text-white/70 max-w-[520px] truncate" title="${preview}">${preview.slice(0, 60) || '-'}</td>
          <td class="py-3 px-4">${esc(it.link_count)}</td>
          <td class="py-3 px-4 text-xs text-white/60">${dt}</td>
          <td class="py-3 px-4 text-right">
            <button data-appid="${appId}" class="kp-edit rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm hover:bg-white/[0.08]">수정</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function openEdit(appId) {
    const json = await apiFetch('/admin/api/korean-patch/' + encodeURIComponent(appId), { method: 'GET' });
    openModal('edit', json.data);
  }

  async function save() {
    const appIds = els.appIds.value;
    const patchText = els.patchText.value;

    const json = await apiFetch('/admin/api/korean-patch', {
      method: 'POST',
      body: JSON.stringify({ app_ids: appIds, patch_text: patchText }),
    });

    showToast(`저장 완료 (${json.data.updated}건)`);
    closeModal();
    await loadList();
  }

  async function del(appId) {
    if (!confirm('정말 삭제하시겠습니까? AppID: ' + appId)) return;
    const json = await apiFetch('/admin/api/korean-patch/' + encodeURIComponent(appId), { method: 'DELETE' });
    showToast(`삭제 완료 (${json.data.deleted}건)`);
    closeModal();
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
  els.newBtn.addEventListener('click', () => openModal('new'));
  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });
  els.modalSave.addEventListener('click', async () => {
    try { await save(); } catch (e) { alert(e.message); }
  });
  els.modalDelete.addEventListener('click', async () => {
    const id = els.modalDelete.dataset.appId;
    if (!id) return;
    try { await del(id); } catch (e) { alert(e.message); }
  });
  els.prev.addEventListener('click', async () => {
    if (state.page > 1) { state.page -= 1; await loadList(); }
  });
  els.next.addEventListener('click', async () => {
    if (state.page < state.totalPages) { state.page += 1; await loadList(); }
  });
  els.pageNav.addEventListener('click', async (e) => {
    const btn = e.target.closest('.kp-page');
    if (!btn) return;
    const p = parseInt(btn.getAttribute('data-page') || '0', 10);
    if (!p || p === state.page) return;
    state.page = p;
    await loadList();
  });

  els.tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.kp-edit');
    if (!btn) return;
    const appId = btn.getAttribute('data-appid');
    try { await openEdit(appId); } catch (err) { alert(err.message); }
  });

  // Initial load
  loadList().catch((e) => {
    els.tbody.innerHTML = '<tr><td class="py-4 px-4 text-rose-300" colspan="6">로드 실패: ' + esc(e.message) + '</td></tr>';
  });
})();
