# Docencia

App de asistencia y calificaciones para docentes que trabajan con listas de Excel. Permite llevar varios grupos y materias, separar registros por parcial y exportar el libro con calificaciones, faltas y una hoja con el detalle de asistencia.

## Aplicaciones portables para Windows y Linux

Los paquetes están en [GitHub Releases](https://github.com/S4w05/Docencia/releases).

- **Windows 10/11**. Extrae el ZIP completo y abre `Docencia/Docencia.exe`. Elige x64 para procesadores Intel o AMD y arm64 para Windows sobre ARM. Los archivos que acompañan al ejecutable forman parte de la aplicación.
- **Linux**. Extrae el archivo `.tar.gz` manteniendo los permisos y abre `Docencia/docencia`. Elige la arquitectura de tu equipo. Se requiere una sesión de escritorio y bibliotecas compatibles con Chromium. Las pruebas de arranque de Linux x64 se ejecutan en Ubuntu.

Ambas ediciones guardan localmente las listas, asistencias y calificaciones, y permiten cambiar de carpeta, archivar semestres y exportar Excel.

### Generar los paquetes

Ejecuta el flujo **Compilar Docencia para Windows y Linux** en la pestaña [Actions](https://github.com/S4w05/Docencia/actions/workflows/desktop.yml). El flujo empaqueta Windows y Linux para x64 y arm64.

También puedes generarlos con Python 3.10 o posterior y la CLI de GitHub. Por ejemplo, desde Linux para conservar los permisos del ejecutable:

```sh
python3 scripts/package-desktop.py linux x64 build/portable
```

## Edición web para Windows, Linux o macOS

Clona el repositorio y abre `src/index.html` en una versión reciente de Chrome, Edge o Firefox con soporte para `DecompressionStream("deflate-raw")`.

```sh
git clone https://github.com/S4w05/Docencia.git
cd Docencia
```

La edición web procesa los archivos en el navegador y guarda los borradores en su almacenamiento local. Vuelve a abrir el Excel original desde el mismo navegador y la misma ubicación de la app para recuperar su borrador. El navegador administra ese almacenamiento. La biblioteca de listas, el archivado y el selector de carpeta están disponibles en las aplicaciones de escritorio.

## Compilar la aplicación para macOS

Se requiere macOS 15 o posterior y Xcode o sus herramientas de línea de comandos con el SDK de macOS. Desde la raíz del repositorio:

```sh
./scripts/build-macos.sh
open build/Docencia.app
```

El argumento opcional puede ser `arm64`, `x86_64` o `universal`. El script firma localmente la app para desarrollo. Para distribuir binarios firmados y notarizados, usa tus propias credenciales de desarrollador de Apple.

En macOS, la app guarda las listas y sus borradores en `~/Library/Application Support/Docencia/Listas` por defecto. Puedes confirmar la ubicación o elegir otra desde **Carpeta de datos**.

En **Carpeta de datos**, **Archivar semestre e iniciar otro** abre una carpeta vacía y conserva el semestre anterior. **Semestres guardados** permite volver a cualquiera de las carpetas que hayas usado como semestre.

## Importar una lista

Usa un archivo `.xlsx` con una columna **Nombres**, **Alumno** o **Estudiantes**. Para encabezados distintos, elige la columna y el rango de filas desde **Ajustar columnas y filas**. En listas compatibles con una columna de calificación, la app puede escribir ahí los resultados. Las plantillas que usan el formato institucional reconocido también reciben fechas y marcas de asistencia en sus columnas y el total de faltas. El repositorio incluye el código y los recursos de la app.

## Parciales y cierre semestral

Añade los periodos que necesites dentro de cada materia. En **Recuento de materia**, define cuántos parciales están previstos y reparte 100 puntos entre parciales y semestral. La configuración inicial prevé tres parciales y asigna 50 puntos a cada bloque. Las notas se capturan sobre 100. Por ejemplo, con parciales de 80, 90 y 100 y un semestral de 92, el resultado es 45 + 46 = **91/100**.

Cada periodo conserva su asistencia. La hoja institucional exporta la calificación y faltas del periodo seleccionado. La hoja **Recuento de materia** reúne las notas de todos los periodos, sus asistencias y la nota final cuando está completa.

## Código y licencia

La interfaz y el procesamiento de Excel están en `src/index.html`, `src/periods.js` y `src/attendance.js`. La app para macOS usa el puente de `src/Docencia.swift`. Los paquetes de Windows y Linux usan el puente y el almacenamiento local de `desktop/`.

Licencia MIT. Puedes usar, modificar, redistribuir y hacer fork del proyecto, conservando el aviso de licencia.
