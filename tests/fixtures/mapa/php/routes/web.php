<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ClienteController;

Route::get('/clientes/{id}', [ClienteController::class, 'show']);
Route::post('/clientes', 'ClienteController@store');
Route::get('/ping', function () { return 'ok'; });
Route::resource('photos', PhotoController::class);
Route::apiResource('posts', PostController::class);
Route::prefix('admin')->group(function () {
    Route::get('/painel', [PainelController::class, 'ver']);
});
Route::group(['prefix' => 'api'], function () {
    Route::delete('/x/{y}', 'XController@apagar');
});
Route::match(['get', 'post'], '/m', [MController::class, 'm']);
