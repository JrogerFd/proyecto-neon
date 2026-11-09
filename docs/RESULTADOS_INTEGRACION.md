# Resultados y estado de integración — Fase 6

## Alcance y entorno

Auditoría y pruebas realizadas en Linux x64 con 8 procesadores lógicos, 11,67
GB de RAM y OpenMP del host. El compilador es el que configura CMake en el
entorno actual; MPI no está instalado en el host, por lo que las pruebas MPI
se ejecutaron con Open MPI 4.1.6 en los tres contenedores Docker. Los
contenedores comparten el mismo host.

Los benchmarks de núcleo y el benchmark HTTP de cinco repeticiones que ya
estaban registrados se conservan como mediciones históricas, no se combinan
con la nueva ejecución HTTP de 30 repeticiones. En cada sweep se emplearon
estados iniciales idénticos; los modos se comprobaron contra secuencial para
el estado de vehículos y los pares de colisión.

## Validación automatizada y visual

| Prueba | Resultado |
|---|---|
| `npm test` después de la corrección de vueltas | 15/15 aprobadas |
| `npm run build` | Correcto; aviso de bundle JS de 591,89 kB (>500 kB) |
| CMake Release + build host | Correcto; OpenMP activo, MPI no disponible en host |
| CTest host | 1/1 aprobada |
| Pruebas API/Node | 7/7 aprobadas |
| Compose config | Válido |
| Clúster Docker | 3/3 nodos sanos; DNS/SSH verificados |
| Colocación Open MPI | Rank 0=node1, rank 1=node2, rank 2=node3 |
| CTest dentro del clúster | 4/4 aprobadas (secuencial + MPI 1/2/3) |
| Suite distribuida MPI | 5/5 aprobadas, incluida colisión entre particiones |
| Laboratorio en navegador | Secuencial, OpenMP y MPI reales respondieron |
| Paridad del snapshot en navegador | Las posiciones y el par 0–1 coincidieron en los tres modos |
| Carrera controlada en navegador | En una sesión corta se observó movimiento C++ secuencial, velocidad, IA rival, HUD y minimapa; no se completó una vuelta |
| Carrera después de detener backend | Fallback a JavaScript mantuvo el control; HUD informó ERROR |
| Vueltas configurables | El ajuste de 1/3/5 vueltas ahora llega a `LapManager`; prueba de una vuelta aprobada |

El build muestra además el aviso ya conocido de `THREE.Clock` obsoleto. No se
validó una carrera completa conduciendo por todas las curvas en los cuatro
modos. Una segunda prueba automatizada no consiguió iniciar el movimiento del
jugador; por tanto no cuenta como prueba de vuelta, checkpoints o resultados.

## Benchmarks de núcleo C++ (mediana de cinco)

`deltaTime=1/60 s`. Las medianas de OpenMP usan el baseline secuencial
emparejado del mismo sweep; MPI reporta su propio baseline secuencial
emparejado para cada comparación. `S = T_seq/T_parallel`, `E=S/p`.

### Escenario: 1.000 vehículos × 1.000 pasos

| Configuración | T paralelo (s) | T secuencial emparejado (s) | Speedup | Eficiencia | Comunicación MPI (s) |
|---|---:|---:|---:|---:|---:|
| Secuencial referencia OpenMP | 0,672070 | — | 1,000 | — | — |
| OpenMP 1 hilo | 0,681651 | 0,672070 | 0,986 | 98,6 % | — |
| OpenMP 2 hilos | 0,552591 | 0,672070 | 1,216 | 60,8 % | — |
| OpenMP 4 hilos | 0,464540 | 0,672070 | 1,447 | 36,2 % | — |
| MPI 1 proceso | 0,740905 | 0,684730 | 0,924 | 92,4 % | 0,003104 |
| MPI 2 procesos | 0,587293 | 0,726490 | 1,237 | 61,9 % | 0,214214 |
| MPI 3 procesos | 0,683561 | 0,850239 | 1,244 | 41,5 % | 0,441385 |

Cada repetición reportó 160.718 colisiones acumuladas y el mismo checksum de
estado, con igualdad confirmada por la comparación interna secuencial/MPI.
El baseline MPI varió entre filas por carga del host; speedup se calcula con
la referencia emparejada de cada fila, no con una mediana secuencial común.

### Escenario: 10.000 vehículos × 100 pasos

| Configuración | T paralelo (s) | T secuencial emparejado (s) | Speedup | Eficiencia | Comunicación MPI (s) |
|---|---:|---:|---:|---:|---:|
| Secuencial referencia OpenMP | 0,694604 | — | 1,000 | — | — |
| OpenMP 1 hilo | 0,694754 | 0,694604 | 1,000 | 100,0 % | — |
| OpenMP 2 hilos | 0,584728 | 0,694604 | 1,188 | 59,4 % | — |
| OpenMP 4 hilos | 0,517910 | 0,694604 | 1,341 | 33,5 % | — |
| MPI 1 proceso | 0,778275 | 0,689657 | 0,886 | 88,6 % | 0,000977 |
| MPI 2 procesos | 0,473272 | 0,774302 | 1,636 | 81,8 % | 0,069017 |
| MPI 3 procesos | 0,428153 | 0,824101 | 1,925 | 64,2 % | 0,172866 |

Cada repetición reportó 95.551 colisiones y el estado/pares coincidieron con
su referencia secuencial. La variación de los baselines MPI también refleja
contención del host compartido; no debe interpretarse como una diferencia de
código entre las referencias.

Los benchmarks de núcleo no incluyen HTTP ni Docker para secuencial/OpenMP;
MPI sí incluye sus comunicaciones de simulación. Para medir de forma más
pareja la ruta real de API se ejecutó además el benchmark siguiente.

## Benchmark HTTP/API histórico y recursos de host (mediana de cinco)

Escenario común: 64 vehículos, 120 pasos, `deltaTime=1/60 s`, mismos IDs,
vehículos, posiciones y pares finales. El script comprobó igualdad exacta del
estado serializado frente a la primera respuesta secuencial.

| Modo | Workers | HTTP mediana (ms) | HTTP p95 (ms) | C++ total (ms) | Movimiento (ms) | Colisiones (ms) | Comunicación MPI (ms) | Speedup | Eficiencia | CPU host mediana | RAM host pico (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Secuencial | 1 | 22,20 | 241,06 | 7,006 | 0,363 | 5,736 | 0 | 1,000 | 100 % | 37,5 % | 7.879 |
| OpenMP | 1 | 31,12 | 38,82 | 6,340 | 0,330 | 5,152 | 0 | 1,105 | 110,5 % | 36,0 % | 7.879 |
| OpenMP | 2 | 30,93 | 40,68 | 7,238 | 0,651 | 5,675 | 0 | 0,968 | 48,4 % | 42,1 % | 7.876 |
| OpenMP | 4 | 33,59 | 40,89 | 8,068 | 0,822 | 6,058 | 0 | 0,868 | 21,7 % | 53,6 % | 7.876 |
| MPI | 1 | 1.200,45 | 1.217,93 | 9,266 | 0,421 | 7,241 | 0,230 | 0,756 | 75,6 % | 34,7 % | 7.896 |
| MPI | 2 | 1.224,15 | 1.262,04 | 34,884 | 0,291 | 4,227 | 28,865 | 0,201 | 10,0 % | 36,9 % | 7.897 |
| MPI | 3 | 1.272,66 | 1.291,69 | 62,688 | 0,279 | 4,737 | 59,415 | 0,112 | 3,7 % | 38,5 % | 7.887 |

El p95 con cinco observaciones es una estimación muy gruesa (en la práctica,
el máximo de la muestra). CPU y RAM son muestras del host completo, no del
proceso Neon Rush; el valor de RAM es uso absoluto observado durante la
ventana, no memoria incremental atribuible al benchmark. La latencia MPI
incluye el lanzamiento de procesos MPI/Docker; el kernel C++ reportado no.
Con esta carga pequeña, comunicación y costes fijos dominan MPI. OpenMP con
varios hilos tampoco acelera cuatro vehículos en el laboratorio; el resultado
ligeramente superior a 1× con OpenMP de un hilo está dentro de ruido de una
carga pequeña y no demuestra paralelismo útil.

Reproducir esta tabla, con el clúster Docker iniciado y la API Node en
ejecución:

```bash
node backend/service/benchmark.mjs --vehicles=64 --steps=120 --repetitions=5
```

## Benchmark HTTP/API con métricas por proceso (n=30)

Esta ejecución nueva usa 64 vehículos, 120 pasos, `deltaTime=1/60 s`, Linux
x64, 8 CPU lógicas y 11,67 GB de RAM. Cada modo tuvo 30 repeticiones; los
estados y pares de colisión coincidieron exactamente. Los tiempos HTTP son
wall-clock del cliente e incluyen creación/lanzamiento del proceso y, para
MPI, la ruta Docker. El tiempo C++ no incluye ese costo. p95 es nearest-rank
con n=30 (índice 29 ordenado), por lo que su resolución sigue limitada.
CPU/RSS proceden de `getrusage` dentro del proceso C++; en MPI son el máximo de
un rank, no la suma. El campo cadence es una tasa serial teórica derivada de
latencia mediana y del intervalo configurado, no FPS medidos en carrera.

Los triples de las columnas siguientes están en orden mediana / promedio /
p95; unidades indicadas en el encabezado.

| Modo / workers | HTTP (ms) | C++ total (ms) | Movimiento (ms) | Colisiones (ms) | MPI comm (ms) | Serialización (ms) | CPU proceso (s) | RSS pico (MiB) | Cadence Hz | Speedup / eficiencia |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Secuencial / 1 | 22,962 / 33,432 / 30,158 | 7,991 / 7,823 / 9,758 | 0,431 / 0,427 / 0,551 | 6,523 / 6,369 / 7,869 | 0 / 0 / 0 | 1,822 / 2,035 / 3,612 | 0,00785 / 0,00776 / 0,00968 | 16,48 / 16,24 / 17,05 | 10,000 | 1,000 / 100,0 % |
| OpenMP / 1 | 29,661 / 29,381 / 34,872 | 7,220 / 7,223 / 8,438 | 0,378 / 0,377 / 0,462 | 5,894 / 5,903 / 6,890 | 0 / 0 / 0 | 1,896 / 2,033 / 3,061 | 0,00721 / 0,00719 / 0,00839 | 16,48 / 16,24 / 17,05 | 10,000 | 1,107 / 110,7 % |
| OpenMP / 2 | 30,391 / 30,387 / 35,827 | 7,312 / 7,242 / 9,702 | 0,685 / 0,774 / 0,950 | 5,604 / 5,496 / 6,749 | 0 / 0 / 0 | 1,878 / 2,059 / 2,910 | 0,01382 / 0,01366 / 0,01680 | 16,48 / 16,24 / 17,05 | 10,000 | 1,093 / 54,6 % |
| OpenMP / 4 | 33,898 / 32,888 / 40,465 | 8,348 / 8,957 / 13,068 | 0,966 / 1,570 / 3,824 | 6,187 / 6,386 / 8,490 | 0 / 0 / 0 | 2,014 / 2,133 / 3,388 | 0,03051 / 0,03160 / 0,04349 | 16,48 / 16,25 / 17,05 | 10,000 | 0,957 / 23,9 % |
| MPI / 1 | 1.154,294 / 1.162,745 / 1.239,650 | 9,059 / 9,017 / 11,731 | 0,422 / 0,471 / 0,645 | 6,912 / 6,879 / 8,514 | 0,220 / 0,236 / 0,420 | 1,822 / 1,886 / 2,632 | 0,00888 / 0,00889 / 0,01173 | 14,68 / 14,69 / 14,88 | 0,866 | 0,882 / 88,2 % |
| MPI / 2 | 1.195,005 / 1.202,417 / 1.267,575 | 32,621 / 34,836 / 55,262 | 0,269 / 0,299 / 0,428 | 3,862 / 4,003 / 5,387 | 27,283 / 29,232 / 48,235 | 1,809 / 1,883 / 2,599 | 0,03252 / 0,03443 / 0,05152 | 14,90 / 14,92 / 15,22 | 0,837 | 0,245 / 12,2 % |
| MPI / 3 | 1.254,934 / 1.264,691 / 1.413,203 | 62,698 / 65,257 / 80,844 | 0,296 / 0,294 / 0,361 | 4,844 / 4,922 / 6,054 | 59,440 / 62,184 / 77,748 | 1,846 / 1,853 / 2,691 | 0,06271 / 0,06515 / 0,08086 | 14,97 / 14,96 / 15,21 | 0,797 | 0,127 / 4,2 % |

Speedup se calcula con el tiempo total C++ secuencial de la misma ejecución
(mediana 7,991 ms); eficiencia es speedup dividido por workers. Los valores
superiores a 100 % de OpenMP/1 reflejan variación de ejecución, no escalado
paralelo. OpenMP/2 y OpenMP/4 no aceleraron este caso pequeño. En MPI, el costo
de comunicación y lanzamiento domina al aumentar ranks; la latencia HTTP de
~1,15–1,25 s confirma que MPI no es adecuado para actualizar movimiento
interactivo en esta arquitectura. La CPU de proceso MPI es el máximo reportado
por rank; las columnas de tiempo no equivalen a uso agregado de CPU.

Reproducir exactamente el tamaño de muestra de esta nueva medición:

```bash
node backend/service/benchmark.mjs --vehicles=64 --steps=120 --repetitions=30
```

Reproducir los benchmarks del núcleo:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 1000 1000 5 4
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 10000 100 5 4
```

## Compatibilidad funcional y límites

- La simulación C++ es un modelo cinemático lineal y de contactos circulares,
  no incluye aceleración, pista, IA, respuesta arcade de colisión ni vueltas.
- En secuencial/OpenMP, C++ calcula y aplica el desplazamiento lineal del
  jugador a partir de velocidad/dirección que JavaScript calculó. JavaScript
  sigue controlando aceleración, dirección, rivales, obstáculos, colisiones,
  progreso, vueltas y resultados; no es una carrera gobernada por C++.
  Respuestas de movimiento que excedan 300 ms disparan fallback local.
- MPI conserva snapshots en sombra y no modifica la posición del jugador.
  Sus tiempos HTTP observados son demasiado altos para el control interactivo.
- Rivales, adelantamientos, obstáculos, nitro, minimapa, clasificación,
  checkpoints, colisiones y resultados permanecen en la ruta JavaScript.
  La opción de vueltas (1/3/5) ahora se transmite a la carrera.
- Se verificó visualmente el laboratorio en navegador en los tres modos, la
  distribución MPI en tres contenedores y el fallback tras desconectar el
  clúster. La carrera completa con conducción natural no se completó, por lo
  que no se declara verificado su ciclo total de vueltas y resultados por modo.
- Los tres contenedores comparten CPU, memoria y red de una sola máquina. No
  son un clúster de tres equipos físicos.
- La ley de Amdahl aplica: movimiento y colisiones tienen partes secuenciales,
  MPI agrega intercambio de halos/migración/colectivas, y el overhead limita
  el speedup. En el escenario 10.000×100 la aceleración MPI3 medida fue 1,925×
  (64,2 % de eficiencia), no el speedup ideal 3×. No se deriva de ello que
  60–70 % del juego completo sea paralelizable.

## Estado por Sprint

| Sprint | Estado | Evidencia / pendiente |
|---|---|---|
| 6.1 HTTP + puente C++ + cliente/laboratorio | Completado | Pruebas Node 7/7; llamadas reales y respuestas verificadas en navegador |
| 6.2 movimiento C++ experimental | Parcial | Secuencial/OpenMP aplican la integración lineal de posición del jugador; falta validar continuidad y una carrera completa |
| 6.3 OpenMP desde API | Completado | OpenMP disponible; respuesta comparada contra secuencial y pruebas automatizadas |
| 6.4 MPI/Docker desde API | Completado | Open MPI 4.1.6; 1/2/3 ranks, tres nodos y pruebas distribuidas aprobadas |
| 6.5 integración de carrera | Parcial | Movimiento corto C++ secuencial y fallback observados; falta completar una vuelta natural con checkpoints/meta/resultados y validar nitro, colisiones y reinicio en los modos |
| 6.6 medición y validación | Parcial | Benchmark API con 30 repeticiones, p95 y CPU/RSS por proceso; falta prueba prolongada/estabilidad y frecuencia efectiva de movimiento medida durante carrera |

**Fase 6 no está cerrada completamente y Neon Rush no debe tratar C++ como
motor de carrera autoritativo.** El siguiente paso es conseguir una prueba
reproducible de circuito completo con checkpoints y resultados en el modo
local y en secuencial/OpenMP, y una prueba prolongada de estabilidad. MPI debe
permanecer en el laboratorio/sombra para movimiento en tiempo real.
