<?php
declare(strict_types=1);

namespace App\Infrastructure\Cache;

use Redis;

final class RedisCache
{
    public function __construct(
        private readonly Redis $redis
    ) {}

    /* =========================
       Basic String Cache
       ========================= */

    public function get(string $key): ?string
    {
        $v = $this->redis->get($key);
        return ($v === false) ? null : (string)$v;
    }

    public function set(string $key, string $value, int $ttl): void
    {
        $this->setEx($key, $ttl, $value);
    }

    public function setEx(string $key, int $ttl, string $value): void
    {
        // ttl 0 이하 방지
        if ($ttl < 1) {
            $ttl = 1;
        }
        $this->redis->setex($key, $ttl, $value);
    }

    /* =========================
       JSON Cache Helpers
       ========================= */

    public function getJson(string $key): ?array
    {
        $raw = $this->get($key);
        if ($raw === null) {
            return null;
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
    }

    public function setJson(string $key, int $ttl, array $data): void
    {
        $this->setEx(
            $key,
            $ttl,
            json_encode($data, JSON_UNESCAPED_UNICODE)
        );
    }

    /**
     * 캐시 미스 시 $producer를 실행하고 결과를 캐시에 저장.
     * (스탬피드 방지용 TTL 지터는 다음 단계에서 추가해도 됩니다)
     */
    public function rememberJson(string $key, int $ttl, callable $producer): array
    {
        $cached = $this->getJson($key);
        if ($cached !== null) {
            return $cached;
        }

        $data = $producer();
        if (!is_array($data)) {
            // producer는 배열을 반환하도록 통일 (실수 방지)
            $data = ['value' => $data];
        }

        $this->setJson($key, $ttl, $data);
        return $data;
    }
}
