<?php

namespace App\Controller;

use App\Repository\UserRepository;
use App\Steam\SteamOpenIdService;
use App\Steam\SteamService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Steam OpenID 로그인/로그아웃 컨트롤러
 *
 * 흐름
 * 1) /login (안내 페이지)
 * 2) /auth/steam/start  -> Steam OpenID로 리다이렉트
 * 3) /auth/steam/callback -> 검증 + Web API로 유저 정보 조회 + DB upsert + 세션 저장
 * 4) 리다이렉트: / (시작 페이지)
 */
class SteamAuthController
{
    public function __construct(
        private SteamOpenIdService $openId,
        private SteamService $steam,
        private UserRepository $users,
    ) {}

    public function start(Request $request, Response $response): Response
    {
        $base = $this->baseUrl($request);
        $returnTo = $base . '/auth/steam/callback';
        $realm = $base . '/';

        // 로그인 후 이동(요구사항: 시작 페이지)
        $_SESSION['redirect_after_login'] = '/';

        $url = $this->openId->buildAuthUrl($returnTo, $realm);
        return $response
            ->withHeader('Location', $url)
            ->withStatus(302);
    }

    public function callback(Request $request, Response $response): Response
    {
        $base = $this->baseUrl($request);
        $returnTo = $base . '/auth/steam/callback';

        $params = $request->getQueryParams();
        $steamId = $this->openId->validateAndGetSteamId($params, $returnTo);
        if ($steamId === null) {
            // 실패 시 로그인 페이지로
            return $response
                ->withHeader('Location', '/login?error=steam_auth_failed')
                ->withStatus(302);
        }

        // Steam Web API로 기본 프로필(닉네임/아바타/프로필 URL 등) 조회
        $summary = $this->steam->fetchProfile($steamId);
        if ($summary !== null) {
            $this->users->upsertFromSteam([
                'steam_id' => $steamId,
                'persona_name' => (string)($summary['personaname'] ?? ''),
                'profile_url' => (string)($summary['profileurl'] ?? ''),
                'avatar_small' => (string)($summary['avatar'] ?? ''),
                'avatar_medium' => (string)($summary['avatarmedium'] ?? ''),
                'avatar_full' => (string)($summary['avatarfull'] ?? ''),
                'loccountrycode' => (string)($summary['loccountrycode'] ?? ''),
                'locstatecode' => (string)($summary['locstatecode'] ?? ''),
                'loccityid' => isset($summary['loccityid']) ? (int)$summary['loccityid'] : null,
                'communityvisibilitystate' => isset($summary['communityvisibilitystate']) ? (int)$summary['communityvisibilitystate'] : null,
                'profilestate' => isset($summary['profilestate']) ? (int)$summary['profilestate'] : null,
            ]);
        }

        // 세션 저장(화면 표시용 최소 정보)
        $_SESSION['steam_user'] = [
            'steam_id' => $steamId,
            'persona_name' => (string)($summary['personaname'] ?? ''),
            'avatar_medium' => (string)($summary['avatarmedium'] ?? ''),
            'last_login_at' => time()
        ];

        $redirect = (string)($_SESSION['redirect_after_login'] ?? '/');
        unset($_SESSION['redirect_after_login']);

        return $response
            ->withHeader('Location', $redirect !== '' ? $redirect : '/')
            ->withStatus(302);
    }

    public function logout(Request $request, Response $response): Response
    {
        unset($_SESSION['steam_user'], $_SESSION['redirect_after_login']);

        return $response
            ->withHeader('Location', '/')
            ->withStatus(302);
    }

    private function baseUrl(Request $request): string
    {
        $uri = $request->getUri();
        $scheme = $uri->getScheme() ?: 'http';
        $host = $uri->getHost();
        $port = $uri->getPort();

        $base = $scheme . '://' . $host;
        if ($port !== null && !in_array($port, [80, 443], true)) {
            $base .= ':' . $port;
        }
        return $base;
    }
}
