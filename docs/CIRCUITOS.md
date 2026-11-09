# Circuitos 3D de Neon Rush

Los tres trazados comparten el muestreo de recorrido de `frontend/src/game/Track.js` y la metadata/checkpoints de `frontend/src/game/TrackCatalog.js`. El recorrido se representa como una superficie triangulada de 300 secciones; las consultas de movimiento usan una línea central cacheada de 600 muestras.

La altura y el peralte se calculan a partir del progreso normalizado del circuito. Esa misma función alimenta la malla, los rivales, las rampas y la física del jugador, por lo que la elevación no es solo decoración.

| Circuito | Geometría y desnivel | Elementos de carrera |
|---|---|---|
| NEON CITY | Óvalo urbano con puentes elevados, pilares de soporte, rampas, descensos, secciones peraltadas y pórtico de túnel. | Boost, obstáculos barredores y eléctricos temporizados. |
| CYBER DESERT | Curvas alrededor de terreno rocoso, montañas procedurales, carretera elevada, cambios de altura y saltos. | Arena que reduce velocidad, rocas móviles, plataformas y barreras. |
| PLASMA CIRCUIT | Trazado de chicanas con mayor amplitud de altura y peralte. | Rampas, obstáculos giratorios, puertas, plataformas y barreras eléctricas. |

Las carreteras y decoraciones se generan localmente con geometría Three.js; no se descargan modelos ni se añaden dependencias externas. Los checkpoints siguen en 25 %, 50 % y 75 % del recorrido.

La introducción de carrera muestra el nombre y número del circuito seleccionado.

## Alcance físico

La superficie elevada es consultable por progreso y desplazamiento lateral. No se usa un motor de física de triángulos ni raycasting continuo contra la malla; los límites de carretera y colisiones siguen un modelo arcade XZ con altura/peralte de la superficie consultada. Ver [FISICA_CIRCUITOS_3D.md](./FISICA_CIRCUITOS_3D.md).
