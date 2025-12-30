<?php
declare(strict_types=1);

namespace App\Service;

use Redis;

final class AbuseGuard
{
    private const int DEDUPE_TTL = 12 * 3600; // 12시간

    public function __construct(
        private readonly Redis $redis
    ) {}

    /**
     * true → 카운트 허용
     * false → 중복/어뷰징으로 스킵
     */
    public function allowLookup(string $fp, string $kind, string $id): bool
    {
        $key = "lookup:dedupe:{$fp}:{$kind}:{$id}";

        // 이미 조회한 경우
        if ($this->redis->exists($key)) {
            return false;
        }

        // 최초 조회 → 기록
        $this->redis->setex($key, self::DEDUPE_TTL, '1');
        return true;
    }
}
