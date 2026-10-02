namespace Loja.Workers;

public class Sync : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken t) { await Task.Delay(1, t); }
}

public class Boot : IHostedService
{
    public Task StartAsync(CancellationToken t) => Task.CompletedTask;
    public Task StopAsync(CancellationToken t) => Task.CompletedTask;
}

public class Funcoes
{
    [FunctionName("ProcessarFila")]
    public void Processar([QueueTrigger("fila")] string msg) { }
}
