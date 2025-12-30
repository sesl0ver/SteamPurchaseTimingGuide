<?php
declare(strict_types=1);

namespace App\Service;

use Psr\Http\Message\ServerRequestInterface;

final class Fingerprint
{
    public static function fromRequest(ServerRequestInterface $req): string
    {
        $ip = $req->getServerParams()['REMOTE_ADDR'] ?? '0.0.0.0';
        $ua = $req->getHeaderLine('User-Agent');
        $lang = $req->getHeaderLine('Accept-Language');

        // IP /24 마스킹
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $parts = explode('.', $ip);
            $ip = "{$parts[0]}.{$parts[1]}.{$parts[2]}.0";
        }

        $raw = $ip . '|' . substr($ua, 0, 120) . '|' . substr($lang, 0, 32);

        return substr(hash('sha256', $raw), 0, 24);
    }
}
