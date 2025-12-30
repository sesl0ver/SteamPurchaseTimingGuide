<?php
declare(strict_types=1);

namespace App\Controller\Admin;

use App\Service\AdminStatsService;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Views\Twig;

final class DashboardController
{
    public function __construct(
        private readonly Twig $view,
        private readonly AdminStatsService $stats
    ) {}

    public function __invoke(ServerRequestInterface $req, ResponseInterface $res): ResponseInterface
    {
        return $this->view->render($res, 'admin/dashboard.twig', [
            'dau' => $this->stats->getDau(7),
            'ccu' => $this->stats->getRecentCcu(5),
            'trending' => $this->stats->getTrending(7, 10),
            'events' => $this->stats->getEvents(3),
            'retention_d1' => $this->stats->getRetention(1),
        ]);
    }
}
