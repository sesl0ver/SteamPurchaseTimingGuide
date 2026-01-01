import { $ } from "./core/dom.js";
import { parseSteamInput } from "./core/utils.js";
import { DealApi } from "./core/api.js";

import { LoadingOverlay } from "./ui/LoadingOverlay.js";
import { PortalPopover } from "./ui/PortalPopover.js";
import { ModalDlc } from "./ui/ModalDlc.js";
import { ModalKoreanPatch } from "./ui/ModalKoreanPatch.js";
import { ModalSearch } from "./ui/ModalSearch.js";

import { HeaderRenderer } from "./render/HeaderRenderer.js";
import { CardsRenderer } from "./render/CardsRenderer.js";
import { NarrativeRenderer } from "./render/NarrativeRenderer.js";
import { TrendingRenderer } from "./render/TrendingRenderer.js";

(() => {
    const appIdInput = $("#appId");
    const fetchBtn = $("#fetchDealBtn");
    const resultArea = $("#resultArea");
    const gameHeader = $("#gameHeader");
    const resultCards = $("#resultCards");
    const trendingSection = $("#trendingSection");
    const trendingList = $("#trendingList");
    const wishlistSelectBtn = $("#wishlistSelectBtn");

    // 검색 UI
    const searchTermInput = $("#searchTerm");
    const searchBtn = $("#searchBtn");

    if (!appIdInput || !fetchBtn || !resultArea || !gameHeader || !resultCards) {
        return;
    }

    const api = new DealApi();
    const loading = new LoadingOverlay();
    const portal = new PortalPopover();
    const dlcModal = new ModalDlc();
    const kpModal = new ModalKoreanPatch();
    const searchModal = new ModalSearch();

    const narrative = new NarrativeRenderer({ resultAreaEl: resultArea });
    const headerRenderer = new HeaderRenderer({ gameHeaderEl: gameHeader });
    const cardsRenderer = new CardsRenderer({
        resultCardsEl: resultCards,
        portal,
        dlcModal,
        kpModal,
        narrative,
    });

    // ===== 딥링크 파싱 =====
    function parseDeepLinkPath() {
        const m = window.location.pathname.match(/^\/(app|sub|bundle)\/(\d+)$/);
        if (!m) return null;
        return { kind: m[1], id: m[2] };
    }

    // ===== URL 정리(쿼리 제거) =====
    function cleanupUrlToRoot() {
        // 이미 "/"면 불필요 호출 방지
        if (window.location.pathname === "/" && window.location.search === "") return;
        history.replaceState({}, "", "/");
    }

    function renderError(msg) {
        portal.close();
        dlcModal.close();
        kpModal.close();
        narrative.set(null);
        gameHeader.classList.add("hidden");

        resultCards.innerHTML = `
      <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p class="text-sm font-semibold text-white/90">정보를 불러오지 못했어요</p>
        <p class="mt-2 text-lg font-semibold text-white">오류 발생</p>
        <p class="mt-1 text-xs leading-relaxed text-white/60">${String(msg || "요청 중 오류가 발생했습니다.")}</p>
      </div>
    `;
    }

    // ===== 검색 실행 =====
    async function runSearch() {
        const term = (searchTermInput?.value || "").trim();
        if (!term) return;

        try {
            loading.show();
            const data = await api.storeSearch(term);
            const items = Array.isArray(data?.items) ? data.items : [];

            searchModal.open(term, items, ({ type, id }) => {
                // type/id로 기본 조회로 연결 (예: app/1234)
                if (type === "sub") appIdInput.value = `https://store.steampowered.com/sub/${id}`;
                else if (type === "bundle") appIdInput.value = `https://store.steampowered.com/bundle/${id}`;
                else appIdInput.value = String(id);

                runFetch({ source: "user", kindOverride: type, idOverride: id });
            });
        } catch (e) {
            console.error(e);
            renderError(e?.message || "검색 중 오류가 발생했습니다.");
        } finally {
            loading.hide();
        }
    }

    // ===== 찜 목록에서 선택 =====
    async function openWishlistSelect() {
        try {
            loading.show();
            const data = await api.wishlistList();
            const items = Array.isArray(data?.items) ? data.items : [];

            const modalItems = items.map((it) => ({
                type: String(it?.kind || "app"),
                id: it?.item_id ?? "",
                name: String(it?.title || ""),
                tiny_image: typeof it?.header_image === "string" ? it.header_image : "",
            })).filter((x) => x.id !== "");

            searchModal.open("찜 목록", modalItems, ({ type, id }) => {
                if (type === "sub") appIdInput.value = `https://store.steampowered.com/sub/${id}`;
                else if (type === "bundle") appIdInput.value = `https://store.steampowered.com/bundle/${id}`;
                else appIdInput.value = String(id);

                runFetch({ source: "user", kindOverride: type, idOverride: id });
            });
        } catch (e) {
            if ((e?.message || "") === "401") {
                window.location.href = "/login";
                return;
            }
            console.error(e);
            renderError("찜 목록을 불러오지 못했어요.");
        } finally {
            loading.hide();
        }
    }

    function syncUrlToDeal(kind, id) {
        const target = `/${kind}/${id}`;

        // 이미 같은 경로면 불필요 변경 X
        if (window.location.pathname === target) return;

        // 쿼리 제거 포함해서 주소를 딥링크로 동기화
        history.replaceState({}, "", target);
    }


    // ===== 조회 실행 =====
    // source 옵션:
    // - "user": 사용자가 입력/버튼/엔터로 실행
    // - "trending": 트렌딩 카드 클릭으로 실행
    // - "deeplink": 쿼리(kind,id)로 자동 실행
    async function runFetch({ source = "user", kindOverride = null, idOverride = null } = {}) {
        let parsed;

        if (kindOverride && idOverride) {
            parsed = { kind: kindOverride, id: String(idOverride) };
        } else {
            const input = appIdInput.value.trim();
            parsed = parseSteamInput(input);
        }

        if (!parsed) {
            renderError("Steam 스토어 주소(/app/… /sub/… /bundle/…)나 ID를 입력해 주세요.");
            return;
        }

        try {
            loading.show();

            const data = await api.fetchDeal(parsed.kind, parsed.id);
            const kind = data?.meta?.kind || parsed.kind;
            const id = data?.meta?.id || parsed.id;

            const steamItem =
                kind === "sub" ? data?.steam?.sub :
                    kind === "bundle" ? data?.steam?.bundle :
                        data?.steam?.app;

            if (!steamItem) throw new Error("Steam 데이터 형식이 올바르지 않습니다.");

            const flags = cardsRenderer.render(data);
            headerRenderer.render({ kind, id, steam_url: data?.meta?.steam_url }, steamItem, flags);

            resultArea.scrollIntoView({ behavior: "smooth" });

            // 성공 후 URL 정리: 딥링크 경로에서 "다른 ID"를 조회했을 때만 / 로 변경
            syncUrlToDeal(kind, id);
        } catch (e) {
            console.error(e);
            renderError(e?.message || "요청 중 오류가 발생했습니다.");
        } finally {
            loading.hide();
        }
    }

    fetchBtn.addEventListener("click", () => runFetch({ source: "user" }));
    wishlistSelectBtn?.addEventListener("click", () => openWishlistSelect());
    wishlistSelectBtn?.addEventListener("click", () => openWishlistSelect());
    appIdInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            runFetch({ source: "user" });
        }
    });

    // 검색 버튼 / 엔터
    searchBtn?.addEventListener("click", () => runSearch());
    searchTermInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            runSearch();
        }
    });

    // 트랜딩 목록
    const trending = (trendingSection && trendingList)
        ? new TrendingRenderer({
            sectionEl: trendingSection,
            listEl: trendingList,
            api,
            days: 7,
            limit: 10,
            intervalMs: 60_000, // 1분
        })
        : null;

    // 페이지 로드 시 바로 시작 (결과가 없어도 hidden 유지)
    trending?.start();

    // ===== Trending 카드 클릭 → 내부 조회 =====
    document.addEventListener("click", (e) => {
        const card = e.target.closest("[data-kind][data-id]");
        if (!card) return;

        // 트렌딩 카드가 아닌 다른 카드 클릭은 무시
        if (!card.closest("#trendingSection")) return;

        e.preventDefault();

        const kind = card.dataset.kind;
        const id = card.dataset.id;

        if (!kind || !id) return;

        // 입력창에 값 주입 (parseSteamInput이 이해할 수 있는 형태)
        // kind가 sub/bundle이면 URL 형태로 넣어주면 parseSteamInput이 확실히 이해합니다.
        if (kind === "sub") appIdInput.value = `https://store.steampowered.com/sub/${id}`;
        else if (kind === "bundle") appIdInput.value = `https://store.steampowered.com/bundle/${id}`;
        else appIdInput.value = id;

        // 바로 조회 실행
        runFetch({ source: "trending" });
    });

    // ===== 딥링크 자동 조회 =====
    const deep = parseDeepLinkPath();
    if (deep) {
        if (deep.kind === "sub") appIdInput.value = `https://store.steampowered.com/sub/${deep.id}`;
        else if (deep.kind === "bundle") appIdInput.value = `https://store.steampowered.com/bundle/${deep.id}`;
        else appIdInput.value = deep.id;

        runFetch({ source: "deeplink", kindOverride: deep.kind, idOverride: deep.id });
    }

    // 페이지 종료 시 정리
    window.addEventListener("beforeunload", () => trending?.stop());
})();
