import { escapeHtml, humanizeAgo } from "../core/utils.js";
import { Scroll } from "../core/scroll.js";

export class TrendingRenderer {
    constructor({ sectionEl, listEl, api, days = 7, limit = 10, intervalMs = 120_000 }) {
        this.sectionEl = sectionEl;
        this.listEl = listEl;
        this.api = api;

        this.days = days;
        this.limit = limit;
        this.intervalMs = intervalMs;

        this.timerId = null;
        this.abortController = null;
        this.started = false;

        // Twig에서 고정 id로 잡는 DOM
        this.wrapEl = null;
        this.scrollerEl = null;

        // Scroll instance (누수 방지: 1회 생성)
        this.scroll = null;

        this._bound = false;
        this._lastSig = "";
        this._lastItemsCount = 0;
    }

    start() {
        if (this.started) return;
        this.started = true;

        this._bindControlsOnce();

        this.refresh();
        this.timerId = setInterval(() => this.refresh(), this.intervalMs);
    }

    stop() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        this._abort();
        this._destroyScroll();
        this.started = false;
    }

    async refresh() {
        if (!this.sectionEl || !this.listEl) return;

        this._abort();
        this.abortController = new AbortController();

        try {
            const data = await this.api.fetchTrending(this.days, this.limit, {
                signal: this.abortController.signal,
            });

            const items = Array.isArray(data?.items) ? data.items : [];
            this._render(items);
        } catch (_) {
            // 기존 정책: 조용히 무시
        }
    }

    _abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    _bindControlsOnce() {
        if (this._bound) return;

        this.wrapEl = document.getElementById("trendingWrap");
        this.scrollerEl = document.getElementById("trendingScroller");

        // scroller 없으면 더 할 게 없음
        if (!this.scrollerEl) return;

        // 모바일에서 세로 스크롤(페이지 스크롤)과 공존하도록: 가로 드래그는 JS, 세로는 브라우저 기본
        // (UI 외형 변화 없음)
        this.scrollerEl.style.touchAction = "pan-y";

        // iOS 사파리에서 드래그 시 텍스트 선택/드래그 이미지 문제 완화
        this.scrollerEl.style.webkitUserSelect = "none";
        this.scrollerEl.style.userSelect = "none";

        // 리사이즈 시 bounds 재계산 반영
        window.addEventListener("resize", () => {
            if (this.scroll) this.scroll.refreshScroll();
        });

        this._bound = true;
    }

    _itemsSignature(items) {
        // 변경 감지용 시그니처(필요 최소 필드)
        // title/cover가 바뀌면 UI가 달라지므로 포함
        return items
            .map((it) => {
                const kind = it?.kind ?? "app";
                const id = it?.id ?? "";
                const title = it?.title ?? "";
                const cover = it?.cover_url ?? it?.header_image ?? "";
                const ts = it?.viewed_at ?? it?.updated_at ?? it?.created_at ?? "";
                return `${kind}:${id}|${title}|${cover}|${ts}`;
            })
            .join("||");
    }

    _ensureScroll() {
        // Scroll은 “viewport(scroller)”에 붙여야 카드 위에서도 드래그가 안정적입니다.
        if (!this.scroll && this.scrollerEl && this.listEl) {
            this.scroll = new Scroll(this.scrollerEl, this.listEl, { mode: "x" });
        }
    }

    _destroyScroll() {
        if (this.scroll) {
            this.scroll.destroy();
            this.scroll = null;
        }
    }

    _render(items) {
        if (!items || items.length === 0) {
            this.sectionEl.classList.add("hidden");
            this.listEl.innerHTML = "";
            this._lastItemsCount = 0;
            this._lastSig = "";
            this._destroyScroll();
            return;
        }

        const sig = this._itemsSignature(items);
        const shouldUpdateDom = sig !== this._lastSig;

        if (shouldUpdateDom) {
            this.listEl.innerHTML = items
                .map((item) => {
                    const kind = item.kind ?? "app";
                    const id = item.id ?? "";
                    const title = item.title ?? `(${kind}:${id})`;
                    const internalUrl = `/${kind}/${id}`;

                    const cover = item.cover_url ?? item.header_image ?? null;
                    const img = cover
                        ? `<img src="${escapeHtml(cover)}" alt="" class="w-full h-24 object-cover" loading="lazy" decoding="async" draggable="false">`
                        : `<div class="w-full h-24 bg-white/5"></div>`;

                    // humanizeAgo는 이미 import 되어있으니, 메타를 추가하되 UI 변화 최소(작은 텍스트 한 줄)
                    // 데이터에 시간 필드가 없으면 표시하지 않음.
                    const rawTime = item.viewed_at ?? item.updated_at ?? item.created_at ?? null;
                    const meta = rawTime
                        ? `<div class="mt-1 text-[11px] text-white/45">${escapeHtml(humanizeAgo(rawTime))}</div>`
                        : "";

                    // ✅ div → a 로 변경: 접근성과 클릭 이동(기능) 강화
                    // ✅ 드래그 후 클릭은 Scroll에서 차단하므로 충돌 최소
                    return `
<a href="${escapeHtml(internalUrl)}"
   data-kind="${escapeHtml(kind)}"
   data-id="${escapeHtml(id)}"
   class="snap-start shrink-0 w-64 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition block"
   draggable="false">
  <div class="relative">
    ${img}
  </div>
  <div class="p-3">
    <div class="text-sm font-semibold text-white/90 line-clamp-2">${escapeHtml(title)}</div>
    ${meta}
  </div>
</a>
        `.trim();
                })
                .join("");

            this._lastSig = sig;
            this._lastItemsCount = items.length;
        }

        this.sectionEl.classList.remove("hidden");

        // Scroll은 최초 1회만 생성, 이후엔 bounds만 갱신
        this._ensureScroll();

        // DOM 업데이트 직후 bounds 재계산
        requestAnimationFrame(() => {
            if (this.scroll) this.scroll.refreshScroll();
        });
    }
}
