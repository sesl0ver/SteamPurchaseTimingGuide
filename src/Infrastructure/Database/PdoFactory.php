<?php

declare(strict_types=1);

namespace App\Infrastructure\Database;

use PDO;
use PDOException;

final class PdoFactory
{
    public static function create(): PDO
    {
        $host = $_ENV['DB_HOST'];
        $port = $_ENV['DB_PORT'] ?? '5432';
        $db   = $_ENV['DB_NAME'];
        $user = $_ENV['DB_USER'];
        $pass = $_ENV['DB_PASS'];

        $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', $host, $port, $db);

        try {
            return new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            throw new \RuntimeException(
                'Database connection failed: ' . $e->getMessage(),
                (int)$e->getCode(),
                $e
            );
        }
    }
}
