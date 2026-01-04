// NarrativeRenderer v2 (관점 기반 요약 구조) — API 스키마 반영 최종본
// - steam.app.price, steam.app.genres, steam.app.purchase_options, steam.app.dlc, steam.reviews, steam.korean.community_patch
// - deal.current / deal.historical_low / deal.current.expiry_at
// 목표: 판단을 대신하지 않으면서 가독성과 분기 다양성을 극대화

import { escapeHtml, humanizeAgo, getDaysLeft } from "../core/utils.js";

export class NarrativeRenderer {
    constructor({ resultAreaEl }) {
        this.resultAreaEl = resultAreaEl;
        this.narrativeEl = null;
    }

    #ensure() {
        if (this.narrativeEl) return this.narrativeEl;

        let el = document.querySelector("#dealNarrative");
        if (!el) {
            el = document.createElement("div");
            el.id = "dealNarrative";
            el.className =
                "mt-4 hidden rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6";
            el.innerHTML = `
        <p class="text-sm font-semibold text-white/85">이번 할인, 이렇게 볼 수 있어요</p>
        <div id="dealNarrativeText" class="mt-3 space-y-4"></div>
        <p class="mt-4 text-[11px] leading-relaxed text-amber-200/80">
          ※ 일부 정보는 캐시된 데이터일 수 있습니다. 최종 구매 전 Steam 상점 정보를 함께 확인해 주세요.<br>
          ※ 할인율 평가는 정가 기준이며, 체감 가격은 개인에 따라 다를 수 있습니다.
        </p>
      `;

            const cards = document.querySelector("#resultCards");
            if (cards?.parentNode === this.resultAreaEl) {
                this.resultAreaEl.insertBefore(el, cards);
            } else {
                this.resultAreaEl.appendChild(el);
            }
        }

        this.narrativeEl = el;
        return el;
    }

    /**
     * Steam release_date 파싱
     * - 예: "27 Dec, 2025", "Dec 27, 2025", "2025년 9월 11일"
     */
    #parseReleaseDate(raw) {
        if (!raw) return null;

        const d1 = new Date(raw);
        if (!Number.isNaN(d1.getTime())) return d1;

        const s = String(raw);
        const m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
        if (m) {
            const y = Number(m[1]);
            const mo = Number(m[2]);
            const da = Number(m[3]);
            if (y && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
                const d2 = new Date(y, mo - 1, da);
                if (!Number.isNaN(d2.getTime())) return d2;
            }
        }

        return null;
    }

    /** ISO 날짜 문자열 → "YYYY년 M월 D일" + daysLeft 계산 (Asia/Seoul 기준) */
    #formatKoreanUntilWithDaysLeft(isoString) {
        try {
            const d = new Date(isoString);
            if (Number.isNaN(d.getTime())) return null;

            const untilText = new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                year: "numeric",
                month: "long",
                day: "numeric",
            }).format(d);

            return { untilText, daysLeft: getDaysLeft(isoString) };
        } catch {
            return null;
        }
    }

    /**
     * 리뷰 라벨 → 톤 매핑
     * API 예: "Mixed" (영문) 또는 한글 라벨
     */
    #mapReviewTone(label) {
        const l = String(label || "").trim();
        if (!l) return null;

        // 영문 Steam 요약
        if (/^overwhelmingly positive$/i.test(l)) return "very_positive";
        if (/^very positive$/i.test(l)) return "very_positive";
        if (/^positive$/i.test(l)) return "positive";
        if (/^mostly positive$/i.test(l)) return "positive";

        if (/^mixed$/i.test(l)) return "mixed";
        if (/^mostly negative$/i.test(l) || /^negative$/i.test(l)) return "negative";
        if (/^overwhelmingly negative$/i.test(l) || /^very negative$/i.test(l)) return "very_negative";

        // 한글 라벨
        if (["압도적으로 긍정적", "매우 긍정적"].includes(l)) return "very_positive";
        if (["긍정적", "대체로 긍정적"].includes(l)) return "positive";

        if (l === "복합적") return "mixed";
        if (["대체로 부정적", "부정적"].includes(l)) return "negative";
        if (["매우 부정적", "압도적으로 부정적"].includes(l)) return "very_negative";

        return null;
    }

    set(html) {
        const el = this.#ensure();
        const box = el.querySelector("#dealNarrativeText");
        if (!box) return;

        if (!html) {
            el.classList.add("hidden");
            box.innerHTML = "";
            return;
        }

        // 허용 태그/속성만 남기는 아주 제한적인 화이트리스트 필터
        // - build()에서 동적 값은 escapeHtml로 이스케이프 처리하는 전제
        // - 그럼에도 innerHTML 사용 시 혹시 모를 누락을 대비해 방어적으로 필터링
        const tpl = document.createElement("template");
        tpl.innerHTML = String(html);

        const ALLOWED_TAGS = new Set(["DIV", "P", "UL", "LI", "STRONG", "BR"]);
        const ALLOWED_ATTRS = new Set(["class", "id"]);

        const elements = tpl.content.querySelectorAll("*");
        for (const elNode of elements) {
            // 태그 화이트리스트
            if (!ALLOWED_TAGS.has(elNode.tagName)) {
                elNode.replaceWith(document.createTextNode(elNode.textContent ?? ""));
                continue;
            }

            // 속성 화이트리스트 + 위험 속성 제거
            for (const attr of Array.from(elNode.attributes)) {
                const name = attr.name.toLowerCase();
                const value = String(attr.value ?? "");

                // on* 이벤트 핸들러 제거
                if (name.startsWith("on")) {
                    elNode.removeAttribute(attr.name);
                    continue;
                }

                // 허용 속성만 유지
                if (!ALLOWED_ATTRS.has(name)) {
                    elNode.removeAttribute(attr.name);
                    continue;
                }

                // class/id에 제어문자가 들어오는 경우를 대비해 제거
                if ((name === "class" || name === "id") && /[\u0000-\u001F\u007F]/.test(value)) {
                    elNode.removeAttribute(attr.name);
                }
            }
        }

        box.innerHTML = "";
        box.appendChild(tpl.content);
        el.classList.remove("hidden");
    }

    /**
     * build 입력은 기존 호출부 호환을 유지합니다.
     */
    build(params) {
        const { isUnavailable, isComingSoon, isFree } = params;

        if (isUnavailable) {
            return `현재 Steam에서 <strong>구매할 수 없는 상태</strong>입니다. 판매 종료 또는 지역 제한일 수 있으니 Steam 상점에서 상태를 확인해 주세요.`;
        }
        if (isComingSoon) {
            return `현재 <strong>출시 예정</strong>인 상품입니다. 출시 전에는 가격/구매 조건이 변동될 수 있으니 Steam 상점에서 출시 일정과 구매 가능 여부를 확인해 주세요.`;
        }
        if (isFree) {
            return `현재 <strong>무료로 플레이</strong>할 수 있는 상품입니다. 구성과 조건은 Steam 상점에서 확인해 주세요.`;
        }

        const ctx = this.#prepareContext(params);
        const items = [];

        this.#analyzePrice(ctx, items);
        this.#analyzeRelease(ctx, items);
        this.#analyzeLanguage(ctx, items);
        this.#analyzeGenre(ctx, items);
        this.#analyzeReviews(ctx, items);
        this.#analyzeOptions(ctx, items);
        this.#analyzeDlc(ctx, items);
        this.#analyzeAchievements(ctx, items);
        this.#analyzeExpiry(ctx, items);

        return this.#renderNarrative(items, ctx);
    }

    #prepareContext(params) {
        const { kind, deal, steamItem, reviews, hasCommunityPatch } = params;

        const price = steamItem?.price || {};
        const steamRegular = Number(price?.regular);
        const steamFinal = Number(price?.final);
        const steamDp = Number(price?.discount_percent);

        const curDp = Number.isFinite(Number(deal?.current?.discount_percent))
            ? Number(deal.current.discount_percent)
            : Number.isFinite(steamDp) ? steamDp : 0;

        const currentAmount = Number.isFinite(Number(deal?.current?.amount))
            ? Number(deal.current.amount)
            : Number.isFinite(steamFinal) ? steamFinal : null;

        const listPrice = Number.isFinite(Number(deal?.current?.regular_price))
            ? Number(deal.current.regular_price)
            : Number.isFinite(steamRegular) ? steamRegular : null;

        const lowInfo = deal?.historical_low;
        const allTimeLow = Number.isFinite(Number(lowInfo?.amount)) ? Number(lowInfo.amount) : null;
        const lowWasNow = !!lowInfo?.is_lowest_now;
        const lowDp = Number.isFinite(Number(lowInfo?.discount_percent)) ? Number(lowInfo.discount_percent) : null;

        let lowCloseness = null;
        if (!lowWasNow && lowDp != null) {
            const diff = Math.abs(lowDp - curDp);
            if (diff === 0) lowCloseness = "same";
            else if (diff <= 5) lowCloseness = "near";
            else if (diff >= 15) lowCloseness = "far";
        }

        const hasRealDiscountHistory =
            listPrice != null && allTimeLow != null &&
            listPrice > 0 && allTimeLow > 0 && allTimeLow < listPrice;

        const allTimeLowEqualsList =
            listPrice != null && allTimeLow != null &&
            listPrice > 0 && allTimeLow > 0 && allTimeLow === listPrice;

        return {
            kind, deal, steamItem, reviews, hasCommunityPatch,
            curDp, currentAmount, listPrice,
            lowInfo, allTimeLow, lowWasNow, lowDp, lowCloseness,
            hasRealDiscountHistory, allTimeLowEqualsList
        };
    }

    #pushItem(items, category, weight, text, key) {
        const t = String(text || "").trim();
        if (!t) return;
        const k = key || `${category}:${t}`;
        // 중복 방지는 build 레벨에서 Set으로 관리해도 되지만 간단히 items 배열 확인
        if (items.some(it => it.key === k)) return;
        items.push({ category, weight, text: t, key: k });
    }

    #strong(s) {
        return `<strong>${escapeHtml(String(s ?? ""))}</strong>`;
    }

    #analyzePrice(ctx, items) {
        const { curDp, lowWasNow, lowCloseness, allTimeLow, lowInfo, hasRealDiscountHistory, allTimeLowEqualsList, listPrice, currentAmount } = ctx;

        if (curDp > 0) {
            if (lowWasNow) {
                this.#pushItem(items, "consider", 95, `현재 할인은 ${this.#strong("역대 최저가")}와 동일한 수준입니다.`, "price:atl_now");
            } else if (lowCloseness === "same") {
                this.#pushItem(items, "consider", 85, `현재 할인 조건은 과거 최저가와 ${this.#strong("같은 수준")}을 유지하고 있습니다.`, "price:atl_same");
            } else if (lowCloseness === "near") {
                this.#pushItem(items, "consider", 80, `현재 가격은 과거 최저가와 ${this.#strong("큰 차이 없는")} 합리적인 수준입니다.`, "price:atl_near");
            } else if (lowCloseness === "far") {
                this.#pushItem(items, "info", 60, `현재도 할인 중이지만, 과거 최저가 대비 ${this.#strong("차이가 있는")} 편입니다.`, "price:atl_far");
            } else if (allTimeLow != null) {
                const ago = humanizeAgo(lowInfo?.last_seen_at);
                this.#pushItem(items, "info", 65, `현재 할인 중이며, 과거 최저가 기록${ago ? `(${escapeHtml(ago)})` : ""}이 확인됩니다.`, "price:atl_exists");
            } else {
                this.#pushItem(items, "info", 55, `현재 할인 중이지만, 가격 이력이 충분하지 않아 과거 기준 비교는 제한적일 수 있습니다.`, "price:history_limited");
            }

            const dpText = `${curDp}%`;
            if (curDp >= 75) {
                this.#pushItem(items, "consider", 75, `할인율이 ${this.#strong(dpText)}로 매우 높으며, 정가 대비 가격 부담이 ${this.#strong("크게 낮아진")} 상태입니다.`, "price:dp_75_up");
            } else if (curDp > 50) {
                this.#pushItem(items, "consider", 70, `할인율이 ${this.#strong(dpText)}로 정가 대비 ${this.#strong("체감될 정도로 큰")} 할인 폭을 보여줍니다.`, "price:dp_over_50");
            } else if (curDp === 50) {
                this.#pushItem(items, "consider", 65, `할인율이 ${this.#strong("50%")}로, 현재 ${this.#strong("정가 대비 반값")}에 구매 가능합니다.`, "price:dp_50");
            } else if (curDp > 30) {
                this.#pushItem(items, "consider", 60, `할인율이 ${this.#strong(dpText)}로 ${this.#strong("의미 있는 수준의 할인")}이 진행 중입니다.`, "price:dp_under_50_over_30");
            } else if (curDp > 10) {
                this.#pushItem(items, "info", 50, `현재 ${this.#strong("할인 중")}이지만, 할인 폭은 ${this.#strong(dpText)}로 비교적 가벼운 편입니다.`, "price:dp_30_down");
            } else {
                this.#pushItem(items, "info", 45, `할인율이 ${this.#strong(dpText)}로 아직은 할인 폭이 크지 않은 단계입니다.`, "price:dp_10_down");
            }

            if (listPrice != null && currentAmount != null) {
                if (listPrice >= 80000 && currentAmount >= 50000) {
                    this.#pushItem(items, "info", 35, `기본 정가가 다소 높게 책정되어 있어, 할인 적용 후에도 실제 지불 가격이 높게 느껴질 수 있습니다.`, "price:high_list");
                }
                if (listPrice > 0 && listPrice <= 20000) {
                    this.#pushItem(items, "info", 28, `기본 정가가 낮은 편이라, 할인율보다는 실제 할인된 절대 금액을 함께 고려해 보세요.`, "price:low_list");
                }
            }
        } else {
            if (allTimeLowEqualsList) {
                this.#pushItem(items, "info", 65, `현재까지 정가로만 판매된 상품으로, 과거에도 정가보다 낮은 가격에 판매된 기록이 없습니다.`, "price:no_sale_ever");
            } else if (hasRealDiscountHistory) {
                this.#pushItem(items, "info", 60, `현재는 ${this.#strong("할인 없는 정가")} 상태이며, 과거에 할인 판매되었던 기록이 존재합니다.`, "price:now_full_past_sale");
            } else if (allTimeLow != null) {
                this.#pushItem(items, "info", 55, `현재 정가로 판매 중입니다. 가격 이력은 존재하나 구체적인 할인 기록은 확정하기 어렵습니다.`, "price:history_unclear");
            } else {
                this.#pushItem(items, "info", 50, `현재 ${this.#strong("할인 없는 정가")}로 판매 중입니다.`, "price:now_full");
            }
            this.#pushItem(items, "caution", 45, `다음 할인 시점을 예측하기 어려우므로, 당장 플레이할 계획이 아니라면 기다려보는 것도 방법입니다.`, "price:wait_uncertain");
        }
    }

    #analyzeRelease(ctx, items) {
        const { steamItem, curDp } = ctx;
        const releaseDateRaw = steamItem?.release_date ?? null;
        const releasedAt = this.#parseReleaseDate(releaseDateRaw);
        if (releasedAt) {
            const diffDays = (Date.now() - releasedAt.getTime()) / 86400000;
            if (diffDays >= 0 && diffDays <= 90) {
                const days = Math.floor(diffDays);
                const text = curDp > 0
                    ? `출시 후 약 ${days}일 만에 진행되는 초기 할인입니다.`
                    : `출시된 지 약 ${days}일 정도 지난 신작이며, 현재는 정가로 판매 중입니다.`;
                this.#pushItem(items, "info", 40, text, "release:recent");
            } else if (diffDays >= 365 * 2) {
                const text = curDp > 0
                    ? `출시 후 상당 기간이 지난 작품으로, 안정적인 할인 주기에 진입한 상태입니다.`
                    : `출시된 지 오래된 작품이지만 현재는 할인 없이 정가로 판매되고 있습니다.`;
                this.#pushItem(items, "info", 30, text, "release:old");
            }
        }
    }

    #analyzeLanguage(ctx, items) {
        const { kind, steamItem, hasCommunityPatch } = ctx;
        if (kind === "app") {
            const koLevel = Number(steamItem?.supported_languages ?? 0);
            if (koLevel === 2) {
                this.#pushItem(items, "consider", 85, `공식적으로 ${this.#strong("한국어 자막과 음성")}을 모두 지원하여 몰입도 높은 플레이가 가능합니다.`, "lang:ko_voice");
            } else if (koLevel === 1) {
                this.#pushItem(items, "consider", 75, `공식 ${this.#strong("한국어 자막")}을 지원하여 원활한 게임 진행이 가능합니다.`, "lang:ko_sub");
            } else if (hasCommunityPatch) {
                this.#pushItem(items, "info", 65, `공식 한국어는 지원하지 않으나, 사용자가 제작한 ${this.#strong("유저 한글패치")}가 존재합니다.`, "lang:community_patch");
            } else {
                this.#pushItem(items, "caution", 85, `공식 ${this.#strong("한국어 미지원")} 상품으로, 플레이 시 언어 장벽이 느껴질 수 있습니다.`, "lang:no_ko");
            }
        } else {
            this.#pushItem(items, "info", 30, `구성 상품별로 ${this.#strong("한국어 지원 여부")}가 다를 수 있으니 Steam 상점에서 개별 정보를 꼭 확인해 주세요.`, "lang:bundle_unknown");
        }
    }

    #analyzeGenre(ctx, items) {
        const { steamItem } = ctx;
        const genres = Array.isArray(steamItem?.genres) ? steamItem.genres.filter(Boolean) : [];
        if (genres.length > 0) {
            const gText = escapeHtml(genres.slice(0, 4).join(" · "));
            this.#pushItem(items, "info", 70, `주요 장르는 ${this.#strong(gText)}입니다.`, "meta:genres");

            const hasRoguelike = genres.some((g) => /로그|rogue/i.test(String(g)));
            const hasPvp = genres.some((g) => /pvp|대전|경쟁/i.test(String(g)));
            if (hasRoguelike || hasPvp) {
                this.#pushItem(items, "info", 25, `장르 특성상 개인의 취향에 따라 플레이 경험이 크게 달라질 수 있으니 신중히 고려해 보세요.`, "meta:genre_taste");
            }
        }
    }

    #analyzeReviews(ctx, items) {
        const { kind, reviews } = ctx;
        const total = Number(reviews?.total || 0);
        const positive = Number(reviews?.positive || 0);
        const negative = Number(reviews?.negative || 0);
        const summary = String(reviews?.summary || "").trim();
        const tone = this.#mapReviewTone(summary);
        const labelText = summary ? escapeHtml(summary) : "평가 정보 없음";

        if (kind === "app" && total > 0) {
            const isGoodReview = tone === "positive" || tone === "very_positive";
            const reviewCategory = isGoodReview ? "consider" : "info";
            const reviewWeight = tone === "very_positive" ? 80 : (tone === "positive" ? 72 : 55);

            this.#pushItem(items, reviewCategory, reviewWeight, `현재 전반적인 사용자 평가는 ${this.#strong(`"${labelText}"`)} 상태입니다.`, "reviews:label");

            const posRate = (positive / total) * 100;
            if ((positive + negative) > 0) {
                this.#pushItem(items, "info", 50, `총 ${this.#strong(total.toLocaleString() + "개")}의 리뷰 중 약 ${this.#strong(posRate.toFixed(1) + "%")}가 긍정적인 반응을 보이고 있습니다.`, "reviews:count_with_positive_rate");
            } else {
                this.#pushItem(items, "info", 50, `현재까지 등록된 사용자 리뷰는 총 ${this.#strong(total.toLocaleString() + "개")}입니다.`, "reviews:count_only");
            }

            if (tone === "very_negative") {
                this.#pushItem(items, "caution", 90, `평가가 매우 부정적이므로, 구매 결정 전에 최근 리뷰와 상세 내용을 꼼꼼히 확인해 보세요.`, "reviews:very_negative");
            } else if (tone === "negative") {
                this.#pushItem(items, "caution", 75, `평가가 좋지 않은 편입니다. 게임 내적인 결함이나 호불호 요소를 리뷰를 통해 파악해 보세요.`, "reviews:negative");
            }
        } else if (kind === "app" && total === 0) {
            this.#pushItem(items, "info", 35, `아직 충분한 사용자 리뷰가 누적되지 않아 객관적인 평가 확인이 어렵습니다.`, "reviews:none");
        }
    }

    #analyzeOptions(ctx, items) {
        const { steamItem } = ctx;
        const po = steamItem?.purchase_options;
        const poItems = Array.isArray(po?.items) ? po.items : [];
        if (poItems.length > 1) {
            this.#pushItem(items, "info", 45, `현재 ${this.#strong(`${poItems.length}가지의 구매 옵션`)}이 제공되고 있습니다. 에디션별 구성을 비교해 보세요.`, "po:count");

            const finals = poItems.map(x => Number(x?.final_price)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
            if (finals.length >= 2) {
                const min = finals[0];
                const max = finals[finals.length - 1];
                if (min > 0 && max / min >= 1.6) {
                    this.#pushItem(items, "caution", 55, `에디션 간 가격 편차가 큰 편입니다. 추가 구성물이 본인에게 정말 필요한지 먼저 검토해 보세요.`, "po:gap");
                }
            }
            const dps = Array.from(new Set(poItems.map(x => Number(x?.discount_percent)).filter(n => Number.isFinite(n))));
            if (dps.length >= 2) {
                this.#pushItem(items, "info", 35, `구매 옵션에 따라 할인율이 다르게 적용되고 있으니, 각 항목의 실제 혜택을 비교해 보세요.`, "po:dp_varies");
            }
        } else {
            if (!(steamItem?.purchasable_signals?.has_steam_price)) {
                this.#pushItem(items, "caution", 70, `Steam 내 가격 정보가 명확히 표시되지 않고 있습니다. 상점 페이지에서 직접 확인이 필요합니다.`, "po:no_price");
            }
        }
    }

    #analyzeDlc(ctx, items) {
        const { steamItem, listPrice } = ctx;
        const dlc = steamItem?.dlc;
        const dlcCount = Number(dlc?.count || 0);
        const dlcPriced = Number(dlc?.priced_count || 0);
        const dlcTotalFinal = Number(dlc?.total_final);
        const dlcTotalRegular = Number(dlc?.total_regular);

        if (dlcCount > 0) {
            this.#pushItem(items, "info", 30, `이 게임은 총 ${this.#strong(`${dlcCount}개`)}의 다운로드 가능한 콘텐츠(DLC)를 보유하고 있습니다.`, "dlc:count");

            if (dlcPriced > 0) {
                if (Number.isFinite(dlcTotalFinal) && Number.isFinite(listPrice) && listPrice > 0) {
                    const ratio = dlcTotalFinal / listPrice;
                    if (ratio >= 1.0) {
                        this.#pushItem(items, "caution", 60, `유료 DLC 합산 금액이 본편 가격을 상회합니다. 모든 콘텐츠가 필요한 경우 전체 비용을 고려해 보세요.`, "dlc:cost_high");
                    } else if (ratio >= 0.5) {
                        this.#pushItem(items, "info", 35, `유료 DLC의 총액이 본편 가격의 절반 이상을 차지할 만큼 비중이 큰 편입니다.`, "dlc:cost_mid");
                    }
                }
                if (Number.isFinite(dlcTotalRegular) && Number.isFinite(dlcTotalFinal) && dlcTotalRegular === dlcTotalFinal) {
                    this.#pushItem(items, "info", 25, `현재 진행 중인 할인에서 일부 DLC는 제외되었을 수 있으니 개별 가격을 확인해 보세요.`, "dlc:no_discount");
                }
            }
        }
    }

    #analyzeAchievements(ctx, items) {
        const { kind, steamItem } = ctx;
        if (kind === "app") {
            const ac = steamItem?.achievement_count;
            if (typeof ac === "number") {
                if (ac > 0) {
                    this.#pushItem(items, "info", 32, `총 ${this.#strong(ac.toLocaleString() + "개")}의 도전과제를 지원하여 다양한 수집 요소와 목표를 제공합니다.`, "meta:achievements");
                } else {
                    this.#pushItem(items, "info", 24, `현재 이 게임은 Steam 도전과제를 지원하지 않는 것으로 확인됩니다.`, "meta:achievements_none");
                }
            }
        }
    }

    #analyzeExpiry(ctx, items) {
        const { deal } = ctx;
        const expiry = deal?.current?.expiry_at;
        if (expiry) {
            const info = this.#formatKoreanUntilWithDaysLeft(expiry);
            if (info?.untilText && Number.isFinite(info.daysLeft)) {
                const { untilText, daysLeft } = info;
                if (daysLeft <= 0) {
                    this.#pushItem(items, "caution", 70, `현재 진행 중인 할인이 ${this.#strong("오늘(" + untilText + ")")} 종료될 예정입니다.`, "expiry:today");
                } else if (daysLeft === 1) {
                    this.#pushItem(items, "caution", 60, `할인 종료까지 ${this.#strong("단 1일")} 남았습니다. (${untilText} 종료)`, "expiry:1d");
                } else if (daysLeft <= 2) {
                    this.#pushItem(items, "info", 40, `할인 종료 시점이 약 ${this.#strong(daysLeft + "일")} 앞으로 다가왔습니다. (${untilText} 종료)`, "expiry:soon");
                }
            }
        }
    }

    #renderNarrative(items, ctx) {
        const groups = { consider: [], info: [], caution: [] };
        for (const it of items) {
            groups[it.category].push(it);
        }

        for (const k of Object.keys(groups)) {
            groups[k].sort((a, b) => b.weight - a.weight);
            const max = k === "info" ? 5 : 4;
            groups[k] = groups[k].slice(0, max);
        }

        const renderGroup = (title, icon, list) => {
            if (!list.length) return "";
            const li = list.map((x) => `<li>${x.text}</li>`).join("");
            return `
        <div>
          <p class="text-sm font-semibold text-white/85">${icon} ${title}</p>
          <ul class="mt-2 list-disc pl-5 text-sm text-white/70 space-y-1">${li}</ul>
        </div>`;
        };

        const conclusion = this.#buildConclusion(items, ctx);

        return [
            renderGroup("고려해볼 만한 요소", "✔", groups.consider),
            renderGroup("참고할 정보", "ℹ", groups.info),
            renderGroup("신중히 볼 요소", "⚠", groups.caution),
            conclusion
                ? `<div><p class="text-sm font-semibold text-white/85">총평</p><p class="mt-2 text-sm text-white/70 leading-relaxed">${conclusion}</p></div>`
                : "",
        ].filter(Boolean).join("");
    }

    #buildConclusion(items, ctx) {
        const has = (k) => items.some((x) => x.key === k);
        const { curDp, hasRealDiscountHistory, allTimeLowEqualsList } = ctx;

        // 시그널 정리
        const langNoKo = has("lang:no_ko");
        const reviewsBad = has("reviews:very_negative") || has("reviews:negative");
        const poGap = has("po:gap");
        const dlcHigh = has("dlc:cost_high");
        const expirySoon = has("expiry:today") || has("expiry:1d") || has("expiry:soon");

        const atlSignals = ["price:atl_now", "price:atl_same", "price:atl_near"];
        const isAtl = atlSignals.some(s => has(s));
        const isFarAtl = has("price:atl_far");

        const dpVeryBig = has("price:dp_75_up");
        const dpBig = has("price:dp_over_50") || has("price:dp_50");
        const dpMeaningful = has("price:dp_under_50_over_30");
        const dpLight = has("price:dp_30_down") || has("price:dp_10_down");

        const addSuffix = (s) => `${s} ${this.#strong("플레이 시점과 개인의 우선순위")}에 따라 판단은 달라질 수 있습니다.`;
        const wrap = (s) => s.replace(/\s+/g, " ").trim();

        let conclusion = "";

        // 1순위: 언어 및 리뷰 등 중대한 리스크
        if (langNoKo && reviewsBad) {
            conclusion = addSuffix(`현재 가격 조건과 별개로, ${this.#strong("한국어 미지원")} 및 ${this.#strong("부정적인 사용자 평가")}를 동시에 고려해야 합니다. 신중한 접근이 필요해 보입니다.`);
        } else if (reviewsBad) {
            conclusion = addSuffix(`사용자 평가가 좋지 않은 상태이므로, 가격 혜택보다는 게임 자체의 완성도나 본인의 취향을 다시 한번 점검해 보시는 것을 추천합니다.`);
        } else if (langNoKo) {
            conclusion = addSuffix(`공식 한국어를 지원하지 않아 플레이에 언어 장벽이 있을 수 있습니다. 유저 패치 여부나 본인의 언어 숙련도를 감안하여 구매를 고려해 보세요.`);
        } else if (poGap || dlcHigh) {
            conclusion = addSuffix(`에디션 간 가격 차이나 DLC 비중이 큰 편입니다. 필요한 구성만 포함된 옵션을 선택하여 불필요한 지출을 줄이는 것이 좋습니다.`);
        }

        // 2순위: 가격적 이점
        if (!conclusion) {
            if (isAtl) {
                conclusion = addSuffix(`현재 가격은 ${this.#strong("역대 최저가 수준")}으로, 가격적인 측면에서 매우 유리한 구매 시점으로 판단됩니다.`);
            } else if (isFarAtl) {
                conclusion = addSuffix(`현재 할인 중이지만 과거 최저가와는 다소 차이가 있습니다. 급한 플레이가 아니라면 다음 할인 기회를 기다려보는 것도 방법입니다.`);
            } else if (dpVeryBig || dpBig || dpMeaningful) {
                conclusion = addSuffix(`정가 대비 ${this.#strong("의미 있는 수준의 할인율")}이 적용되어 있어, 평소 관심 있던 게임이라면 충분히 매력적인 가격대입니다.`);
            } else if (curDp > 0 && dpLight) {
                conclusion = addSuffix(`할인이 진행 중이나 할인 폭은 다소 가벼운 편입니다. 플레이 시점의 시급성에 따라 판단이 달라질 수 있는 구간입니다.`);
            } else if (curDp === 0) {
                if (hasRealDiscountHistory) {
                    conclusion = addSuffix(`현재 정가 판매 중이나 과거 할인 이력이 뚜렷합니다. 시간적 여유가 있다면 다음 할인 기간을 기다려 보는 것을 추천합니다.`);
                } else if (allTimeLowEqualsList) {
                    conclusion = addSuffix(`과거에도 할인 기록이 없는 상품입니다. 정가 구매가 일반적인 선택일 수 있으며, 플레이 계획에 맞춰 결정해 보세요.`);
                } else {
                    conclusion = addSuffix(`현재 정가 상태이며 가격 변동 이력이 제한적입니다. 본인의 예산과 플레이 계획을 우선적으로 고려하여 판단해 보세요.`);
                }
            }
        }

        if (conclusion && expirySoon) {
            conclusion = wrap(`${conclusion} 또한 ${this.#strong("할인 종료가 임박")}했으므로, 구매를 결정하셨다면 종료 일시를 꼭 확인하시기 바랍니다.`);
        }

        return wrap(conclusion);
    }
}
