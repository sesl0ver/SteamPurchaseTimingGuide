<?php
declare(strict_types=1);

namespace App\Service;

final class CommunityKoreanPatchParser
{
    /**
     * @param array{app_id:int, link_count:int, patch_text:string, updated_at:string}|null $row
     * @return array{
     *   exists: bool,
     *   items: list<array{url:string, title:string}>,
     *   updated_at: string|null,
     *   evidence: string
     * }
     */
    public function fromRow(?array $row): array
    {
        if ($row === null) {
            return [
                'exists' => false,
                'items' => [],
                'updated_at' => null,
                'evidence' => 'db.community_korean_patch',
            ];
        }

        $patchText = (string)($row['patch_text'] ?? '');
        $updatedAt = isset($row['updated_at']) ? (string)$row['updated_at'] : null;

        // link_count는 기존 컬럼이지만, 현재 포맷(라인 단위)에서는 신뢰도가 떨어질 수 있어 참고만 합니다.
        $linkCount = (int)($row['link_count'] ?? 0);

        return $this->parse($patchText, $updatedAt, $linkCount);
    }

    /**
     * patch_text 포맷:
     * - 줄바꿈으로 여러 레코드
     * - 각 줄은: "URL | 설명"
     *
     * @return array{
     *   exists: bool,
     *   items: list<array{url:string, title:string}>,
     *   updated_at: string|null,
     *   evidence: string
     * }
     */
    public function parse(string $patchText, ?string $updatedAt = null, int $linkCount = 0): array
    {
        $patchText = trim($patchText);
        if ($patchText === '') {
            return [
                'exists' => false,
                'items' => [],
                'updated_at' => $updatedAt,
                'evidence' => 'db.community_korean_patch',
            ];
        }

        // 1) 줄 단위 분리 (CRLF/LF 모두 대응)
        $lines = preg_split("/\r\n|\n|\r/", $patchText) ?: [];
        $lines = array_values(array_filter(array_map('trim', $lines), static fn($v) => $v !== ''));

        $items = [];

        foreach ($lines as $line) {
            // 2) "URL | 설명" 형식. | 가 없을 수도 있으니 방어적으로 처리
            $parts = array_map('trim', explode('|', $line, 2));
            $url = $parts[0] ?? '';
            $title = $parts[1] ?? '';

            // URL이 아니면 이 라인은 무시(또는 title로 흡수) - 운영 안정성 우선
            if ($url === '' || !$this->looksLikeUrl($url)) {
                continue;
            }

            // title이 비어있으면 도메인/기본값이라도 넣고 싶으면 여기서 처리 가능
            $items[] = [
                'url' => $url,
                'title' => $title,
            ];
        }

        // 3) link_count와 실제 라인 수가 다를 수 있음 (구 데이터 호환용)
        // - 현재 포맷에서는 items 기준이 진실이므로 items만으로 exists 결정
        $exists = count($items) > 0;

        return [
            'exists' => $exists,
            'items' => $items,
            'updated_at' => $updatedAt,
            'evidence' => 'db.community_korean_patch',
        ];
    }

    private function looksLikeUrl(string $s): bool
    {
        return (bool) filter_var($s, FILTER_VALIDATE_URL);
    }
}
