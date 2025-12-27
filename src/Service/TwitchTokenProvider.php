<?php
declare(strict_types=1);

namespace App\Service;

use App\Infrastructure\Cache\RedisCache;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;

final class TwitchTokenProvider
{
    private const CACHE_KEY = 'twitch:token:v1';
    private const SAFETY_BUFFER_SECONDS = 60;

    private ClientInterface $http;
    private RedisCache $cache;
    private string $clientId;
    private string $clientSecret;

    public function __construct(
        ClientInterface $http,
        RedisCache $cache
    ) {
        $this->http = $http;
        $this->cache = $cache;
        $this->clientId = $_ENV['TWITCH_CLIENT_ID'] ?? '';
        $this->clientSecret = $_ENV['TWITCH_CLIENT_SECRET'] ?? '';
    }

    /**
     * 최종 목표: Bearer 토큰 문자열(액세스 토큰) 반환
     */
    public function getAccessToken(): string
    {
        // 1) 캐시가 있고 만료 전이면 캐시 사용
        $cached = $this->readCache();
        if ($cached !== null) {
            return $cached['access_token'];
        }

        // 2) 없거나 만료/손상 -> 새 토큰 발급
        $tokenResp = $this->requestNewToken();

        $accessToken = (string)$tokenResp['access_token'];
        $expiresIn   = (int)$tokenResp['expires_in'];

        if ($accessToken === '' || $expiresIn < self::SAFETY_BUFFER_SECONDS) {
            throw new \RuntimeException('Unexpected token response: empty token or too small expires_in.');
        }

        // 3) 캐시 저장
        $expiresAt = time() + $expiresIn;

        $payload = [
            'access_token' => $accessToken,
            'expires_at'   => $expiresAt,
        ];

        // Redis TTL은 만료 안전 버퍼를 뺀 값으로(너무 작으면 최소 60초)
        $ttl = max(60, $expiresIn - self::SAFETY_BUFFER_SECONDS);
        $this->writeCache($payload, $ttl);

        return $payload['access_token'];
    }

    /**
     * @return array{access_token:string, expires_at:int}|null
     */
    private function readCache(): ?array
    {
        $data = $this->cache->getJson(self::CACHE_KEY);
        if (!is_array($data) || !isset($data['access_token'], $data['expires_at'])) {
            return null;
        }

        $expiresAt = (int)$data['expires_at'];

        // 안전 버퍼 60초: 만료 임박이면 재발급 유도
        if ($expiresAt <= time() + self::SAFETY_BUFFER_SECONDS) {
            return null;
        }

        $accessToken = (string)$data['access_token'];
        if ($accessToken === '') {
            return null;
        }

        return [
            'access_token' => $accessToken,
            'expires_at'   => $expiresAt,
        ];
    }

    /**
     * @param array{access_token:string, expires_at:int} $payload
     */
    private function writeCache(array $payload, int $ttl): void
    {
        // RedisCache 내부에서 ttl<1 방지하지만, 여기서도 최소 보장
        $ttl = max(60, $ttl);

        // JSON 형태 그대로 저장
        $this->cache->setJson(self::CACHE_KEY, $ttl, $payload);
    }

    /**
     * 토큰 발급 (Twitch Client Credentials)
     * @return array{access_token:string, expires_in:int}
     */
    private function requestNewToken(): array
    {
        if ($this->clientId === '' || $this->clientSecret === '') {
            throw new \RuntimeException('Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET.');
        }

        $url = 'https://id.twitch.tv/oauth2/token';

        try {
            // Twitch 문서: client_id, client_secret, grant_type=client_credentials
            $resp = $this->http->request('POST', $url, [
                'query' => [
                    'client_id'     => $this->clientId,
                    'client_secret' => $this->clientSecret,
                    'grant_type'    => 'client_credentials',
                ],
                'headers' => [
                    'Accept' => 'application/json',
                ],
                // 토큰 발급은 빠르게 실패하는 편이 낫습니다.
                'timeout' => 10.0,
                'connect_timeout' => 5.0,
                // 4xx/5xx도 예외 대신 응답으로 받고 우리가 처리
                'http_errors' => false,
            ]);
        } catch (GuzzleException $e) {
            throw new \RuntimeException('Token request failed: ' . $e->getMessage(), 0, $e);
        }

        $status = $resp->getStatusCode();
        $raw = (string)$resp->getBody();

        if ($status >= 400) {
            throw new \RuntimeException("Token HTTP {$status}: {$raw}");
        }

        $data = json_decode($raw, true);
        if (!is_array($data) || !isset($data['access_token'], $data['expires_in'])) {
            throw new \RuntimeException('Unexpected token response: ' . $raw);
        }

        return [
            'access_token' => (string)$data['access_token'],
            'expires_in'   => (int)$data['expires_in'],
        ];
    }
}
