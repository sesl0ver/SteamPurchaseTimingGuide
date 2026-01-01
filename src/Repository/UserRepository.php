<?php

namespace App\Repository;

use PDO;

/**
 * Steam 유저 기본 정보 저장/조회용 Repository
 * - 향후 보유 게임/도전과제 등 확장 시 steam_id를 FK로 연결할 수 있도록 설계했습니다.
 */
class UserRepository
{
    public function __construct(private PDO $pdo) {}

    /**
     * Steam 유저 정보 upsert
     *
     * @param array{steam_id:string,persona_name?:string,profile_url?:string,avatar_small?:string,avatar_medium?:string,avatar_full?:string,loccountrycode?:string,locstatecode?:string,loccityid?:int,communityvisibilitystate?:int,profilestate?:int} $data
     */
    public function upsertFromSteam(array $data): void
    {
        $sql = <<<SQL
INSERT INTO users (
  steam_id,
  persona_name,
  profile_url,
  avatar_small,
  avatar_medium,
  avatar_full,
  community_visibility_state,
  profile_state,
  last_login_at,
  created_at,
  updated_at
) VALUES (
  :steam_id,
  :persona_name,
  :profile_url,
  :avatar_small,
  :avatar_medium,
  :avatar_full,
  :community_visibility_state,
  :profile_state,
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (steam_id) DO UPDATE SET
  persona_name = EXCLUDED.persona_name,
  profile_url = EXCLUDED.profile_url,
  avatar_small = EXCLUDED.avatar_small,
  avatar_medium = EXCLUDED.avatar_medium,
  avatar_full = EXCLUDED.avatar_full,
  community_visibility_state = EXCLUDED.community_visibility_state,
  profile_state = EXCLUDED.profile_state,
  last_login_at = NOW(),
  updated_at = NOW()
SQL;

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            ':steam_id' => (string)$data['steam_id'],
            ':persona_name' => (string)($data['persona_name'] ?? ''),
            ':profile_url' => (string)($data['profile_url'] ?? ''),
            ':avatar_small' => (string)($data['avatar_small'] ?? ''),
            ':avatar_medium' => (string)($data['avatar_medium'] ?? ''),
            ':avatar_full' => (string)($data['avatar_full'] ?? ''),
            ':community_visibility_state' => isset($data['communityvisibilitystate']) ? (int)$data['communityvisibilitystate'] : null,
            ':profile_state' => isset($data['profilestate']) ? (int)$data['profilestate'] : null,
        ]);
    }

    /**
     * @return array<string,mixed>|null
     */
    public function findBySteamId(string $steamId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE steam_id = :steam_id LIMIT 1');
        $stmt->execute([':steam_id' => $steamId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }
}
