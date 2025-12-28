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
        // - 기존 포맷은 "한 줄 = 한 링크"였지만, 실제 데이터에는
        //   "URL | 제목" 다음 줄들에 참여자/역할 등 설명이 이어지는 케이스가 존재합니다.
        // - 따라서 URL 라인을 "앵커"로 보고, 다음 URL이 나오기 전까지의 모든 줄을
        //   해당 링크의 title(멀티라인)로 누적합니다.
        $rawLines = preg_split("/\r\n|\n|\r/", $patchText) ?: [];

        /** @var list<array{url:string, _title_lines:list<string>}> $items */
        $items = [];
        $currentIndex = null;

        foreach ($rawLines as $rawLine) {
            // 오른쪽 공백만 제거하고, URL 탐지는 trim()된 문자열로 수행
            $line = rtrim((string)$rawLine);
            $trimmed = trim($line);

            // 빈 줄도 블록 내에서는 의미가 있을 수 있어 보존(단, 링크 시작 전에는 무시)
            if ($trimmed === '') {
                if ($currentIndex !== null) {
                    $items[$currentIndex]['_title_lines'][] = '';
                }
                continue;
            }

            // 2) "URL | 설명" 형식. | 가 없을 수도 있으니 방어적으로 처리
            $parts = array_map('trim', explode('|', $trimmed, 2));
            $url = $parts[0] ?? '';
            $title = $parts[1] ?? '';

            // URL 라인이면 새 아이템 시작
            if ($url !== '' && $this->looksLikeUrl($url)) {
                $items[] = [
                    'url' => $url,
                    '_title_lines' => $title !== '' ? [$title] : [],
                ];
                $currentIndex = count($items) - 1;
                continue;
            }

            // URL이 아닌 라인은 직전 URL 아이템의 설명으로 누적
            if ($currentIndex !== null) {
                $items[$currentIndex]['_title_lines'][] = $trimmed;
            }
        }

        // 3) 최종 title/description 구성
        $finalItems = [];
        foreach ($items as $it) {
            $lines = $it['_title_lines'];

            while ($lines !== [] && trim((string)($lines[0] ?? '')) === '') {
                array_shift($lines);
            }
            while ($lines !== [] && trim((string)($lines[count($lines) - 1] ?? '')) === '') {
                array_pop($lines);
            }

            $description = implode("\n", $lines);

            $finalItems[] = [
                // 제목은 URL 그대로 사용 (이미지 상단 타이틀용)
                'url' => $it['url'],
                'description' => $description !== ''
                    ? $description
                    : $it['url'],
            ];
        }

        // 3) link_count와 실제 라인 수가 다를 수 있음 (구 데이터 호환용)
        // - 현재 포맷에서는 items 기준이 진실이므로 items만으로 exists 결정
        $exists = count($finalItems) > 0;

        return [
            'exists' => $exists,
            'items' => $finalItems,
            'updated_at' => $updatedAt,
            'evidence' => 'db.community_korean_patch',
        ];
    }

    private function looksLikeUrl(string $s): bool
    {
        return (bool) filter_var($s, FILTER_VALIDATE_URL);
    }
}
