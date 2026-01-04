// NarrativeRenderer v2 (관점 기반 요약 구조) — API 스키마 반영 최종본
// - steam.app.price, steam.app.genres, steam.app.purchase_options, steam.app.dlc, steam.reviews, steam.korean.community_patch
// - deal.current / deal.historical_low / deal.current.expiry_at
// 목표: 판단을 대신하지 않으면서 가독성과 분기 다양성을 극대화

import { escapeHtml, humanizeAgo } from "../core/utils.js";

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

            const tz = "Asia/Seoul";

            const parts = new Intl.DateTimeFormat("ko-KR", {
                timeZone: tz,
                year: "numeric",
                month: "numeric",
                day: "numeric",
            }).formatToParts(d);

            const y = parts.find((p) => p.type === "year")?.value;
            const m = parts.find((p) => p.type === "month")?.value;
            const day = parts.find((p) => p.type === "day")?.value;
            if (!y || !m || !day) return null;

            const untilText = `${y}년 ${Number(m)}월 ${Number(day)}일`;

            const now = new Date();
            const nowParts = new Intl.DateTimeFormat("en-CA", {
                timeZone: tz,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            }).formatToParts(now);

            const ny = nowParts.find((p) => p.type === "year")?.value;
            const nm = nowParts.find((p) => p.type === "month")?.value;
            const nd = nowParts.find((p) => p.type === "day")?.value;
            if (!ny || !nm || !nd) return { untilText, daysLeft: null };

            const todayUtc = Date.UTC(Number(ny), Number(nm) - 1, Number(nd));
            const untilUtc = Date.UTC(Number(y), Number(m) - 1, Number(day));
            const daysLeft = Math.ceil((untilUtc - todayUtc) / 86400000);

            return { untilText, daysLeft };
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
     * - steamItem: data.steam.app
     * - reviews: data.steam.reviews
     * - deal: data.deal
     */
    build({ kind, isUnavailable, isComingSoon, isFree, deal, steamItem, reviews, hasCommunityPatch }) {
        const strong = (s) => `<strong>${escapeHtml(String(s ?? ""))}</strong>`;

        if (isUnavailable) {
            return `현재 Steam에서 ${strong("구매할 수 없는 상태")}입니다. 판매 종료 또는 지역 제한일 수 있으니 Steam 상점에서 상태를 확인해 주세요.`;
        }

        if (isComingSoon) {
            return `현재 ${strong("출시 예정")}인 상품입니다. 출시 전에는 가격/구매 조건이 변동될 수 있으니 Steam 상점에서 출시 일정과 구매 가능 여부를 확인해 주세요.`;
        }

        if (isFree) {
            return `현재 ${strong("무료로 플레이")}할 수 있는 상품입니다. 구성과 조건은 Steam 상점에서 확인해 주세요.`;
        }

        /** @type {{category: 'consider'|'info'|'caution', weight:number, text:string, key?:string}[]} */
        const items = [];
        const seen = new Set();
        const push = (category, weight, text, key) => {
            const t = String(text || "").trim();
            if (!t) return;
            const k = key || `${category}:${t}`;
            if (seen.has(k)) return;
            seen.add(k);
            items.push({ category, weight, text: t, key: k });
        };

        // ---------------- 데이터 취합(스키마 우선) ----------------
        const price = steamItem?.price || {};
        const steamRegular = Number(price?.regular);
        const steamFinal = Number(price?.final);
        const steamDp = Number(price?.discount_percent);

        const curDp = Number.isFinite(Number(deal?.current?.discount_percent))
            ? Number(deal.current.discount_percent)
            : Number.isFinite(steamDp)
                ? steamDp
                : 0;

        const currentAmount = Number.isFinite(Number(deal?.current?.amount))
            ? Number(deal.current.amount)
            : Number.isFinite(steamFinal)
                ? steamFinal
                : null;

        const listPrice = Number.isFinite(Number(deal?.current?.regular_price))
            ? Number(deal.current.regular_price)
            : Number.isFinite(steamRegular)
                ? steamRegular
                : null;

        const lowInfo = deal?.historical_low;
        const allTimeLow = Number.isFinite(Number(lowInfo?.amount)) ? Number(lowInfo.amount) : null;
        const lowWasNow = !!lowInfo?.is_lowest_now;
        const lowDp = Number.isFinite(Number(lowInfo?.discount_percent)) ? Number(lowInfo.discount_percent) : null;

        // ATL 근접도(할인율 기준)
        let lowCloseness = null;
        if (!lowWasNow && lowDp != null) {
            const diff = Math.abs(lowDp - curDp);
            if (diff === 0) lowCloseness = "same";
            else if (diff <= 5) lowCloseness = "near";
            else if (diff >= 15) lowCloseness = "far";
        }

        const hasRealDiscountHistory =
            listPrice != null &&
            allTimeLow != null &&
            listPrice > 0 &&
            allTimeLow > 0 &&
            allTimeLow < listPrice;

        const allTimeLowEqualsList =
            listPrice != null &&
            allTimeLow != null &&
            listPrice > 0 &&
            allTimeLow > 0 &&
            allTimeLow === listPrice;

        // ---------------- (1) 가격/할인/이력 ----------------
        const meaningfulDiscountThreshold = 20;
        const comfortableDiscountThreshold = 30;

        const isMeaningfulDiscount = curDp >= meaningfulDiscountThreshold;

        if (curDp > 0) {
            // 할인 중
            if (lowWasNow) {
                push("consider", 95, `현재 할인은 ${strong("역대 최저가")}에 해당합니다.`, "price:atl_now");
            } else if (lowCloseness === "same") {
                push("consider", 85, `현재 할인 조건은 과거 최저가와 ${strong("같은 수준")}입니다.`, "price:atl_same");
            } else if (lowCloseness === "near") {
                push("consider", 80, `현재 할인 조건은 과거 최저가와 ${strong("큰 차이 없는")} 편입니다.`, "price:atl_near");
            } else if (lowCloseness === "far") {
                push("info", 60, `현재도 할인 중이지만, 과거 최저가 대비 ${strong("차이가 있는")} 편입니다.`, "price:atl_far");
            } else if (allTimeLow != null) {
                const ago = humanizeAgo(lowInfo?.last_seen_at);
                push(
                    "info",
                    65,
                    `현재는 할인 중이며, 과거 최저가 이력${ago ? `(${escapeHtml(ago)})` : ""}이 확인됩니다.`,
                    "price:atl_exists"
                );
            } else {
                push(
                    "info",
                    55,
                    `현재는 할인 중이지만, 가격 이력이 충분하지 않아 과거 기준 비교는 제한될 수 있습니다.`,
                    "price:history_limited"
                );
            }

            // 할인폭: 정보성 안내(판단 아님) — 세분화
            // 표시/판단 기준을 curDp로 통일(steamDp는 NaN/불일치 가능)
            const dpText = Number.isFinite(curDp) ? `${curDp}%` : null;

            if (curDp >= 75) {
                push(
                    "consider",
                    75,
                    `할인율이 ${strong(dpText)}로 ${strong("매우 큰 편")}입니다.`,
                    "price:dp_75_up"
                );
            } else if (curDp > 50) {
                push(
                    "consider",
                    70,
                    `할인율이 ${strong(dpText)}로 ${strong("체감될 정도로 큰 편")}입니다.`,
                    "price:dp_over_50"
                );
            } else if (curDp === 50) {
                push(
                    "consider",
                    65,
                    `할인율이 ${strong("50%")}로, ${strong("정가 대비 절반 가격")}입니다.`,
                    "price:dp_50"
                );
            } else if (curDp > 30) {
                push(
                    "consider",
                    60,
                    `할인율이 ${strong(dpText)}로 ${strong("의미 있는 할인")}으로 볼 수 있습니다.`,
                    "price:dp_under_50_over_30"
                );
            } else if (curDp > 10) {
                push(
                    "info",
                    50,
                    `현재 ${strong("할인 중")}이지만, 할인 폭은 ${strong(dpText)}로 비교적 ${strong("가벼운 편")}입니다.`,
                    "price:dp_30_down"
                );
            } else if (curDp > 0) {
                push(
                    "info",
                    45,
                    `할인율이 ${strong(dpText)}로 ${strong("크진 않은 편")}입니다.`,
                    "price:dp_10_down"
                );
            }

            // 정가가 높은 편이면 체감 안내
            if (listPrice != null && currentAmount != null) {
                if (listPrice >= 80000 && currentAmount >= 50000) {
                    push(
                        "info",
                        35,
                        `정가가 높은 편이라 할인 적용 후에도 체감 가격이 높게 느껴질 수 있습니다.`,
                        "price:high_list"
                    );
                }

                // 저가(인디) 게임 안내 추가
                if (listPrice > 0 && listPrice <= 20000) {
                    push(
                        "info",
                        28,
                        `정가가 비교적 낮은 편이라, 할인율뿐 아니라 실제로 얼마나 할인하는지 함께 확인해보세요.`,
                        "price:low_list"
                    );
                }
            }
        } else {
            // 정가
            if (allTimeLowEqualsList) {
                push("info", 65, `현재까지 정가로만 판매된 상품입니다. 과거에도 정가보다 낮은 기록은 없습니다.`, "price:no_sale_ever");
            } else if (hasRealDiscountHistory) {
                push("info", 60, `현재는 ${strong("할인 없이 정가")}로 판매 중이며, 과거 할인 판매 이력이 있습니다.`, "price:now_full_past_sale");
            } else if (allTimeLow != null) {
                push("info", 55, `현재는 정가로 판매 중이며, 가격 이력은 존재하나 할인 판매 기록은 확정하기 어렵습니다.`, "price:history_unclear");
            } else {
                push("info", 50, `현재는 ${strong("할인 없이 정가")}로 판매 중입니다.`, "price:now_full");
            }

            push("caution", 45, `다음 할인 시점은 확정하기 어렵기 때문에, 플레이 계획에 따라 판단이 달라질 수 있습니다.`, "price:wait_uncertain");
        }

        // ---------------- (2) 출시 시점 ----------------
        const releaseDateRaw = steamItem?.release_date ?? null;
        const releasedAt = this.#parseReleaseDate(releaseDateRaw);
        if (releasedAt) {
            const diffDays = (Date.now() - releasedAt.getTime()) / 86400000;
            if (diffDays >= 0 && diffDays <= 90) {
                const days = Math.floor(diffDays);
                push(
                    "info",
                    40,
                    curDp > 0
                        ? `출시 후 ${days}일 정도 지난 시점에 진행 중인 할인입니다.`
                        : `출시 후 ${days}일 정도 지난 작품으로, 현재는 정가로 판매 중입니다.`,
                    "release:recent"
                );
            } else if (diffDays >= 365 * 2) {
                push(
                    "info",
                    30,
                    curDp > 0
                        ? `출시 후 시간이 충분히 지난 작품에 적용된 할인입니다.`
                        : `출시된 지 오래된 작품으로, 현재는 정가로 판매 중입니다.`,
                    "release:old"
                );
            }
        }

        // ---------------- (3) 언어 / 한글패치 ----------------
        if (kind === "app") {
            const koLevel = Number(steamItem?.supported_languages ?? 0);
            if (koLevel === 2) {
                push("consider", 85, `공식 ${strong("한국어(음성 포함)")}을 지원합니다.`, "lang:ko_voice");
            } else if (koLevel === 1) {
                push("consider", 75, `공식 ${strong("한국어")}를 지원합니다.`, "lang:ko_sub");
            } else if (hasCommunityPatch) {
                push("info", 65, `공식 한국어는 없지만 ${strong("유저 한글패치")}가 존재합니다.`, "lang:community_patch");
            } else {
                push("caution", 85, `공식 ${strong("한국어 미지원")}으로 인해 언어 부담이 생길 수 있습니다.`, "lang:no_ko");
            }
        } else {
            push(
                "info",
                30,
                `묶음 상품은 구성 게임별로 ${strong("한국어 지원 여부")}가 다를 수 있어, 각 게임의 Steam 상점 페이지에서 언어 정보를 확인해 주세요.`,
                "lang:bundle_unknown"
            );
        }

        // ---------------- (4) 장르 ----------------
        const genres = Array.isArray(steamItem?.genres) ? steamItem.genres.filter(Boolean) : [];
        if (genres.length > 0) {
            const gText = escapeHtml(genres.slice(0, 4).join("·"));
            push("info", 70, `장르는 ${strong(gText)}입니다.`, "meta:genres");

            // 취향 편차 힌트(억지 방지)
            const hasRoguelike = genres.some((g) => /로그|rogue/i.test(String(g)));
            const hasPvp = genres.some((g) => /pvp|대전|경쟁/i.test(String(g)));
            if (hasRoguelike || hasPvp) {
                push("info", 25, `장르 특성상 취향에 따른 체감 차이가 있을 수 있어, 플레이 스타일을 함께 고려해 보세요.`, "meta:genre_taste");
            }
        }

        // ---------------- (5) 리뷰 ----------------
        const total = Number(reviews?.total || 0);
        const positive = Number(reviews?.positive || 0);
        const negative = Number(reviews?.negative || 0);
        const summary = String(reviews?.summary || "").trim();
        const tone = this.#mapReviewTone(summary);

        const number_format = (n) => Number(n).toLocaleString("ko-KR");

// 라벨 원문 유지
        const labelText = summary ? escapeHtml(summary) : "평가 정보 없음";

        if (kind === "app" && total > 0) {
            // 1) 평가(라벨) — 긍정적 이상이면 consider로 승격
            const isGoodReview = tone === "positive" || tone === "very_positive";

            const reviewCategory = isGoodReview ? "consider" : "info";
            const reviewWeight =
                tone === "very_positive" ? 80 :
                    tone === "positive" ? 72 :
                        55;

            push(
                reviewCategory,
                reviewWeight,
                `현재 평가는 ${strong(`"${labelText}"`)}입니다.`,
                "reviews:label"
            );

            // 2) 수치 정보 — 긍정 비율(%)을 항상 같이 보여주기
            const posRate = total > 0 ? (positive / total) * 100 : null;
            const posRateText = posRate != null ? ` (${posRate.toFixed(1)}%)` : "";

            // positive/negative가 둘 다 0일 수도 있으니 방어
            if ((positive + negative) > 0) {
                push(
                    "info",
                    50,
                    `리뷰 수는 ${strong(number_format(total) + "개")}이며, 그중 ${strong("긍정")} 리뷰가 ${strong(number_format(positive) + "개" + posRateText)}입니다.`,
                    "reviews:count_with_positive_rate"
                );
            } else {
                push(
                    "info",
                    50,
                    `리뷰 수는 ${strong(number_format(total) + "개")}입니다.`,
                    "reviews:count_only"
                );
            }

            // 3) 라벨이 부정 쪽일 때만 caution
            if (tone === "very_negative") {
                push(
                    "caution",
                    90,
                    `평가가 낮게 형성된 상태이므로, 구매 전 상세 리뷰를 함께 확인해 보세요.`,
                    "reviews:very_negative"
                );
            } else if (tone === "negative") {
                push(
                    "caution",
                    75,
                    `평가가 낮은 편이므로, 구매 전 상세 리뷰를 함께 확인해 보세요.`,
                    "reviews:negative"
                );
            }
        } else if (kind === "app" && total === 0) {
            push("info", 35, `아직 집계된 리뷰가 없습니다.`, "reviews:none");
        }

        // ---------------- (6) 구매 옵션 ----------------
        const po = steamItem?.purchase_options;
        const poItems = Array.isArray(po?.items) ? po.items : [];
        if (poItems.length > 1) {
            push("info", 45, `구매 옵션이 ${strong(`${poItems.length}개`)} 존재합니다. 에디션별 구성/가격 차이를 확인해 보세요.`, "po:count");

            // 에디션 가격 편차
            const finals = poItems
                .map((x) => Number(x?.final_price))
                .filter((n) => Number.isFinite(n) && n > 0)
                .sort((a, b) => a - b);

            if (finals.length >= 2) {
                const min = finals[0];
                const max = finals[finals.length - 1];
                if (min > 0 && max / min >= 1.6) {
                    push(
                        "caution",
                        55,
                        `에디션 간 가격 차이가 큰 편이라, 본편만 필요한지(또는 추가 구성물이 필요한지)를 먼저 정리해 두는 것이 좋습니다.`,
                        "po:gap"
                    );
                }
            }

            // 에디션별 할인율이 다르면 참고
            const dps = Array.from(new Set(poItems.map((x) => Number(x?.discount_percent)).filter((n) => Number.isFinite(n))));
            if (dps.length >= 2) {
                push("info", 35, `에디션별 할인율이 서로 다를 수 있습니다. 각 옵션의 할인율을 함께 확인해 보세요.`, "po:dp_varies");
            }
        } else {
            const sig = steamItem?.purchasable_signals;
            const hasSteamPrice = !!sig?.has_steam_price;
            if (!hasSteamPrice) {
                push("caution", 70, `Steam 가격 정보가 확인되지 않아 구매 가능 여부를 Steam 상점에서 다시 확인해 주세요.`, "po:no_price");
            }
        }

        // ---------------- (7) DLC ----------------
        const dlc = steamItem?.dlc;
        const dlcCount = Number(dlc?.count || 0);
        const dlcPriced = Number(dlc?.priced_count || 0);
        const dlcTotalRegular = Number(dlc?.total_regular);
        const dlcTotalFinal = Number(dlc?.total_final);

        if (dlcCount > 0) {
            push("info", 30, `DLC가 ${strong(`${dlcCount}개`)} 존재합니다.`, "dlc:count");

            if (dlcPriced > 0) {
                if (Number.isFinite(dlcTotalFinal) && Number.isFinite(listPrice) && listPrice > 0) {
                    const ratio = dlcTotalFinal / listPrice;
                    if (ratio >= 1.0) {
                        push(
                            "caution",
                            60,
                            `유료 DLC 총액이 본편 정가와 비슷하거나 더 큰 편입니다. 장기 플레이를 고려하신다면, 포함 구성에 따른 전체 비용을 함께 확인해 보세요.`,
                            "dlc:cost_high"
                        );
                    } else if (ratio >= 0.5) {
                        push(
                            "info",
                            35,
                            `유료 DLC 총액이 본편 정가의 절반 이상인 편입니다. 필요한 DLC만 선택해도 충분한지 확인해 보세요.`,
                            "dlc:cost_mid"
                        );
                    }
                }

                if (Number.isFinite(dlcTotalRegular) && Number.isFinite(dlcTotalFinal) && dlcTotalRegular === dlcTotalFinal) {
                    push("info", 25, `현재 DLC는 할인 적용이 없는 항목이 포함될 수 있습니다.`, "dlc:no_discount");
                }
            }
        }

        // ---------------- (7.5) 도전과제(참고 정보) ----------------
        // data.steam.app.achievement_count 기준 (총 도전과제 수)
        if (kind === "app") {
            const ac = steamItem?.achievement_count;

            if (typeof ac === "number") {
                if (ac > 0) {
                    push("info", 32, `도전과제가 ${strong(`${number_format(ac)}개`)} 존재합니다.`, "meta:achievements");
                } else {
                    // 0은 사실상 "미지원" 케이스로 처리
                    push("info", 24, `도전과제를 지원하지 않습니다.`, "meta:achievements_none");
                }
            } else {
                // 값이 없으면(미지원/미제공)도 “참고 정보”로는 무해하니 단정 없이 안내
                push("info", 22, `도전과제 정보가 확인되지 않습니다.`, "meta:achievements_unknown");
            }
        }

        // ---------------- (8) 할인 종료 임박 ----------------
        const expiry = deal?.current?.expiry_at;
        if (expiry) {
            const info = this.#formatKoreanUntilWithDaysLeft(expiry);
            if (info?.untilText && Number.isFinite(info.daysLeft)) {
                const { untilText, daysLeft } = info;
                if (daysLeft <= 0) {
                    push("caution", 70, `할인은 ${strong(untilText)}에 ${strong("종료")}됩니다.`, "expiry:today");
                } else if (daysLeft === 1) {
                    push("caution", 60, `할인은 ${strong(untilText)}까지 ${strong("1일")} 남아있습니다.`, "expiry:1d");
                } else if (daysLeft <= 2) {
                    push("info", 40, `할인은 ${strong(untilText)}까지 ${strong(`${daysLeft}일`)} 남아있습니다.`, "expiry:soon");
                }
            }
        }

        // ---------------- 그룹화 & 렌더 ----------------
        const groups = { consider: [], info: [], caution: [] };
        for (const it of items) groups[it.category].push(it);

        for (const k of Object.keys(groups)) {
            groups[k].sort((a, b) => b.weight - a.weight);
            // 피로도 방지용 상한(원하면 조절)
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

        // ---------------- 총평(재조합, 단정 방지) ----------------
        const topInfo = groups.info[0];

        // 특정 시그널 키 존재 여부로 총평을 세분화
        const has = (k) => items.some((x) => x.key === k);

        // 가격 관련 시그널
        const priceATL = has("price:atl_now") || has("price:atl_same") || has("price:atl_near");
        const priceFull = has("price:now_full") || has("price:now_full_past_sale") || has("price:no_sale_ever");
        const priceWaitUncertain = has("price:wait_uncertain");

        // 할인율 등급 시그널(이번에 추가한 키)
        const dpVeryBig = has("price:dp_75_up");
        const dpBig = has("price:dp_over_50") || has("price:dp_50");
        const dpMeaningful = has("price:dp_under_50_over_30");
        const dpLight = has("price:dp_30_down") || has("price:dp_10_down");

        // 언어/리뷰/구성 리스크
        const langNoKo = has("lang:no_ko");
        const reviewsBad = has("reviews:very_negative") || has("reviews:negative");
        const poGap = has("po:gap");
        const dlcHigh = has("dlc:cost_high");

        // 임박(정보성)
        const expirySoon = has("expiry:today") || has("expiry:1d") || has("expiry:soon");

        // 총평 문구 조합용
        const wrap = (s) => s.replace(/\s+/g, " ").trim();
        const addSuffix = (s) => `${s} ${strong("플레이 시점과 비교 기준에 따라")} 체감은 달라질 수 있습니다.`;

        // 1) 리스크(언어/리뷰/구성)가 강한 경우를 우선 처리
        let conclusion = "";
        if (langNoKo && reviewsBad) {
            conclusion = addSuffix(
                `가격 조건과 별개로, ${strong("한국어 지원")}과 ${strong("평가")} 측면에서 확인할 지점이 있습니다. 구매 전 상점 페이지와 상세 리뷰를 함께 살펴보는 편이 안전합니다.`
            );
        } else if (reviewsBad) {
            conclusion = addSuffix(
                `${strong("평가")}가 낮게 형성된 상태라, 가격 조건과 함께 상세 리뷰를 확인해 보는 쪽이 좋습니다.`
            );
        } else if (langNoKo) {
            conclusion = addSuffix(
                `${strong("공식 한국어 미지원")}으로 플레이 경험이 달라질 수 있어, 언어 부담을 먼저 감안해 보세요.`
            );
        } else if (poGap || dlcHigh) {
            conclusion = addSuffix(
                `구성(에디션/DLC)에 따라 총 비용과 체감 가치가 달라질 수 있습니다. 필요한 구성만 골라서 비교해 보세요.`
            );
        }

        const priceAtlNow = has("price:atl_now");
        const priceAtlSame = has("price:atl_same");
        const priceAtlNear = has("price:atl_near");
        const priceAtlFar  = has("price:atl_far");

        // 2) 위 리스크 총평이 없으면, 가격 축으로 총평 세분화
        if (!conclusion) {
            if (priceAtlNow) {
                conclusion = addSuffix(
                    `현재 가격은 ${strong("역대 최저가")}로 확인됩니다.`
                );
            } else if (priceAtlSame) {
                conclusion = addSuffix(
                    `현재 조건은 과거 최저가와 ${strong("같은 수준")}입니다.`
                );
            } else if (priceAtlNear) {
                conclusion = addSuffix(
                    `현재 조건은 과거 최저가와 ${strong("큰 차이 없는")} 편입니다.`
                );
            } else if (priceAtlFar) {
                conclusion = addSuffix(
                    `현재도 할인 중이지만, 과거 최저가 대비 ${strong("차이가 있는")} 편입니다.`
                );
            } else if (dpVeryBig || dpBig || dpMeaningful) {
                conclusion = addSuffix(
                    `가격 측면에서 참고할 만한 할인 폭이 확인됩니다.`
                );
            } else if (curDp > 0 && dpLight) {
                conclusion = addSuffix(
                    `현재 할인 중이지만 할인 폭은 가벼운 편이라, 플레이 시점에 따라 체감이 달라질 수 있습니다.`
                );
            } else if (priceFull && hasRealDiscountHistory) {
                conclusion = addSuffix(
                    `현재는 정가지만 과거 할인 이력이 있습니다. 당장 플레이 계획이 없다면, 가격 이력과 다음 변동을 함께 지켜보는 선택지도 있어요.`
                );
            } else if (priceFull && !hasRealDiscountHistory) {
                conclusion = addSuffix(
                    `현재는 정가이며, 할인/가격 이력이 제한적이거나 확정하기 어렵습니다. 비교 기준을 정해두고(플레이 시점/예산) 확인해 보세요.`
                );
            } else if (priceWaitUncertain) {
                conclusion = addSuffix(
                    `다음 할인 시점은 확정하기 어려워, 지금 필요한지(바로 플레이할지) 여부가 기준이 될 수 있습니다.`
                );
            } else if (topInfo) {
                conclusion = addSuffix(
                    `${topInfo.text} 현재 정보만으로 한쪽 결론으로 기울이기보다는, 본인 기준에 맞춰 비교해 보세요.`
                );
            }
        }

        // 3) 임박 정보는 총평 뒤에 짧게 덧붙이기(유도 금지)
        if (conclusion && expirySoon) {
            conclusion = wrap(`${conclusion} 또한 ${strong("할인 종료일")}이 가까울 수 있으니 종료 일자도 함께 확인해 주세요.`);
        }

        conclusion = wrap(conclusion);


        if (conclusion) conclusion = conclusion.replace(/\s+/g, " ").trim();

        return [
            renderGroup("고려해볼 만한 요소", "✔", groups.consider),
            renderGroup("참고할 정보", "ℹ", groups.info),
            renderGroup("신중히 볼 요소", "⚠", groups.caution),
            conclusion
                ? `<div><p class="text-sm font-semibold text-white/85">총평</p><p class="mt-2 text-sm text-white/70 leading-relaxed">${conclusion}</p></div>`
                : "",
        ].filter(Boolean).join("");
    }
}
