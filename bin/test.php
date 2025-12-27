<?php
declare(strict_types=1);

/**
 * Smoke test for /api/deal/sub/{id}
 *
 * Usage:
 *   php tests/smoke_sub.php 7
 *   BASE_URL=https://sesl0ver.dev php tests/smoke_sub.php 7
 */

$baseUrl = getenv('BASE_URL') ?: 'https://sesl0ver.dev';
$subId = $argv[1] ?? '7';

if (!preg_match('/^\d+$/', $subId)) {
    fwrite(STDERR, "Invalid sub id: {$subId}\n");
    exit(2);
}

$url = rtrim($baseUrl, '/') . "/api/deal/sub/{$subId}";

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HTTPHEADER => [
        'Accept: application/json',
    ],
]);

$body = curl_exec($ch);
$errno = curl_errno($ch);
$err = curl_error($ch);
$httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($errno !== 0) {
    fwrite(STDERR, "cURL error ({$errno}): {$err}\n");
    exit(3);
}

if ($body === false || $body === '') {
    fwrite(STDERR, "Empty response body. HTTP {$httpCode}\n");
    exit(4);
}

$data = json_decode($body, true);
if (!is_array($data)) {
    fwrite(STDERR, "Invalid JSON. HTTP {$httpCode}\nRaw:\n{$body}\n");
    exit(5);
}

// ---------- Assertions ----------
function assertTrue(bool $cond, string $msg): void {
    if (!$cond) {
        fwrite(STDERR, "❌ FAIL: {$msg}\n");
        exit(10);
    }
}

assertTrue($httpCode === 200, "HTTP code should be 200, got {$httpCode}");
assertTrue(($data['success'] ?? null) === true, "success should be true");
assertTrue(isset($data['data']) && is_array($data['data']), "data must exist");

$payload = $data['data'];

assertTrue(isset($payload['steam']['sub']) && is_array($payload['steam']['sub']), "steam.sub must exist");
$sub = $payload['steam']['sub'];

assertTrue((string)($sub['id'] ?? '') === (string)$subId, "steam.sub.id must match requested sub id");
assertTrue(is_string($sub['title'] ?? null) && $sub['title'] !== '', "steam.sub.title must be non-empty string");

if (isset($sub['price']) && $sub['price'] !== null) {
    assertTrue(is_array($sub['price']), "steam.sub.price must be array or null");
    assertTrue(isset($sub['price']['currency']), "steam.sub.price.currency must exist");
    assertTrue(isset($sub['price']['regular']), "steam.sub.price.regular must exist");
    assertTrue(isset($sub['price']['final']), "steam.sub.price.final must exist");
}

assertTrue(isset($payload['deal']) && is_array($payload['deal']), "deal must exist");
$deal = $payload['deal'];

assertTrue(in_array($deal['status'] ?? null, ['available', 'unavailable'], true), "deal.status must be available|unavailable");

if (($deal['status'] ?? null) === 'available') {
    assertTrue(isset($deal['current']) && is_array($deal['current']), "deal.current must exist when available");
    assertTrue(isset($deal['current']['amount']), "deal.current.amount must exist");
    assertTrue(isset($deal['current']['currency']), "deal.current.currency must exist");
    assertTrue(isset($deal['current']['regular_price']), "deal.current.regular_price must exist");
}

if (isset($deal['historical_low'])) {
    assertTrue(is_array($deal['historical_low']), "deal.historical_low must be array");
    assertTrue(isset($deal['historical_low']['amount']), "historical_low.amount must exist");
    assertTrue(isset($deal['historical_low']['last_seen_at']), "historical_low.last_seen_at should exist (may be null if provider omits)");
}

assertTrue(isset($payload['meta']) && is_array($payload['meta']), "meta must exist");
assertTrue(($payload['meta']['kind'] ?? null) === 'sub', "meta.kind must be 'sub'");
assertTrue((string)($payload['meta']['id'] ?? '') === (string)$subId, "meta.id must match sub id");

// ---------- Output ----------
echo "✅ OK: /api/deal/sub/{$subId}\n";
echo "   title: " . $sub['title'] . "\n";
echo "   deal.status: " . ($deal['status'] ?? '-') . "\n";

if (($deal['status'] ?? null) === 'available') {
    $cur = $deal['current'];
    echo "   current: {$cur['amount']} {$cur['currency']} (regular {$cur['regular_price']})\n";
}

if (isset($deal['historical_low'])) {
    $hl = $deal['historical_low'];
    echo "   historical_low: {$hl['amount']} " . ($hl['currency'] ?? '') . " (last_seen_at: " . ($hl['last_seen_at'] ?? 'null') . ")\n";
}
