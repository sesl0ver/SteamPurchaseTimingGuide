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
     * Steam release_date 파싱
     * - 예: "27 Dec, 2025", "Dec 27, 2025", "2025년 12월 27일"
     */
    #parseReleaseDate(raw) {
        if (!raw) return null;

        // 1) 표준 파싱
        const d1 = new Date(raw);
        if (!Number.isNaN(d1.getTime())) return d1;

        // 2) 한국어 형식: "YYYY년 M월 D일" (뒤에 "출시"가 붙어도 허용)
        const s = String(raw);
        const m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*출시)?/);
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
     * ISO 날짜 문자열 → "YYYY년 M월 D일" + daysLeft 계산 (Asia/Seoul 기준)
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
     */
    #mapReviewTone(label) {
        const reviewLabel = String(label || "").trim();
        if (!reviewLabel) return null;

        if (reviewLabel === "복합적") return "mixed";
        if (["대체로 부정적", "부정적"].includes(reviewLabel)) return "negative";
        if (["매우 부정적", "압도적으로 부정적"].includes(reviewLabel)) return "very_negative";
        return null;
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

        const pushUnique = (sentence) => {
            const s = String(sentence || "").trim();
            if (!s) return;
            if (parts.includes(s)) return;
            parts.push(s);
        };

        // --- 가격/할인 데이터 ---
        const curDp = Number(deal?.current?.discount_percent || 0);
        const lowInfo = deal?.historical_low;

        // 정가(regular_price) 우선, 없으면 current.amount를 fallback
        const regularAmountRaw = deal?.current?.regular_price;
        const currentAmountRaw = deal?.current?.amount;
        const listPrice = Number.isFinite(Number(regularAmountRaw))
            ? Number(regularAmountRaw)
            : Number.isFinite(Number(currentAmountRaw))
                ? Number(currentAmountRaw)
                : null;

        const allTimeLow = Number.isFinite(Number(lowInfo?.amount)) ? Number(lowInfo.amount) : null;

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

        const lowWasNow = !!lowInfo?.is_lowest_now;
        const lowDp = Number.isFinite(Number(lowInfo?.discount_percent))
            ? Number(lowInfo.discount_percent)
            : null;

        // 출시 초기(90일)
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

        // 1) 할인/가격 요약
        if (curDp > 0) {
            if (isEarlyRelease) {
                pushUnique(
                    `현재는 ${strong("할인 판매 중")}이며, 출시 이후 비교적 이른 시점에 할인(${strong(
                        "초기 할인"
                    )})이 적용된 상태입니다.`
                );
            } else {
                if (lowWasNow) {
                    pushUnique(
                        `현재는 ${strong("할인 판매 중")}이며, ${strong(
                            "역대 최저가"
                        )}에 해당합니다.`
                    );
                } else if (lowCloseness === "same") {
                    pushUnique(
                        `현재는 ${strong("할인 판매 중")}이며, 과거 최저가와 ${strong(
                            "같은 수준"
                        )}입니다.`
                    );
                } else if (lowCloseness === "near") {
                    pushUnique(
                        `현재는 ${strong("할인 판매 중")}이며, 과거 최저가와 ${strong(
                            "큰 차이 없는"
                        )} 편입니다.`
                    );
                } else if (lowCloseness === "far") {
                    pushUnique(
                        `현재는 ${strong("할인 판매 중")}이지만, 과거 최저가 대비 ${strong(
                            "차이가 있는"
                        )} 편입니다.`
                    );
                } else if (lowInfo?.amount != null) {
                    const ago = humanizeAgo(lowInfo.last_seen_at);
                    pushUnique(
                        `현재는 ${strong("할인 판매 중")}이며, 과거 최저가 이력${
                            ago ? `(${escapeHtml(ago)})` : ""
                        }이 확인됩니다.`
                    );
                } else {
                    pushUnique(
                        `현재는 ${strong(
                            "할인 판매 중"
                        )}이지만, 가격 이력이 충분하지 않아 과거 기준 비교는 제한될 수 있습니다.`
                    );
                }
            }
        } else {
            // ✅ 정가=역대최저가 → 실질 할인 이력 없음(추천 문구 1번)
            if (allTimeLowEqualsList) {
                pushUnique(
                    `현재까지 정가로만 판매된 상품입니다. 과거에도 정가보다 낮은 가격으로 판매된 기록은 없습니다.`
                );
            } else if (hasRealDiscountHistory) {
                pushUnique(
                    `현재는 ${strong(
                        "할인 없이 정가"
                    )}로 판매 중이며, 과거에 정가보다 낮은 가격으로 판매된 이력이 있습니다.`
                );
            } else if (lowInfo?.amount != null) {
                pushUnique(
                    `현재는 ${strong(
                        "할인 없이 정가"
                    )}로 판매 중입니다. 다만 가격 이력은 존재하나, 정가 대비 할인 판매 기록은 확정하기 어렵습니다.`
                );
            } else {
                pushUnique(`현재는 ${strong("할인 없이 정가")}로 판매 중입니다.`);
            }

            if (isEarlyRelease) {
                pushUnique(`출시 이후 비교적 이른 시점으로, 할인 폭이 크지 않을 수 있습니다.`);
            }
        }

        // 2) 언어/플레이 환경
        if (kind === "app") {
            const koLevel = Number(steamItem?.supported_languages ?? 0);
            if (koLevel === 2) {
                pushUnique(
                    `언어 측면에서는 ${strong(
                        "공식 한국어(음성 포함)"
                    )}를 지원하여 별도의 언어 부담이 없습니다.`
                );
            } else if (koLevel === 1) {
                pushUnique(
                    `언어 측면에서는 ${strong(
                        "공식 한국어"
                    )}를 지원하여 플레이에 큰 부담이 없습니다.`
                );
            } else if (hasCommunityPatch) {
                pushUnique(
                    `공식 한국어는 지원하지 않지만, ${strong(
                        "유저 한글패치"
                    )}가 존재해 언어로 인한 부담을 어느 정도 줄일 수 있습니다.`
                );
            } else {
                pushUnique(
                    `공식 ${strong(
                        "한국어 미지원"
                    )}으로 인해 플레이 시 언어 부담이 발생할 수 있습니다.`
                );
            }
        }

        // 3) 리뷰 요약(문장) + 톤(분기) — ✅ reviewTone 항상 정의됨
        const total = Number(reviews?.total || 0);
        const summary = String(reviews?.summary || "").trim();
        const reviewTone = this.#mapReviewTone(summary);

        let reviewSummarySentence = "";
        if (kind === "app" && total > 0 && summary) {
            const volume =
                total < 200 ? "표본이 적은" : total < 2000 ? "충분한" : "매우 많은";
            reviewSummarySentence = `유저 평가는 ${strong(summary)}이며, 리뷰 수는 ${strong(
                volume
            )} 편입니다.`;
        } else if (kind === "app" && total === 0) {
            reviewSummarySentence = "리뷰 데이터가 충분하지 않아 평판을 요약하기 어렵습니다.";
        }

        // ✅ 요청사항: 유저 평가 요약을 먼저 배치
        if (reviewSummarySentence) {
            pushUnique(reviewSummarySentence);
        }

        // 4) 구매 판단 보조
        const meaningfulDiscountThreshold = 20;
        const comfortableDiscountThreshold = 30;

        const isMeaningfulDiscount = curDp >= meaningfulDiscountThreshold;
        const isComfortableDiscount = curDp >= comfortableDiscountThreshold;

        if (curDp > 0) {
            const mentionedAtl = parts.some((p) => p.includes("역대 최저가"));

            if (lowWasNow || lowCloseness === "same" || lowCloseness === "near") {
                if (reviewTone) {
                    let caution = "";
                    if (reviewTone === "mixed") {
                        caution = `${strong(
                            "호불호가 갈리는 편"
                        )}입니다. 게임의 성향이 본인 취향에 맞는지, 최근 리뷰를 함께 확인해 보세요.`;
                    } else if (reviewTone === "negative") {
                        caution = `${strong(
                            "단점이나 불만 사항이 반복적으로 언급"
                        )}되고 있습니다. 최근 리뷰에서 어떤 부분이 지적되는지 확인해 보세요.`;
                    } else if (reviewTone === "very_negative") {
                        caution = `${strong(
                            "구매 전 게임 상태 확인이 필요"
                        )}합니다. 최근 리뷰와 공지 사항을 함께 확인해 주세요.`;
                    }

                    if (mentionedAtl) {
                        pushUnique(`할인 조건을 고려하면, ${caution}`);
                    } else {
                        pushUnique(
                            `현재 가격은 ${strong(
                                "역대 최저가(또는 근접)"
                            )}에 해당하며, ${caution}`
                        );
                    }
                } else if (!isMeaningfulDiscount) {
                    pushUnique(
                        mentionedAtl
                            ? `할인 폭이 크지 않아 체감상 크게 저렴하게 느껴지지는 않을 수 있습니다.`
                            : `현재 가격은 ${strong(
                                "역대 최저가(또는 근접)"
                            )}에 해당하지만, 할인 폭이 크지 않아 체감상 크게 저렴하게 느껴지지는 않을 수 있습니다.`
                    );
                } else if (isComfortableDiscount) {
                    pushUnique(
                        `당장 플레이할 계획이 있다면, 현재 가격은 ${strong(
                            "지금 구매해도 부담이 크지 않은 편"
                        )}으로 볼 수 있습니다.`
                    );
                } else {
                    pushUnique(
                        mentionedAtl
                            ? `할인 폭은 ${strong(
                                "보통 수준"
                            )}입니다. 지금 구매할지는 당장 플레이할 계획이 있는지를 기준으로 고려해보는 것이 좋습니다.`
                            : `현재 가격은 ${strong(
                                "역대 최저가(또는 근접)"
                            )}에 해당하지만, 할인 폭은 ${strong(
                                "보통 수준"
                            )}입니다. 지금 구매할지는 당장 플레이할 계획이 있는지를 기준으로 고려해보는 것이 좋습니다.`
                    );
                }
            } else if (lowCloseness === "far") {
                pushUnique(
                    `지금 구매할지, 더 낮은 가격을 기다릴지는 개인의 상황에 따라 선택이 달라질 수 있어 ${strong(
                        "고민이 필요할 수 있습니다"
                    )}.`
                );
            } else {
                pushUnique(
                    `현재 조건은 플레이 시점과 개인 사정에 따라 ${strong(
                        "고민이 필요할 수 있습니다"
                    )}.`
                );
            }
        } else {
            pushUnique(
                `지금 구매할지, 다음 할인을 기다릴지는 개인의 상황에 따라 선택이 달라질 수 있어 ${strong(
                    "고민이 필요할 수 있습니다"
                )}.`
            );
        }

        // 5) 할인 종료 임박 안내
        const expiry = deal?.current?.expiry_at;
        if (expiry) {
            const info = this.#formatKoreanUntilWithDaysLeft(expiry);
            if (info?.untilText && Number.isFinite(info.daysLeft) && info.daysLeft <= 2) {
                const { untilText, daysLeft } = info;
                if (daysLeft <= 0) {
                    pushUnique(`할인은 ${strong(untilText)}에 ${strong("종료")}됩니다.`);
                } else if (daysLeft === 1) {
                    pushUnique(`할인은 ${strong(untilText)}까지 ${strong("1일")} 남아있습니다.`);
                } else {
                    pushUnique(
                        `할인은 ${strong(untilText)}까지 ${strong(`${daysLeft}일`)} 남아있습니다.`
                    );
                }
            }
        }

        return parts.join(" ");
    }
}
