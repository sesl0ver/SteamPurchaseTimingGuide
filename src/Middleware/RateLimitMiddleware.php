<?php

namespace App\Middleware;

use App\Http\ApiResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Response;

final class RateLimitMiddleware implements MiddlewareInterface
{
    public function __construct(
        private readonly \Redis $redis,
        private readonly string $prefix = 'rl:deal',
        private readonly int $limitPerMinute = 8,
        private readonly int $ttlSeconds = 70
    ) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $ip = $this->getClientIp($request);
        $minute = (int) floor(time() / 60);

        $key = "{$this->prefix}:{$ip}:{$minute}";

        // INCR + TTL
        $count = (int) $this->redis->incr($key);
        if ($count === 1) {
            $this->redis->expire($key, $this->ttlSeconds);
        }

        if ($count > $this->limitPerMinute) {
            $retryAfter = 60 - (time() % 60);
            $res = new Response(429);
            $res = $res->withHeader('Retry-After', (string)$retryAfter);

            return ApiResponse::errorWithDetails(
                $res,
                'Too Many Requests',
                1429,     // 엘 님이 쓰는 에러코드 체계에 맞춰 조정 가능
                429,
                [
                    ['field' => 'limit', 'reason' => (string)$this->limitPerMinute],
                    ['field' => 'retry_after', 'reason' => (string)$retryAfter],
                ]
            );
        }

        return $handler->handle($request);
    }

    private function getClientIp(ServerRequestInterface $request): string
    {
        // 프록시 뒤라면 trusted proxy 설정이 필요합니다.
        // 우선은 X-Forwarded-For 첫 값 -> 없으면 REMOTE_ADDR
        $xff = $request->getHeaderLine('X-Forwarded-For');
        if ($xff !== '') {
            $parts = explode(',', $xff);
            $ip = trim($parts[0]);
            if ($ip !== '') return $ip;
        }

        $serverParams = $request->getServerParams();
        return (string)($serverParams['REMOTE_ADDR'] ?? '0.0.0.0');
    }
}
