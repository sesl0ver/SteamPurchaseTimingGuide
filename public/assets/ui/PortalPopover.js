import { escapeHtml } from "../core/utils.js";

export class PortalPopover {
    #backdrop = null;
    #modal = null;
    #anchorBtn = null;
    #handlersBound = false;

    close() {
        this.#modal?.remove();
        this.#backdrop?.remove();
        this.#modal = null;
        this.#backdrop = null;

        if (this.#anchorBtn) {
            this.#anchorBtn.setAttribute("aria-expanded", "false");
            this.#anchorBtn = null;
        }
    }

    #createBackdrop() {
        const el = document.createElement("div");
        el.className = "fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm";
        el.addEventListener("click", (e) => {
            e.preventDefault();
            this.close();
        });
        return el;
    }

    #createModal(items, titleText) {
        const el = document.createElement("div");
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-label", titleText);

        // ✅ DLC/한글패치 모달과 동일한 컨테이너 톤
        el.className =
            "fixed left-1/2 top-1/2 z-[9999] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 " +
            "rounded-3xl border border-white/10 bg-neutral-950/95 p-5 shadow-2xl";

        const arr = Array.isArray(items) ? items : [];

        // ✅ 카드 전체 클릭 + 모달 내부에서만 hover/focus 배경 강조
        const listHtml = arr
            .map((x) => {
                const name = escapeHtml(x?.name || "");
                const href = x?.href ? String(x.href) : "";

                if (!href) {
                    return `
            <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <p class="text-sm font-semibold text-white/85">${name}</p>
            </div>
          `;
                }

                return `
          <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"
             class="block rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3
                    transition-colors duration-150
                    hover:bg-white/[0.06] focus-visible:bg-white/[0.06]
                    focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/10">
            <p class="text-sm font-semibold text-white/85">${name}</p>
            <p class="mt-1 text-[11px] text-white/45 break-all">${escapeHtml(href)}</p>
          </a>
        `;
            })
            .join("");

        el.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-semibold text-white/85">${escapeHtml(titleText)}</p>
          <p class="mt-1 text-xs text-white/50">항목을 클릭하면 새 창에서 열립니다.</p>
        </div>
        <button type="button" data-portal-close
          class="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/10">
          닫기
        </button>
      </div>

      <div class="mt-4 max-h-[60vh] space-y-2 overflow-auto pr-1">
        ${listHtml || `<p class="text-sm text-white/60">표시할 항목이 없습니다.</p>`}
      </div>
    `;

        el.addEventListener("click", (e) => e.stopPropagation());
        el.querySelector("[data-portal-close]")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.close();
        });

        return el;
    }

    /**
     * 기존 호출 시그니처 유지:
     * - open(btn, items, titleText)
     * 변경 후에는 btn은 aria-expanded 동기화에만 사용(포지셔닝은 하지 않음)
     */
    open(btn, items, titleText = "목록") {
        // 같은 버튼에서 다시 열면 토글
        if (this.#modal && this.#anchorBtn === btn) {
            this.close();
            return;
        }

        this.close();

        this.#anchorBtn = btn || null;
        if (this.#anchorBtn) this.#anchorBtn.setAttribute("aria-expanded", "true");

        this.#backdrop = this.#createBackdrop();
        document.body.appendChild(this.#backdrop);

        this.#modal = this.#createModal(items, titleText);
        document.body.appendChild(this.#modal);

        if (!this.#handlersBound) {
            this.#handlersBound = true;
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") this.close();
            });
        }
    }
}