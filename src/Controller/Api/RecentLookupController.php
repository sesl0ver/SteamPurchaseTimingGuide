<?php
declare(strict_types=1);

namespace App\Controller\Api;

use App\Service\Fingerprint;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Redis;

final class RecentLookupController
{
    private const int MAX_LIMIT = 30;
    private const string RECENT_KEY = 'lookups:recent';

    public function __construct(
        private readonly Redis $redis
    ) {}

    /**
     * GET /api/recent-lookups?limit=10
     * - 최근 조회한 게임(lookups:recent) 목록을 반환
     */
    public function listRecent(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $this->recordStats($request);

        $q = $request->getQueryParams();
        $limit = isset($q['limit']) ? (int)$q['limit'] : 10;
        $limit = max(1, min(self::MAX_LIMIT, $limit));

        // 최근 조회순으로 멤버 가져오기 (score가 타임스탬프)
        $members = $this->redis->zRevRange(self::RECENT_KEY, 0, $limit - 1);

        if (!$members) {
            return $this->json($response, [
                'success' => true,
                'data' => [
                    'meta' => [
                        'limit' => $limit,
                        'as_of' => date('Y-m-d\TH:i:s\Z'),
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
                // 'rank' => $idx + 1,
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
                    'limit' => $limit,
                    'as_of' => date('Y-m-d\TH:i:s\Z'),
                ],
                'items' => $items,
            ],
        ]);
    }

    private function recordStats(ServerRequestInterface $request): void
    {
        $fp = Fingerprint::fromRequest($request);
        $ccuKey = 'stats:ccu:' . date('YmdHi');
        $this->redis->sAdd($ccuKey, $fp);
        $this->redis->expire($ccuKey, 180);
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
