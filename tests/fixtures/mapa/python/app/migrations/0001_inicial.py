from django.db import migrations, models


class Migration(migrations.Migration):
    operations = [
        migrations.CreateModel(name="Pedido", fields=[("id", models.AutoField())]),
        migrations.CreateModel(name="Antigo", fields=[], options={"db_table": "tabela_antiga"}),
        migrations.RunSQL("CREATE TABLE extra (id int)"),
    ]
