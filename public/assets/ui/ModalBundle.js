import { escapeHtml } from "../core/utils.js";

export class ModalBundle {
    #backdrop = null;
    #modal = null;

    close() {
        this.#backdrop?.remove();
        this.#modal?.remove();
        this.#backdrop = null;
        this.#modal = null;
    }

    open(title, bundles) {
        this.close();

        this.#backdrop = document.createElement("div");
        this.#backdrop.className = "fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm";
        this.#backdrop.addEventListener("click", () => this.close());

        this.#modal = document.createElement("div");
        this.#modal.className =
            "fixed left-1/2 top-1/2 z-[9999] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 " +
            "rounded-3xl border border-white/10 bg-neutral-950/95 p-5 shadow-2xl";

        const bundlesArr = Array.isArray(bundles) ? bundles : [];

        let html = "";
        if (bundlesArr.length === 0) {
            html = `<p class="text-sm text-white/60 text-center py-10">포함된 번들 정보가 없습니다.</p>`;
        } else {
            html = bundlesArr.map(bundle => {
                const bundleTitle = escapeHtml(bundle.title || "이름 없는 번들");
                const bundleUrl = bundle.url || "#";
                const shopName = escapeHtml(bundle.page?.name || "");

                const games = [];
                if (Array.isArray(bundle.tiers)) {
                    bundle.tiers.forEach(tier => {
                        if (Array.isArray(tier.games)) {
                            tier.games.forEach(g => games.push(g));
                        }
                    });
                }

                const gamesHtml = games.map(g => {
                    const gTitle = escapeHtml(g.title || "알 수 없는 게임");
                    const banner = g.banner145 || "";
                    
                    return `
                        <a href="${bundleUrl}" target="_blank" rel="noopener noreferrer"
                           class="block rounded-2xl border border-white/10 bg-white/[0.03]
                                  transition-colors duration-150
                                  hover:bg-white/[0.06] focus-visible:bg-white/[0.06]
                                  focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/10">
                            <div class="flex items-center gap-3 px-3 py-3">
                                <div class="h-10 w-[88px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                                    ${banner ? `<img src="${banner}" class="h-full w-full object-cover opacity-95" alt="${gTitle}" loading="lazy" />` : ""}
                                </div>
                                <div class="min-w-0 flex-1">
                                    <p class="truncate text-sm font-medium text-white/85">${gTitle}</p>
                                    <p class="mt-0.5 text-[9px] text-white/30 uppercase font-semibold tracking-wider">Bundle Page ↗</p>
                                </div>
                            </div>
                        </a>
                    `;
                }).join("");

                return `
                    <div class="space-y-3">
                        <div class="flex items-end justify-between px-1">
                            <h3 class="text-sm font-bold text-white/90">${bundleTitle}</h3>
                            ${shopName ? `<span class="text-[11px] text-white/40">${shopName}</span>` : ""}
                        </div>
                        <div class="space-y-2">
                            ${gamesHtml}
                        </div>
                    </div>
                `;
            }).join(`<div class="my-6 border-t border-white/5"></div>`);
        }

        this.#modal.innerHTML = `
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-sm font-semibold text-white/85">${escapeHtml(title || "번들 목록")}</p>
                    <p class="mt-1 text-xs text-white/50">게임을 클릭하면 해당 번들 판매 페이지를 새 창으로 엽니다.</p>
                </div>
                <button type="button"
                    class="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 hover:bg-white/[0.06]"
                    data-close>닫기</button>
            </div>

            <div class="mt-4 max-h-[60vh] space-y-6 overflow-auto pr-1 scrollbar-hidden">
                ${html}
            </div>
        `;

        this.#modal.querySelector("[data-close]")?.addEventListener("click", () => this.close());

        const handleEscape = (e) => {
            if (e.key === "Escape") {
                this.close();
                document.removeEventListener("keydown", handleEscape);
            }
        };
        document.addEventListener("keydown", handleEscape);

        document.body.appendChild(this.#backdrop);
        document.body.appendChild(this.#modal);
    }
}
