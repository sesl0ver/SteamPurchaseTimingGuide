import { escapeHtml, formatPrice } from "../core/utils.js";

export class ModalDlc {
    #backdrop = null;
    #modal = null;

    close() {
        this.#backdrop?.remove();
        this.#modal?.remove();
        this.#backdrop = null;
        this.#modal = null;
    }

    open(title, items, currency = "KRW") {
        this.close();

        this.#backdrop = document.createElement("div");
        this.#backdrop.className = "fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm";
        this.#backdrop.addEventListener("click", () => this.close());

        this.#modal = document.createElement("div");
        this.#modal.className =
            "fixed left-1/2 top-1/2 z-[9999] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 " +
            "rounded-3xl border border-white/10 bg-neutral-950/95 p-5 shadow-2xl";

        const arr = Array.isArray(items) ? items : [];
        const listHtml = arr
            .map((d) => {
                const name = escapeHtml(d?.name || "");
                const appid = d?.appid ?? d?.id ?? null;

                const amount = d?.price?.amount ?? d?.amount ?? null;
                const cur = d?.price?.currency || d?.currency || currency;

                const priceText = amount == null ? "가격 정보 없음" : Number(amount) === 0 ? "무료" : formatPrice(amount, cur);
                const href = appid ? `https://store.steampowered.com/app/${encodeURIComponent(appid)}/` : null;

                return `
          <div class="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div class="min-w-0">
              ${
                    href
                        ? `<a href="${href}" target="_blank" rel="noopener noreferrer"
                       class="block truncate text-sm font-medium text-white/85 hover:text-white">${name}</a>`
                        : `<p class="truncate text-sm font-medium text-white/85">${name}</p>`
                }
              ${appid ? `<p class="mt-0.5 text-[11px] text-white/40">AppID ${escapeHtml(appid)}</p>` : ""}
            </div>
            <div class="shrink-0 text-xs text-white/70">${escapeHtml(priceText)}</div>
          </div>
        `;
            })
            .join("");

        this.#modal.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-semibold text-white/85">${escapeHtml(title || "DLC 목록")}</p>
          <p class="mt-1 text-xs text-white/50">DLC를 클릭하면 Steam 상점 페이지를 새 창으로 엽니다.</p>
        </div>
        <button type="button"
          class="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 hover:bg-white/[0.06]"
          data-close>닫기</button>
      </div>

      <div class="mt-4 max-h-[60vh] space-y-2 overflow-auto pr-1">
        ${listHtml || `<p class="text-sm text-white/60">표시할 DLC가 없습니다.</p>`}
      </div>
    `;

        this.#modal.querySelector("[data-close]")?.addEventListener("click", () => this.close());

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
