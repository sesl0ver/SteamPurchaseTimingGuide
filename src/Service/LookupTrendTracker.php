<?php
declare(strict_types=1);

namespace App\Service;

use Redis;
use Throwable;

final class LookupTrendTracker
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

            // 어뷰징 차단
            if (!$this->abuse->allowLookup($fp, $kind, $id)) {
                return;
            }

            $member = "{$kind}:{$id}";

            $now = time();
            $this->redis->zAdd(self::RECENT_KEY, $now, $member);
            $this->redis->zRemRangeByRank(self::RECENT_KEY, 0, -self::RECENT_MAX - 1);

            $ymd = date('Ymd');
            $this->redis->zIncrBy("lookups:daily:{$ymd}", 1, $member);
            $this->redis->expire("lookups:daily:{$ymd}", self::DAILY_TTL);

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
