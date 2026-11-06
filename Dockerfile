FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive \
    OMPI_ALLOW_RUN_AS_ROOT=1 \
    OMPI_ALLOW_RUN_AS_ROOT_CONFIRM=1 \
    OMPI_MCA_plm_rsh_agent=ssh

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssh-server \
        openssh-client \
        openmpi-bin \
        libopenmpi-dev \
        build-essential \
        iproute2 \
        libgl1 \
        libgl1-mesa-dri \
        libegl1 \
        libglx0 \
        libx11-6 \
        libxext6 \
        libxi6 \
        libxrender1 \
        libxfixes3 \
        libxrandr2 \
        libxcursor1 \
        libxinerama1 \
        libxxf86vm1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY requirements-render.txt ./
RUN pip install --no-cache-dir -r requirements-render.txt
COPY requirements-mpi.txt ./
RUN pip install --no-cache-dir --no-binary=mpi4py -r requirements-mpi.txt

COPY . .

RUN mkdir -p /root/.ssh /run/sshd /run/mpi-ssh \
    && sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config \
    && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config \
    && sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && echo 'StrictModes no' >> /etc/ssh/sshd_config

COPY docker/entrypoint.sh /usr/local/bin/neonrush-entrypoint
RUN chmod +x /usr/local/bin/neonrush-entrypoint

EXPOSE 50505

ENTRYPOINT ["/usr/local/bin/neonrush-entrypoint"]
CMD ["python", "run.py", "--help"]
