<?php
namespace App\Console\Commands;

use Symfony\Component\Console\Attribute\AsCommand;

class Sincronizar extends Command
{
    protected $signature = 'app:sincronizar {--full}';
    public function handle() { return 0; }
}

#[AsCommand(name: 'app:limpar')]
class Limpar extends Command {}
