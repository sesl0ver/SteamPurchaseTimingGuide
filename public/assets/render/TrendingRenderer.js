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

        // ✅ 고정 DOM
        this.wrapEl = null;
        this.scrollerEl = null;
        this.prevBtn = null;
        this.nextBtn = null;

        this._bound = false;
        this._lastItemsCount = 0;
    }

    start() {
        if (this.started) return;
        this.started = true;

        // ✅ 고정 컨트롤은 1번만 연결
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
        } catch (e) {}
    }

    _abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    _bindControlsOnce() {
        if (this._bound) return;

        // ✅ Twig에서 고정 id로 잡음
        this.wrapEl = document.getElementById("trendingWrap");
        this.scrollerEl = document.getElementById("trendingScroller");
        this.prevBtn = document.getElementById("trendPrev");
        this.nextBtn = document.getElementById("trendNext");

        if (!this.wrapEl || !this.scrollerEl || !this.prevBtn || !this.nextBtn) return;

        // 아이콘 삽입 (1회)
        this.prevBtn.innerHTML = this._arrowSvg("left");
        this.nextBtn.innerHTML = this._arrowSvg("right");

        this.prevBtn.addEventListener("click", () => this._scrollPrev());
        this.nextBtn.addEventListener("click", () => this._scrollNext());

        this.scrollerEl.addEventListener("scroll", () => this._syncControlsVisibility(), { passive: true });
        window.addEventListener("resize", () => this._syncControlsVisibility());

        this._bound = true;
    }

    _render(items) {
        if (!items || items.length === 0) {
            this.sectionEl.classList.add("hidden");
            this.listEl.innerHTML = "";
            this._lastItemsCount = 0;
            this._syncControlsVisibility();
            return;
        }

        // ✅ 리스트만 교체 (버튼/스크롤 컨테이너는 건드리지 않음)
        this.listEl.innerHTML = items.map((item) => {
            const title = item.title ?? `(${item.kind}:${item.id})`;
            const internalUrl = `/${item.kind}/${item.id}`;
            const img = item.header_image
                ? `<img src="${item.header_image}" alt="" class="w-full h-24 object-cover" loading="lazy">`
                : `<div class="w-full h-24 bg-white/5"></div>`;

            return `
<a href="${internalUrl}" data-kind="${item.kind}" data-id="${item.id}" rel="noopener"
   class="snap-start shrink-0 w-64 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition">
  <div class="relative">
    ${img}
    <div class="absolute top-2 left-2 text-xs font-semibold bg-black/70 text-white rounded-full px-2 py-1">
      #${item.rank}
    </div>
  </div>
  <div class="p-3">
    <div class="text-sm font-semibold text-white/90 line-clamp-2">${this._escapeHtml(title)}</div>
  </div>
</a>
      `.trim();
        }).join("");

        this.sectionEl.classList.remove("hidden");
        this._lastItemsCount = items.length;

        // ✅ 새 렌더 이후 스크롤/버튼 상태 재계산
        requestAnimationFrame(() => this._syncControlsVisibility());
    }

    _scrollPrev() {
        if (!this.scrollerEl) return;

        if (this.scrollerEl.scrollLeft <= 0) {
            this.scrollerEl.scrollTo({ left: this._maxScrollLeft(), behavior: "smooth" });
            return;
        }
        this.scrollerEl.scrollBy({ left: -this._scrollStep(), behavior: "smooth" });
    }

    _scrollNext() {
        if (!this.scrollerEl) return;

        const max = this._maxScrollLeft();
        if (this.scrollerEl.scrollLeft >= max - 2) {
            this.scrollerEl.scrollTo({ left: 0, behavior: "smooth" });
            return;
        }
        this.scrollerEl.scrollBy({ left: this._scrollStep(), behavior: "smooth" });
    }

    _scrollStep() {
        const firstCard = this.listEl?.firstElementChild;
        return firstCard ? firstCard.offsetWidth + 12 : 320;
    }

    _maxScrollLeft() {
        if (!this.scrollerEl) return 0;
        return Math.max(0, this.scrollerEl.scrollWidth - this.scrollerEl.clientWidth);
    }

    _syncControlsVisibility() {
        if (!this.scrollerEl || !this.prevBtn || !this.nextBtn || this._lastItemsCount <= 0) {
            if (this.prevBtn) this.prevBtn.style.display = "none";
            if (this.nextBtn) this.nextBtn.style.display = "none";
            return;
        }

        const max = this._maxScrollLeft();
        const needsScroll = max > 4;

        if (!needsScroll) {
            this.prevBtn.style.display = "none";
            this.nextBtn.style.display = "none";
            return;
        }

        this.prevBtn.style.display = "";
        this.nextBtn.style.display = "";

        // const left = this.scrollerEl.scrollLeft;
        // this.prevBtn.style.opacity = left <= 2 ? "0.35" : "1";
        // this.nextBtn.style.opacity = left >= max - 2 ? "0.35" : "1";
    }

    _arrowSvg(dir) {
        const rotate = dir === "left" ? "180" : "0";
        return `
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="transform: rotate(${rotate}deg)">
  <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
    `.trim();
    }

    _escapeHtml(str) {
        return String(str)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#039;");
    }
}
