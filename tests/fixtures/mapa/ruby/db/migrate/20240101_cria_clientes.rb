class CriaClientes < ActiveRecord::Migration[7.0]
  def change
    create_table :clientes do |t|
      t.string :nome
    end
    add_index :clientes, :nome
    execute <<~SQL
      UPDATE clientes SET nome = 'x' WHERE id = #{id}
    SQL
  end
end
