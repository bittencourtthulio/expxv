using Loja.Data;

namespace Loja;

public class Program : IProgram
{
    public static async Task Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddScoped<IServico, Servico>();
        builder.Services.AddSingleton<Cache>();
        builder.Services.AddTransient(typeof(IRepo), typeof(Repo));
        var app = builder.Build();
        app.MapGet("/ping", () => "pong");
        app.MapPost("/pedidos", PedidosHandler.Criar);
        app.MapGet("/ola/{nome}", (string nome) => nome);
        var chave = Environment.GetEnvironmentVariable("CONEXAO_DB");
        var cmd = new SqlCommand("UPDATE pedidos SET total = 0 WHERE id = 1");
        var lista = conn.Query("SELECT * FROM clientes c INNER JOIN enderecos e ON e.cid = c.id");
        var frase = "Select an item from the list";
        app.Run();
    }
}
