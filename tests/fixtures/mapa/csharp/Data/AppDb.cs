namespace Loja.Data
{
    public class AppDb : DbContext
    {
        public DbSet<Pedido> Pedidos { get; set; }
        private DbSet<Cliente> _naoMapeado;

        protected override void OnModelCreating(ModelBuilder mb)
        {
            mb.Entity<Cliente>().ToTable("tb_clientes");
        }
    }

    [Table("tb_itens")]
    public class Item { }
}
