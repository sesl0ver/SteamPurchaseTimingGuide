// ModalKoreanPatch.js (UPDATED: 최근 갱신 표시를 사용자 친화 형식으로 변환)
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

                const d = String(it?.description || "").trim();

                let description = d;

                if (d && (d.includes("\n") || d.includes("\r"))) {
                    const lines = (d.split(/\r\n|\n|\r/) || [])
                        .map((x) => x.trim())
                        .filter(Boolean);
                    if (lines.length >= 2) {
                        // description = lines[0];
                        description = description || lines.slice(1).join("\n");
                    }
                }

                return { url, description: description || "설명 없음" };
            })
            .filter(Boolean);
    }

    /**
     * updatedAt(ISO/offset 포함 가능)을 사용자 친화 형식으로 변환
     * - 출력 예: "2025년 12월 27일 18:36"
     * - 파싱 불가/값 없음: 표시 생략
     */
    static formatUpdatedAtKo(updatedAt) {
        if (!updatedAt) return "";

        const raw = String(updatedAt).trim();
        if (!raw) return "";

        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return "";

        const tz = "Asia/Seoul";
        const parts = new Intl.DateTimeFormat("ko-KR", {
            timeZone: tz,
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).formatToParts(d);

        const y = parts.find((p) => p.type === "year")?.value;
        const mo = parts.find((p) => p.type === "month")?.value;
        const da = parts.find((p) => p.type === "day")?.value;
        const hh = parts.find((p) => p.type === "hour")?.value;
        const mm = parts.find((p) => p.type === "minute")?.value;

        if (!y || !mo || !da || !hh || !mm) return "";

        return `${y}년 ${Number(mo)}월 ${Number(da)}일 ${hh}:${mm}`;
    }

    open(rawItems, updatedAt = null) {
        this.close();

        this.#backdrop = document.createElement("div");
        this.#backdrop.className =
            "fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm";
        this.#backdrop.addEventListener("click", () => this.close());

        this.#modal = document.createElement("div");
        this.#modal.className =
            "fixed left-1/2 top-1/2 z-[9999] w-[min(820px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 " +
            "rounded-3xl border border-white/10 bg-neutral-950/95 p-5 shadow-2xl";

        const items = ModalKoreanPatch.normalizePatchItems(rawItems);

        const listHtml = items
            .map((x) => {
                const description = x.description ? escapeHtmlWithBreaks(x.description) : "";
                const url = escapeHtml(x.url);

                return `
          <a href="${url}" target="_blank" rel="noopener noreferrer"
             class="block rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3
                    transition-colors duration-150
                    hover:bg-white/[0.06] focus-visible:bg-white/[0.06]
                    focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/10">
            <p class="text-sm font-semibold text-white/85">${url}</p>
            ${
                    description
                        ? `<div class="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-white/70">
                     ${description}
                   </div>`
                        : ""
                }
          </a>
        `;
            })
            .join("");

        const updatedPretty = ModalKoreanPatch.formatUpdatedAtKo(updatedAt);
        const updatedText = updatedPretty ? `최근 갱신: ${escapeHtml(updatedPretty)}` : "";

        this.#modal.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-semibold text-white/85">유저 한글패치</p>
          <p class="mt-1 text-xs text-white/50">링크를 클릭하면 새 창에서 열립니다.${
            updatedText ? ` ${updatedText}` : ""
        }</p>
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

        this.#modal
            .querySelector("[data-close]")
            ?.addEventListener("click", () => this.close());

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
