import { escapeHtml } from "../core/utils.js";

export class PortalPopover {
    #backdrop = null;
    #popover = null;
    #anchorBtn = null;
    #handlersBound = false;

    close() {
        this.#popover?.remove();
        this.#backdrop?.remove();
        this.#popover = null;
        this.#backdrop = null;

        if (this.#anchorBtn) {
            this.#anchorBtn.setAttribute("aria-expanded", "false");
            this.#anchorBtn = null;
        }
    }

    #position() {
        if (!this.#popover || !this.#anchorBtn) return;

        const rect = this.#anchorBtn.getBoundingClientRect();
        const margin = 10;

        let left = rect.left;
        let top = rect.bottom + margin;

        const popRect = this.#popover.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        if (left + popRect.width > vw - margin) {
            left = Math.max(margin, vw - margin - popRect.width);
        }
        if (top + popRect.height > vh - margin) {
            const altTop = rect.top - margin - popRect.height;
            if (altTop >= margin) top = altTop;
        }

        this.#popover.style.left = `${Math.round(left)}px`;
        this.#popover.style.top = `${Math.round(top)}px`;
    }

    #createBackdrop() {
        const el = document.createElement("div");
        el.className = "fixed inset-0 z-[9998] bg-black/40 backdrop-blur-[1px]";
        el.addEventListener("click", (e) => {
            e.preventDefault();
            this.close();
        });
        return el;
    }

    #createPopover(items, titleText) {
        const el = document.createElement("div");
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-label", titleText);

        el.className =
            "fixed z-[9999] w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-white/10 " +
            "bg-neutral-950/95 backdrop-blur p-3 shadow-2xl";

        const chips = (Array.isArray(items) ? items : [])
            .map((a) => {
                const name = escapeHtml(a?.name || "");
                const appid = a?.appid;
                const href = a?.href;

                if (href) {
                    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"
            class="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/75
                   hover:bg-white/[0.08] hover:text-white transition">${name}</a>`;
                }

                if (appid) {
                    const link = `https://store.steampowered.com/app/${encodeURIComponent(appid)}/`;
                    return `<a href="${link}" target="_blank" rel="noopener noreferrer"
            class="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/75
                   hover:bg-white/[0.08] hover:text-white transition">${name}</a>`;
                }

                return `<span class="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/75">${name}</span>`;
            })
            .join("");

        el.innerHTML = `
      <div class="flex items-center justify-between px-1">
        <p class="text-xs font-semibold text-white/80">${escapeHtml(titleText)}</p>
        <button type="button" data-portal-close
          class="rounded-lg px-2 py-1 text-xs text-white/50 hover:text-white/80 hover:bg-white/5">
          닫기
        </button>
      </div>

      <div class="mt-2 max-h-72 overflow-auto pr-1">
        <div class="flex flex-wrap gap-2">${chips}</div>
      </div>

      <div class="mt-3 px-1 text-[11px] text-white/45">목록이 길 경우 스크롤됩니다.</div>
    `;

        el.addEventListener("click", (e) => e.stopPropagation());
        el.querySelector("[data-portal-close]")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.close();
        });

        return el;
    }

    open(btn, items, titleText = "목록") {
        if (this.#popover && this.#anchorBtn === btn) {
            this.close();
            return;
        }

        this.close();

        this.#anchorBtn = btn;
        this.#anchorBtn.setAttribute("aria-expanded", "true");

        this.#backdrop = this.#createBackdrop();
        document.body.appendChild(this.#backdrop);

        this.#popover = this.#createPopover(items, titleText);
        document.body.appendChild(this.#popover);

        this.#position();

        if (!this.#handlersBound) {
            this.#handlersBound = true;

            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") this.close();
            });

            window.addEventListener("resize", () => this.#popover && this.#position());
            window.addEventListener("scroll", () => this.#popover && this.#position(), { passive: true });
        }
    }
}
