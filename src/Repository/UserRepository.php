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
        if ($row) {
            $row['id'] = (string)$row['id'];
            $row['steam_id'] = (string)$row['steam_id'];
        }
        return $row ?: null;
    }

    /**
     * 관리자용: 사용자 목록 페이징 조회
     */
    public function listPaged(int $page, int $perPage, ?string $query = null): array
    {
        $offset = ($page - 1) * $perPage;
        $whereSql = '';
        $params = [];

        if ($query !== null && $query !== '') {
            $params[':q1'] = "%$query%";
            if (ctype_digit($query)) {
                $whereSql = "WHERE persona_name ILIKE :q1 OR steam_id = :q2";
                $params[':q2'] = $query;
            } else {
                $whereSql = "WHERE persona_name ILIKE :q1";
            }
        }

        $sql = "SELECT * FROM users {$whereSql} ORDER BY last_login_at DESC LIMIT :limit OFFSET :offset";
        $stmt = $this->pdo->prepare($sql);

        foreach ($params as $key => $val) {
            $stmt->bindValue($key, $val, PDO::PARAM_STR);
        }
        $stmt->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);

        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $items = [];
        foreach ($rows as $row) {
            $row['id'] = (string)$row['id'];
            $row['steam_id'] = (string)$row['steam_id'];
            $items[] = $row;
        }

        $total = $this->countAll($query);

        return [
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'total_pages' => (int)ceil($total / max(1, $perPage)),
        ];
    }

    /**
     * 관리자용: 전체 사용자 수 계산
     */
    public function countAll(?string $query = null): int
    {
        $whereSql = '';
        $params = [];

        if ($query !== null && $query !== '') {
            $params[':q1'] = "%$query%";
            if (ctype_digit($query)) {
                $whereSql = "WHERE persona_name ILIKE :q1 OR steam_id = :q2";
                $params[':q2'] = $query;
            } else {
                $whereSql = "WHERE persona_name ILIKE :q1";
            }
        }

        $sql = "SELECT COUNT(*) FROM users {$whereSql}";
        $stmt = $this->pdo->prepare($sql);

        foreach ($params as $key => $val) {
            $stmt->bindValue($key, $val, PDO::PARAM_STR);
        }

        $stmt->execute();

        return (int)$stmt->fetchColumn();
    }

    /**
     * 관리자용: 사용자 삭제 (ID 기준)
     * id는 bigint이므로 string으로 처리하는 것이 오버플로우 방지에 안전합니다.
     */
    public function deleteById(string|int $id): bool
    {
        $this->pdo->beginTransaction();
        try {
            $paramType = is_int($id) ? PDO::PARAM_INT : PDO::PARAM_STR;

            // 찜 목록 명시적 삭제 (요구사항)
            $stmtWish = $this->pdo->prepare('DELETE FROM wishlist WHERE user_id = :id');
            $stmtWish->bindValue(':id', $id, $paramType);
            $stmtWish->execute();

            // 사용자 삭제
            $stmtUser = $this->pdo->prepare('DELETE FROM users WHERE id = :id');
            $stmtUser->bindValue(':id', $id, $paramType);
            $ok = $stmtUser->execute();

            $this->pdo->commit();
            return $ok;
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }
}
