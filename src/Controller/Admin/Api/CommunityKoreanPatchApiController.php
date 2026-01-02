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
        $name = (string)($payload['name'] ?? '');
        $appIdRaw = trim((string)($payload['app_id'] ?? ''));

        if ($appIdRaw === '' || !ctype_digit($appIdRaw)) {
            return $this->json($res->withStatus(422), [
                'success' => false,
                'message' => 'app_id is required',
            ]);
        }

        $ok = $this->repo->upsertOne((int)$appIdRaw, $name, $patchText);

        return $this->json($res, [
            'success' => true,
            'data' => [
                'updated' => $ok ? 1 : 0,
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
