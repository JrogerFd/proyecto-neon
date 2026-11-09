# Desafíos y misiones diarias

## Arquitectura

`frontend/src/game/Progression.js` es el registro centralizado de eventos y el
proyector de progreso. `Race.js` emite eventos solamente al confirmar estados
del juego: fin de cuenta regresiva, checkpoint válido, vuelta válida, colisión,
adelantamiento observado en la clasificación, segundos efectivos de nitro,
aterrizaje de una rampa, velocidad medida, evasión cercana de un obstáculo
activo, sector completado y mejora de récord de vuelta. El final de carrera
incluye posición y colisiones contadas durante esa carrera.

Los eventos tienen un ID estable dentro de cada carrera y se deduplican. Se
persiste una bitácora acotada a los 200 eventos recientes y un conjunto acotado
de IDs procesados; los contadores de desafíos y misiones se guardan por separado
en `localStorage` versionado (`neon-rush-progression`). La economía conserva el
monedero versionado existente en `neon-rush-neon-wallet`.

El progreso se deriva de la simulación local, no de acciones de interfaz. Por
ejemplo, una vuelta requiere pasar checkpoints en orden y cruzar meta en
sentido válido; una mejora de récord solo se deriva de una vuelta válida con un
tiempo menor al mejor guardado para ese circuito. Las velocidades se muestrean
durante la carrera y se registran también al cruzar hitos, para no perder un
pico breve de velocidad.

## Desafíos permanentes

| Categoría | Desafío | Objetivo |
|---|---|---|
| Velocidad | Velocidad terminal | Alcanzar 180 km/h |
| Velocidad | Sobrecarga | Acumular 15 segundos de nitro |
| Velocidad | Ritmo perfecto | Completar 3 sectores en 20 s o menos |
| Conducción | Línea limpia | Finalizar una carrera sin colisiones |
| Conducción | Adelantador | 5 adelantamientos |
| Conducción | Constancia | 6 vueltas válidas |
| Conducción | Control total | 120 segundos sobre la pista |
| Habilidad | Aterrizaje limpio | 2 saltos aterrizados |
| Habilidad | Imperturbable | Evitar 5 obstáculos activos |
| Habilidad | Dominio de Plasma | Finalizar una carrera en PLASMA CIRCUIT |
| Tiempo | Nuevo récord | Mejorar un récord personal de vuelta |
| Tiempo | A contrarreloj | Finalizar una carrera en menos de 90 segundos |

Al completar un desafío, se acredita automáticamente su recompensa. Algunos
desafíos también desbloquean un artículo existente y funcional de la tienda.
Los desbloqueos se añaden al inventario; el jugador puede equiparlos desde el
garaje o la tienda.

## Misiones diarias

Cada fecha UTC selecciona tres misiones de una lista rotatoria: carreras
completadas, victoria, adelantamientos, segundos de nitro, carrera limpia,
obstáculos evitados, saltos aterrizados y finalización de PLASMA CIRCUIT. La
selección es determinista por fecha UTC. El progreso se conserva al recargar y
se reinicia al cambiar `YYYY-MM-DD` UTC. La pantalla muestra objetivo,
progreso, recompensa, estado y tiempo restante hasta la próxima medianoche
UTC.

Cada misión tiene un ID que incluye la fecha al pagarla. Tanto las misiones
como los desafíos consultan los IDs de recompensa ya procesados en el monedero,
por lo que recargar o volver a abrir la pantalla no duplica NC ni desbloqueos.

## Límites

El estado y la bitácora se guardan en el navegador y pueden manipularse desde el
cliente; esto no constituye protección antitrampas ni una cuenta sincronizada.
La evasión se contabiliza cuando el jugador cruza el progreso de un obstáculo
activo a corta distancia sin que el colisionador registre impacto. El modelo
de colisiones sigue siendo arcade, no una prueba geométrica exacta.
