import { escapeHtml } from "../core/utils.js";

/**
 * Steam Store Search 결과 모달
 * - UI 톤은 ModalDlc와 동일 계열(rounded-3xl, dark, subtle border)
 * - 항목 클릭 시 callback으로 type/id 전달 (예: app/1234)
 */
export class ModalSearch {
    #backdrop = null;
    #modal = null;
    #onSelect = null;

    close() {
        this.#backdrop?.remove();
        this.#modal?.remove();
        this.#backdrop = null;
        this.#modal = null;
        this.#onSelect = null;
    }

    /**
     * @param {string} term
     * @param {Array<{type:string,name:string,id:number|string,tiny_image?:string}>} items
     * @param {(item:{type:string,id:number|string,name:string})=>void} onSelect
     */
    open(term, items, onSelect) {
        this.close();

        this.#onSelect = typeof onSelect === "function" ? onSelect : null;

        this.#backdrop = document.createElement("div");
        this.#backdrop.className =
            "fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm";
        this.#backdrop.addEventListener("click", () => this.close());

        this.#modal = document.createElement("div");
        this.#modal.className =
            "fixed left-1/2 top-1/2 z-[9999] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 " +
            "rounded-3xl border border-white/10 bg-neutral-950/95 p-5 shadow-2xl";

        const safeTerm = escapeHtml(term || "");
        const arr = Array.isArray(items) ? items : [];

        const listHtml = arr
            .map((it) => {
                const type = String(it?.type || "");
                const id = it?.id ?? "";
                const name = escapeHtml(it?.name || "");
                const tiny = typeof it?.tiny_image === "string" ? it.tiny_image : "";

                const keyText = `${escapeHtml(type)}/${escapeHtml(String(id))}`;

                // 왼쪽 이미지: UI와 일체감(rounded + subtle border) + object-cover
                const imgHtml = tiny
                    ? `
          <div class="h-10 w-[88px] overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
            <img src="${escapeHtml(tiny)}" alt="" class="h-full w-full object-cover opacity-95" loading="lazy" decoding="async" />
          </div>
        `
                    : `
          <div class="h-10 w-[88px] rounded-xl border border-white/10 bg-white/[0.03]"></div>
        `;

                return `
        <button type="button"
          class="w-full text-left rounded-2xl border border-white/10 bg-white/[0.03]
                 transition-colors duration-150
                 hover:bg-white/[0.06] focus-visible:bg-white/[0.06]
                 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/10"
          data-kind="${escapeHtml(type)}" data-id="${escapeHtml(String(id))}" data-name="${name}">
          <div class="flex items-center gap-3 px-3 py-3">
            ${imgHtml}
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-white/85">${name}</p>
              <p class="mt-0.5 text-[11px] text-white/40">${keyText}</p>
            </div>
          </div>
        </button>
      `;
            })
            .join("");

        this.#modal.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-white/85">검색 결과</p>
          <p class="mt-1 text-xs text-white/50">“${safeTerm}” 검색 결과를 클릭하면 바로 조회합니다.</p>
        </div>
        <button type="button"
          class="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 hover:bg-white/[0.06]"
          data-close>닫기</button>
      </div>

      <div class="mt-4 max-h-[60vh] space-y-2 overflow-auto pr-1">
        ${listHtml || `<p class="text-sm text-white/60">검색 결과가 없습니다.</p>`}
      </div>
    `;

        this.#modal
            .querySelector("[data-close]")
            ?.addEventListener("click", () => this.close());

        // 항목 선택
        this.#modal.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-kind][data-id]");
            if (!btn) return;
            const kind = btn.dataset.kind;
            const id = btn.dataset.id;
            const name = btn.dataset.name;
            if (!kind || !id) return;
            this.#onSelect?.({ type: kind, id, name: name || "" });
            this.close();
        });

        document.addEventListener(
            "keydown",
            (e) => {
                if (e.key === "Escape") this.close();
            },
            { once: true }
        );

        document.body.appendChild(this.#backdrop);
        document.body.appendChild(this.#modal);
    }
}
