# Proyecto NEON

![Python](https://img.shields.io/badge/Python-Blender%20API-3776AB?logo=python&logoColor=white)
![Blender](https://img.shields.io/badge/Blender-procedural%203D-E87D0D?logo=blender&logoColor=white)
![Git](https://img.shields.io/badge/Git-control%20de%20versiones-F05032?logo=git&logoColor=white)

Automatización de vehículos de competición GT3 con **Python y Blender**. El
proyecto está orientado a generar modelos y materiales PBR, preparar escenas de
estudio y producir renders para un juego arcade en desarrollo. Git forma parte
del flujo de trabajo para mantener un historial de cambios de scripts y
recursos.

Repositorio: [JrogerFd/proyecto-neon](https://github.com/JrogerFd/proyecto-neon)

## Objetivo

Reducir el trabajo repetitivo de creación de assets y facilitar la iteración
visual de vehículos GT3 mediante scripts ejecutados dentro de Blender. El flujo
automatizado cubre la construcción procedural de elementos del vehículo, la
asignación de materiales físicamente basados y la preparación de una iluminación
de estudio lista para renderizar.

Los assets se conciben para integrarse en un juego arcade: deben ofrecer una
presentación visual cuidada y, a la vez, permitir iterar sobre sus componentes y
acabados desde el entorno de creación.

## Características

- **Generación procedural del vehículo:** creación y composición de un chasis
  con proporciones de coche de competición GT3.
- **Componentes configurables:** generación de rines, alerones y elementos
  visuales complementarios para construir variantes del vehículo.
- **Materiales PBR:** configuración de materiales para representar superficies
  pintadas, metal, goma y otros acabados mediante propiedades como color,
  rugosidad y metálico.
- **Iluminación de estudio:** preparación de una escena de presentación con
  iluminación orientada a definir volúmenes, reflejos y silueta.
- **Renderizado repetible:** escena preparada por script para revisar cambios de
  geometría y materiales de forma consistente.
- **Flujo con Git:** historial de versiones para organizar cambios en scripts,
  configuración y recursos del proyecto.

## Requisitos

- Blender instalado con el espacio de trabajo **Scripting** y su editor de
  texto.
- Python integrado en Blender. Los scripts de este flujo se ejecutan dentro de
  Blender y utilizan su API (`bpy`); no es necesario instalar `bpy` en un Python
  externo para ejecutarlos desde la interfaz.
- Git para clonar el repositorio y gestionar cambios.

La compatibilidad concreta depende de las API utilizadas por cada script. Si un
script especifica una versión de Blender o dependencias adicionales, utiliza
esa configuración.

## Uso desde el editor de texto de Blender

1. Clona el repositorio y abre Blender:

   ```bash
   git clone https://github.com/JrogerFd/proyecto-neon.git
   cd proyecto-neon
   ```

2. En Blender, selecciona el espacio de trabajo **Scripting**.
3. En el panel **Text Editor**, usa **Open** para abrir el script Python del
   proyecto que quieras ejecutar. También puedes crear un texto con **New** y
   pegar el contenido del script.
4. Revisa los parámetros de entrada del script y ajústalos antes de ejecutarlo,
   si corresponde.
5. Pulsa **Run Script** en el encabezado del editor (o usa `Alt+P` con el cursor
   sobre el editor).
6. Inspecciona el resultado en el **3D Viewport** y en la escena. Ejecuta el
   render desde Blender para comprobar la geometría, los materiales y la
   iluminación.
7. Guarda el archivo de trabajo con **File → Save**. Guarda o exporta los
   resultados desde Blender según el formato requerido por el flujo de
   integración del juego.

> **Nota:** ejecuta estos scripts desde Blender, no con `python script.py` en
> una terminal, salvo que un script indique expresamente que admite ejecución
> externa. Las operaciones que usan `bpy` requieren el contexto de Blender.

## Flujo de trabajo recomendado

1. **Generar:** ejecutar el script de construcción para crear el vehículo y sus
   componentes.
2. **Ajustar:** iterar sobre proporciones, piezas y parámetros de materiales.
3. **Presentar:** preparar la cámara y la iluminación de estudio para evaluar
   los acabados en el render.
4. **Guardar:** conservar el archivo `.blend` y los recursos de salida
   pertinentes.
5. **Versionar:** registrar cambios de código y recursos seleccionados en Git,
   con commits enfocados en cada cambio.

Ejemplo de flujo de versionado:

```bash
git status
git add ruta/al/script.py
git commit -m "Añade generación procedural del vehículo GT3"
```

## Estructura del proceso

El pipeline se organiza conceptualmente en estas etapas:

| Etapa | Resultado |
|---|---|
| Construcción procedural | Chasis y componentes GT3 generados en la escena |
| Materiales | Superficies configuradas con propiedades PBR |
| Presentación | Cámara e iluminación de estudio para inspección visual |
| Render | Imagen de referencia del asset |
| Control de versiones | Cambios de scripts y recursos registrados con Git |

## Créditos

Proyecto creado y mantenido por **JrogerFd**.

---

*Proyecto de automatización 3D para la producción de vehículos GT3 destinados a
un juego arcade en desarrollo.*
# proyecto-neon
