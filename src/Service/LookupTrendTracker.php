<?php
declare(strict_types=1);

namespace App\Service;

use Redis;
use Throwable;

final class LookupTrendTracker
{
    // 요구사항 고정값
    private const int DAILY_TTL_SECONDS = 14 * 24 * 60 * 60;   // 14일
    private const int META_TTL_SECONDS  = 90 * 24 * 60 * 60;   // 90일

    public function __construct(
        private readonly Redis $redis
    ) {}

    /**
     * 조회 성공 시점에만 호출하세요.
     * - kind(app/sub/bundle), id, title, header_image, steam_url 모두 있을 때만 기록
     */
    public function record(string $kind, string $id, string $title, string $headerImage, string $steamUrl): void
    {
        // 최소 안전장치 (요구사항 그대로)
        if ($kind === '' || $id === '' || $title === '' || $headerImage === '' || $steamUrl === '') {
            return;
        }

        // 숫자 ID만 허용 (원치 않으면 제거 가능)
        if (!preg_match('/^\d+$/', $id)) {
            return;
        }

        try {
            $ymd = gmdate('Ymd');
            $dailyKey = "lookups:daily:{$ymd}";
            $member = "{$kind}:{$id}";

            // (1) 일별 집계
            $this->redis->zIncrBy($dailyKey, 1, $member);
            $this->redis->expire($dailyKey, self::DAILY_TTL_SECONDS);

            // (2) 메타 스냅샷
            $metaKey = "lookup:meta:{$kind}:{$id}";
            $nowIsoZ = gmdate('Y-m-d\TH:i:s\Z');

            // phpredis는 배열로 hMSet 가능
            $this->redis->hMSet($metaKey, [
                'kind' => $kind,
                'id' => $id,
                'title' => $title,
                'header_image' => $headerImage,
                'steam_url' => $steamUrl,
                'last_seen_at' => $nowIsoZ,
            ]);
            $this->redis->expire($metaKey, self::META_TTL_SECONDS);

        } catch (Throwable) {
            // 조회 API를 절대 망가뜨리지 않기 위해, 로깅 실패는 조용히 무시
            return;
        }
    }
}
