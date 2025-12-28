import { escapeHtml, steamStoreUrl } from "../core/utils.js";

export class HeaderRenderer {
    constructor({ gameHeaderEl }) {
        this.gameHeaderEl = gameHeaderEl;
    }

    render(meta, steamItem, flags) {
        const { kind, id, steam_url } = meta;
        const { isFree, isUnavailable } = flags;

        const title = steamItem.title ?? "제목 정보 없음";
        const img = steamItem.header_image ?? steamItem.page_image ?? "";
        const releaseDate = steamItem.release_date || "";

        const badge = isFree
            ? "🆓 무료 플레이"
            : isUnavailable
                ? "⛔ 현재 구매 불가"
                : kind === "bundle"
                    ? "🎁 번들"
                    : kind === "sub"
                        ? "🧩 패키지"
                        : "";

        const link = steam_url || steamStoreUrl(kind, id);

        const ko = Number(steamItem?.supported_languages ?? 0);
        const hasCommunityPatch = (steamItem?.korean?.community_patch?.items?.length ?? steamItem?.community_patch?.items?.length ?? 0) > 0;

        const koBadge =
            ko === 2
                ? `<span class="ml-2 inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/80">한국어 · 음성</span>`
                : ko === 1
                    ? `<span class="ml-2 inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/80">한국어</span>`
                    : "";

        const communityBadge =
            ko === 0 && hasCommunityPatch
                ? `<span class="ml-2 inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/80">유저 한글패치</span>`
                : "";

        const release_text = (/\d/.test(releaseDate)) ? ' 출시' : '';

        this.gameHeaderEl.innerHTML = `
      <a href="${link}" target="_blank" rel="noopener"
         class="group block overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.05] transition">
        <div class="flex flex-col md:flex-row">
          <div class="w-full md:w-[38%]">
            <div class="relative h-56 md:h-full overflow-hidden bg-black/30">
              ${
            img
                ? `<img src="${img}" alt="${escapeHtml(title)}" class="h-full w-full object-cover" />`
                : `<div class="h-full w-full grid place-items-center text-white/40 text-sm">이미지 없음</div>`
        }
              <div class="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent"></div>
              ${
            releaseDate
                ? `<div class="absolute left-3 bottom-3 rounded-xl bg-black/50 px-3 py-1 text-xs text-white">
                       📅 ${escapeHtml(releaseDate)}${release_text}
                     </div>`
                : ""
        }
            </div>
          </div>
          <div class="flex-1 p-5 md:p-7">
            <p class="text-xs text-white/55">Steam 상점 ${badge ? "· " + badge : ""}</p>
            <h3 class="mt-1 text-lg md:text-xl font-semibold text-white/90">${escapeHtml(title)} ${koBadge} ${communityBadge}</h3>
            <p class="mt-2 text-xs text-white/60">Steam 상점 페이지를 새 창에서 열 수 있어요.</p>
          </div>
        </div>
      </a>
    `;

        this.gameHeaderEl.classList.remove("hidden");
    }
}
