# Economía NEON COINS

La economía del frontend está definida en `frontend/src/game/Economy.js` y el monedero versionado/persistido en `frontend/src/storage/NeonWallet.js`.

## Recompensas

| Resultado | NC |
|---|---:|
| Primero | 500 |
| Segundo | 300 |
| Tercero | 200 |
| Cuarto | 100 |
| Carrera válida completada | +100 |

La recompensa de posición se suma al bono por completar. Completar en una posición posterior a la cuarta otorga solo el bono de finalización. Los valores se centralizan en `NEON_COINS_REWARDS`.

Cada instancia de carrera tiene un identificador; el monedero guarda los IDs procesados para no volver a pagar el mismo resultado. Reiniciar crea una nueva carrera. El resultado solo se liquida al completar vueltas válidas.

## Tienda e inventario

La pantalla **Tienda y monedero** muestra saldo, ganancias, gastos e historial, permite filtrar categorías y previsualizar artículos en el modelo 3D. La tienda incluye:

- Vehículos del catálogo existente.
- Pinturas, luces neón, llantas, alerones y diseños ya soportados por los modelos.
- Mejoras de motor, turbo, aceleración, frenos y estabilidad.

Las mejoras se compran por nivel y se aplican a velocidad, aceleración, freno, manejo o nitro en las carreras. Las compras verifican saldo, propiedad y orden de niveles; los artículos cosméticos comprados se equipan y aparecen en el garaje. Los vehículos no adquiridos no aparecen como selección de carrera.

El saldo inicial es 0 NC; se obtienen monedas al terminar carreras. No hay compras ficticias con saldo negativo.

## Persistencia y límites de seguridad

El monedero usa `localStorage` con clave `neon-rush-neon-wallet` y versión de esquema. El historial visible conserva hasta 500 movimientos; los IDs de carreras procesadas se conservan para idempotencia. Sin acceso a almacenamiento, las transacciones no se confirman.

Esto es almacenamiento local de un solo navegador, no una cuenta ni una economía segura contra manipulación. El usuario puede editar o borrar los datos locales; no se deben usar NC como valor real ni sincronizar este saldo como autoridad en un servidor.
