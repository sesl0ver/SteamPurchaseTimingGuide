import { escapeHtml, escapeHtmlWithBreaks } from "../core/utils.js";

export class ModalKoreanPatch {
    #backdrop = null;
    #modal = null;

    close() {
        this.#backdrop?.remove();
        this.#modal?.remove();
        this.#backdrop = null;
        this.#modal = null;
    }

    static normalizePatchItems(rawItems) {
        const arr = Array.isArray(rawItems) ? rawItems : [];
        return arr
            .map((it) => {
                const url = String(it?.url || it?.href || "").trim();
                if (!url) return null;

                const t = String(it?.title || it?.name || it?.text || "").trim();
                const d = String(it?.desc || it?.description || "").trim();

                let headline = t;
                let desc = d;

                if (t && (t.includes("\n") || t.includes("\r"))) {
                    const lines = (t.split(/\r\n|\n|\r/) || []).map((x) => x.trim()).filter(Boolean);
                    if (lines.length >= 2) {
                        headline = lines[0];
                        desc = desc || lines.slice(1).join("\n");
                    }
                }

                return { url, headline: headline || "설명 없음", desc: desc || "" };
            })
            .filter(Boolean);
    }

    open(rawItems, updatedAt = null) {
        this.close();

        this.#backdrop = document.createElement("div");
        this.#backdrop.className = "fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm";
        this.#backdrop.addEventListener("click", () => this.close());

        this.#modal = document.createElement("div");
        this.#modal.className =
            "fixed left-1/2 top-1/2 z-[9999] w-[min(820px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 " +
            "rounded-3xl border border-white/10 bg-neutral-950/95 p-5 shadow-2xl";

        const items = ModalKoreanPatch.normalizePatchItems(rawItems);

        const listHtml = items
            .map((x) => {
                const head = escapeHtml(x.headline);
                const desc = x.desc ? escapeHtmlWithBreaks(x.desc) : "";
                const url = escapeHtml(x.url);

                return `
          <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <a href="${url}" target="_blank" rel="noopener noreferrer"
               class="block text-sm font-semibold text-white/85 hover:text-white break-all">
              ${head}
            </a>
            <p class="mt-1 text-[11px] text-white/45 break-all">${url}</p>
            ${
                    desc
                        ? `<div class="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-white/70">
                   ${desc}
                 </div>`
                        : ""
                }
          </div>
        `;
            })
            .join("");

        const updatedText = updatedAt ? `최근 갱신: ${escapeHtml(updatedAt)}` : "";

        this.#modal.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-semibold text-white/85">유저 한글패치</p>
          <p class="mt-1 text-xs text-white/50">링크를 클릭하면 새 창에서 열립니다. ${updatedText}</p>
        </div>
        <button type="button"
          class="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70 hover:bg-white/[0.06]"
          data-close>닫기</button>
      </div>

      <div class="mt-4 max-h-[60vh] space-y-2 overflow-auto pr-1">
        ${listHtml || `<p class="text-sm text-white/60">표시할 한글패치 정보가 없습니다.</p>`}
      </div>

      <div class="mt-4 text-[11px] leading-relaxed text-white/45">
        ※ 유저 한글패치는 비공식 자료이며, 제공처의 설치 방법/주의사항을 확인해 주세요.
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
