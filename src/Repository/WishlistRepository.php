<?php

namespace App\Repository;

use PDO;

/**
 * 찜(위시리스트) 저장/조회용 Repository
 *
 * - user_id(users.id) 기반
 * - kind(app/sub/bundle) + item_id 조합으로 한 유저당 1개만 허용
 */
class WishlistRepository
{
    public function __construct(private PDO $pdo) {}

    public function countByUser(int $userId): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM wishlist WHERE user_id = :uid');
        $stmt->execute([':uid' => $userId]);
        return (int)($stmt->fetchColumn() ?: 0);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function listByUserPaged(int $userId, int $limit, int $offset): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT kind, item_id, title, header_image, steam_url, created_at '
            . 'FROM wishlist WHERE user_id = :uid ORDER BY created_at DESC LIMIT :lim OFFSET :off'
        );
        $stmt->bindValue(':uid', $userId, PDO::PARAM_INT);
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':off', $offset, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function listByUser(int $userId, int $limit = 200): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT kind, item_id, title, header_image, steam_url, created_at '
            . 'FROM wishlist WHERE user_id = :uid ORDER BY created_at DESC LIMIT :lim'
        );
        $stmt->bindValue(':uid', $userId, PDO::PARAM_INT);
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    public function exists(int $userId, string $kind, string $itemId): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT 1 FROM wishlist WHERE user_id = :uid AND kind = :kind AND item_id = :item_id LIMIT 1'
        );
        $stmt->execute([
            ':uid' => $userId,
            ':kind' => $kind,
            ':item_id' => $itemId,
        ]);
        return (bool)$stmt->fetchColumn();
    }

    /**
     * 토글: 없으면 추가, 있으면 삭제
     *
     * @return bool true = 찜 상태(추가됨), false = 해제됨(삭제됨)
     */
    public function toggle(
        int $userId,
        string $kind,
        string $itemId,
        string $title = '',
        string $headerImage = '',
        string $steamUrl = ''
    ): bool {
        $this->pdo->beginTransaction();
        try {
            if ($this->exists($userId, $kind, $itemId)) {
                $del = $this->pdo->prepare(
                    'DELETE FROM wishlist WHERE user_id = :uid AND kind = :kind AND item_id = :item_id'
                );
                $del->execute([
                    ':uid' => $userId,
                    ':kind' => $kind,
                    ':item_id' => $itemId,
                ]);
                $this->pdo->commit();
                return false;
            }

            $ins = $this->pdo->prepare(
                'INSERT INTO wishlist (user_id, kind, item_id, title, header_image, steam_url, created_at) '
                . 'VALUES (:uid, :kind, :item_id, :title, :header_image, :steam_url, NOW())'
            );
            $ins->execute([
                ':uid' => $userId,
                ':kind' => $kind,
                ':item_id' => $itemId,
                ':title' => $title,
                ':header_image' => $headerImage,
                ':steam_url' => $steamUrl,
            ]);
            $this->pdo->commit();
            return true;
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    public function deleteByUser(int $userId): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM wishlist WHERE user_id = :uid');
        $stmt->execute([':uid' => $userId]);
    }

    public function deleteOne(int $userId, string $kind, string $itemId): void
    {
        $stmt = $this->pdo->prepare(
            'DELETE FROM wishlist WHERE user_id = :uid AND kind = :kind AND item_id = :item_id'
        );
        $stmt->execute([
            ':uid' => $userId,
            ':kind' => $kind,
            ':item_id' => $itemId,
        ]);
    }
}
