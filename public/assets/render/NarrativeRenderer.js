import { escapeHtml, humanizeAgo, sanitizeNarrativeHtml } from "../core/utils.js";

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
            el.className = "mt-4 hidden rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6";
            el.innerHTML = `
        <p class="text-sm font-semibold text-white/85">이번 딜 요약</p>
        <p id="dealNarrativeText"
           class="mt-2 text-sm leading-relaxed text-white/70
                  [&_strong]:font-semibold [&_strong]:underline [&_strong]:underline-offset-2
                  [&_strong]:decoration-white/40"></p>
        <p class="mt-3 text-[11px] leading-relaxed text-amber-200/80">
          ※ 일부 정보는 캐시된 데이터일 수 있습니다. 최종 구매 전 Steam 상점 정보를 함께 확인해 주세요.
        </p>
      `;
            const cards = document.querySelector("#resultCards");
            if (cards?.parentNode === this.resultAreaEl) this.resultAreaEl.insertBefore(el, cards);
            else this.resultAreaEl.appendChild(el);
        }

        this.narrativeEl = el;
        return el;
    }

    /**
     * ISO 날짜 문자열 → "YYYY년 M월 D일까지 / N일 남음"
     * (Asia/Seoul 기준)
     */
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

            const y = parts.find(p => p.type === "year")?.value;
            const m = parts.find(p => p.type === "month")?.value;
            const day = parts.find(p => p.type === "day")?.value;
            if (!y || !m || !day) return null;

            const untilText = `${y}년 ${Number(m)}월 ${Number(day)}일까지`;

            // 오늘(Seoul 기준) 자정
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
            if (!ny || !nm || !nd) return { untilText, daysLeft: null };

            const todayUtc = Date.UTC(Number(ny), Number(nm) - 1, Number(nd));
            const untilUtc = Date.UTC(Number(y), Number(m) - 1, Number(day));

            const daysLeft = Math.ceil((untilUtc - todayUtc) / 86400000);

            return { untilText, daysLeft };
        } catch {
            return null;
        }
    }

    set(text) {
        const el = this.#ensure();
        const p = el.querySelector("#dealNarrativeText");
        if (!p) return;

        if (!text) {
            el.classList.add("hidden");
            p.textContent = "";
            return;
        }

        p.innerHTML = sanitizeNarrativeHtml(text);
        el.classList.remove("hidden");
    }

    build({ kind, isUnavailable, isFree, deal, steamItem, reviews, hasCommunityPatch }) {
        const strong = (s) => `<strong>${escapeHtml(String(s ?? ""))}</strong>`;
        const pctp = (n) => `${Number(n).toLocaleString()}%p`;

        if (isUnavailable) {
            return `현재 Steam에서 ${strong("구매할 수 없는 상태")}입니다. 스토어 판매 종료, 지역 제한 등의 사유일 수 있으니 Steam 상점에서 상태를 확인해 주세요.`;
        }
        if (isFree) {
            return `현재 ${strong("무료로 플레이")}할 수 있는 상품입니다. 콘텐츠 구성이나 조건은 Steam 상점에서 확인할 수 있습니다.`;
        }

        const parts = [];
        const curDp = Number(deal?.current?.discount_percent || 0);
        const lowInfo = deal?.historical_low;

        if (curDp > 0) parts.push(`현재 ${strong(`${curDp}% 할인`)} 중입니다.`);
        else parts.push(`현재 ${strong("할인 없이 정가")}로 판매 중입니다.`);

        let diffPP = null;
        let diffAbs = null;
        let lowWasNow = false;
        let lowDp = null;
        let lowAgo = null;

        if (lowInfo?.amount != null) {
            lowWasNow = !!lowInfo.is_lowest_now;
            lowDp = Number.isFinite(Number(lowInfo.discount_percent)) ? Number(lowInfo.discount_percent) : null;
            lowAgo = humanizeAgo(lowInfo.last_seen_at);

            if (lowWasNow) {
                parts.push(`지금 가격은 ${strong("역대 최저가")}에 해당합니다.`);
            } else if (lowDp != null) {
                const when = lowAgo ? `(${lowAgo}) ` : "";
                parts.push(`과거 ${when}${strong(`${lowDp}% 최저가 할인율`)}이 확인되었습니다.`);
                diffPP = lowDp - curDp;
                if (Number.isFinite(diffPP)) {
                    diffAbs = Math.abs(diffPP);
                    if (diffPP === 0) parts.push(`현재 할인율은 ${strong("최저가 당시와 동일")}합니다.`);
                    else parts.push(`현재 할인율은 최저가 당시와 ${strong(pctp(diffAbs))} 차이가 있습니다.`);
                }
            } else {
                const when = lowAgo ? `(${lowAgo}) ` : "";
                parts.push(`과거 ${when}${strong("최저가 기록")}이 확인되었지만, 당시 할인율 정보는 충분히 확인되지 않았습니다.`);
            }
        } else {
            parts.push("과거 가격 이력이 충분히 확인되지 않아, 최저가 기준과의 직접적인 비교는 제한될 수 있습니다.");
        }

        // 한국어 지원
        if (kind === "app") {
            const koLevel = Number(steamItem?.supported_languages ?? 0);
            const koText = (() => {
                if (koLevel === 2) return `공식 ${strong("한국어")} 및 ${strong("한국어 음성")}을 지원합니다.`;
                if (koLevel === 1) return `공식 ${strong("한국어")}를 지원합니다.`;
                if (koLevel === 0 && hasCommunityPatch) return `공식 한국어는 지원하지 않지만, ${strong("유저 한글패치")} 정보가 확인됩니다.`;
                return `${strong("한국어 미지원")}입니다.`;
            })();
            parts.push(koText);
        }

        // 리뷰
        const total = Number(reviews?.total || 0);
        const positive = Number(reviews?.positive || 0);
        const summary = String(reviews?.summary || "");
        const ratioPct = total > 0 ? Math.round((positive / total) * 100) : null;

        if (kind === "app" && total > 0) {
            if (Number.isFinite(ratioPct)) {
                parts.push(`유저 평가는 ${strong(summary)}이며, 전체 ${strong(`${total.toLocaleString()}건`)} 중 긍정 비율은 약 ${strong(`${ratioPct}%`)}입니다.`);
            } else {
                parts.push(`유저 평가는 ${strong(summary)}이며, 전체 ${strong(`${total.toLocaleString()}건`)}의 리뷰가 집계되어 있습니다.`);
            }
        }

        // ✅ 딜 평가(판단 보조) 문구
        if (curDp > 0) {
            if (lowWasNow) {
                parts.push(`현재 할인 조건은 ${strong("구매를 고려해볼만한")} 수준입니다. 다만 플레이 계획과 선호에 따라 판단이 달라질 수 있습니다.`);
            } else if (diffAbs != null) {
                if (diffAbs === 0) {
                    parts.push(`현재 할인율은 최저가 당시와 동일해, ${strong("지금 필요 여부")}에 따라 판단이 달라질 수 있습니다.`);
                } else if (diffAbs <= 5) {
                    parts.push(`최저가 당시와 할인율 차이가 크지 않아, ${strong("구매를 고려해볼만한")} 편입니다. 다만 기다림의 가치도 함께 비교해 보세요.`);
                } else if (diffAbs >= 15) {
                    parts.push(`최저가 당시 대비 할인율 차이가 있어 ${strong("조금 더 고민이 필요")}할 수 있습니다. 당장 플레이할 계획이 있는지 함께 고려해 보세요.`);
                } else {
                    parts.push(`현재 조건은 과거 최저가와 비교해 ${strong("판단이 갈릴 수 있는")} 구간입니다. 사용자 성향에 따라 선택이 달라질 수 있습니다.`);
                }
            } else {
                parts.push(`현재 할인 조건은 사용자 성향과 플레이 계획에 따라 ${strong("판단이 달라질 수")} 있습니다.`);
            }
        } else {
            parts.push(`현재는 할인 없이 정가로 판매 중이라, ${strong("구매 시점은 사용자 판단")}에 따라 달라질 수 있습니다.`);
        }

        // 할인 종료 시점
        const expiry = deal?.current?.expiry_at;
        if (expiry) {
            const info = this.#formatKoreanUntilWithDaysLeft(expiry);
            if (info?.untilText) {
                const { untilText, daysLeft } = info;
                if (Number.isFinite(daysLeft)) {
                    if (daysLeft <= 0) parts.push(`할인은 ${strong(untilText)}이며, ${strong("오늘 종료")}됩니다.`);
                    else if (daysLeft === 1) parts.push(`할인은 ${strong(untilText)}이며, ${strong("1일")} 남아있습니다.`);
                    else parts.push(`할인은 ${strong(untilText)}이며, ${strong(`${daysLeft}일`)} 남아있습니다.`);
                } else {
                    parts.push(`할인은 ${strong(untilText)}까지 진행됩니다.`);
                }
            } else {
                parts.push(`할인은 ${strong("기간 한정")}으로 진행됩니다.`);
            }
        }

        return parts.join(" ");
    }
}
