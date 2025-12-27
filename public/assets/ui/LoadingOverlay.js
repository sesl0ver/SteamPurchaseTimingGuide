export class LoadingOverlay {
    #backdrop = null;
    #modal = null;

    show() {
        if (this.#modal) return;

        this.#backdrop = document.createElement("div");
        this.#backdrop.className = "fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm";

        this.#modal = document.createElement("div");
        this.#modal.className =
            "fixed left-1/2 top-1/2 z-[9999] -translate-x-1/2 -translate-y-1/2 " +
            "rounded-2xl border border-white/10 bg-neutral-950/90 px-8 py-6 shadow-2xl";

        const text = "게임 정보를 불러오고 있어요…";
        this.#modal.innerHTML = `
      <div class="flex items-center gap-1 text-lg font-semibold text-white">
        ${text
            .split("")
            .map((ch, i) => `<span class="loading-wave" style="animation-delay:${i * 0.05}s">${ch === " " ? "&nbsp;" : ch}</span>`)
            .join("")}
      </div>
    `;

        document.body.appendChild(this.#backdrop);
        document.body.appendChild(this.#modal);
    }

    hide() {
        this.#backdrop?.remove();
        this.#modal?.remove();
        this.#backdrop = null;
        this.#modal = null;
    }
}
