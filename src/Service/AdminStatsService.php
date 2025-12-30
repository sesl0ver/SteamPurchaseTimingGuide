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

    /* ========= DAU 증감 ========= */
    public function getDauDelta(): array
    {
        $today = gmdate('Ymd');
        $yesterday = gmdate('Ymd', time() - 86400);

        $todayCnt = $this->redis->sCard("stats:dau:{$today}");
        $yesterdayCnt = $this->redis->sCard("stats:dau:{$yesterday}");

        return [
            'today' => $todayCnt,
            'yesterday' => $yesterdayCnt,
            'delta' => $todayCnt - $yesterdayCnt,
        ];
    }

    /* ========= CCU 증감 ========= */
    public function getCcuDelta(int $minutes = 5): array
    {
        $now = $this->getRecentCcu($minutes);

        // 10~5분 전 구간을 “어제” 대신 비교 기준으로 사용
        $past = [];
        for ($i = $minutes * 2; $i > $minutes; $i--) {
            $key = "stats:ccu:" . gmdate('YmdHi', time() - $i * 60);
            foreach ($this->redis->sMembers($key) as $fp) {
                $past[$fp] = true;
            }
        }

        $pastCnt = count($past);

        return [
            'current' => $now,
            'past' => $pastCnt,
            'delta' => $now - $pastCnt,
        ];
    }

    /* ========= 트렌딩 집중도 ========= */
    public function getTrendingFocus(int $days = 7, int $top = 3): array
    {
        $items = $this->getTrending($days, 10);

        $total = array_sum(array_column($items, 'count'));
        if ($total === 0) return [];

        $focus = [];
        for ($i = 0; $i < min($top, count($items)); $i++) {
            $focus[] = [
                'rank' => $i + 1,
                'title' => $items[$i]['title'],
                'ratio' => round($items[$i]['count'] / $total * 100, 1),
            ];
        }

        return $focus;
    }

    /* ========= 오늘 신규 vs 재방문 ========= */
    public function getTodayNewVsReturning(): array
    {
        $today = gmdate('Ymd');

        $dauKey = "stats:dau:{$today}";
        $cohortKey = "cohort:first_seen:{$today}";

        $total = $this->redis->sCard($dauKey);
        $new = $this->redis->sInterCard([$dauKey, $cohortKey]);
        $returning = max(0, $total - $new);

        return [
            'total' => $total,
            'new' => $new,
            'returning' => $returning,
        ];
    }

}
