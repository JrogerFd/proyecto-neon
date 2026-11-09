# Neon Rush: clúster MPI de tres nodos con Docker

Este entorno ejecuta el motor C++ existente con OpenMPI sobre tres
contenedores conectados a una red privada de Docker. `node1` coordina y
participa como rank; `node2` y `node3` también ejecutan ranks. Los tres
servicios utilizan la misma imagen construida una sola vez, por lo que llevan
la misma versión de OpenMPI y el mismo binario.

Los contenedores comparten el hardware del host: no representan tres máquinas
físicas ni aíslan el uso de CPU. La red de Compose es interna; no se publican
puertos al host ni se monta el socket Docker.

## Requisitos

- Ubuntu con Docker Engine y el plugin Docker Compose.
- Permiso para usar Docker desde la cuenta. Sigue la guía oficial de Docker
  para configurar el acceso al daemon; evita ejecutar el cliente con `sudo`
  de forma habitual.
- Acceso a Internet durante la primera construcción para descargar Ubuntu y
  los paquetes OpenMPI.

Verifica el entorno:

```bash
docker --version
docker compose version
docker info
```

Desde la raíz del repositorio, construye y arranca los servicios:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh up
```

El Dockerfile instala OpenMPI desde Ubuntu 24.04, configura CMake en Release,
compila con soporte MPI y ejecuta CTest durante la construcción. La versión de
OpenMPI se puede consultar dentro de cada servicio.

## Verificación de red y distribución

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh status
./infrastructure/mpi-cluster/scripts/cluster.sh verify
```

`verify` comprueba DNS y ping por la red privada, la autenticación SSH de
`node1` hacia ambos trabajadores y la versión de OpenMPI de los tres nodos.
Finalmente lanza tres ranks, uno por nodo, e imprime el hostname asociado a
cada rank. El script de lanzamiento fija el hostfile y usa `--map-by
ppr:1:node`; además, el hostfile declara un slot por nodo.

Pruebas MPI y distribución:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh test
```

Este comando ejecuta CTest en `node1` y luego lanza la batería MPI con tres
ranks distribuidos por el hostfile. Los tests comparan movimiento con el modo
secuencial, identificadores, pares y duplicados de colisión, colisiones entre
particiones, halos, repetibilidad y casos vacíos.

## Simulaciones

Los argumentos de `run` son: cantidad de procesos, vehículos y pasos.

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh run 3 1000 1000
./infrastructure/mpi-cluster/scripts/cluster.sh run 3 10000 100
```

Para validar el estado y los pares de colisión contra el secuencial:

```bash
docker compose -f infrastructure/mpi-cluster/compose.yaml exec -T --user neon node1 \
  /usr/local/bin/run-mpi 3 /opt/neon-rush/build/neon_rush_sim \
  --mode mpi-compare --vehicles 1000 --steps 1000 --repetitions 5
```

El mapa MPI asigna un rank por contenedor distinto para las configuraciones de
uno, dos o tres procesos. Es posible inspeccionar el mapeo directamente con:

```bash
docker compose -f infrastructure/mpi-cluster/compose.yaml exec -T --user neon node1 \
  /usr/local/bin/run-mpi 3 /opt/neon-rush/build/neon_rush_sim \
  --mode mpi --vehicles 1000 --steps 1000
```

La salida contiene una sección `MPI rank placement` con rank y hostname.

## Benchmarks

Ejecuta secuencial, OpenMP y MPI con el mismo número de vehículos y pasos:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 1000 1000 5 4
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 10000 100 5 4
```

El script informa ejecuciones secuenciales, comparación OpenMP y
`mpi-compare` para uno, dos y tres procesos. `mpi-compare` valida cada
repetición contra su línea base secuencial y muestra medianas, tiempos de
movimiento, detección, comunicación, total, speedup y eficiencia.

La duración MPI medida incluye distribución inicial y comunicaciones/
sincronizaciones del run; el total se obtiene del rank más lento. Las
validaciones que reúnen el estado final quedan fuera de ese intervalo.
OpenMP y todos los ranks MPI comparten CPU y memoria del mismo host, así que
las cifras no predicen el rendimiento de tres nodos físicos. Registra CPU,
RAM, límites de recursos, versión Docker/OpenMPI y carga concurrente al
presentar resultados académicos.

## SSH y secretos del entorno local

El coordinador genera una clave Ed25519 sin contraseña al iniciar. La clave
privada reside exclusivamente en el volumen Docker `mpi-ssh-key`, montado solo
en `node1`; los trabajadores reciben únicamente la clave pública mediante el
volumen `mpi-authorized-keys`. No se guardan claves ni contraseñas en el
repositorio. El acceso por contraseña SSH está desactivado. Los contenedores
no usan modo privilegiado, no publican puertos y no montan el socket Docker.
Cada nodo tiene su propia clave de host persistente. En el primer lanzamiento
MPI, el coordinador fija esas claves en `known_hosts`; los siguientes
lanzamientos exigen verificación estricta de clave de host.

La clave SSH se conserva al detener el clúster con `down`, para facilitar el
reinicio repetible:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh down
./infrastructure/mpi-cluster/scripts/cluster.sh up
./infrastructure/mpi-cluster/scripts/cluster.sh verify
```

Los volúmenes de claves son específicos del entorno de desarrollo y deben
protegerse como credenciales. Para retirar esos datos de forma deliberada,
primero detén el clúster y elimina solo los volúmenes lógicos
`mpi-ssh-key`, `mpi-authorized-keys` y `mpi-node*-hostkeys` desde Docker.
Compose los materializa con el prefijo del proyecto (por defecto
`mpi-cluster_`). No se usa `down -v` en los scripts para evitar borrar estado
accidentalmente.

Las mediciones realizadas y su interpretación se encuentran en
[`../../benchmarks/mpi-docker-cluster.md`](../../benchmarks/mpi-docker-cluster.md).
