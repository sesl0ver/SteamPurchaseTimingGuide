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

        const isLoggedIn = Boolean(window?.__APP_AUTH?.loggedIn);

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

              <!-- Wishlist(찜) 버튼: 이미지 좌상단 원형 하트 -->
              <button
                type="button"
                id="wishlistBtn"
                data-kind="${kind}"
                data-id="${id}"
                data-title="${escapeHtml(title)}"
                data-img="${img}"
                data-steam-url="${link}"
                aria-label="찜하기"
                class="absolute left-3 top-3 grid size-10 place-items-center rounded-full border border-white/10 bg-black/50 backdrop-blur-sm transition hover:bg-black/60"
              >
                ${this.heartSvg(false)}
              </button>
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

        // ===== Wishlist 상태 반영/토글 핸들러 =====
        const btn = this.gameHeaderEl.querySelector("#wishlistBtn");
        if (btn) {
            // 링크 클릭 전파 차단
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });

            // 로그인 안 된 경우: 로그인 페이지로 유도
            if (!isLoggedIn) {
                btn.addEventListener("click", () => {
                    window.location.href = "/login";
                }, { once: true });
                btn.title = "로그인이 필요합니다";
                return;
            }

            // 1) 초기 상태 조회
            this.syncWishlistState(btn).catch(() => {});

            // 2) 토글
            btn.addEventListener("click", () => {
                this.toggleWishlist(btn).catch(() => {});
            });
        }
    }

    heartSvg(isOn) {
        // isOn: 채워진 하트 / 아닌 경우 빈 하트
        const cls = isOn ? "text-rose-400" : "text-white/75";
        const fill = isOn ? "currentColor" : "none";
        const stroke = isOn ? "currentColor" : "currentColor";
        return `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" class="${cls}">
            <path d="M12 21s-7.5-4.5-9.5-9.5C1 7.5 3.5 5 6.5 5c1.7 0 3.2.8 4.1 2.0C11.3 5.8 12.8 5 14.5 5 17.5 5 20 7.5 21.5 11.5 19.5 16.5 12 21 12 21z"
              fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" />
          </svg>
        `;
    }

    setWishlistBtn(btn, wished) {
        btn.innerHTML = this.heartSvg(Boolean(wished));
        btn.dataset.wished = wished ? "1" : "0";
        btn.setAttribute("aria-label", wished ? "찜 해제" : "찜하기");
    }

    async syncWishlistState(btn) {
        const kind = btn.dataset.kind;
        const id = btn.dataset.id;
        const res = await fetch(`/api/wishlist/status?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`);
        if (!res.ok) return;
        const json = await res.json();
        const wished = Boolean(json?.data?.wished ?? json?.wished);
        this.setWishlistBtn(btn, wished);
    }

    async toggleWishlist(btn) {
        const payload = {
            kind: btn.dataset.kind,
            id: btn.dataset.id,
            title: btn.dataset.title || "",
            header_image: btn.dataset.img || "",
            steam_url: btn.dataset.steamUrl || "",
        };

        const res = await fetch("/api/wishlist/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (res.status === 401) {
            window.location.href = "/login";
            return;
        }

        if (!res.ok) {
            return;
        }
        const json = await res.json();
        const wished = Boolean(json?.data?.wished ?? json?.wished);
        this.setWishlistBtn(btn, wished);
    }
}
