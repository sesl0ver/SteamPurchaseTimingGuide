import {
    escapeHtml,
    truncateText,
    formatPrice,
    formatDate,
    parseKrwTextToNumber,
    decodeHtmlEntities,
    stripHtml,
    clamp,
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

        const d = this.#daysLeftSeoul(expiryAt);
        if (!Number.isFinite(d)) return "tone-sale-on";

        if (d <= 0) return "tone-sale-today";
        if (d <= 2) return "tone-sale-soon";
        return "tone-sale-on";
    }

    // -----------------------------

    normalizeServerDlc(dlc) {
        if (!dlc || !Array.isArray(dlc.items)) {
            return { ok: false, items: [], total: null, currency: "KRW", count: 0, missingPrice: 0 };
        }

        const missingPrice = dlc.items.reduce((acc, it) => (it?.price?.amount == null ? acc + 1 : acc), 0);

        return {
            ok: true,
            items: dlc.items,
            total: dlc.total_final ?? null,
            currency: dlc.currency || "KRW",
            count: dlc.count ?? dlc.items.length,
            missingPrice,
        };
    }

    render(payload) {
        const { steam, deal, meta } = payload;
        const kind = meta?.kind || "app";
        const steamItem = kind === "sub" ? steam?.sub : kind === "bundle" ? steam?.bundle : steam?.app;
        const isComingSoon = Boolean(steamItem?.is_coming_soon);

        // -----------------------------
        // 구매 가능/불가 판정(안정화 버전 유지)
        // -----------------------------
        const dealStatus = String(deal?.status || "").toLowerCase();

        // 서버에서 purchasable_signals를 제공하면 그 값을 우선 사용(응답 축소 목적)
        const signals = steamItem?.purchasable_signals || null;

        const pkgCount = Number.isFinite(Number(signals?.packages_count))
            ? Number(signals.packages_count)
            : 0;

        const groupCount = Number.isFinite(Number(signals?.package_groups_count))
            ? Number(signals.package_groups_count)
            : 0;

        const hasSteamPrice = typeof signals?.has_steam_price === "boolean"
            ? signals.has_steam_price
            : (steamItem?.price &&
                (Number.isFinite(Number(steamItem.price.final)) || Number.isFinite(Number(steamItem.price.regular))));

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

        // 출시 예정인 경우(coming soon)인데 가격이 0으로 들어오는 케이스가 있어,
        // 무료 플레이로 오인되지 않도록 무료 판정은 coming soon보다 우선하지 않습니다.
        const isFreeEffective = isFree && !isComingSoon;

        const currency = deal?.current?.currency || steamItem?.price?.currency || "KRW";

        // 한국어 패치
        const communityPatch =
            steam?.korean?.community_patch ??
            steamItem?.korean?.community_patch ??
            steamItem?.community_patch ??
            null;
        const rawPatchItems = Array.isArray(communityPatch?.items) ? communityPatch.items : [];
        const patchItems = rawPatchItems;
        const hasCommunityPatch = rawPatchItems.length > 0;

        // 리뷰(app만)
        const reviews = steam?.reviews;
        const total = Number(reviews?.total || 0);
        const pos = Number(reviews?.positive || 0);

        const rawSummary = reviews?.summary || "";
        const reviewMain = total > 0 ? (this.REVIEW_TEXT_MAP[rawSummary] || rawSummary) : "아직 리뷰가 충분하지 않습니다";
        const reviewDesc =
            total > 0
                ? `전체 ${total.toLocaleString()}건 중 긍정 ${pos.toLocaleString()}건`
                : "조금 더 시간이 지나면 평가가 모일 수 있어요.";

        // -----------------------------
        // price card + tone
        // -----------------------------
        let priceCard;
        if (isUnavailable) {
            priceCard = this.createCard(
                "현재 가격",
                "현재 구매할 수 없어요",
                "스토어에서 판매가 종료되었거나 지역 제한이 있을 수 있습니다."
            );
        } else if (isUnknownAvailability) {
            priceCard = this.createCard(
                "현재 가격",
                "상태 확인 필요",
                "가격/구매 가능 여부를 확정하기 어려워요. Steam 상점에서 구매 버튼 노출 여부를 확인해 주세요."
            );
        } else if (isComingSoon) {
            priceCard = this.createCard("현재 가격", "출시 예정", "아직 출시 전이라 가격/구매 정보가 확정되지 않았을 수 있습니다. Steam 상점에서 출시/구매 버튼 상태를 확인해 주세요.");
        } else if (isFreeEffective) {
            priceCard = this.createCard("현재 가격", "무료 플레이", "지금 바로 추가 비용 없이 즐길 수 있습니다.", "tone-price-high");
        } else {
            const dp = Number(deal?.current?.discount_percent ?? steamItem?.price?.discount_percent ?? 0);
            const amount = deal?.current?.amount ?? steamItem?.price?.final;
            const regular = deal?.current?.regular_price ?? steamItem?.price?.regular;

            const priceTone = this.#toneForPrice(dp, isUnavailable, isUnknownAvailability, isFreeEffective);

            if (Number(dp) > 0 && amount != null && regular != null) {
                priceCard = this.createCard(
                    "현재 가격",
                    `${formatPrice(amount, currency)} (${dp}% 할인)`,
                    `정가 ${formatPrice(regular, currency)} 기준 할인 중입니다.`,
                    priceTone
                );
            } else if (amount != null) {
                priceCard = this.createCard(
                    "현재 가격",
                    `${formatPrice(amount, currency)} (정가)`,
                    "지금은 할인 없이 정가로 판매 중입니다.",
                    priceTone
                );
            } else {
                priceCard = this.createCard("현재 가격", "확인 불가", "현재 가격 정보를 확인할 수 없습니다. Steam 상점을 확인해 주세요.");
            }
        }

        // -----------------------------
        // history card + tone
        // -----------------------------
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

        const historyCard =
            low?.amount != null
                ? (() => {
                    const seen = formatDate(low.last_seen_at);

                    const dpNum = Number.isFinite(Number(low.discount_percent))
                        ? Number(low.discount_percent)
                        : null;

                    // 역대 최저가가 정가와 동일하면, "0% 최저가"처럼 보이는 표현을 피하고
                    // 사용자가 즉시 이해할 수 있도록 "(정가)"를 명시합니다.
                    const titleText = lowEqualsRegular
                        ? "역대 최저가 (정가)"
                        : low.is_lowest_now
                            ? "역대 최저가"
                            : dpNum != null && dpNum > 0
                                ? `과거 ${dpNum}% 최저가 기록이 있습니다`
                                : "과거 최저가 기록이 있습니다";

                    const desc = `최저가 ${formatPrice(low.amount, low.currency || currency)}${
                        lowEqualsRegular ? " (정가)" : ""
                    }${seen ? " (기준: " + seen + ")" : ""}`;

                    return this.createCard("가격 이력", titleText, desc, historyTone);
                })()
                : this.createCard(
                    "가격 이력",
                    "확인 불가",
                    deal?.message || "가격 히스토리 정보를 확인할 수 없습니다.",
                    historyTone
                );

        // -----------------------------
        // sale / purchase info card + tone (할인 기간 카드일 때만)
        // -----------------------------
        const expiry = deal?.current?.expiry_at;
        const expiryK = expiry ? formatDate(expiry) : null;

        const saleTone = this.#toneForSale(expiry, isUnavailable, isUnknownAvailability, isFreeEffective);

        const saleCard = isUnavailable
            ? this.createCard(
                "구매 정보",
                "구매 불가",
                "스토어 판매 종료, 지역 제한 등의 사유일 수 있습니다. Steam 상점에서 상태를 확인해 주세요."
            )
            : isUnknownAvailability
                ? this.createCard(
                    "구매 정보",
                    "상태 확인 필요",
                    "현재 구매 가능 여부를 확정하기 어려워요. Steam 상점에서 구매 버튼 노출 여부를 확인해 주세요."
                )
                : isComingSoon
                    ? this.createCard("구매 정보", "출시 예정", "아직 출시 전이라 구매할 수 없습니다. Steam 상점에서 출시 일정과 구매 가능 여부를 확인해 주세요.")
                    : isFreeEffective
                        ? this.createCard("구매 정보", "무료 플레이", "언제든지 플레이할 수 있습니다.")
                        : this.createCard(
                        "할인 기간",
                        expiry ? "할인 진행 중" : "정보 없음",
                        expiryK ? `할인은 ${expiryK}까지입니다.` : "할인 종료 시점을 확인할 수 없습니다.",
                        saleTone
                    );

        // -----------------------------
        // 4th card (app=유저 반응) + tone
        // -----------------------------
        let fourthCard;
        if (kind === "app") {
            const reviewTone = this.#toneForReview(total, pos, kind);
            fourthCard = this.createCard("유저 반응", reviewMain, reviewDesc, reviewTone);
        } else {
            fourthCard = this.createCard("구성", "정보", "구성 정보는 상점 페이지에서 확인하세요.");
        }

        // -----------------------------
        // extra (app only) - tone 제외
        // -----------------------------
        let dlcCard = "";
        let editionsCard = "";
        let koreanCard = "";

        let dlcCache = null;
        let editionsItems = [];

        if (kind === "app") {
            // DLC: 0개여도 항상 노출(이전 수정 유지)
            {
                const dlc = this.normalizeServerDlc(steamItem?.dlc || steam?.dlc);
                const count = Number(dlc?.count || 0);
                const missing = Number(dlc?.missingPrice || 0);

                const totalText =
                    dlc?.total == null
                        ? null
                        : dlc.total === 0
                            ? "무료 DLC 포함"
                            : formatPrice(dlc.total, dlc.currency || currency);

                const hasItems = Array.isArray(dlc?.items) && dlc.items.length > 0;
                const hasDlc = count > 0;

                const mainLine = hasDlc ? `총 ${count.toLocaleString()}개의 다운로드 콘텐츠.` : "다운로드 콘텐츠(DLC)가 없습니다.";

                let subRow = "";
                if (hasItems) {
                    const subLeft = totalText ? `총 ${escapeHtml(totalText)}` : "합계를 확인할 수 없습니다";
                    const subExtra = missing > 0 ? ` · 가격 정보 없음 ${missing.toLocaleString()}개` : "";

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
                    const hint = hasDlc ? "목록 정보를 불러오지 못했습니다." : "추가 콘텐츠가 없는 상품입니다.";
                    subRow = `<p class="mt-2 text-xs text-white/60">${escapeHtml(hint)}</p>`;
                }

                dlcCard = `
          <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <p class="text-sm font-semibold text-white/90">DLC</p>
            <p class="mt-2 text-lg font-semibold text-white">${escapeHtml(mainLine)}</p>
            ${subRow}
          </div>
        `;

                dlcCache = dlc;
            }

            // 구매 옵션 (서버 제공 purchase_options만 사용)
            const pkg = steamItem?.purchase_options || { title: "구매 옵션", items: [] };
            const items = Array.isArray(pkg?.items) ? pkg.items : [];
            const showOptionsBtn = items.length >= 2;

            editionsItems = items.map((it) => {
                const dp = Number(it.discount_percent || 0);
                const finalText = it.final_price == null ? "가격 정보 없음" : formatPrice(it.final_price, it.currency || currency);
                const origText = it.original_price == null ? "" : ` (정가 ${formatPrice(it.original_price, it.currency || currency)})`;

                const label = `${it.name}${dp ? ` · ${dp}%` : ""} · ${finalText}${origText}`;
                return {
                    name: label,
                    href: it.packageid ? `https://store.steampowered.com/sub/${encodeURIComponent(it.packageid)}/` : null,
                };
            });

            const editionsMainText =
                items.length === 1 ? "1개의 구매 옵션만 존재합니다." : `${items.length.toLocaleString()}개의 구매 옵션이 존재합니다.`;

            editionsCard = `
        <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p class="text-sm font-semibold text-white/90">구매 옵션</p>
          <p class="mt-2 text-lg font-semibold text-white">${escapeHtml(editionsMainText)}</p>
          ${
                showOptionsBtn
                    ? `<div class="mt-2 flex justify-end">
                   <button type="button" data-editions-btn
                     class="shrink-0 inline-flex items-center gap-1 text-xs text-white/60 underline underline-offset-4 hover:text-white transition"
                     aria-haspopup="dialog" aria-expanded="false">
                     옵션 보기 <span class="text-white/50">▾</span>
                   </button>
                 </div>`
                    : ""
            }
        </div>
      `;

            // 한국어 카드 (tone 제외)
            if (hasCommunityPatch) {
                const koLevel = Number(steamItem?.supported_languages ?? 0);
                const officialText = koLevel === 2 ? "공식 한국어(음성 포함)" : koLevel === 1 ? "공식 한국어 지원" : "공식 한국어 미지원";

                const firstTitle = rawPatchItems[0]?.title || rawPatchItems[0]?.name || "";
                const preview = firstTitle ? ` · ${escapeHtml(truncateText(String(firstTitle).split(/\r\n|\n|\r/)[0], 46))}` : "";

                koreanCard = `
          <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:col-span-2">
            <p class="text-sm font-semibold text-white/90">한국어</p>
            <p class="mt-2 text-lg font-semibold text-white">${escapeHtml(officialText)}</p>
            <div class="mt-2 flex items-center justify-between gap-3">
              <p class="text-xs text-white/60">유저 한글패치 ${rawPatchItems.length.toLocaleString()}개${preview}</p>
              <button type="button" data-kp-btn
                class="shrink-0 inline-flex items-center gap-1 text-xs text-white/60 underline underline-offset-4 hover:text-white transition">
                목록 보기 <span class="text-white/50">▾</span>
              </button>
            </div>
            <p class="mt-3 text-[11px] leading-relaxed text-white/45">
              ※ 유저 한글패치는 비공식 자료이며, 제공처의 설치 방법/주의사항 및 적용 대상 버전을 확인해 주세요.
            </p>
          </div>
        `;
            }
        }

        const extraCards = kind === "app" ? `${dlcCard}${editionsCard}${koreanCard}` : "";

        this.resultCardsEl.innerHTML = `
      <div class="grid gap-4 sm:grid-cols-2">
        ${priceCard}
        ${historyCard}
        ${fourthCard}
        ${saleCard}
        ${extraCards}
      </div>
    `;

        // 바인딩
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

        // narrative (기존 유지)
        const narrativeText = this.narrative.build({
            kind,
            isUnavailable,
            isComingSoon,
            isFree: isFreeEffective,
            deal,
            steamItem,
            reviews: {
                summary: this.REVIEW_TEXT_MAP[rawSummary] || rawSummary,
                total: Number(reviews?.total || 0),
                positive: Number(reviews?.positive || 0),
            },
            hasCommunityPatch,
        });
        this.narrative.set(narrativeText);

        return { isFree: isFreeEffective, isComingSoon, isUnavailable, kind, steamItem };
    }
}
