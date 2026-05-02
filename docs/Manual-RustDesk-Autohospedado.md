# Manual completo (operación y mantenimiento) — RustDesk autoalojado

**Objetivo**: desplegar un servicio remoto tipo RustDesk (autoalojado por la empresa) en una **VM Linux** con **servicios RustDesk en Docker**, y generar clientes personalizados con `https://rdgen.crayoneater.org/`.

Este documento está escrito para que cualquier persona de TI generalista pueda **instalar, operar, mantener, respaldar y migrar** el servicio con procedimientos simples y repetibles.

---

## 1) Datos fijos de tu entorno (importante)

- **DDNS / Dominio público**: `mancomputer.redirecme.net`
- **IP local de la VM**: `192.168.0.202`
- **Sistema**: VM en Linux (recomendado Debian/Ubuntu LTS)
- **Contenedores**: `hbbs` (rendezvous) y `hbbr` (relay) dentro de Docker
- **Generación de clientes**: `rdgen` (`https://rdgen.crayoneater.org/`)

---

## 2) Resumen de arquitectura (en 2 minutos)

RustDesk en modo autoalojado usa dos servicios principales:

- **`hbbs`**: servidor de “encuentro” (rendezvous). Los clientes lo consultan para localizar el otro extremo.
- **`hbbr`**: servidor de relay. Si la conexión directa P2P falla, el tráfico pasa por aquí.

Los clientes se configuran para apuntar a tu dominio `mancomputer.redirecme.net` y usar la **clave pública** del servidor.

**Punto crítico**: si cambias las claves del servidor, los clientes viejos dejarán de confiar en el servidor. Por eso la carpeta de datos (claves) se respalda y se migra.

---

## 3) Requisitos previos (checklist)

### 3.1 VM Linux recomendada

- **CPU**: 2 vCPU (mínimo)
- **RAM**: 2–4 GB
- **Disco**: 20–40 GB
- **Red**: IP fija en LAN `192.168.0.202`
- **Acceso**: SSH (puerto 22 o uno alternativo)

### 3.2 Router / Firewall perimetral

Debes tener:

- **DDNS** `mancomputer.redirecme.net` apuntando a tu IP pública.
- **NAT / Port Forwarding** hacia `192.168.0.202`.

---

## 4) Puertos necesarios (muy importante)

RustDesk Server usa varios puertos. Mantén esto como “fuente de verdad” para el router y el firewall de la VM:

### 4.1 Puertos a abrir hacia Internet (en el router)

Redirige hacia `192.168.0.202`:

- **TCP 21115**
- **TCP 21116**
- **UDP 21116**
- **TCP 21117**
- **TCP 21118**
- **TCP 21119**

> Nota: según versión/cliente, el uso exacto puede variar, pero este set cubre el escenario estándar. Si algo falla, el primer diagnóstico es confirmar NAT y firewall en estos puertos.

### 4.2 Puertos a permitir en el firewall de la VM

Permite los mismos puertos y SSH.

Ejemplo con `ufw` (Ubuntu/Debian):

```bash
sudo ufw allow 22/tcp
sudo ufw allow 21115/tcp
sudo ufw allow 21116/tcp
sudo ufw allow 21116/udp
sudo ufw allow 21117/tcp
sudo ufw allow 21118/tcp
sudo ufw allow 21119/tcp
sudo ufw enable
sudo ufw status verbose
```

---

## 5) Instalación desde cero (VM Linux + Docker + RustDesk)

Las instrucciones siguientes asumen Debian/Ubuntu. Si usas otra distro, se adapta principalmente el gestor de paquetes.

### 5.1 Preparar el sistema

Actualiza paquetes:

```bash
sudo apt update
sudo apt -y upgrade
sudo apt -y install ca-certificates curl gnupg lsb-release ufw
```

Configura hora (opcional pero recomendable):

```bash
timedatectl status
sudo timedatectl set-timezone Europe/Madrid
```

### 5.2 Instalar Docker Engine y Docker Compose (plugin)

Instalación rápida (repos oficial Docker):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Arranque y verificación:

```bash
sudo systemctl enable --now docker
docker version
docker compose version
```

(Opcional) permitir a tu usuario ejecutar Docker sin `sudo`:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### 5.3 Crear carpeta de despliegue

Usaremos `/opt/rustdesk-server`:

```bash
sudo mkdir -p /opt/rustdesk-server
sudo chown -R $USER:$USER /opt/rustdesk-server
cd /opt/rustdesk-server
mkdir -p data
```

### 5.4 Crear `docker-compose.yml`

Crea el archivo:

```bash
nano /opt/rustdesk-server/docker-compose.yml
```

Contenido recomendado:

```yaml
services:
  hbbs:
    image: rustdesk/rustdesk-server:latest
    container_name: rustdesk-hbbs
    command: hbbs -r mancomputer.redirecme.net:21117
    restart: unless-stopped
    ports:
      - "21115:21115/tcp"
      - "21116:21116/tcp"
      - "21116:21116/udp"
      - "21117:21117/tcp"
      - "21118:21118/tcp"
      - "21119:21119/tcp"
    volumes:
      - ./data:/root

  hbbr:
    image: rustdesk/rustdesk-server:latest
    container_name: rustdesk-hbbr
    command: hbbr
    restart: unless-stopped
    ports:
      - "21117:21117/tcp"
      - "21119:21119/tcp"
    volumes:
      - ./data:/root
```

> Importante: `hbbs` y `hbbr` comparten `./data` para conservar claves y configuración. La línea `hbbs -r mancomputer.redirecme.net:21117` define el relay/rendezvous que usarán los clientes.

### 5.5 Arrancar servicios

```bash
cd /opt/rustdesk-server
docker compose up -d
docker ps
```

Ver logs:

```bash
docker logs -n 200 rustdesk-hbbs
docker logs -n 200 rustdesk-hbbr
```

### 5.6 Verificación básica (sin herramientas raras)

Comprueba puertos escuchando:

```bash
sudo ss -lntup | grep -E "21115|21116|21117|21118|21119"
```

Comprueba que el DDNS resuelve a tu IP pública (desde un PC fuera de la red si es posible):

```bash
nslookup mancomputer.redirecme.net
```

---

## 6) Claves del servidor y “Key” para clientes (punto más importante)

RustDesk genera claves en la carpeta montada `./data` (dentro del host: `/opt/rustdesk-server/data`).

### 6.1 Dónde están las claves

En el host:

```bash
ls -la /opt/rustdesk-server/data
```

Normalmente verás archivos tipo:

- `id_ed25519` (clave privada)
- `id_ed25519.pub` (clave pública)

> **No compartas** la privada. La pública se usa para firmar/validar el servidor en los clientes.

### 6.2 Obtener la clave pública para configurar clientes

```bash
cat /opt/rustdesk-server/data/id_ed25519.pub
```

Copia ese valor y guárdalo en un lugar seguro (por ejemplo, un gestor de contraseñas/secretos de la empresa).

---

## 7) Generación de clientes con `rdgen` (paso a paso)

Sitio: `https://rdgen.crayoneater.org/`

**Datos que normalmente tendrás que introducir:**

- **Rendezvous Server**: `mancomputer.redirecme.net`
- **Relay Server**: `mancomputer.redirecme.net` (si el generador lo pide separado)
- **Key (Public Key)**: el contenido de `id_ed25519.pub`
- (Opcional) **Nombre/Branding** y parámetros de seguridad/políticas

### 7.1 Recomendaciones operativas para clientes

- Usa **la misma key** siempre (mientras no reconstruyas el servidor).
- Versiona los instaladores generados (ej.: `RustDesk-Cliente-EMPRESA-2026-04-29.exe`).
- Mantén un “paquete” por sistema operativo (Windows/macOS/Linux).

---

## 8) Operación diaria (para no expertos)

### 8.1 Comandos básicos (los 6 más usados)

Entrar a la VM:

```bash
ssh usuario@192.168.0.202
```

Ver estado:

```bash
cd /opt/rustdesk-server
docker ps
docker compose ps
```

Ver logs recientes:

```bash
docker logs -n 200 rustdesk-hbbs
docker logs -n 200 rustdesk-hbbr
```

Reiniciar servicios:

```bash
cd /opt/rustdesk-server
docker compose restart
```

Parar y arrancar:

```bash
cd /opt/rustdesk-server
docker compose down
docker compose up -d
```

Actualizar a la última versión:

```bash
cd /opt/rustdesk-server
docker compose pull
docker compose up -d
docker image prune -f
```

### 8.2 Qué revisar si “no conecta”

Checklist en orden (del más común al menos común):

1) **DDNS**: ¿`mancomputer.redirecme.net` apunta a la IP pública correcta?
2) **Router/NAT**: ¿los puertos están redirigidos a `192.168.0.202`?
3) **Firewall VM** (`ufw`): ¿puertos permitidos?
4) **Servicios**: ¿contenedores “Up”?
5) **Claves**: ¿se perdió la carpeta `/opt/rustdesk-server/data`?

Comandos útiles:

```bash
docker ps
sudo ufw status verbose
sudo ss -lntup | grep -E "21115|21116|21117|21118|21119"
```

---

## 9) Backups (respaldo) — política simple y efectiva

**Qué se respalda**: la carpeta `/opt/rustdesk-server/` (en especial `data/` y `docker-compose.yml`).

### 9.1 Backup manual (archivo .tar.gz)

```bash
sudo tar -czf /root/backup-rustdesk-$(date +%F).tar.gz -C /opt rustdesk-server
ls -lh /root/backup-rustdesk-*.tar.gz
```

Transfiere el backup a un lugar seguro (NAS/S3/otro servidor):

```bash
scp /root/backup-rustdesk-YYYY-MM-DD.tar.gz usuario@SERVIDOR_BACKUP:/ruta/
```

### 9.2 Restauración desde backup (en una VM nueva)

1) Instala Docker + Compose (sección 5.2).
2) Copia el backup a la VM nueva en `/root/`.
3) Restaura:

```bash
sudo tar -xzf /root/backup-rustdesk-YYYY-MM-DD.tar.gz -C /opt
cd /opt/rustdesk-server
docker compose up -d
```

**Resultado**: mantienes las **mismas claves**, por lo que los clientes existentes siguen funcionando sin regenerarlos.

---

## 10) Seguridad mínima recomendada (sin complicaciones)

### 10.1 Sistema operativo

- Mantén el sistema al día:

```bash
sudo apt update
sudo apt -y upgrade
sudo reboot
```

- Desactiva login SSH por contraseña (si tu organización puede) y usa llaves.
- Limita SSH a IPs administrativas si es posible.

### 10.2 Docker

- Evita exponer servicios extra en la VM.
- No publiques la clave privada.
- Mantén `data/` con permisos restringidos.

```bash
sudo chmod -R go-rwx /opt/rustdesk-server/data
```

---

## 11) Monitorización básica (sin herramientas enterprise)

### 11.1 Salud de contenedores

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### 11.2 Uso de recursos

```bash
docker stats --no-stream
free -h
df -h
```

---

## 12) Migración del servicio entre hipervisores

Tienes dos estrategias. La recomendada para “cero complicaciones” es **migrar por backup de aplicación** (estrategia B), porque funciona igual aunque cambies el hypervisor.

### Estrategia A (migrar VM completa): Proxmox → VirtualBox/VMware

**Útil si**: quieres mover la VM “tal cual”, con todo el sistema, redes, Docker, etc.

#### A.1 En Proxmox: crear backup de VM

En el host Proxmox (no dentro de la VM), identifica VMID y ejecuta:

```bash
vzdump <VMID> --mode snapshot --compress zstd --storage local
```

El backup queda típico en:

- `/var/lib/vz/dump/`

Verifica:

```bash
ls -lh /var/lib/vz/dump/ | grep <VMID>
```

#### A.2 Exportar disco y convertir formato

Si en vez de restaurar en Proxmox quieres importar en otro hypervisor, normalmente tendrás un disco `qcow2` o `raw`.

Instala `qemu-img` en una máquina Linux (host Proxmox suele tenerlo):

```bash
qemu-img --version
```

Ejemplos de conversión:

- **QCOW2 → VMDK (VMware)**

```bash
qemu-img convert -p -f qcow2 -O vmdk vm-disk.qcow2 vm-disk.vmdk
```

- **QCOW2 → VDI (VirtualBox)**

```bash
qemu-img convert -p -f qcow2 -O vdi vm-disk.qcow2 vm-disk.vdi
```

Luego crea una VM nueva en VMware/VirtualBox y adjunta el disco convertido.

#### A.3 Ajustes típicos tras importar

1) **Red**: configura la NIC (NAT/Bridged) para que la VM vuelva a tener IP estática `192.168.0.202`.
2) **SSH**: prueba acceso.
3) **Docker**: verifica que arranca.
4) **Servicios**: `docker compose up -d` si no levantó automáticamente.

### Estrategia B (recomendada): migrar por backup de aplicación (Docker/data)

**Útil si**: quieres migrar sin depender del hypervisor y con mínima complejidad.

#### B.1 En la VM origen: crear backup

```bash
sudo tar -czf /root/backup-rustdesk-$(date +%F).tar.gz -C /opt rustdesk-server
```

#### B.2 Preparar la VM destino (en VirtualBox/VMware/otro)

1) Instala Linux.
2) Asigna IP estática (ideal: `192.168.0.202` cuando hagas el corte).
3) Instala Docker + Compose (sección 5.2).

#### B.3 Restaurar y levantar

Copia el tar.gz a la VM nueva y ejecuta:

```bash
sudo mkdir -p /opt
sudo tar -xzf /root/backup-rustdesk-YYYY-MM-DD.tar.gz -C /opt
cd /opt/rustdesk-server
docker compose up -d
docker ps
```

#### B.4 Corte (cambio definitivo)

1) Apaga servicios en VM vieja:

```bash
cd /opt/rustdesk-server
docker compose down
```

2) Asegura que **DDNS** sigue apuntando a tu IP pública (normalmente no cambia).
3) En el router, confirma que el NAT apunta a `192.168.0.202` (si cambió la VM física, pero mantienes la IP local, no tendrás que tocar NAT).

**Resultado**: los clientes siguen funcionando porque conservaste `data/` (claves).

---

## 13) Procedimiento “desastre total” (reconstruir desde cero)

Si perdiste completamente el servidor y **no tienes backup de `data/`**:

1) Reinstala (sección 5).
2) Se generarán **claves nuevas**.
3) Tendrás que **regenerar clientes** en `rdgen` con la nueva `id_ed25519.pub`.

> Impacto: los clientes antiguos podrían no confiar en el nuevo servidor, y tendrás que redistribuir el instalador actualizado.

---

## 14) Apéndice: comandos de diagnóstico rápidos

### 14.1 Ver contenedores y reinicios

```bash
docker ps -a
docker compose ps
```

### 14.2 Ver errores recientes

```bash
docker logs -n 300 rustdesk-hbbs
docker logs -n 300 rustdesk-hbbr
```

### 14.3 Reinicio limpio

```bash
cd /opt/rustdesk-server
docker compose down
docker compose up -d
```

### 14.4 Comprobar resolución DNS

```bash
nslookup mancomputer.redirecme.net
```

---

## 15) “Hoja de operación” (1 página)

**Estado**:

```bash
cd /opt/rustdesk-server && docker compose ps
```

**Reiniciar**:

```bash
cd /opt/rustdesk-server && docker compose restart
```

**Actualizar**:

```bash
cd /opt/rustdesk-server && docker compose pull && docker compose up -d
```

**Backup**:

```bash
sudo tar -czf /root/backup-rustdesk-$(date +%F).tar.gz -C /opt rustdesk-server
```

