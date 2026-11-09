# Guía de ejecución y validación final — NEON RUSH Fase 7

## Cierre de entrega

Esta guía recoge la ejecución validada de frontend, backend y clúster MPI para la entrega final de la Fase 7. Los comandos que siguen coinciden con las ejecuciones reales realizadas en esta sesión y no incluyen resultados inventados.

### Frontend

```bash
cd /home/helen/Proyectos/neon-rush/frontend
npm test
npm run build
```

### Backend Release

```bash
cd /home/helen/Proyectos/neon-rush
cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Release
cmake --build backend/build --parallel
ctest --test-dir backend/build --output-on-failure
```

### Clúster Docker MPI

```bash
cd /home/helen/Proyectos/neon-rush
./infrastructure/mpi-cluster/scripts/cluster.sh verify
./infrastructure/mpi-cluster/scripts/cluster.sh test
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 1000 1000 5 4
```

---

# Guía de ejecución y validación de la Fase 5

Todos los comandos se ejecutan desde la raíz del repositorio salvo que se
indique lo contrario. No se requiere modificar ni construir el frontend para
ejecutar el motor.

## Herramientas y modos localmente

Comprueba Docker y Compose:

```bash
docker --version
docker compose version
docker info
```

En Ubuntu, si Docker no estuviera instalado, sigue la guía oficial de Docker
Engine y Compose para esa versión de Ubuntu. Ejecutar Docker requiere acceso al
daemon; no cambies permisos de sistema ni ejecutes operaciones como root sin
autorización.

Construye secuencial y OpenMP en Release:

```bash
cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Release
cmake --build backend/build --parallel
ctest --test-dir backend/build --output-on-failure
```

Si OpenMPI está instalado en el host, CMake también detecta MPI y registra
CTest MPI. En este entorno la validación OpenMPI se hizo dentro de los
contenedores; el host no tenía `mpirun` ni `mpicxx`.

## Arrancar y probar el clúster

Construye una imagen común, arranca los tres nodos y espera a que estén
saludables:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh up
./infrastructure/mpi-cluster/scripts/cluster.sh status
./infrastructure/mpi-cluster/scripts/cluster.sh verify
./infrastructure/mpi-cluster/scripts/cluster.sh test
```

`verify` revisa DNS/ping, SSH a los trabajadores y OpenMPI en cada contenedor;
al final imprime `rank 0: node1`, `rank 1: node2`, `rank 2: node3`. `test`
ejecuta CTest secuencial/OpenMP y MPI con 1, 2 y 3 ranks, y después ejecuta los
tests MPI entre tres contenedores.

Ejecuta cargas MPI con todos los procesos distribuidos entre nodos:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh run 3 1000 1000
./infrastructure/mpi-cluster/scripts/cluster.sh run 3 10000 100
./infrastructure/mpi-cluster/scripts/cluster.sh run 3 10000 1000
```

Para exigir comparación del estado y pares contra el modo secuencial, utiliza
el ejecutable dentro de `node1` mediante `run-mpi`:

```bash
docker compose -f infrastructure/mpi-cluster/compose.yaml exec -T --user neon node1 \
  /usr/local/bin/run-mpi 3 /opt/neon-rush/build/neon_rush_sim \
  --mode mpi-compare --vehicles 10000 --steps 1000 --repetitions 5
```

## Matriz de benchmarks

El comando `benchmark VEHICULOS PASOS REPETICIONES HILOS_MAX` mide
secuencial, OpenMP en 1, 2 y 4 hilos, y MPI en 1, 2 y 3 procesos. OpenMP y MPI
comparan cada repetición con el estado secuencial determinista. Se usaron cinco
repeticiones:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 1000 1000 5 4
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 10000 100 5 4
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 10000 1000 5 4
```

Los resultados y el equipo se registran en
[`RESULTADOS_RENDIMIENTO.md`](./RESULTADOS_RENDIMIENTO.md). Para evitar
competencia, ejecuta una sola matriz a la vez y anota cualquier carga externa
del host.

## Detener/reiniciar

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh down
./infrastructure/mpi-cluster/scripts/cluster.sh up
./infrastructure/mpi-cluster/scripts/cluster.sh verify
```

`down` elimina contenedores y red del proyecto, pero conserva volúmenes de
claves para poder validar un reinicio con host keys persistentes. Para la
política de SSH y la eliminación deliberada de esos volúmenes, consulta
[`../infrastructure/mpi-cluster/README.md`](../infrastructure/mpi-cluster/README.md).

## Frontend durante Sprint 6

No existe integración frontend/backend en Fase 5. Como propuesta para Sprint 6,
el navegador podría enviar por WebSocket controles de carrera, secuencia de
input, delta de simulación y estado de vehículos requerido; el servidor
devolvería posiciones, velocidades, contactos y versión del tick. El servidor
debería validar entradas y mantener autoridad sobre el estado compartido.

No conviene enviar una llamada HTTP por cada fotograma. Un primer prototipo
podría enviar snapshots a 20–30 Hz y renderizar en el cliente a la frecuencia
de pantalla, interpolando entre ticks. Medir RTT, jitter y pérdida antes de
elegir el intervalo; latencias de red pueden ser mayores que el propio paso de
simulación. El navegador mantendría renderizado Three.js, cámara, HUD,
minimapa, controles locales y predicción visual de baja latencia. El servidor
podría ejecutar reglas autoritativas, progreso y colisiones compartidas. Este
protocolo es una propuesta; no está implementado.

Posible mensaje cliente → servidor:

```json
{
  "type": "input",
  "sequence": 184,
  "clientTimeMs": 81234,
  "controls": {
    "throttle": 1.0,
    "brake": 0.0,
    "steer": -0.25,
    "nitro": false
  }
}
```

Posible snapshot servidor → cliente:

```json
{
  "type": "state",
  "tick": 2710,
  "serverTimeMs": 135500,
  "vehicles": [
    {
      "id": 0,
      "x": 12.5,
      "z": -4.25,
      "speed": 18.0,
      "direction": 1.57,
      "active": true
    }
  ],
  "collisionPairs": [[0, 3]],
  "lap": 2,
  "standings": ["0", "NOVA", "BLAZE", "VOLT"]
}
```
