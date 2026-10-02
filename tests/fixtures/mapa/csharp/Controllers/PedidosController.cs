using System;
using System.Collections.Generic;
using static System.Math;
using Repo = Loja.Data.PedidoRepository;
using Loja.Domain;

namespace Loja.Web;

/// <summary>
/// Controller de pedidos.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class PedidosController : ControllerBase, IPedidos
{
    private readonly Repo _repo;
    private readonly IServico _servico;

    public PedidosController(Repo repo, IServico servico)
    {
        _repo = repo;
        _servico = servico;
    }

    /// <summary>Busca um pedido.</summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        if (id > 0 && _repo != null || id < -1)
        {
            _servico.Executar(id);
        }
        var s = new Servico();
        Helper.Run();
        this.Auditar();
        base.Init();
        return Ok(id > 5 ? 1 : 2);
    }

    [HttpPost]
    public IActionResult Criar() { throw new InvalidOperationException("x"); }

    [HttpDelete("[action]/{id}")]
    private void Remover(int id) { }

    [HttpGet("/legado/{x?}")]
    public void Absoluta(string x) { }

    private void Auditar() { var o = _repo?.Obter()?.Valor(); }

    public int Total { get; set; }

    // Get e HttpGet no texto não geram rota: "[HttpGet(\"/nao\")]"
    public string Falso() => "[HttpGet(\"/nao\")]";
}

public interface IPedidos : IDisposable
{
    void Criar();
}
