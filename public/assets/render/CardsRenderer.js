import {
    escapeHtml,
    truncateText,
    formatPrice,
    formatDate,
    parseKrwTextToNumber,
    decodeHtmlEntities,
    stripHtml,
    clamp,
    getDaysLeft,
} from "../core/utils.js";

export class CardsRenderer {
    constructor({ resultCardsEl, portal, dlcModal, kpModal, narrative }) {
        this.resultCardsEl = resultCardsEl;
        this.portal = portal;
        this.dlcModal = dlcModal;
        this.kpModal = kpModal;
        this.narrative = narrative;

        this.REVIEW_TEXT_MAP = {
            "Overwhelmingly Positive": "압도적으로 긍정적",
            "Very Positive": "매우 긍정적",
            "Mostly Positive": "대체로 긍정적",
            "Positive": "긍정적",
            "Mixed": "복합적",
            "Mostly Negative": "대체로 부정적",
            "Negative": "부정적",
            "Very Negative": "매우 부정적",
            "Overwhelmingly Negative": "압도적으로 부정적",
            "No user reviews": "유저 평가 없음",
            "No Reviews": "리뷰 없음",
        };
    }

    // toneClass 추가(최소 침습)
    createCard(title, main, desc, toneClass = "") {
        const tone = toneClass ? ` ${toneClass}` : "";
        return `
      <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-5${tone}">
        <p class="text-sm font-semibold text-white/90">${title}</p>
        <p class="mt-2 text-lg font-semibold text-white">${main}</p>
        <p class="mt-1 text-xs leading-relaxed text-white/60">${desc}</p>
      </div>
    `;
    }

    // -----------------------------
    // Tone 계산(4개 카드만 사용)
    // -----------------------------
    #toneForPrice(discountPercent, isUnavailable, isUnknown, isFree) {
        if (isUnavailable || isUnknown) return "";
        if (isFree) return "tone-price-high";
        const dp = Number(discountPercent || 0);
        if (dp >= 60) return "tone-price-high";
        if (dp >= 30) return "tone-price-mid";
        if (dp > 0) return "tone-price-low";
        return "tone-price-none";
    }

    #toneForHistory(lowInfo) {
        if (lowInfo?.amount != null) {
            if (lowInfo?.is_lowest_now) return "tone-history-lowest";
            return "tone-history-known";
        }
        return "tone-history-unknown";
    }

    #toneForReview(total, positive, kind) {
        if (kind !== "app") return "";
        const t = Number(total || 0);
        if (t <= 0) return "tone-review-unknown";
        const p = Number(positive || 0);
        const ratio = t > 0 ? (p / t) * 100 : null;

        if (!Number.isFinite(ratio)) return "tone-review-unknown";
        if (ratio >= 80) return "tone-review-high";
        if (ratio >= 50) return "tone-review-mid";
        return "tone-review-low";
    }

    // expiry_at(ISO) 기준 D-day 계산(Asia/Seoul, "날짜 단위"로)
    #daysLeftSeoul(isoString) {
        try {
            const tz = "Asia/Seoul";
            const d = new Date(isoString);
            if (Number.isNaN(d.getTime())) return null;

            // until 날짜 파트
            const untilParts = new Intl.DateTimeFormat("en-CA", {
                timeZone: tz,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            }).formatToParts(d);
            const uy = untilParts.find(p => p.type === "year")?.value;
            const um = untilParts.find(p => p.type === "month")?.value;
            const ud = untilParts.find(p => p.type === "day")?.value;
            if (!uy || !um || !ud) return null;

            // today 날짜 파트
            const now = new Date();
            const nowParts = new Intl.DateTimeFormat("en-CA", {
                timeZone: tz,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            }).formatToParts(now);
            const ny = nowParts.find(p => p.type === "year")?.value;
            const nm = nowParts.find(p => p.type === "month")?.value;
            const nd = nowParts.find(p => p.type === "day")?.value;
            if (!ny || !nm || !nd) return null;

            const todayStartUtc = Date.UTC(Number(ny), Number(nm) - 1, Number(nd));
            const untilStartUtc = Date.UTC(Number(uy), Number(um) - 1, Number(ud));
            const daysLeft = Math.ceil((untilStartUtc - todayStartUtc) / 86400000);

            return Number.isFinite(daysLeft) ? daysLeft : null;
        } catch {
            return null;
        }
    }

    #toneForSale(expiryAt, isUnavailable, isUnknown, isFree) {
        if (isUnavailable || isUnknown || isFree) return "";
        if (!expiryAt) return "tone-sale-off";

        const d = getDaysLeft(expiryAt);
        if (!Number.isFinite(d)) return "tone-sale-on";

        if (d <= 0) return "tone-sale-today";
        if (d <= 2) return "tone-sale-soon";
        return "tone-sale-on";
    }

    #prepareContext(payload) {
        const { steam, deal, meta } = payload;
        const kind = meta?.kind || "app";
        const steamItem = kind === "sub" ? steam?.sub : kind === "bundle" ? steam?.bundle : steam?.app;
        const isComingSoon = Boolean(steamItem?.is_coming_soon);

        const dealStatus = String(deal?.status || "").toLowerCase();
        const signals = steamItem?.purchasable_signals || null;

        const pkgCount = Number(signals?.packages_count || 0);
        const groupCount = Number(signals?.package_groups_count || 0);
        const hasSteamPrice = Boolean(signals?.has_steam_price);

        const isPurchasableBySteamSignals = pkgCount > 0 || groupCount > 0 || hasSteamPrice;

        const isUnavailable =
            !isPurchasableBySteamSignals &&
            ["unavailable", "not_available", "removed", "delisted", "region_restricted"].includes(dealStatus);

        const isUnknownAvailability = !isPurchasableBySteamSignals && !isUnavailable;

        const curAmount = Number(deal?.current?.amount);
        const steamFinal = Number(steamItem?.price?.final);

        const isFree =
            isPurchasableBySteamSignals &&
            (Number.isFinite(curAmount) ? curAmount === 0 : Number.isFinite(steamFinal) && steamFinal === 0);

        const isFreeEffective = isFree && !isComingSoon;
        const currency = deal?.current?.currency || steamItem?.price?.currency || "KRW";

        const communityPatch = steam?.korean?.community_patch ?? steamItem?.korean?.community_patch ?? null;
        const patchItems = Array.isArray(communityPatch?.items) ? communityPatch.items : [];
        const hasCommunityPatch = patchItems.length > 0;

        const reviews = steam?.reviews;
        const total = Number(reviews?.total || 0);
        const pos = Number(reviews?.positive || 0);
        const rawSummary = reviews?.summary || "";

        return {
            steam, deal, meta,
            kind, steamItem, isComingSoon, isUnavailable, isUnknownAvailability, isFreeEffective,
            currency, communityPatch, patchItems, hasCommunityPatch,
            reviews, total, pos, rawSummary
        };
    }

    #renderPriceCard(ctx) {
        const { isUnavailable, isUnknownAvailability, isComingSoon, isFreeEffective, deal, steamItem, currency } = ctx;

        if (isUnavailable) {
            return this.createCard(
                "현재 가격",
                "구매 불가 상품",
                "스토어 판매가 종료되었거나 지역 제한이 걸려 있어 현재 구매할 수 없습니다."
            );
        }
        if (isUnknownAvailability) {
            return this.createCard(
                "현재 가격",
                "판매 상태 확인 필요",
                "현재 가격 정보를 확정하기 어렵습니다. Steam 상점 페이지에서 구매 버튼 노출 여부를 확인해 주세요."
            );
        }
        if (isComingSoon) {
            return this.createCard(
                "현재 가격",
                "출시 예정",
                "정식 출시 전으로 아직 가격 정보가 공개되지 않았습니다. 출시 일정을 상점 페이지에서 확인해 보세요."
            );
        }
        if (isFreeEffective) {
            return this.createCard(
                "현재 가격",
                "무료 플레이",
                "추가 비용 없이 지금 바로 플레이할 수 있는 무료 게임입니다.",
                "tone-price-high"
            );
        }

        const dp = Number(deal?.current?.discount_percent ?? steamItem?.price?.discount_percent ?? 0);
        const amount = deal?.current?.amount ?? steamItem?.price?.final;
        const regular = deal?.current?.regular_price ?? steamItem?.price?.regular;
        const priceTone = this.#toneForPrice(dp, isUnavailable, isUnknownAvailability, isFreeEffective);

        if (Number(dp) > 0 && amount != null && regular != null) {
            return this.createCard(
                "현재 가격",
                `${formatPrice(amount, currency)} (${dp}% 할인)`,
                `정가 ${formatPrice(regular, currency)} 대비 할인된 가격으로 판매 중입니다.`,
                priceTone
            );
        }
        if (amount != null) {
            return this.createCard(
                "현재 가격",
                `${formatPrice(amount, currency)} (정가)`,
                "현재 별도의 할인 없이 정가로 판매되고 있습니다.",
                priceTone
            );
        }

        return this.createCard(
            "현재 가격",
            "확인 불가",
            "현재 가격 정보를 불러오지 못했습니다. Steam 상점 페이지에서 직접 확인해 주세요."
        );
    }

    #renderHistoryCard(ctx) {
        const { deal, steamItem, currency } = ctx;
        const low = deal?.historical_low;
        const regularForHistory = deal?.current?.regular_price ?? steamItem?.price?.regular ?? null;

        const lowEqualsRegular =
            low?.amount != null &&
            regularForHistory != null &&
            Number.isFinite(Number(low.amount)) &&
            Number.isFinite(Number(regularForHistory)) &&
            Number(low.amount) > 0 &&
            Number(regularForHistory) > 0 &&
            Number(low.amount) === Number(regularForHistory);

        const historyTone = this.#toneForHistory(low);

        if (low?.amount != null) {
            const seen = formatDate(low.last_seen_at);
            const dpNum = Number.isFinite(Number(low.discount_percent)) ? Number(low.discount_percent) : null;

            const titleText = lowEqualsRegular
                ? "역대 최저가 (정가)"
                : low.is_lowest_now
                    ? "역대 최저가"
                    : dpNum != null && dpNum > 0
                        ? `과거 ${dpNum}% 할인 기록이 있습니다`
                        : "과거 최저가 기록이 있습니다";

            const desc = `최저가 ${formatPrice(low.amount, low.currency || currency)}${
                lowEqualsRegular ? " (정가)" : ""
            }${seen ? " (기준: " + seen + ")" : ""}`;

            return this.createCard("가격 이력", titleText, desc, historyTone);
        }

        return this.createCard(
            "가격 이력",
            "기록 없음",
            deal?.message || "역대 최저가 정보를 확인할 수 없습니다.",
            historyTone
        );
    }

    #renderReviewCard(ctx) {
        const { kind, total, pos, rawSummary } = ctx;
        if (kind !== "app") {
            return this.createCard("구성 정보", "패키지/번들", "전체 구성 및 포함된 아이템은 상점 페이지에서 확인 가능합니다.");
        }

        const reviewMain = total > 0 ? (this.REVIEW_TEXT_MAP[rawSummary] || rawSummary) : "평가 정보 부족";
        const reviewDesc = total > 0
            ? `전체 ${total.toLocaleString()}건 중 ${pos.toLocaleString()}건이 긍정적입니다.`
            : "아직 리뷰가 충분히 모이지 않아 전체적인 평가를 알기 어렵습니다.";

        const reviewTone = this.#toneForReview(total, pos, kind);
        return this.createCard("유저 반응", reviewMain, reviewDesc, reviewTone);
    }

    #renderSaleCard(ctx) {
        const { deal, isUnavailable, isUnknownAvailability, isComingSoon, isFreeEffective } = ctx;
        const expiry = deal?.current?.expiry_at;
        const expiryK = expiry ? formatDate(expiry) : null;
        const saleTone = this.#toneForSale(expiry, isUnavailable, isUnknownAvailability, isFreeEffective);

        if (isUnavailable) {
            return this.createCard("할인 정보", "구매 불가", "현재 판매되지 않는 상품입니다.");
        }
        if (isUnknownAvailability) {
            return this.createCard("할인 정보", "상태 확인 필요", "Steam 상점에서 상세 정보를 확인해 주세요.");
        }
        if (isComingSoon) {
            return this.createCard("할인 정보", "출시 예정", "정식 출시 이후 할인 정보가 표시됩니다.");
        }
        if (isFreeEffective) {
            return this.createCard("할인 정보", "무료 플레이", "별도의 기한 없이 언제든 무료로 즐기실 수 있습니다.");
        }

        return this.createCard(
            "할인 기간",
            expiry ? "할인 진행 중" : "진행 중인 할인 없음",
            expiryK ? `할인은 ${expiryK}까지 계속됩니다.` : "현재 할인 종료 시점이 확정되지 않았습니다.",
            saleTone
        );
    }

    #renderDlcCard(ctx) {
        const { steamItem, currency } = ctx;
        const dlc = steamItem?.dlc || null;
        const count = Number(dlc?.count || 0);
        const hasDlc = count > 0;
        const dlcItems = Array.isArray(dlc?.items) ? dlc.items : [];
        const hasItems = dlcItems.length > 0;

        const mainLine = hasDlc ? `총 ${count.toLocaleString()}개의 추가 콘텐츠` : "추가 콘텐츠 없음";

        let subRow = "";
        if (hasItems) {
            const totalText = dlc.total_final === 0 ? "무료 DLC 포함" : (dlc.total_final ? formatPrice(dlc.total_final, dlc.currency || currency) : null);
            const missing = Number(dlc.count || 0) - dlcItems.filter(it => it.price?.amount != null).length;
            const subLeft = totalText ? `합계 ${escapeHtml(totalText)}` : "합계 금액 확인 불가";
            const subExtra = missing > 0 ? ` · ${missing.toLocaleString()}개 가격 미표시` : "";

            subRow = `
        <div class="mt-2 flex items-center justify-between gap-3">
          <p class="text-xs text-white/60">${subLeft}${escapeHtml(subExtra)}</p>
          <button type="button" data-dlc-btn
            class="shrink-0 inline-flex items-center gap-1 text-xs text-white/60 underline underline-offset-4 hover:text-white transition">
            목록 보기 <span class="text-white/50">▾</span>
          </button>
        </div>
      `;
        } else {
            const hint = hasDlc ? "상세 목록을 불러오지 못했습니다." : "구매 가능한 추가 콘텐츠(DLC)가 없습니다.";
            subRow = `<p class="mt-2 text-xs text-white/60">${escapeHtml(hint)}</p>`;
        }

        return `
      <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p class="text-sm font-semibold text-white/90">DLC</p>
        <p class="mt-2 text-lg font-semibold text-white">${escapeHtml(mainLine)}</p>
        ${subRow}
      </div>
    `;
    }

    #renderOptionsCard(ctx) {
        const { steamItem, currency } = ctx;
        const po = steamItem?.purchase_options || null;
        const items = Array.isArray(po?.items) ? po.items : [];
        const showOptionsBtn = items.length >= 2;

        const editionsItems = items.map((it) => {
            const dp = Number(it.discount_percent || 0);
            const finalText = it.final_price == null ? "가격 정보 없음" : formatPrice(it.final_price, it.currency || currency);
            const origText = it.original_price == null ? "" : ` (정가 ${formatPrice(it.original_price, it.currency || currency)})`;
            const label = `${it.name}${dp ? ` · ${dp}%` : ""} · ${finalText}${origText}`;
            return {
                name: label,
                href: it.packageid ? `https://store.steampowered.com/sub/${encodeURIComponent(it.packageid)}/` : null,
            };
        });

        const editionsMainText = items.length <= 1 ? "기본 구매 옵션만 존재합니다." : `${items.length.toLocaleString()}개의 구매 옵션이 있습니다.`;

        return {
            html: `
        <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p class="text-sm font-semibold text-white/90">구매 옵션</p>
          <p class="mt-2 text-lg font-semibold text-white">${escapeHtml(editionsMainText)}</p>
          ${showOptionsBtn ? `<div class="mt-2 flex justify-end">
                   <button type="button" data-editions-btn
                     class="shrink-0 inline-flex items-center gap-1 text-xs text-white/60 underline underline-offset-4 hover:text-white transition"
                     aria-haspopup="dialog" aria-expanded="false">
                     옵션 보기 <span class="text-white/50">▾</span>
                   </button>
                 </div>` : ""}
        </div>
      `,
            items: editionsItems
        };
    }

    #renderKoreanCard(ctx) {
        const { steamItem, hasCommunityPatch, patchItems } = ctx;
        if (!hasCommunityPatch) return "";

        const koLevel = Number(steamItem?.supported_languages ?? 0);
        const officialText = koLevel === 2 ? "공식 한국어(음성 지원)" : koLevel === 1 ? "공식 한국어 자막 지원" : "공식 한국어 미지원";
        const firstTitle = patchItems[0]?.title || patchItems[0]?.name || "";
        const preview = firstTitle ? ` · ${escapeHtml(truncateText(String(firstTitle).split(/\r\n|\n|\r/)[0], 46))}` : "";

        return `
      <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:col-span-2">
        <p class="text-sm font-semibold text-white/90">한국어 정보</p>
        <p class="mt-2 text-lg font-semibold text-white">${escapeHtml(officialText)}</p>
        <div class="mt-2 flex items-center justify-between gap-3">
          <p class="text-xs text-white/60">유저 한글패치 ${patchItems.length.toLocaleString()}개${preview}</p>
          <button type="button" data-kp-btn
            class="shrink-0 inline-flex items-center gap-1 text-xs text-white/60 underline underline-offset-4 hover:text-white transition">
            목록 보기 <span class="text-white/50">▾</span>
          </button>
        </div>
        <p class="mt-3 text-[11px] leading-relaxed text-white/45">※ 유저 한글패치는 비공식 자료이며, 반드시 배포처의 안내 사항을 확인해 주세요.</p>
      </div>
    `;
    }

    render(payload) {
        const ctx = this.#prepareContext(payload);
        const { kind, steamItem, deal, reviews, rawSummary, hasCommunityPatch, patchItems, communityPatch, currency } = ctx;

        const priceCard = this.#renderPriceCard(ctx);
        const historyCard = this.#renderHistoryCard(ctx);
        const reviewCard = this.#renderReviewCard(ctx);
        const saleCard = this.#renderSaleCard(ctx);

        let extraCardsHtml = "";
        let dlcCache = null;
        let editionsItems = [];

        if (kind === "app") {
            dlcCache = steamItem?.dlc || null;
            const dlcCardHtml = this.#renderDlcCard(ctx);
            const optResult = this.#renderOptionsCard(ctx);
            editionsItems = optResult.items;
            const koreanCardHtml = this.#renderKoreanCard(ctx);
            extraCardsHtml = `${dlcCardHtml}${optResult.html}${koreanCardHtml}`;
        }

        this.resultCardsEl.innerHTML = `
      <div class="grid gap-4 sm:grid-cols-2">
        ${priceCard}${historyCard}${reviewCard}${saleCard}${extraCardsHtml}
      </div>
    `;

        // 이벤트 바인딩
        this.#bindEvents({ dlcCache, editionsItems, hasCommunityPatch, patchItems, communityPatch, currency });

        // Narrative 렌더링
        const narrativeText = this.narrative.build({
            kind,
            isUnavailable: ctx.isUnavailable,
            isComingSoon: ctx.isComingSoon,
            isFree: ctx.isFreeEffective,
            deal,
            steamItem,
            reviews: {
                summary: this.REVIEW_TEXT_MAP[rawSummary] || rawSummary,
                total: ctx.total,
                positive: ctx.pos,
            },
            hasCommunityPatch,
        });
        this.narrative.set(narrativeText);

        return {
            isFree: ctx.isFreeEffective,
            isComingSoon: ctx.isComingSoon,
            isUnavailable: ctx.isUnavailable,
            kind,
            steamItem
        };
    }

    #bindEvents({ dlcCache, editionsItems, hasCommunityPatch, patchItems, communityPatch, currency }) {
        const dlcBtn = this.resultCardsEl.querySelector("[data-dlc-btn]");
        if (dlcBtn && Array.isArray(dlcCache?.items) && dlcCache.items.length) {
            dlcBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.dlcModal.open("DLC 목록", dlcCache.items, dlcCache.currency || currency);
            });
        }

        const edBtn = this.resultCardsEl.querySelector("[data-editions-btn]");
        if (edBtn && Array.isArray(editionsItems) && editionsItems.length) {
            edBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.portal.open(edBtn, editionsItems, "구매 옵션");
            });
        }

        const kpBtn = this.resultCardsEl.querySelector("[data-kp-btn]");
        if (kpBtn && hasCommunityPatch) {
            kpBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const updatedAt = communityPatch?.updated_at ?? communityPatch?.updatedAt ?? null;
                this.kpModal.open(patchItems, updatedAt);
            });
        }
    }
}
