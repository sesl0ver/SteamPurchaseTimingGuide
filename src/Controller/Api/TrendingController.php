<?php
declare(strict_types=1);

namespace App\Controller\Api;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Redis;

final class TrendingController
{
    private const int MAX_DAYS = 14;
    private const int MAX_LIMIT = 30;

    private const int TMP_TTL_SECONDS = 120;           // 집계 임시 ZSET TTL (짧게)
    private const int META_TTL_SECONDS = 90 * 86400;   // 메타 TTL(참고용, 기록쪽과 동일하게 유지 권장)

    public function __construct(
        private readonly Redis $redis
    ) {}

    /**
     * GET /api/trending?days=7&limit=10
     * - 최근 N일 lookups:daily:* ZSET을 합산해서 상위 항목을 반환
     * - 조회수는 노출하지 않고 rank만 반환
     */
    public function list(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $q = $request->getQueryParams();

        $days  = isset($q['days']) ? (int)$q['days'] : 7;
        $limit = isset($q['limit']) ? (int)$q['limit'] : 10;

        $days  = max(1, min(self::MAX_DAYS, $days));
        $limit = max(1, min(self::MAX_LIMIT, $limit));

        $todayYmd = gmdate('Ymd');

        // 임시 집계 키(캐시)
        $tmpKey = "lookups:tmp:trending:{$days}d:{$todayYmd}";

        // 최근 N일 키 생성
        $keys = [];
        for ($i = 0; $i < $days; $i++) {
            $ymd = gmdate('Ymd', time() - ($i * 86400));
            $keys[] = "lookups:daily:{$ymd}";
        }

        // tmpKey 없으면 생성
        if (!$this->redis->exists($tmpKey)) {
            // Redis는 없는 source key를 "빈 ZSET"처럼 취급하므로 그대로 union해도 보통 안전합니다.
            $this->redis->zUnionStore($tmpKey, $keys);
            $this->redis->expire($tmpKey, self::TMP_TTL_SECONDS);
        }

        // 상위 멤버(조회수는 필요 없으니 score 미포함)
        $members = $this->redis->zRevRange($tmpKey, 0, $limit - 1);
        if (!$members) {
            return $this->json($response, [
                'success' => true,
                'data' => [
                    'meta' => [
                        'days' => $days,
                        'limit' => $limit,
                        'as_of' => gmdate('Y-m-d\TH:i:s\Z'),
                    ],
                    'items' => [],
                ],
            ]);
        }

        // 메타를 파이프라인으로 묶어서 읽기
        $fields = ['kind', 'id', 'title', 'header_image', 'steam_url', 'last_seen_at'];

        $pipe = $this->redis->multi(Redis::PIPELINE);
        foreach ($members as $m) {
            [$kind, $id] = $this->parseMember($m);
            $metaKey = "lookup:meta:{$kind}:{$id}";
            $pipe->hMGet($metaKey, $fields);
        }
        /** @var array<int,array<string,?string>> $metaRows */
        $metaRows = $pipe->exec();

        $items = [];
        foreach ($members as $idx => $m) {
            $row = $metaRows[$idx] ?? [];
            [$kind, $id] = $this->parseMember($m);

            $steamUrl = (string)($row['steam_url'] ?? $this->fallbackSteamUrl($kind, $id));

            // meta가 만료/누락되어도 rank 리스트는 유지(최소 정보로 복구)
            $items[] = [
                'rank' => $idx + 1,
                'kind' => (string)($row['kind'] ?? $kind),
                'id' => (int)($row['id'] ?? $id),
                'title' => $row['title'] ?? null,
                'header_image' => $row['header_image'] ?? null,
                'steam_url' => $steamUrl,
                'last_seen_at' => $row['last_seen_at'] ?? null,
            ];
        }

        return $this->json($response, [
            'success' => true,
            'data' => [
                'meta' => [
                    'days' => $days,
                    'limit' => $limit,
                    'as_of' => gmdate('Y-m-d\TH:i:s\Z'),
                ],
                'items' => $items,
            ],
        ]);
    }

    private function parseMember(string $member): array
    {
        // "app:3101040"
        $parts = explode(':', $member, 2);
        $kind = $parts[0] ?? 'app';
        $id = isset($parts[1]) ? (int)$parts[1] : 0;
        return [$kind, $id];
    }

    private function fallbackSteamUrl(string $kind, int $id): string
    {
        return match ($kind) {
            'sub' => "https://store.steampowered.com/sub/{$id}/",
            'bundle' => "https://store.steampowered.com/bundle/{$id}/",
            default => "https://store.steampowered.com/app/{$id}/",
        };
    }

    private function json(ResponseInterface $response, array $payload, int $status = 200): ResponseInterface
    {
        $response->getBody()->write(
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus($status);
    }
}
