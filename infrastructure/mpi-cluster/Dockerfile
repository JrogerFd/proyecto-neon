FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      cmake \
      iproute2 \
      iputils-ping \
      libopenmpi-dev \
      openmpi-bin \
      openssh-client \
      openssh-server \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash neon \
    && mkdir -p /etc/neon-rush /opt/neon-rush

WORKDIR /opt/neon-rush
COPY backend/CMakeLists.txt backend/README.md /opt/neon-rush/backend/
COPY backend/include/ /opt/neon-rush/backend/include/
COPY backend/src/ /opt/neon-rush/backend/src/
COPY backend/tests/ /opt/neon-rush/backend/tests/
COPY infrastructure/mpi-cluster/config/hostfile /etc/neon-rush/hostfile
COPY infrastructure/mpi-cluster/scripts/cluster-entrypoint.sh /usr/local/bin/cluster-entrypoint
COPY infrastructure/mpi-cluster/scripts/run-mpi.sh /usr/local/bin/run-mpi
RUN chmod 0755 /usr/local/bin/cluster-entrypoint /usr/local/bin/run-mpi \
    && cmake -S /opt/neon-rush/backend -B /opt/neon-rush/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DMPI_CXX_COMPILER=/usr/bin/mpicxx \
    && cmake --build /opt/neon-rush/build --parallel \
    && test -x /opt/neon-rush/build/neon_rush_api \
    && chown -R neon:neon /opt/neon-rush

USER neon
RUN OMPI_MCA_rmaps_base_oversubscribe=1 \
    ctest --test-dir /opt/neon-rush/build --output-on-failure

USER root
ENTRYPOINT ["/usr/local/bin/cluster-entrypoint"]
