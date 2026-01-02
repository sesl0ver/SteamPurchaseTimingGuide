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
        $token = (string)($req->getQueryParams()['token'] ?? '');
        return $this->view->render($res, 'admin/dashboard.twig', [
            'admin_token' => $token,
            'dau' => $this->stats->getDau(7),
            'ccu' => $this->stats->getRecentCcu(5),
            'trending' => $this->stats->getTrending(7, 20),
            'events' => $this->stats->getEvents(3),
            'retention_d1' => $this->stats->getRetention(1),

            // 추가
            'dau_delta' => $this->stats->getDauDelta(),
            'ccu_delta' => $this->stats->getCcuDelta(),
            'trending_focus' => $this->stats->getTrendingFocus(7, 5),
            'new_vs_return' => $this->stats->getTodayNewVsReturning(),
        ]);
    }
}
