<?php

namespace App\Middleware;

use App\Http\ApiResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Response;

final class AppIdCooldownMiddleware implements MiddlewareInterface
{
    public function __construct(
        private readonly \Redis $redis,
        private readonly int $cooldownSeconds = 10,
        private readonly string $prefix = 'rl:deal:item'
    ) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        // (선택) GET에만 적용하고 싶으면 아래 주석 해제
        // if (strtoupper($request->getMethod()) !== 'GET') return $handler->handle($request);

        // ✅ RouteContext 없이, request attributes에서 "route" 객체를 찾아 arguments 추출
        $args = $this->getRouteArguments($request);

        [$type, $id] = $this->extractTypeAndId($args);

        if ($type === null || $id === null) {
            return $handler->handle($request);
        }

        $ip = $this->getClientIp($request);
        $key = "{$this->prefix}:{$ip}:{$type}:{$id}";

        // SET NX EX : 처음 요청만 true, ttl 동안은 false
        $ok = $this->redis->set($key, '1', ['nx', 'ex' => $this->cooldownSeconds]);

        if ($ok !== true) {
            $retryAfter = $this->cooldownSeconds;
            $res = (new Response(429))
                ->withHeader('Retry-After', (string)$retryAfter);

            return ApiResponse::errorWithDetails(
                $res,
                'Too Many Requests',
                1429,
                429,
                [
                    ['field' => 'cooldown_seconds', 'reason' => (string)$this->cooldownSeconds],
                    ['field' => 'type', 'reason' => $type],
                    ['field' => 'id', 'reason' => (string)$id],
                ]
            );
        }

        return $handler->handle($request);
    }

    /**
     * Slim 라우팅 미들웨어가 request에 주입한 Route 객체에서 arguments를 꺼냅니다.
     * RouteContext 클래스에 의존하지 않기 위해 "getArguments()" 메서드를 가진 객체를 탐색합니다.
     */
    private function getRouteArguments(ServerRequestInterface $request): array
    {
        foreach ($request->getAttributes() as $attr) {
            if (is_object($attr) && method_exists($attr, 'getArguments')) {
                $args = $attr->getArguments();
                return is_array($args) ? $args : [];
            }
        }
        return [];
    }

    /**
     * 현재 프로젝트의 라우트 파라미터 이름을 모두 커버합니다.
     * - app: {steam_appid}
     * - sub: {sub_id}
     * - bundle: {bundle_id}
     *
     * (추가로, 통합 라우트(/deal/{type}/{id}) 대비 type/id도 인식)
     */
    private function extractTypeAndId(array $args): array
    {
        if (isset($args['type'], $args['id'])) {
            $type = (string)$args['type'];
            $id = (string)$args['id'];

            if (in_array($type, ['app', 'sub', 'bundle'], true) && $id !== '') {
                return [$type, $id];
            }
        }

        if (isset($args['steam_appid'])) {
            return ['app', (string)$args['steam_appid']];
        }
        if (isset($args['sub_id'])) {
            return ['sub', (string)$args['sub_id']];
        }
        if (isset($args['bundle_id'])) {
            return ['bundle', (string)$args['bundle_id']];
        }

        return [null, null];
    }

    private function getClientIp(ServerRequestInterface $request): string
    {
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
