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
            el.className =
                "mt-4 hidden rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6";
            el.innerHTML = `
        <p class="text-sm font-semibold text-white/85">이번 할인, 이렇게 볼 수 있어요</p>
        <p id="dealNarrativeText"
           class="mt-2 text-sm leading-relaxed text-white/70
                  [&_strong]:font-semibold [&_strong]:underline [&_strong]:underline-offset-2
                  [&_strong]:decoration-white/40"></p>
        <p class="mt-3 text-[11px] leading-relaxed text-amber-200/80">
          ※ 일부 정보는 캐시된 데이터일 수 있습니다. 최종 구매 전 Steam 상점 정보를 함께 확인해 주세요.<br>
          ※ 게임 가격에 대한 체감은 개인마다 다를 수 있으며, 할인율에 대한 평가는 정가를 기준으로 이루어집니다. 이로 인해 정가가 높은 작품의 경우, 할인율이 적용되더라도 체감 가격이 저렴하게 느껴지지 않을 수 있습니다.
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
     * Steam release_date.date 파싱
     * - 예: "27 Dec, 2025", "Dec 27, 2025", "2025년 12월 27일"
     */
    #parseReleaseDate(raw) {
        if (!raw) return null;

        // 1) 표준 파싱 시도
        const d1 = new Date(raw);
        if (!Number.isNaN(d1.getTime())) return d1;

        // 2) 한국어 형식: "YYYY년 M월 D일" (뒤에 "출시"가 붙어도 허용)
        const m = String(raw).match(
            /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*출시)?/
        );
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


    /**
     * ISO 날짜 문자열 → "YYYY년 M월 D일까지 / N일 남음" (Asia/Seoul 기준)
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

            const y = parts.find((p) => p.type === "year")?.value;
            const m = parts.find((p) => p.type === "month")?.value;
            const day = parts.find((p) => p.type === "day")?.value;
            if (!y || !m || !day) return null;

            const untilText = `${y}년 ${Number(m)}월 ${Number(day)}일까지`;

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

        if (isUnavailable) {
            return `현재 Steam에서 ${strong(
                "구매할 수 없는 상태"
            )}입니다. 판매 종료 또는 지역 제한일 수 있으니 Steam 상점에서 상태를 확인해 주세요.`;
        }

        if (isFree) {
            return `현재 ${strong(
                "무료로 플레이"
            )}할 수 있는 상품입니다. 구성과 조건은 Steam 상점에서 확인해 주세요.`;
        }

        const parts = [];

        // 1) 할인/가격 요약
        const curDp = Number(deal?.current?.discount_percent || 0);
        const lowInfo = deal?.historical_low;

        const lowWasNow = !!lowInfo?.is_lowest_now;
        const lowDp = Number.isFinite(Number(lowInfo?.discount_percent))
            ? Number(lowInfo.discount_percent)
            : null;

        // 출시 시점 기반 맥락(출시 후 3개월 이내)
        // release_date는 데이터 소스/가공 단계에 따라 키가 달라질 수 있어 가능한 후보를 순서대로 fallback 합니다.
        // (콘솔에 undefined가 찍히는 경우, 아래 후보 중 하나로 들어오는지 확인해 주세요.)
        // 출시일은 현재 steamItem.release_date 문자열로 제공됨 (예: "2025년 12월 27일")
        const releaseDateRaw = steamItem?.release_date ?? null;
        const releasedAt = this.#parseReleaseDate(releaseDateRaw);
        let isEarlyRelease = false;
        if (releasedAt) {
            const diffDays = (Date.now() - releasedAt.getTime()) / 86400000;
            isEarlyRelease = diffDays >= 0 && diffDays <= 90;
        }

        let lowCloseness = null;
        if (!lowWasNow && lowDp != null) {
            const diff = Math.abs(lowDp - curDp);
            if (diff === 0) lowCloseness = "same";
            else if (diff <= 5) lowCloseness = "near";
            else if (diff >= 15) lowCloseness = "far";
        }

        if (curDp > 0) {
            // 출시 초기(3개월 이내) 할인인 경우에는 "역대 최저가" 표현을 우선하지 않고
            // "초기 할인" 맥락을 핵심으로 전달합니다.
            if (isEarlyRelease) {
                parts.push(
                    `현재는 ${strong("할인 판매 중")}이며, 출시 이후 비교적 이른 시점에 할인(${strong(
                        "초기 할인"
                    )})이 적용된 상태입니다.`
                );
            } else {
                if (lowWasNow) {
                    parts.push(
                        `현재는 ${strong("할인 판매 중")}이며, ${strong(
                            "역대 최저가"
                        )}에 해당합니다.`
                    );
                } else if (lowCloseness === "same") {
                    parts.push(
                        `현재는 ${strong("할인 판매 중")}이며, 과거 최저가와 ${strong(
                            "같은 수준"
                        )}입니다.`
                    );
                } else if (lowCloseness === "near") {
                    parts.push(
                        `현재는 ${strong("할인 판매 중")}이며, 과거 최저가와 ${strong(
                            "큰 차이 없는"
                        )} 편입니다.`
                    );
                } else if (lowCloseness === "far") {
                    parts.push(
                        `현재는 ${strong("할인 판매 중")}이지만, 과거 최저가 대비 ${strong(
                            "차이가 있는"
                        )} 편입니다.`
                    );
                } else if (lowInfo?.amount != null) {
                    const ago = humanizeAgo(lowInfo.last_seen_at);
                    parts.push(
                        `현재는 ${strong("할인 판매 중")}이며, 과거 최저가 이력${
                            ago ? `(${escapeHtml(ago)})` : ""
                        }이 확인됩니다.`
                    );
                } else {
                    parts.push(
                        `현재는 ${strong(
                            "할인 판매 중"
                        )}이지만, 가격 이력이 충분하지 않아 과거 기준 비교는 제한될 수 있습니다.`
                    );
                }
            }
        } else {
            if (lowInfo?.amount != null) {
                parts.push(
                    `현재는 ${strong(
                        "할인 없이 정가"
                    )}로 판매 중이며, 과거에는 할인 이력이 있었습니다.`
                );
            } else {
                parts.push(
                    `현재는 ${strong(
                        "할인 없이 정가"
                    )}로 판매 중이며, 가격 이력이 충분하지 않습니다.`
                );
            }

            if (isEarlyRelease) {
                parts.push(`출시 이후 비교적 이른 시점으로, 할인 폭이 크지 않을 수 있습니다.`);
            }
        }

        // 2) 언어/플레이 환경
        if (kind === "app") {
            const koLevel = Number(steamItem?.supported_languages ?? 0);
            if (koLevel === 2) {
                parts.push(
                    `언어 측면에서는 ${strong(
                        "공식 한국어(음성 포함)"
                    )}를 지원하여 별도의 언어 부담이 없습니다.`
                );
            } else if (koLevel === 1) {
                parts.push(
                    `언어 측면에서는 ${strong(
                        "공식 한국어"
                    )}를 지원하여 플레이에 큰 부담이 없습니다.`
                );
            } else if (hasCommunityPatch) {
                parts.push(
                    `공식 한국어는 지원하지 않지만, ${strong(
                        "유저 한글패치"
                    )}가 존재해 언어로 인한 부담을 어느 정도 줄일 수 있습니다.`
                );
            } else {
                parts.push(
                    `공식 ${strong(
                        "한국어 미지원"
                    )}으로 인해 플레이 시 언어 부담이 발생할 수 있습니다.`
                );
            }
        }

        // 3) 리뷰 요약
        const total = Number(reviews?.total || 0);
        const summary = String(reviews?.summary || "").trim();
        if (kind === "app" && total > 0 && summary) {
            const volume =
                total < 200 ? "표본이 적은" : total < 2000 ? "충분한" : "매우 많은";
            parts.push(
                `유저 평가는 ${strong(summary)}이며, 리뷰 수는 ${strong(
                    volume
                )} 편입니다.`
            );
        } else if (kind === "app" && total === 0) {
            parts.push(`리뷰 데이터가 충분하지 않아 평판을 요약하기 어렵습니다.`);
        }

        // 4) 구매 판단 보조
        const meaningfulDiscountThreshold = 20;
        const comfortableDiscountThreshold = 30;

        const isMeaningfulDiscount = curDp >= meaningfulDiscountThreshold;
        const isComfortableDiscount = curDp >= comfortableDiscountThreshold;

        const reviewLabel = summary;
        const mixedOrWorse = [
            "복합적",
            "대체로 부정적",
            "부정적",
            "매우 부정적",
        ].includes(reviewLabel);

        if (curDp > 0) {
            if (lowWasNow || lowCloseness === "same" || lowCloseness === "near") {
                if (mixedOrWorse) {
                    parts.push(
                        `현재 가격은 ${strong(
                            "역대 최저가(또는 근접)"
                        )}에 해당하지만, 유저 평가는 ${strong(
                            reviewLabel
                        )}로 ${strong(
                            "호불호가 있을 수 있습니다"
                        )}. 구매 전 게임 성격과 최근 리뷰를 함께 확인해 보세요.`
                    );
                } else if (!isMeaningfulDiscount) {
                    parts.push(
                        `현재 가격은 ${strong(
                            "역대 최저가(또는 근접)"
                        )}에 해당하지만, 할인 폭이 크지 않아 체감상 크게 저렴하게 느껴지지는 않을 수 있습니다.`
                    );
                } else if (isComfortableDiscount) {
                    parts.push(
                        `당장 플레이할 계획이 있다면, 현재 가격은 ${strong(
                            "지금 구매해도 부담이 크지 않은 편"
                        )}으로 볼 수 있습니다.`
                    );
                } else {
                    parts.push(
                        `현재 가격은 ${strong(
                            "역대 최저가(또는 근접)"
                        )}에 해당하지만, 할인 폭은 ${strong(
                            "보통 수준"
                        )}입니다. 지금 구매할지는 당장 플레이할 계획이 있는지를 기준으로 고려해보는 것이 좋습니다.`
                    );
                }
            } else if (lowCloseness === "far") {
                parts.push(
                    `지금 구매할지, 더 낮은 가격을 기다릴지는 개인의 상황에 따라 선택이 달라질 수 있어 ${strong(
                        "고민이 필요할 수 있습니다"
                    )}.`
                );
            } else {
                parts.push(
                    `현재 조건은 플레이 시점과 개인 사정에 따라 ${strong(
                        "고민이 필요할 수 있습니다"
                    )}.`
                );
            }
        } else {
            parts.push(
                `지금 구매할지, 다음 할인을 기다릴지는 개인의 상황에 따라 선택이 달라질 수 있어 ${strong(
                    "고민이 필요할 수 있습니다"
                )}.`
            );
        }

        // 5) 할인 종료 임박 안내
        const expiry = deal?.current?.expiry_at;
        if (expiry) {
            const info = this.#formatKoreanUntilWithDaysLeft(expiry);
            if (
                info?.untilText &&
                Number.isFinite(info.daysLeft) &&
                info.daysLeft <= 2
            ) {
                const { untilText, daysLeft } = info;
                if (daysLeft <= 0) {
                    parts.push(`할인은 ${strong(untilText)}에 ${strong("종료")}됩니다.`);
                } else if (daysLeft === 1) {
                    parts.push(
                        `할인은 ${strong(untilText)}까지 ${strong("1일")} 남아있습니다.`
                    );
                } else {
                    parts.push(
                        `할인은 ${strong(untilText)}까지 ${strong(
                            `${daysLeft}일`
                        )} 남아있습니다.`
                    );
                }
            }
        }

        return parts.join(" ");
    }
}
