<?php
declare(strict_types=1);

namespace App\Service;

use Redis;
use Throwable;

final class LookupHistoryTracker
{
    private const int DAILY_TTL = 14 * 86400;
    private const int META_TTL  = 90 * 86400;
    private const string RECENT_KEY = 'lookups:recent';
    private const int RECENT_MAX = 500;

    public function __construct(
        private readonly Redis $redis,
        private readonly AbuseGuard $abuse,
        private readonly StatsTracker $stats
    ) {}

    public function record(
        string $fp,
        string $kind,
        string $id,
        string $title,
        string $headerImage,
        string $steamUrl
    ): void {
        if ($kind === '' || $id === '' || $title === '') return;

        try {
            // DAU / First Seen
            $this->stats->markDau($fp);
            $this->stats->markFirstSeen($fp);

            $member = "{$kind}:{$id}";

            $now = time();

            // "최근 조회" 목록은 재조회 시에도 항상 최신으로 갱신되어야 하므로
            // 어뷰징/중복 차단 로직과 분리해서 먼저 업데이트한다.
            $this->redis->zAdd(self::RECENT_KEY, $now, $member);

            // ZSET trim: RECENT_MAX 초과분(가장 오래된 것)만 제거
            // (음수 인덱스 기반 제거는 개수가 적을 때 전체가 지워질 수 있어 방지)
            $count = (int) $this->redis->zCard(self::RECENT_KEY);
            if ($count > self::RECENT_MAX) {
                $overflow = $count - self::RECENT_MAX;
                $this->redis->zRemRangeByRank(self::RECENT_KEY, 0, $overflow - 1);
            }

            $ymd = date('Ymd');

            // 어뷰징/중복 차단은 "일별 조회 통계"에만 적용 (최근 조회 갱신과 분리)
            if ($this->abuse->allowLookup($fp, $kind, $id)) {
                $this->redis->zIncrBy("lookups:daily:{$ymd}", 1, $member);
                $this->redis->expire("lookups:daily:{$ymd}", self::DAILY_TTL);
            }

            $metaKey = "lookup:meta:{$kind}:{$id}";
            $this->redis->hMSet($metaKey, [
                'kind' => $kind,
                'id' => $id,
                'title' => $title,
                'header_image' => $headerImage,
                'steam_url' => $steamUrl,
                'last_seen_at' => date('c'),
            ]);
            $this->redis->expire($metaKey, self::META_TTL);

        } catch (Throwable) {
            // 로깅 실패는 서비스에 영향 주지 않음
        }
    }
}
