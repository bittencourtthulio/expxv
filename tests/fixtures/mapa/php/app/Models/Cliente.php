<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use App\Contracts\Auditavel;
use App\Support\{Helper, Formatter as Fmt};
use function App\Support\moeda;
use const App\Support\LIMITE;

/**
 * Cliente da loja.
 */
class Cliente extends Model implements Auditavel, \JsonSerializable
{
    use Notificavel, \App\Traits\Datavel;

    protected $table = 'clientes';

    public const ATIVO = 1;

    /** Total gasto pelo cliente. */
    public function total(int $meses = 3): float
    {
        $soma = 0.0;
        foreach ($this->pedidos as $p) {
            if ($p->ativo && $meses > 0) {
                $soma += moeda($p->valor);
            }
        }
        $this->auditar();
        self::normalizar($soma);
        Helper::arredondar($soma);
        parent::boot();
        return $soma;
    }

    private function auditar(): void
    {
        throw new \RuntimeException('falha');
    }

    protected static function normalizar($v): void {}

    public function jsonSerialize(): array
    {
        return [new Fmt(), new Cliente()];
    }
}
