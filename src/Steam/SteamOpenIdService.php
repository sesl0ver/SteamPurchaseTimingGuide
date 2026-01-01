<?php

namespace App\Steam;

use GuzzleHttp\ClientInterface;

/**
 * Steam OpenID 2.0 helper
 * - 외부 라이브러리 없이 Steam OpenID 규격에 맞춰 로그인 URL 생성 및 콜백 검증을 수행합니다.
 */
class SteamOpenIdService
{
    private const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';

    public function __construct(private ClientInterface $http) {}

    /**
     * Steam 로그인 페이지로 보낼 URL 생성
     */
    public function buildAuthUrl(string $returnTo, string $realm): string
    {
        $params = [
            'openid.ns'         => 'http://specs.openid.net/auth/2.0',
            'openid.mode'       => 'checkid_setup',
            'openid.return_to'  => $returnTo,
            'openid.realm'      => $realm,
            'openid.identity'   => 'http://specs.openid.net/auth/2.0/identifier_select',
            'openid.claimed_id' => 'http://specs.openid.net/auth/2.0/identifier_select',
        ];

        return self::OPENID_ENDPOINT . '?' . http_build_query($params);
    }

    /**
     * OpenID 콜백 파라미터 검증 후 SteamID64 반환
     *
     * @return string|null SteamID64(정상) / null(실패)
     */
    public function validateAndGetSteamId(array $queryParams, string $returnTo): ?string
    {
        // 기본 파라미터 검증
        $required = ['openid_assoc_handle', 'openid_signed', 'openid_sig', 'openid_claimed_id'];
        foreach ($required as $k) {
            if (!isset($queryParams[$k]) || $queryParams[$k] === '') {
                return null;
            }
        }

        // claimed_id 에서 SteamID 추출
        $claimedId = (string)$queryParams['openid_claimed_id'];
        if (!preg_match('~^https?://steamcommunity\.com/openid/id/(\d{17})$~', $claimedId, $m)) {
            return null;
        }
        $steamId = $m[1];

        // check_authentication 요청 구성
        // - PHP는 query string의 '.'을 '_'로 바꿔서 파싱하므로(openid.sig -> openid_sig)
        //   콜백으로 받은 값을 다시 OpenID 포맷(openid.sig)으로 되돌려 POST합니다.
        $post = [
            'openid.ns'   => 'http://specs.openid.net/auth/2.0',
            'openid.mode' => 'check_authentication',
        ];

        foreach ($queryParams as $k => $v) {
            if (is_string($k) && str_starts_with($k, 'openid_') && $k !== 'openid_mode') {
                $field = substr($k, 7);
                $post['openid.' . $field] = $v;
            }
        }

        // return_to는 위/변조 방지 차원에서 강제 고정
        $post['openid.return_to'] = $returnTo;

        try {
            $res = $this->http->request('POST', self::OPENID_ENDPOINT, [
                'form_params' => $post,
                'timeout' => 10.0,
            ]);
            $body = (string)$res->getBody();
        } catch (\Throwable) {
            return null;
        }

        // Steam 응답: "is_valid:true" 포함 여부로 판단
        if (!str_contains($body, "is_valid:true")) {
            return null;
        }

        return $steamId;
    }
}
