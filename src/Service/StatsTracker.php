<?php
declare(strict_types=1);

namespace App\Service;

use Redis;

final class StatsTracker
{
    public function __construct(
        private readonly Redis $redis
    ) {}

    /* ========= DAU ========= */

    public function markDau(string $fp): void
    {
        $key = 'stats:dau:' . gmdate('Ymd');
        $this->redis->sAdd($key, $fp);
        $this->redis->expire($key, 60 * 86400);
    }

    /* ========= Retention ========= */

    public function markFirstSeen(string $fp): void
    {
        $key = 'cohort:first_seen:' . gmdate('Ymd');
        $this->redis->sAdd($key, $fp);
        $this->redis->expire($key, 90 * 86400);
    }

    /* ========= Event ========= */

    public function trackEvent(string $event): void
    {
        $key = 'events:' . gmdate('Ymd');
        $this->redis->hIncrBy($key, $event, 1);
        $this->redis->expire($key, 30 * 86400);
    }
}
