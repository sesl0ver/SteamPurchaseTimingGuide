<?php
declare(strict_types=1);

namespace App\Repository;

use PDO;

final class CommunityKoreanPatchRepository
{
    public function __construct(private readonly PDO $pdo) {}

    /**
     * Admin용 Raw 조회 (편집 화면용)
     *
     * @return array{app_id:int, link_count:int, patch_text:string, updated_at:string}|null
     */
    public function findRawByAppId(int $appId): ?array
    {
        return $this->findByAppId($appId);
    }

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

    /**
     * Admin용 리스트/검색 + 페이징
     *
     * @return array{items:list<array{app_id:int, link_count:int, patch_text:string, updated_at:string}>, page:int, per_page:int, total:int, total_pages:int, q:?int}
     */
    public function listPaged(int $page, int $perPage, ?int $appIdFilter = null): array
    {
        $offset = ($page - 1) * $perPage;
        if ($offset < 0) { $offset = 0; }

        $where = '';
        $params = [];
        if ($appIdFilter !== null) {
            $where = 'WHERE app_id = :app_id';
            $params['app_id'] = $appIdFilter;
        }

        $cntSql = "SELECT COUNT(*) FROM public.community_korean_patch {$where}";
        $cntStmt = $this->pdo->prepare($cntSql);
        $cntStmt->execute($params);
        $total = (int)$cntStmt->fetchColumn();

        $sql = <<<SQL
SELECT app_id, name, link_count, patch_text, updated_at
FROM public.community_korean_patch
{$where}
ORDER BY updated_at DESC NULLS LAST, app_id DESC
LIMIT :limit OFFSET :offset
SQL;

        $stmt = $this->pdo->prepare($sql);
        foreach ($params as $k => $v) {
            $stmt->bindValue(':' . $k, $v, PDO::PARAM_INT);
        }
        $stmt->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();

        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $items = [];
        foreach ($rows as $row) {
            $items[] = [
                'app_id' => (int)$row['app_id'],
                'name' => (string)$row['name'],
                'link_count' => (int)($row['link_count'] ?? 0),
                'patch_text' => (string)($row['patch_text'] ?? ''),
                'updated_at' => (string)($row['updated_at'] ?? ''),
            ];
        }

        $totalPages = (int)ceil($total / max(1, $perPage));
        if ($totalPages < 1) { $totalPages = 1; }
        if ($page > $totalPages) { $page = $totalPages; }

        return [
            'items' => $items,
            'page' => $page,
            'per_page' => $perPage,
            'total' => $total,
            'total_pages' => $totalPages,
            'q' => $appIdFilter,
        ];
    }

    /**
     * Admin용 Upsert(여러 AppID 지원)
     *
     * @param int[] $appIds
     */
    public function upsertMany(array $appIds, string $patchText): int
    {
        $patchText = (string)$patchText;
        $linkCount = $this->countLinks($patchText);

        $sql = <<<SQL
INSERT INTO public.community_korean_patch (app_id, link_count, patch_text, updated_at)
VALUES (:app_id, :link_count, :patch_text, NOW())
ON CONFLICT (app_id)
DO UPDATE SET
  link_count = EXCLUDED.link_count,
  patch_text = EXCLUDED.patch_text,
  updated_at = NOW()
SQL;

        $stmt = $this->pdo->prepare($sql);

        $updated = 0;
        foreach ($appIds as $appId) {
            $stmt->execute([
                'app_id' => (int)$appId,
                'link_count' => $linkCount,
                'patch_text' => $patchText,
            ]);
            $updated++;
        }
        return $updated;
    }

    public function deleteByAppId(int $appId): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM public.community_korean_patch WHERE app_id = :app_id');
        $stmt->execute(['app_id' => $appId]);
        return $stmt->rowCount() > 0;
    }

    private function countLinks(string $patchText): int
    {
        $patchText = trim($patchText);
        if ($patchText === '') {
            return 0;
        }

        $lines = preg_split("/\r\n|\n|\r/", $patchText) ?: [];
        $count = 0;
        foreach ($lines as $line) {
            $trim = trim((string)$line);
            if ($trim === '') { continue; }
            $first = trim((string)explode('|', $trim, 2)[0]);
            if ($first !== '' && filter_var($first, FILTER_VALIDATE_URL)) {
                $count++;
            }
        }
        return $count;
    }
}
