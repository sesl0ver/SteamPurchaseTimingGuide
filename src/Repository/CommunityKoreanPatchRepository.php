<?php
declare(strict_types=1);

namespace App\Repository;

use PDO;

final class CommunityKoreanPatchRepository
{
    public function __construct(private readonly PDO $pdo) {}

    /**
     * @return array{app_id:int, link_count:int, patch_text:string, updated_at:string}|null
     */
    public function findByAppId(int $appId): ?array
    {
        $sql = <<<SQL
SELECT app_id, link_count, patch_text, updated_at
FROM public.community_korean_patch
WHERE app_id = :app_id
LIMIT 1
SQL;

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute(['app_id' => $appId]);

        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }

        return [
            'app_id' => (int)$row['app_id'],
            'link_count' => (int)$row['link_count'],
            'patch_text' => (string)$row['patch_text'],
            'updated_at' => (string)$row['updated_at'],
        ];
    }
}
