<?php
declare(strict_types=1);

namespace App\Service;

use Redis;

final class AdminStatsService
{
    public function __construct(
        private readonly Redis $redis
    ) {}

    /* ========= DAU ========= */

    public function getDau(int $days = 7): array
    {
        $out = [];
        for ($i = 0; $i < $days; $i++) {
            $ymd = gmdate('Ymd', time() - $i * 86400);
            $key = "stats:dau:{$ymd}";
            $out[$ymd] = $this->redis->sCard($key);
        }
        return array_reverse($out, true);
    }

    /* ========= CCU (최근 N분) ========= */

    public function getRecentCcu(int $minutes = 5): int
    {
        $set = [];
        for ($i = 0; $i < $minutes; $i++) {
            $key = "stats:ccu:" . gmdate('YmdHi', time() - $i * 60);
            $members = $this->redis->sMembers($key);
            foreach ($members as $m) {
                $set[$m] = true;
            }
        }
        return count($set);
    }

    /* ========= Trending ========= */

    public function getTrending(int $days = 7, int $limit = 10): array
    {
        $today = gmdate('Ymd');
        $tmpKey = "admin:tmp:trending:{$days}d:{$today}";

        if (!$this->redis->exists($tmpKey)) {
            $keys = [];
            for ($i = 0; $i < $days; $i++) {
                $ymd = gmdate('Ymd', time() - $i * 86400);
                $keys[] = "lookups:daily:{$ymd}";
            }

            $this->redis->zUnionStore($tmpKey, $keys);
            $this->redis->expire($tmpKey, 60);
        }

        $members = $this->redis->zRevRange($tmpKey, 0, $limit - 1, true);

        $items = [];
        foreach ($members as $member => $score) {
            [$kind, $id] = explode(':', $member, 2);
            $meta = $this->redis->hGetAll("lookup:meta:{$kind}:{$id}");

            $items[] = [
                'kind' => $kind,
                'id' => $id,
                'title' => $meta['title'] ?? null,
                'count' => (int)$score,
            ];
        }

        return $items;
    }

    /* ========= Events ========= */

    public function getEvents(int $days = 3): array
    {
        $out = [];
        for ($i = 0; $i < $days; $i++) {
            $ymd = gmdate('Ymd', time() - $i * 86400);
            $out[$ymd] = $this->redis->hGetAll("events:{$ymd}");
        }
        return array_reverse($out, true);
    }

    /* ========= Retention ========= */

    public function getRetention(int $daysAgo = 1): array
    {
        $cohortDay = gmdate('Ymd', time() - $daysAgo * 86400);
        $today = gmdate('Ymd');

        $cohortKey = "cohort:first_seen:{$cohortDay}";
        $todayKey = "stats:dau:{$today}";

        $cohortSize = $this->redis->sCard($cohortKey);
        $returned = $this->redis->sInterCard([$cohortKey, $todayKey]);

        return [
            'cohort_day' => $cohortDay,
            'cohort_size' => $cohortSize,
            'returned' => $returned,
            'rate' => $cohortSize > 0 ? round($returned / $cohortSize * 100, 2) : 0,
        ];
    }
}
