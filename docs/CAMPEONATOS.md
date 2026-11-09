# Campeonato NEON CUP

## Formato

La NEON CUP consta de una carrera por circuito, en orden fijo:

1. NEON CITY
2. CYBER DESERT
3. PLASMA CIRCUIT

El botón del menú continúa la siguiente ronda pendiente o inicia una
temporada nueva cuando la anterior terminó. Cada ronda utiliza una carrera
local de una vuelta con los tres rivales. Se conserva el control habitual del
jugador; el modo experimental C++ no se activa para el campeonato.

## Puntuación y clasificación

| Posición | Puntos |
|---:|---:|
| 1.º | 15 |
| 2.º | 12 |
| 3.º | 10 |
| 4.º | 8 |
| 5.º o posterior | 0 |
| DNF / abandono | 0 |

Los puntos se asignan con las posiciones registradas en la clasificación real
al finalizar la vuelta del jugador. La tabla ordena por puntos, victorias,
segundos puestos, terceros puestos, carreras finalizadas y, finalmente,
tiempo total registrado. Si todos esos criterios empatan, se muestra una
posición compartida. Un campeonato sin puntos no declara campeón ni paga un
premio.

Un abandono después de comenzar la carrera registra DNF, consume esa ronda,
otorga cero puntos y habilita la siguiente. Salir antes de terminar la cuenta
regresiva no cuenta como abandono. Un reinicio manual permite volver a correr
la ronda pendiente; no crea resultado hasta completar una carrera válida.

## Resultados y recompensas

Se persiste el ID de la temporada, el circuito esperado, el ID único de cada
carrera, participantes, posiciones, tiempos, estado de abandono, puntos,
clasificación final y campeón. Una carrera solo se acepta si corresponde a la
ronda esperada y al ID de temporada activo; el mismo ID de carrera no se
puntúa dos veces.

Premios finales del jugador: 1.º 1000 NC, 2.º 700 NC, 3.º 500 NC y 4.º 300 NC.
El campeón jugador desbloquea el vehículo NOVA HYPER; las siguientes posiciones
desbloquean artículos cosméticos funcionales. Una temporada sin puntos no
desbloquea artículos. La recompensa utiliza un ID idempotente ligado a la
temporada y se acredita en el monedero existente.

Las temporadas terminadas se conservan en el historial local (hasta diez
temporadas); el menú muestra la clasificación y los resultados de la temporada
actual.

## Persistencia y límites

Los datos están en `localStorage` bajo `neon-rush-progression`. La prevención
de duplicados resiste recargas normales, pero no manipulación del navegador ni
restauración externa de respaldos. Las posiciones de rivales se toman de la
clasificación del juego cuando el jugador termina; rivales que aún aparecen
“en carrera” se puntúan por su posición de progreso observada en ese momento.
