<?php
declare(strict_types=1);

namespace App\Steam;

final class SteamWebApiClient
{
    public function __construct(
        private string $apiKey,
        private int $timeoutSeconds = 10,
    ) {}

    public function getPlayerSummary(string $steamId): ?array
    {
        $data = $this->get('ISteamUser/GetPlayerSummaries/v0002/', [
            'steamids' => $steamId,
        ]);

        $players = $data['response']['players'] ?? [];
        return $players[0] ?? null;
    }

    public function getOwnedGames(string $steamId, bool $includeAppInfo = true): ?array
    {
        $data = $this->get('IPlayerService/GetOwnedGames/v0001/', [
            'steamid' => $steamId,
            'include_appinfo' => $includeAppInfo ? 1 : 0,
            'include_played_free_games' => 1,
        ]);

        return $data['response'] ?? null;
    }

    private function get(string $path, array $query): array
    {
        $query = array_merge($query, ['key' => $this->apiKey]);

        $url = 'https://api.steampowered.com/' . ltrim($path, '/')
            . '?' . http_build_query($query);

        $ctx = stream_context_create([
            'http' => [
                'method'  => 'GET',
                'timeout' => $this->timeoutSeconds,
            ],
        ]);

        $json = @file_get_contents($url, false, $ctx);
        if ($json === false) {
            throw new \RuntimeException('Steam Web API request failed');
        }

        $data = json_decode($json, true);
        if (!is_array($data)) {
            throw new \RuntimeException('Steam Web API returned invalid JSON');
        }

        return $data;
    }
}
