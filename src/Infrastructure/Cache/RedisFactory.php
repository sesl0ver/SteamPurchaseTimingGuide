<?php
declare(strict_types=1);

namespace App\Infrastructure\Cache;

use Redis;
use RuntimeException;

final class RedisFactory
{
    public static function create(): Redis
    {
        $host = (string)($_ENV['REDIS_HOST'] ?? '127.0.0.1');
        $port = (int)($_ENV['REDIS_PORT'] ?? 6379);
        $timeout = (float)($_ENV['REDIS_TIMEOUT'] ?? 1.0);

        $redis = new Redis();

        if (!$redis->connect($host, $port, $timeout)) {
            throw new RuntimeException(sprintf('Redis connect failed: %s:%d', $host, $port));
        }

        // 로컬/내부망에서도 끊김 감지에 도움(필수는 아니지만 무해)
        $redis->setOption(Redis::OPT_TCP_KEEPALIVE, 1);

        // (선택) 비밀번호 사용 시
        /*$password = (string)($_ENV['REDIS_PASSWORD'] ?? '');
        if ($password !== '') {
            if (!$redis->auth($password)) {
                throw new RuntimeException('Redis AUTH failed.');
            }
        }*/

        // (선택) 기본 DB 인덱스(0~15)
        /*$db = (int)($_ENV['REDIS_DB'] ?? 0);
        if ($db !== 0) {
            if (!$redis->select($db)) {
                throw new RuntimeException('Redis SELECT failed.');
            }
        }*/

        return $redis;
    }
}
