<?php
declare(strict_types=1);

namespace App\Controller\Admin\Api;

use App\Repository\CommunityKoreanPatchRepository;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Psr7\Response;

/**
 * Admin API(JSON)
 * - /admin/api/korean-patch
 * - 관리자 토큰은 AdminGuardMiddleware에서 이미 검증됨
 */
final class CommunityKoreanPatchApiController
{
    public function __construct(private readonly CommunityKoreanPatchRepository $repo) {}

    public function list(ServerRequestInterface $req, ResponseInterface $res): ResponseInterface
    {
        $q = trim((string)($req->getQueryParams()['q'] ?? ''));
        $page = (int)($req->getQueryParams()['page'] ?? 1);
        $perPage = (int)($req->getQueryParams()['per_page'] ?? 20);

        if ($page < 1) { $page = 1; }
        if ($perPage < 5) { $perPage = 5; }
        if ($perPage > 100) { $perPage = 100; }

        $appIdFilter = null;
        if ($q !== '') {
            // Steam AppID는 숫자만 허용
            if (ctype_digit($q)) {
                $appIdFilter = (int)$q;
            }
        }

        $result = $this->repo->listPaged($page, $perPage, $appIdFilter);

        return $this->json($res, [
            'success' => true,
            'data' => $result,
        ]);
    }

    public function get(ServerRequestInterface $req, ResponseInterface $res, array $args): ResponseInterface
    {
        $appId = (int)($args['app_id'] ?? 0);
        $row = $this->repo->findRawByAppId($appId);

        if ($row === null) {
            return $this->json($res->withStatus(404), [
                'success' => false,
                'message' => 'Not found',
            ]);
        }

        return $this->json($res, [
            'success' => true,
            'data' => $row,
        ]);
    }

    public function upsert(ServerRequestInterface $req, ResponseInterface $res): ResponseInterface
    {
        $body = (string)$req->getBody();
        $payload = json_decode($body, true);
        if (!is_array($payload)) {
            return $this->json($res->withStatus(400), [
                'success' => false,
                'message' => 'Invalid JSON',
            ]);
        }

        $patchText = (string)($payload['patch_text'] ?? '');
        $rawIds = $payload['app_ids'] ?? '';
        $appIds = $this->normalizeAppIds($rawIds);

        if ($appIds === []) {
            return $this->json($res->withStatus(422), [
                'success' => false,
                'message' => 'app_ids is required',
            ]);
        }

        $updated = $this->repo->upsertMany($appIds, $patchText);

        return $this->json($res, [
            'success' => true,
            'data' => [
                'updated' => $updated,
            ],
        ]);
    }

    public function delete(ServerRequestInterface $req, ResponseInterface $res, array $args): ResponseInterface
    {
        $appId = (int)($args['app_id'] ?? 0);
        $ok = $this->repo->deleteByAppId($appId);

        return $this->json($res, [
            'success' => true,
            'data' => [
                'deleted' => $ok ? 1 : 0,
            ],
        ]);
    }

    /**
     * @param mixed $raw
     * @return int[]
     */
    private function normalizeAppIds(mixed $raw): array
    {
        $ids = [];
        if (is_array($raw)) {
            foreach ($raw as $v) {
                $s = trim((string)$v);
                if ($s !== '' && ctype_digit($s)) {
                    $ids[] = (int)$s;
                }
            }
        } else {
            $s = trim((string)$raw);
            if ($s !== '') {
                // 줄바꿈/쉼표/공백 모두 허용
                $parts = preg_split('/[\r\n,\s]+/', $s) ?: [];
                foreach ($parts as $p) {
                    $p = trim((string)$p);
                    if ($p !== '' && ctype_digit($p)) {
                        $ids[] = (int)$p;
                    }
                }
            }
        }

        // 중복 제거
        $ids = array_values(array_unique($ids));
        sort($ids);
        return $ids;
    }

    private function json(ResponseInterface $res, array $data): ResponseInterface
    {
        $payload = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            $payload = '{"success":false,"message":"json_encode failed"}';
        }
        $res->getBody()->write($payload);
        return $res;
    }
}
