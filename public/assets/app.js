import { $ } from "./core/dom.js";
import { parseSteamInput } from "./core/utils.js";
import { DealApi } from "./core/api.js";

import { LoadingOverlay } from "./ui/LoadingOverlay.js";
import { PortalPopover } from "./ui/PortalPopover.js";
import { ModalDlc } from "./ui/ModalDlc.js";
import { ModalKoreanPatch } from "./ui/ModalKoreanPatch.js";

import { HeaderRenderer } from "./render/HeaderRenderer.js";
import { CardsRenderer } from "./render/CardsRenderer.js";
import { NarrativeRenderer } from "./render/NarrativeRenderer.js";

(() => {
    const appIdInput = $("#appId");
    const fetchBtn = $("#fetchDealBtn");
    const resultArea = $("#resultArea");
    const gameHeader = $("#gameHeader");
    const resultCards = $("#resultCards");

    if (!appIdInput || !fetchBtn || !resultArea || !gameHeader || !resultCards) {
        console.warn("[app.js] Required DOM elements not found.");
        return;
    }

    const api = new DealApi();
    const loading = new LoadingOverlay();
    const portal = new PortalPopover();
    const dlcModal = new ModalDlc();
    const kpModal = new ModalKoreanPatch();

    const narrative = new NarrativeRenderer({ resultAreaEl: resultArea });
    const headerRenderer = new HeaderRenderer({ gameHeaderEl: gameHeader });
    const cardsRenderer = new CardsRenderer({
        resultCardsEl: resultCards,
        portal,
        dlcModal,
        kpModal,
        narrative,
    });

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

    async function runFetch() {
        const input = appIdInput.value.trim();
        const parsed = parseSteamInput(input);

        if (!parsed) {
            renderError("Steam 스토어 주소(/app/… /sub/… /bundle/…)나 ID를 입력해 주세요.");
            return;
        }

        try {
            loading.show();

            const data = await api.fetchDeal(parsed.kind, parsed.id);
            const kind = data?.meta?.kind || parsed.kind;
            const id = data?.meta?.id || parsed.id;

            const steamItem = kind === "sub" ? data?.steam?.sub : kind === "bundle" ? data?.steam?.bundle : data?.steam?.app;
            if (!steamItem) throw new Error("Steam 데이터 형식이 올바르지 않습니다.");

            const flags = cardsRenderer.render(data);
            headerRenderer.render({ kind, id, steam_url: data?.meta?.steam_url }, steamItem, flags);

            resultArea.scrollIntoView({ behavior: "smooth" });
        } catch (e) {
            console.error(e);
            renderError(e?.message || "요청 중 오류가 발생했습니다.");
        } finally {
            loading.hide();
        }
    }

    fetchBtn.addEventListener("click", runFetch);
    appIdInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            runFetch();
        }
    });
})();
