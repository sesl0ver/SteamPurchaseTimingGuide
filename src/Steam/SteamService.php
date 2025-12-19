<?php
declare(strict_types=1);

namespace App\Steam;

final class SteamService
{
    public function __construct(
        private SteamWebApiClient $client,
    ) {}

    public function fetchProfile(string $steamId): ?array
    {
        return $this->client->getPlayerSummary($steamId);
    }

    public function fetchOwnedGames(string $steamId): ?array
    {
        return $this->client->getOwnedGames($steamId, true);
    }
}
