<?php
declare(strict_types=1);

namespace App\Steam;

use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;

final class SteamWebApiClient
{
    public function __construct(
        private ClientInterface $http,
        private string $apiKey,
        private int $timeoutSeconds = 10,
    ) {}

    public function getPlayerSummary(string $steamId): ?array
    {
        try {
            $data = $this->get('ISteamUser/GetPlayerSummaries/v0002/', [
                'steamids' => $steamId,
            ]);

            $players = $data['response']['players'] ?? [];
            return $players[0] ?? null;
        } catch (\Throwable) {
            return null;
        }
    }

    public function getOwnedGames(string $steamId, bool $includeAppInfo = true): ?array
    {
        try {
            $data = $this->get('IPlayerService/GetOwnedGames/v0001/', [
                'steamid' => $steamId,
                'include_appinfo' => $includeAppInfo ? 1 : 0,
                'include_played_free_games' => 1,
            ]);

            return $data['response'] ?? null;
        } catch (\Throwable) {
            return null;
        }
    }

    private function get(string $path, array $query): array
    {
        try {
            $response = $this->http->request('GET', 'https://api.steampowered.com/' . ltrim($path, '/'), [
                'query' => array_merge($query, ['key' => $this->apiKey]),
                'timeout' => $this->timeoutSeconds,
            ]);

            $raw = (string)$response->getBody();
            $data = json_decode($raw, true);

            if (!is_array($data)) {
                throw new \RuntimeException('Steam Web API returned invalid JSON');
            }

            return $data;
        } catch (GuzzleException $e) {
            throw new \RuntimeException('Steam Web API request failed: ' . $e->getMessage(), 0, $e);
        }
    }
}
