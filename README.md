# Docencia

App de asistencia y calificaciones para docentes que trabajan con listas de Excel. Permite llevar varios grupos y materias, separar registros por parcial y exportar el libro con calificaciones, faltas y una hoja con el detalle de asistencia.

## Abrir en Windows, Linux o macOS

Clona el repositorio y abre `src/index.html` en una versión reciente de Chrome, Edge o Firefox con soporte para `DecompressionStream("deflate-raw")`.

```sh
git clone https://github.com/S4w05/Docencia.git
cd Docencia
```

La edición web procesa los archivos en el navegador y guarda los borradores en su almacenamiento local. Vuelve a abrir el Excel original desde el mismo navegador y la misma ubicación de la app para recuperar su borrador. El navegador administra ese almacenamiento. Las funciones de biblioteca de listas, archivado, selector de carpeta y guardado nativo pertenecen a la app de macOS.

## Compilar la aplicación para macOS

Se requiere macOS 15 o posterior y Xcode o sus herramientas de línea de comandos con el SDK de macOS. Desde la raíz del repositorio:

```sh
./scripts/build-macos.sh
open build/Docencia.app
```

El argumento opcional puede ser `arm64`, `x86_64` o `universal`. El script firma localmente la app para desarrollo. Para distribuir binarios firmados y notarizados, usa tus propias credenciales de desarrollador de Apple.

En macOS, la app guarda las listas y sus borradores en `~/Library/Application Support/Docencia/Listas` por defecto. Puedes confirmar la ubicación o elegir otra desde **Carpeta de datos**.

## Importar una lista

Usa un archivo `.xlsx` con una columna **Nombres**, **Alumno** o **Estudiantes**. Para encabezados distintos, elige la columna y el rango de filas desde **Ajustar columnas y filas**. En listas compatibles con una columna de calificación, la app puede escribir ahí los resultados. Las plantillas que usan el formato institucional reconocido también reciben fechas y marcas de asistencia en sus columnas y el total de faltas. El repositorio incluye el código y los recursos de la app.

## Código y licencia

La interfaz y el procesamiento de Excel están en `src/index.html` y `src/attendance.js`. Para crear un cliente de escritorio en otro sistema, el puente de `src/Docencia.swift` sirve de referencia para implementar el almacenamiento y los diálogos de archivos de esa plataforma. La edición web puede usarse directamente y el cliente nativo se compila para macOS.

Licencia MIT. Puedes usar, modificar, redistribuir y hacer fork del proyecto, conservando el aviso de licencia.
