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
        $key = 'stats:dau:' . date('Ymd');
        $this->redis->sAdd($key, $fp);
        $this->redis->expire($key, 60 * 86400);
    }

    /* ========= CCU ========= */

    public function markCcu(string $fp): void
    {
        $key = 'stats:ccu:' . date('YmdHi');
        $this->redis->sAdd($key, $fp);
        $this->redis->expire($key, 180);
    }

    /* ========= Retention ========= */

    public function markFirstSeen(string $fp): void
    {
        $key = 'cohort:first_seen:' . date('Ymd');
        $this->redis->sAdd($key, $fp);
        $this->redis->expire($key, 90 * 86400);
    }

    /* ========= Event ========= */

    public function trackEvent(string $event): void
    {
        $key = 'events:' . date('Ymd');
        $this->redis->hIncrBy($key, $event, 1);
        $this->redis->expire($key, 30 * 86400);
    }
}
