<?php
namespace App\Console;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule)
    {
        $schedule->command('relatorio:diario')->daily();
        $schedule->job(new LimparCache)->hourly();
        $outro->command('nao:agendado');
    }
}
