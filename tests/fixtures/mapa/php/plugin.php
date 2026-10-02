<html>
<body>
<?php
require_once __DIR__ . '/inc/util.php';
require 'lib/base.php';
include dirname(__FILE__) . '/../topo.php';
include $arquivo;
require_once $dir . '/x.php';
add_action('init', 'iniciar_plugin');
add_filter('the_content', [$this, 'filtrar']);
add_action('wp_head', function () { echo 1; });
function iniciar_plugin() { $r = getenv('WP_DEBUG'); $e = env('APP_NOME'); return $_ENV['CHAVE_X'] . $_SERVER['SERVER_NAME']; }
$conn = mysqli_query($db, "UPDATE contas SET saldo = saldo - 1 WHERE id = 3");
$pdo->query("SELECT * FROM usuarios u LEFT JOIN perfis f ON f.uid = u.id");
$texto = "Select an option from the list below";
$v = 'nome'; echo $$v;
eval('return 1;');
call_user_func('iniciar_plugin');
$obj->$metodo();
$cls = new $nome();
$ref = new ReflectionClass('X');
try { risco(); } catch (Exception $e) { }
try { risco(); } catch (Exception $e) { log_it($e); }
?>
<p>fim <?= htmlspecialchars($x) ?></p>
</body>
</html>
