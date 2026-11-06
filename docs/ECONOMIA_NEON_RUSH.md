# Economía NEON RUSH

## Moneda y monedero

La moneda de juego es NEON COINS (NC), sin dinero real ni servicios externos.
Saldo, totales acumulados, inventario, historial de transacciones y progreso
viven en el mismo perfil JSON local (`~/.neonrush/profile.json`, o
`NEONRUSH_PROFILE`).

La escritura serializa un snapshot a un archivo temporal en el mismo directorio,
vacía el buffer y usa `os.replace`. Si falla, la operación de perfil restaura
su estado en memoria y propaga el error. El esquema actual es versión 2 y
conserva los campos conocidos de perfiles anteriores.

La persistencia local no ofrece transacciones ACID ni seguridad frente a edición
manual del archivo o manipulación del reloj del equipo.

## Recompensas

| Resultado | NC por posición | Finalización | Total |
|---|---:|---:|---:|
| 1.º | 500 | 100 | 600 |
| 2.º | 300 | 100 | 400 |
| 3.º | 200 | 100 | 300 |
| 4.º | 100 | 100 | 200 |
| 5.º o posterior | 0 | 100 | 100 |
| Abandono/DNF | 0 | 0 | 0 |

El resultado central recibe un ID único de carrera. IDs procesados se guardan;
un resultado repetido no vuelve a pagar. Llamadas antiguas sin ID usan una
huella determinista como compatibilidad de mejor esfuerzo. El resultado se
procesa una vez desde `NeonApp._begin_race`.

## Tienda

El catálogo de cosméticos de color se valida centralmente antes de descontar:
`paint_jade` cuesta 120 NC, `paint_solar` 200 NC y `suit_oracle` 450 NC.
No se admiten IDs ajenos al catálogo, moneda distinta de NC, precio manipulado,
saldo negativo ni doble compra. Un cosmético adquirido puede volver a
equiparse sin un nuevo cargo.

El catálogo actual no vende vehículos, llantas, alerones ni mejoras de
conducción; no se muestran como productos implementados.
