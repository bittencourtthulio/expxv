<?php
namespace App\Controller;

use Symfony\Component\Routing\Annotation\Route;

#[Route('/api')]
class ApiController
{
    #[Route('/items/{id}', name: 'item_show', methods: ['GET', 'HEAD'])]
    public function show(int $id) { return $id; }

    /**
     * @Route("/legado", methods={"POST"})
     */
    public function legado() { return 1; }

    #[Route(path: '/livre')]
    public function livre() { return 1; }

    // não é rota: Route comum numa string
    public function falso() { return 'Route::get("/nao")'; }
}
