# AgroCore Argentina

## Manual de Usuario

**El corazón del negocio agrícola**

Sistema integral de gestión para empresas rurales y agropecuarias.
Multi-empresa · Multi-usuario · En la nube o servidor propio.

---

**Versión del manual:** 2.0 — julio 2026 · cubre AgroCore v2.15
**Sistema:** AgroCore v2.15
**Soporte:** vía WhatsApp / mail · Respuesta en 24 hs hábiles

---

## Tabla de contenidos

1. Bienvenida
2. Acceder al sistema
3. Primer login y conceptos clave
4. Recorrido por la interfaz
5. Trabajar con múltiples empresas
6. Módulos del sistema
   - 6.1 Inicio
   - 6.2 Dashboard
   - 6.3 Producción
   - 6.4 Stock
   - 6.5 Contactos
   - 6.6 Finanzas
   - 6.7 Logística y RRHH
   - 6.8 Administración
   - 6.9 Agenda y recordatorios
   - 6.10 Resumen multi-empresa
7. Flujos de trabajo típicos
8. Preguntas frecuentes
9. Soporte y contacto

---

## 1. Bienvenida

AgroCore es un sistema integral pensado **por y para el agro argentino**. No es un ERP genérico adaptado a la fuerza: cada módulo se diseñó pensando en las particularidades del campo argentino — campañas de gruesa y fina, arrendamientos en quintales, facturación con ARCA, libro IVA, cotizaciones de la BCR Rosario en vivo.

El sistema te permite gestionar:

- **Producción:** campos, lotes, campañas, insumos y labores aplicadas.
- **Stock:** granos y productos en general, con trazabilidad y reporte de margen.
- **Contactos:** clientes y proveedores, con cuentas corrientes integradas.
- **Finanzas:** flujo de caja, facturación electrónica ARCA, compras, libro IVA, cheques, cuentas corrientes, arrendamientos y control de efectivo.
- **Logística y RRHH:** viajes (cartas de porte) y empleados (contratos, recibos).
- **Administración:** catálogos, usuarios, roles y permisos, empresas.

Todo en una sola plataforma, con datos compartidos entre módulos. Si cargás una factura de venta, automáticamente se actualiza el stock, el flujo de caja proyectado, la cuenta corriente del cliente, el libro IVA y los KPIs del dashboard.

---

## 2. Acceder al sistema

### Para el demo

Durante el período de prueba, accedé desde cualquier navegador (Chrome, Edge, Firefox o Safari) en computadora, tablet o celular:

```
https://demo.agrocore.ar
```

El sistema te lleva automáticamente a la pantalla de login.

### Para producción (cuenta propia)

Una vez contratado, AgroCore se instala sobre tu propia infraestructura, a elección:

- **Cloud (AWS):** sobre tu cuenta de Amazon Web Services. URL personalizada (por ejemplo `app.tuempresa.com.ar`). Acceso desde cualquier lugar con internet.
- **Servidor propio (on-premise):** instalado en un servidor físico de tu empresa. Acceso desde la red interna o vía VPN.

En ambos casos, el sistema y los datos son **de tu propiedad**.

### Compatibilidad

- **Navegadores:** Chrome, Edge, Firefox, Safari (versiones de los últimos 2 años).
- **Dispositivos:** computadora de escritorio (recomendado), notebook, tablet, celular.
- **Sin instalación:** todo corre en el navegador.
- **Modo offline:** funciona como PWA (Progressive Web App), permitiendo seguir consultando información incluso sin internet temporalmente.

---

## 3. Primer login y conceptos clave

### Usuarios de prueba

En el demo, ya hay dos usuarios cargados:

| Usuario | Contraseña | Rol |
|---|---|---|
| `Admin` | `admin123` | Administrador de empresa |
| `Super` | `super123` | Super administrador (todas las empresas) |

> En tu instalación productiva estos usuarios no existen — el primer alta la hace el equipo de implementación con tus datos reales.

### Cómo iniciar sesión

1. Entrá a `https://demo.agrocore.ar`.
2. Escribí el **usuario** (alias, nombre o email) y la **contraseña**.
3. Clic en **Ingresar**.

### Conceptos fundamentales

**Empresa**
> Cada empresa es una unidad independiente de datos: tiene sus campos, su stock, sus clientes, sus facturas. No se mezcla con otras. Una persona puede tener acceso a varias empresas (por ejemplo, un contador que lleva tres explotaciones).

**Usuario**
> La persona física que usa el sistema. Tiene un alias, email, foto opcional y contraseña encriptada.

**Rol y permisos**
> Cada usuario, en cada empresa donde tiene acceso, tiene un rol. Los roles definen qué puede hacer y qué no. Los permisos están agrupados por módulo (`produccion:read`, `stock:read`, `finanzas:read`, etc.) y los roles vienen pre-cargados con permisos típicos del agro, personalizables por empresa.

---

## 4. Recorrido por la interfaz

### El layout general

Una vez adentro, ves siempre tres zonas:

- **Barra lateral (izquierda):** logo, selector de empresa activa, navegación entre módulos agrupados en secciones.
- **Barra superior:** título de la pantalla, buscador global, notificaciones, ticker de cotizaciones BCR.
- **Área principal (centro):** contenido del módulo actual.

### Las 7 secciones de la barra lateral

| Sección | Contenido |
|---|---|
| **INICIO** | Inicio · Dashboard |
| **PRODUCCIÓN** | Campos y lotes · Campañas · Insumos y labores |
| **STOCK** | Stock · Movimientos · Reporte de margen |
| **CONTACTOS** | Clientes · Proveedores |
| **FINANZAS** | Flujo de caja · Facturación (ventas) · Compras · Libro IVA · Cheques · Cuentas corrientes · Arrendamientos · Control de efectivo |
| **LOGÍSTICA Y RRHH** | Viajes · Empleados |
| **ADMINISTRACIÓN** | Catálogos · Usuarios · Roles y permisos · Empresas |

### El ticker de cotizaciones BCR

| Indicador | Qué es |
|---|---|
| **Blue** | Cotización del dólar paralelo (ARS por USD). |
| **CCL** | Contado con liquidación (cotización financiera). |
| **Cripto** | Promedio del USDT en exchanges argentinos. |
| **Tarjeta** | Dólar oficial + impuestos (consumo en moneda extranjera). |
| **Soja** | Precio Cámara Arbitral de Cereales BCR (USD/tonelada). |
| **Maíz** | Ídem soja. |
| **Trigo** | Ídem soja. |

La hora a la derecha muestra cuándo se actualizó por última vez. El sistema refresca automáticamente.

### Notificaciones

El icono de campanita arriba a la derecha muestra alertas: vencimientos de cheques, stock bajo, facturas vencidas, vencimientos de arrendamientos, etc.

### Buscador global

La barra de búsqueda al centro-arriba permite encontrar rápidamente clientes, productos o empleados sin entrar al módulo correspondiente.

---

## 5. Trabajar con múltiples empresas

Una funcionalidad clave: **gestionás varias empresas con el mismo usuario**, sin cerrar sesión.

### Cómo cambiar de empresa

1. Clic sobre el nombre de la empresa actual en la barra lateral.
2. Aparece un menú con todas las empresas a las que tenés acceso.
3. Clic en la empresa destino.
4. La página se recarga mostrando los datos de la nueva empresa.

Al cambiar, **todo el sistema cambia de contexto**. Sin riesgo de mezcla de datos.

### Color institucional por empresa

Cada empresa puede tener configurado un color hex propio. Al cambiar de empresa, el borde activo del menú lateral, los acentos del header y otros detalles visuales toman ese color. Útil cuando un contador lleva varias explotaciones — el color te recuerda en cuál estás trabajando.

### Permisos por empresa

Una persona puede ser "Admin" en la empresa A y "Solo lectura" en la empresa B. El sistema aplica el rol correspondiente al cambiar.

### Para Super Admin

Los usuarios con rol `super` pueden ver todas las empresas, crear/modificar/eliminar empresas y asignar usuarios. Generalmente reservado para el dueño del sistema o el contador externo.

---

## 6. Módulos del sistema

### 6.1 Inicio

Punto de aterrizaje al entrar. Muestra:

- **Saludo personalizado** con tu nombre, empresa activa y fecha.
- **KPIs rápidos** (lado derecho): Campañas activas, Stock granos (kg), Cabezas.
- **Accesos rápidos** (grilla central): tarjetas con acceso directo a Campañas, Stock, Movimientos, Margen, Facturación, Compras, Clientes, Proveedores, Dashboard.
- **Botón "Ir al Dashboard"** para profundizar.

### 6.2 Dashboard

Vista de control para dueño / gerente. Tabs internas:

- **Resumen:** indicadores económicos generales del mes vs mes anterior.
- **Finanzas:** ventas, compras, margen, cuentas corrientes, posición de cheques.
- **Stock:** valorización, productos con menor rotación, alertas de mínimo.
- **Producción:** campañas activas, hectáreas por cultivo, rinde estimado vs real.
- **Evolución patrimonial:** cómo evolucionó el stock + cuentas a lo largo del tiempo.

Cada tab tiene sus propios gráficos (Chart.js) y KPIs. Filtrable por rango de fechas y moneda (pesos / dólares).

---

### 6.3 Producción

Sección que agrupa la gestión de campos, lotes, campañas e insumos.

#### Campos y lotes

**Qué hace:** permite cargar las parcelas con sus datos catastrales, superficie y subdivisiones (lotes).

**Datos típicos:**
- Nombre del campo (ej. "Campo Las Tres Marías")
- Localidad y provincia
- Coordenadas GPS (opcional)
- Superficie total (en hectáreas)
- Tipo de tenencia: propio, arrendado, en aparcería
- Si es arrendado: contrato vinculado (ver Finanzas → Arrendamientos)
- Lotes: cada lote tiene su propio nombre, superficie y ambiente

**Lotes y ambientes:** cada lote puede tener un ambiente asociado (alto / medio / bajo, suelo arcilloso / franco / arenoso) usado después al planificar campañas y al generar reportes de margen por ambiente.

#### Campañas

**Qué hace:** una campaña representa el ciclo productivo de un cultivo en uno o varios lotes durante una temporada. Es el núcleo de la planificación productiva.

**Datos:**
- Nombre de la campaña (ej. "Soja 2025/26")
- Cultivo principal: soja, maíz, trigo, girasol, etc.
- Tipo: gruesa, fina, doble cultivo
- Fecha de siembra prevista y real
- Fecha de cosecha prevista y real
- Lotes incluidos
- Variedad / híbrido sembrado
- Densidad de siembra
- Rinde estimado (kg/ha) y rinde real (cuando se cosecha)

**Estados:** Planificada → Sembrada → En curso → Cosechada → Histórica.

**Margen bruto:** a medida que cargás insumos aplicados (semilla, fertilizantes, herbicidas) y al cosechar registrás rinde + precio de venta, el sistema calcula automáticamente el margen bruto por hectárea, total de la campaña, y comparado con la planificación inicial.

#### Insumos y labores

**Qué hace:** registra cada aplicación de insumo (semilla, fertilizante, agroquímico) y cada labor (siembra, pulverización, cosecha) sobre un lote específico de una campaña.

**Datos:**
- Campaña + lote
- Fecha
- Tipo (insumo o labor)
- Producto utilizado (busca en el catálogo)
- Dosis por hectárea
- Cantidad total aplicada
- Costo
- Operario / contratista
- Equipo utilizado
- Observaciones

**Integración con stock:** cuando cargás un insumo aplicado, **automáticamente se descuenta del stock** del producto correspondiente. No hay que cargar dos veces.

**Reporte por lote:** vista que muestra todas las aplicaciones realizadas en un lote durante una campaña, con costo acumulado vs presupuesto.

**Labor con varios empleados e insumos:** en una misma labor podés cargar varios operarios (con su % de cobro cada uno) y varios insumos por lote sin salir del formulario.

#### Servicios a terceros (labores facturables)

**Qué hace:** cuando hacés una labor **para otro campo/cliente**, al cargarla tildás "Servicio a terceros" y elegís el cliente (la campaña queda opcional). La labor se registra igual (los insumos siguen descontando stock y se calcula el % de ganancia del empleado **solo sobre el precio de la labor**, no sobre los insumos que se le cobran al cliente).

**Facturar:** en **Producción → Servicios a terceros** ves la lista con un botón **Facturar**, que abre la factura de venta ya cargada con el cliente + la línea de la labor + los insumos como líneas aparte. Al autorizarla, el servicio queda marcado como facturado y vinculado a esa factura.

#### Hacienda (por campo)

**Qué hace:** gestiona el ganado por campo. Definís las **categorías de animales por especie** (bovino, porcino, ovino, etc.) desde el catálogo "Categorías de animales", registrás los movimientos de hacienda y el sistema lleva el **stock por campo**, comparando el declarado (SENASA / RENSPA) con el real.

**Datos:** especie y categoría, cantidad de cabezas, kg/peso por categoría, campo, fecha. Funciona incluso **sin conexión** y las cabezas se consolidan en los KPIs del Inicio. En empresas solo agrícolas, los campos de hacienda se ocultan.

---

### 6.4 Stock

Maneja todo lo que se compra, almacena, consume o vende.

#### Stock (Productos y existencias)

Listado del inventario actual: cada producto con su cantidad disponible, valorizado al precio de última compra o promedio ponderado.

**Tipos de productos:** insumos agrícolas, granos, combustible, repuestos y consumibles, otros.

**Información por producto:** nombre, código, categoría, unidad, stock actual (con alerta de mínimo), valorización, ubicación, histórico de movimientos.

#### Movimientos

Cada vez que entra o sale algo del stock, se registra un movimiento. Trazabilidad completa.

**Tipos:** entrada por compra, entrada por cosecha, salida por venta, salida por consumo interno, ajuste de inventario, transferencia entre depósitos.

**Cada movimiento registra:** fecha, tipo, producto y cantidad, origen/destino, comprobante asociado, usuario.

**Integración:** los movimientos generados por compras o ventas tienen un botón que abre la factura origen. En facturas de venta, el sistema avisa antes de vender más de lo que hay en stock.

#### Reporte de margen

Análisis económico que cruza compras vs ventas (de granos u otros productos) calculando:

- Costo promedio del producto
- Precio promedio de venta
- % de margen
- Ganancia total

Filtros: por producto, campaña, cliente / proveedor, período. Exportable a Excel.

#### Traspaso / conversión y reubicación

**Traspaso entre artículos:** convertís stock de un artículo en otro (ej. **grano → semilla**), descontando de uno e ingresando al otro en un solo paso, con la trazabilidad del movimiento.

**Reubicar en lote:** cambiás la categoría / familia de varios artículos a la vez, útil cuando reorganizás el catálogo.

**Catálogo con árbol:** el stock y los buscadores muestran **solo artículos del catálogo**, ordenados por el árbol **Categoría → Familia → Producto** (ver Administración → Catálogos), con filtros por categoría y familia.

---

### 6.5 Contactos

#### Clientes

**Qué hace:** carga y gestión de clientes a quienes les vendés. Base para emitir facturas, llevar cuentas corrientes y reportes comerciales.

**Datos:**
- Razón social y nombre de fantasía
- CUIT / CUIL
- Condición frente al IVA: RI, Monotributo, Exento, Consumidor Final
- Domicilio fiscal
- Email y teléfono
- Persona de contacto
- Condiciones comerciales por defecto (días de pago, lista de precios)
- Observaciones internas

**Información derivada:** saldo de cuenta corriente, última factura emitida, total facturado en el último año, cheques recibidos pendientes.

#### Proveedores

Espejo de Clientes pero para vendedores de insumos, contratistas, transportistas, etc. Mismos campos. Información derivada: saldo a pagar, total comprado en el año, cheques entregados pendientes.

---

### 6.6 Finanzas

La sección más amplia del sistema. Agrupa toda la gestión económica y financiera.

#### Flujo de caja

**Qué hace:** proyección financiera consolidada a partir de cobros esperados, pagos comprometidos, vencimientos de cheques, pagos de arrendamientos y otros compromisos cargados en el sistema.

**Salida:** gráfico y tabla diaria/semanal/mensual con saldo proyectado a 30/60/90 días. Anticipa baches financieros antes de que ocurran.

#### Facturación (ventas)

**Qué hace:** emite facturas electrónicas (A, B, C, M) directamente vía web service de ARCA, con CAE en el momento.

**Cómo emitir una factura:**

1. Clic en **Facturación → Nueva factura**.
2. Seleccionar el cliente.
3. El sistema sugiere el tipo de comprobante según condición IVA tuya / del cliente.
4. Cargar ítems: producto / servicio, cantidad, precio, IVA. Si es producto del stock, se descuenta automáticamente.
5. El dropdown de productos muestra el stock disponible y avisa si querés vender más de lo que hay.
6. Verificar total y agregar observaciones.
7. **Emitir** → conexión a ARCA, CAE obtenido, PDF generado.
8. Listo para enviar por email al cliente.

**Tipos soportados:** Facturas A/B/C/M, Notas de crédito y débito, Recibos, Remitos, Comprobantes de cobro.

**Modo informal:** si tu empresa no factura por ARCA, el sistema genera comprobantes internos sin CAE pero con el mismo formato visual. En empresas informales, todo lo relativo a ARCA queda deshabilitado (grisado).

**Envío y reimpresión:** cada comprobante se puede **enviar por email o por WhatsApp** al cliente, reimprimir en PDF (la factura ARCA sale por triplicado) y **reabrir** desde la cuenta corriente.

**Notas de crédito y débito:** la **NC** reingresa el stock; la **ND** no mueve stock.

**Saldo a favor:** si un cliente paga de más o se le emite una NC, queda un **saldo a favor** que luego se aplica a otras facturas.

**Numeración:** los comprobantes internos (órdenes de pago, recibos) llevan numeración automática y correlativa, configurable en Administración → numeradores.

#### Compras

**Qué hace:** registra las facturas que **te emiten** los proveedores, para control de gastos, IVA crédito fiscal, cuentas corrientes y vencimientos.

**Datos por factura de compra:**
- Proveedor
- Tipo y número de comprobante
- Fecha de emisión y de vencimiento
- Ítems con detalle, cantidades, precios y alícuotas
- Si el ítem es producto del stock, **se incrementa automáticamente** al confirmar
- Forma de pago: contado, cheque, cuenta corriente, transferencia
- Adjuntar PDF / imagen del comprobante físico (opcional)

**Importación masiva:** desde Excel o desde el portal "Mis Comprobantes" de ARCA. Un lector de **PDF de factura ARCA** autocompleta el formulario leyendo el código QR o el nombre del archivo.

**Pago y Orden de Pago:** al pagar una factura de compra (efectivo, cheque propio, transferencia, **tarjeta de crédito** o medio externo del catálogo) el sistema genera una **Orden de Pago** imprimible / PDF con el detalle de comprobantes aplicados, cheques entregados, retenciones e importe en letras. Se puede enviar por email / WhatsApp y **deshacer / reabrir** el pago desde la cuenta corriente.

#### Libro IVA

**Qué hace:** consolida todas las operaciones gravadas del período (ventas + compras) discriminadas por alícuota, listo para presentación de DDJJ de IVA.

**Vistas:**
- **Libro IVA Ventas:** todas las facturas emitidas del mes, con base imponible y débito fiscal por alícuota (10.5%, 21%, 27%, exento).
- **Libro IVA Compras:** todas las facturas recibidas del mes, con base y crédito fiscal por alícuota.
- **Resumen mensual:** débito fiscal, crédito fiscal y saldo a pagar / favor.

**Exportación:** archivos compatibles con AFIP/ARCA (formato CITI o Mis Comprobantes), Excel, PDF.

#### Cheques

**Qué hace:** registra cheques recibidos (de clientes) y emitidos (a proveedores), con su estado a través del ciclo de vida.

**Estados:** En cartera → Endosado / Depositado → Acreditado / Rechazado.

**Datos por cheque:** número, banco, sucursal, importe, fechas (emisión y vencimiento), cliente / proveedor, cuenta corriente afectada, CUIT del librador, observaciones.

**Alertas:** el sistema avisa cuando un cheque está próximo a vencer (3 días antes por defecto).

#### Cuentas corrientes

**Qué hace:** para cada cliente y cada proveedor, mantiene un registro de débitos y créditos con saldo actualizado.

**Movimientos típicos:**
- Factura emitida → débito en cuenta corriente del cliente.
- Cobro recibido → crédito en cuenta corriente del cliente.
- Factura recibida → débito (te debe el proveedor… al revés, vos le debés).
- Pago realizado → crédito en cuenta corriente del proveedor.

**Conciliación:** permite "atar" un cobro a una factura específica, dejando claro qué está pago y qué no.

**Tipos de cuenta:** a **cobrar** (clientes), a **pagar** (proveedores) y **manuales / libres** (contratos u obligaciones sin factura). Pueden estar en pesos, dólares, kg novillo o quintales de grano; los totales de arriba suman también la moneda extranjera **valorizada a su cotización**.

#### Arrendamientos

**Qué hace:** registra los contratos de arrendamiento de campos cuando explotás campos que no son propios.

**Datos por contrato:**
- Arrendador (CUIT, datos de contacto)
- Campo arrendado (vinculado al módulo Producción → Campos)
- Plazo del contrato (fecha inicio, fecha fin)
- Modalidad de pago: en pesos, en dólares, en quintales fijos de soja/maíz, en porcentaje del rinde
- Cantidad acordada
- Vencimientos (uno o varios pagos a lo largo del contrato)

**Integración:** los vencimientos aparecen automáticamente en el flujo de caja como pagos comprometidos. Si el contrato es en quintales, el sistema valoriza la cuota al precio BCR del día y calcula el equivalente en pesos / dólares.

**Alertas:** vencimientos próximos, contratos por terminar, renovaciones a evaluar.

#### Control de efectivo

**Qué hace:** registro de movimientos de caja: ingresos y egresos en efectivo con saldo actualizado. Soporta **varias cajas** (multi-caja) y cada movimiento se clasifica como **de la empresa** o **propio / personal** (los personales también se contabilizan porque salen de activos de la empresa).

**Datos por movimiento:** fecha, tipo (ingreso / egreso), caja, concepto (categoría + familia desde el árbol de Categorías de Gastos), importe, comprobante asociado.

**Movimientos internos:** cuando la plata **cambia de lugar pero sigue en la empresa** (extracción o depósito banco↔caja, o transferencia entre cuentas propias), el sistema muestra las **dos patas** del movimiento pero **no las cuenta como ingreso ni egreso** en los totales, para no inflar los números.

#### Movimientos diarios

**Qué hace:** una vista única con **todos los movimientos de plata del período** (banco, caja, cuentas) ordenados por fecha, con su categoría y familia. Los movimientos internos aparecen etiquetados "🔁 interno · no suma", y el método de pago se muestra (efectivo, cheque, transferencia, 💳 tarjeta) con filtros. Estos egresos impactan también en el Dashboard.

#### Órdenes de pago

**Qué hace:** cada pago a proveedor genera una **Orden de Pago** numerada, con comprobantes aplicados, cheques entregados, retenciones e importe en letras. Imprimible / PDF, enviable por email o WhatsApp, con opción de **deshacer** el pago (reabre la cuenta corriente).

#### Créditos y préstamos

**Qué hace:** registra créditos bancarios o de proveedores con su **plan de cuotas** (automático o manual), moneda (pesos, dólares o kg novillo) y tipo de cambio. Permite cargar cuotas ya pagadas, editar / eliminar, sumar IVA de intereses y gastos, y arma solo las alarmas de vencimiento en la Agenda.

#### Bancos y tarjetas de crédito

**Qué hace:** administra las cuentas bancarias (saldos en vivo) y sus movimientos (depósitos, extracciones, débitos, transferencias, comisiones, impuestos, intereses), más las **tarjetas de crédito** de la empresa como medio de pago disponible en todos los formularios de cobro / pago.

#### Cotizaciones (multimoneda)

**Qué hace:** guarda la cotización diaria (dólar oficial / blue / MEP / CCL, **kg novillo** y granos de pizarra BCR). Facturas, cuentas corrientes, créditos y arrendamientos pueden operar en **otra moneda**, y el sistema calcula la **diferencia de cambio** en pesos al cobrar o pagar.

---

### 6.7 Logística y RRHH

Sección que agrupa los movimientos de transporte y la gestión del personal.

#### Viajes

**Qué hace:** registra los viajes de transporte cuando se trasladan granos a destino (acopio, exportadora, planta de proceso) o entre campos propios.

**Datos por viaje:**
- Fecha de salida y de llegada
- Origen (campo / depósito) y destino
- Transportista (proveedor del servicio)
- Chofer y patente del camión
- Tipo de carga (producto, generalmente grano)
- Tonelaje cargado y pesado en destino
- Cartas de porte (CTG y/o número físico)
- Costo del flete (kilometraje, tarifa por tonelada o lump sum)
- Asociación con factura de venta o ingreso a depósito

**Integración:** los kilos pesados en destino pueden generar el movimiento de stock asociado (entrada al depósito comprador o salida de tu silo).

#### Empleados

**Qué hace:** alta y gestión del personal de la empresa: datos personales, contratos, sueldos, recibos.

**Datos por empleado:**
- Nombre, apellido, CUIL, DNI
- Fecha de nacimiento, fecha de ingreso
- Puesto / categoría según convenio
- Sueldo básico
- Modalidad: efectivo / registrado, jornal, mensual, por tarea
- Datos de contacto y emergencia

**Contratos:** cada empleado puede tener uno o varios contratos a lo largo del tiempo (por temporada, por obra). El sistema mantiene el histórico.

**Recibos de sueldo:** generación mensual con cálculo automático de descuentos (jubilación, obra social), aguinaldo, vacaciones, horas extras. Exportables a PDF para imprimir o enviar por mail.

**Propios o externos:** además del personal en relación de dependencia, podés cargar **contratistas / fasoneros** que cobran por **% de la labor**. Un empleado puede además estar **vinculado a un usuario y a un chofer** (misma persona, una sola ficha).

**Planilla mensual:** adelantos, horas, premios y descuentos con categorías configurables (cantidad × valor). La liquidación descuenta desde efectivo, cheque o transferencia y se exporta a Excel.

---

### 6.8 Administración

Sección al pie de la barra lateral, agrupa los parámetros del sistema.

#### Catálogos

Master data que alimenta a todos los módulos. Las pestañas se arman solas desde el árbol de categorías.

- **Árbol de Categorías y Familias:** estructura **Categoría → Familia → Producto** (Insumos, Hacienda, Cereales…). Define cómo se agrupan y filtran productos, insumos y labores en todo el sistema.
- **Categorías de Gastos:** árbol propio para clasificar los movimientos de plata (categoría + familia).
- **Productos / Insumos / Cereales / Labores:** artículos del catálogo con unidad, alícuota IVA, stock mínimo, tipo y familia. Las labores llevan **precio sugerido** que se autocarga en el formulario.
- **Categorías de animales:** por especie (bovino, porcino, ovino…) con kg / peso, para Hacienda.
- **Cerealeras, depósitos propios y cajas físicas · Bancos y Tarjetas de crédito · Ciclos.**
- **Geografía:** País → Provincia → Ciudad (cargada de inicio).

**Copiar configuración entre empresas:** desde Configuración podés **transferir** a otra empresa los Catálogos, el árbol de Categorías y Familias y/o el de Categorías de Gastos (cada uno opcional, sin duplicar). Una empresa nueva se arma en minutos.

#### Usuarios

Alta de personas que pueden iniciar sesión.

**Datos:**
- Email (único)
- Alias para login rápido
- Nombre y apellido
- Foto / avatar (opcional)
- Estado: activo / inactivo
- Rol Super Admin (acceso a todas las empresas) — solo asignable por otro Super Admin

**Asignación a empresas:** desde la ficha del usuario, asociás cada empresa donde participa con su rol respectivo.

**Reseteo de contraseña:** un Admin puede resetear la contraseña de los usuarios de su empresa (les genera una contraseña temporal).

#### Roles y permisos

Roles vienen pre-cargados (Admin, Contable, Operaciones, Lectura), y podés crear roles a medida.

**Cómo se configura:** por cada rol elegís **pantalla por pantalla** qué ve (se lista cada ítem del menú de la izquierda y se marca exactamente lo permitido, ej. Stock sí / Hacienda no). Aparte están los **permisos de acción** (Crear / Editar / Eliminar) por área. Las **categorías de stock** que ve un rol salen del árbol de Categorías y Familias, así que se pueden limitar por tipo de producto.

**Ejemplos de roles típicos:**
- **Admin empresa:** ve todas las pantallas y puede Crear / Editar / Eliminar en todo.
- **Contable externo:** Finanzas y Dashboard; Stock solo lectura.
- **Operaciones de campo:** Producción y Stock (Crear / Editar), sin Finanzas.
- **Solo lectura:** todas las pantallas visibles, sin acciones.

**Vínculo con la persona:** un usuario puede estar asociado a su **Empleado / Chofer**, para que solo vea lo suyo.

#### Empresas

Solo accesible para Super Admin.

**Datos por empresa:**
- Nombre y nombre de fantasía
- CUIT
- Razón social
- Condición frente al IVA
- Domicilio
- Logo (base64 o URL)
- Color institucional (hex)
- Modo: facturación ARCA habilitada o "informal" (sin ARCA)
- Estado: activa / inactiva

**Operaciones:**
- Crear nueva empresa.
- Editar datos.
- Asignar usuarios y roles.
- Configurar integración ARCA (certificado digital, modo, punto de venta).
- Desactivar (no se pierden datos pero no se puede operar).

---

### 6.9 Agenda y recordatorios

**Qué hace:** un **calendario** con los vencimientos y alarmas del sistema — cheques, cuotas de crédito, arrendamientos y recordatorios manuales — con avisos automáticos (por ejemplo, revisar un cheque 7 días después de la fecha). Se puede ver por **una empresa o por todas** a la vez.

### 6.10 Resumen multi-empresa

**Qué hace:** consolida los indicadores (stock, cuentas por cobrar / pagar, saldos) de **todas tus empresas** en una sola pantalla, pensado para el dueño que maneja varias firmas.

### 6.11 Fábrica (producción industrial)

**Qué hace:** sección del menú que aparece en las empresas con **Producción industrial / Fábrica** activada (Configuración → Empresa). Reúne la molienda, el canje y las cuentas de la fábrica.

- **Molienda / Fábrica:** se define una **fórmula** (grano de origen + coproductos con su % de rendimiento) y se cargan los **partes de producción** diarios con los kilos reales. En productos obtenidos se ve el **Kg estimado** (según la fórmula) al lado del **Kg real**. Los **costos indirectos** se cargan por unidad: la **luz en kWh** y el **gasoil en litros** (eligiendo el artículo y el depósito de la cisterna, que descuenta stock y toma el precio de la última compra); el resto va como "$ directo". Hay una **planilla en blanco** para imprimir (materias primas en 3 turnos y productos obtenidos con Kg inicial/obtenido/final).
- **Costo de luz por factura:** al cargar la **factura de compra** de la luz, un check "aplica a la producción" + el período reparte el total de la factura entre los partes del período según los **kWh** de cada uno.
- **Canje (grano):** una sola pantalla **flexible** (cuenta corriente en kilos por cliente): entró grano, se llevó producto, **liquidar en pesos** (baja el saldo en kg y genera la deuda a pagar) o ajuste. La operación completa (entra y sale junto con acuerdo fijo) queda como opción.
- **Cuentas de Fábrica:** una sola lista por contacto con el saldo en **pesos** y en **kilos**, y —para los proveedores de grano— su cuenta en kilos (entregado, liquidado, disponible, vencimientos) con las acciones de entrega, liquidación y comprobantes. Unifica lo que antes eran "Proveedores de granos" y "Cuentas de Fábrica 360".

> Para el detalle paso a paso, en **Ayuda → Instructivos** están: *Molienda / Fábrica*, *Canje (grano)* y *Cuentas de Fábrica*.

### 6.12 Ficha de Cliente/Proveedor

**Qué hace:** en **Comercial → Ficha Cliente/Proveedor** (reemplazó a "Compensación de cuentas"). Elegís un contacto y un rango de fechas (arranca con el último mes) y ves **todos sus movimientos** en **pesos** (ventas, compras, cobros, pagos) con el saldo neto, y —si es proveedor de grano— también en **kilos**. Desde la misma ficha hacés ventas, compras, cobros, pagos, entregas/retiros de grano y la **compensación** (neteo cliente↔proveedor, vinculando por **CUIT**). Unifica los dos roles de una misma persona sin fusionar tablas.

---

## 7. Flujos de trabajo típicos

### Flujo 1 — Cargar una compra de fertilizante

1. **Contactos → Proveedores → Nuevo** (si no existe). CUIT, razón social, condición IVA.
2. **Finanzas → Compras → Nueva factura de compra**. Proveedor, tipo A, número, fecha, ítem (Urea Granulada × 5000 kg × $X).
3. Forma de pago: cuenta corriente. Confirmás.
4. **Resultado automático:**
   - Stock de Urea sube 5000 kg.
   - Cuenta corriente del proveedor con saldo deudor.
   - Aparece en flujo de caja como compromiso de pago.
   - IVA registrado en libro IVA Compras.

### Flujo 2 — Aplicar el fertilizante a una campaña

1. **Producción → Insumos y labores → Nueva aplicación**.
2. Campaña ("Soja 2025/26"), lote, fecha, insumo Urea Granulada, dosis 100 kg/ha, hectáreas 50.
3. Sistema calcula: total = 5000 kg. Confirmás.
4. **Resultado automático:**
   - Stock de Urea baja 5000 kg.
   - Costo imputado a la campaña (visible en reporte de margen).

### Flujo 3 — Vender granos y cobrar con cheques

1. **Finanzas → Facturación → Nueva factura**. Cliente "Acopiadora Pampeana", factura A, ítem "Soja Cosecha 25/26 × 100 t × USD 380/t".
2. Sistema emite, obtiene CAE de ARCA, descuenta del stock, genera PDF.
3. Recibís el cheque. **Finanzas → Cheques → Nuevo (recibido)**. Banco, número, importe, fecha, asociado a la factura.
4. **Resultado automático:**
   - Cuenta corriente del cliente al día.
   - Cheque "en cartera".
   - Aparece en flujos de caja como cobro proyectado a la fecha de vencimiento.
   - Sumado al libro IVA Ventas del mes.

### Flujo 4 — Cierre de campaña con rinde real

1. **Producción → Campañas → Editar "Soja 2025/26"**. Cargás rinde real (35 qq/ha).
2. **Stock → Movimientos → Entrada por cosecha**: 35 qq × 50 ha = 175 t entran al stock.
3. Marcás campaña como **Cosechada**.
4. **Resultado automático:**
   - Stock de soja sube 175 toneladas.
   - Reporte de margen completo: ingresos por venta posterior - insumos cargados - labores - costo de arrendamiento del campo (si aplica).

### Flujo 5 — Pago de cuota de arrendamiento

1. **Finanzas → Arrendamientos → Editar contrato existente**.
2. Verificás el próximo vencimiento (ej. 1 cuota = 200 quintales de soja, vence el 30/06/2026).
3. Al llegar el vencimiento, registrás el pago: el sistema valoriza al precio BCR del día.
4. **Resultado automático:**
   - Cuenta corriente del arrendador queda actualizada.
   - Aparece en libro IVA Compras (si es factura) o como gasto (si es comprobante interno).
   - Egreso reflejado en flujo de caja real.

### Flujo 6 — Despacho de soja a destino

1. **Logística y RRHH → Viajes → Nuevo viaje**.
2. Origen: tu silo. Destino: Acopiadora Pampeana. Transportista: "Logística del Sur SRL".
3. Chofer, patente, tonelaje cargado en origen, carta de porte (CTG).
4. Al llegar a destino, cargás el peso real y eventuales mermas.
5. **Resultado automático:**
   - Salida de stock por la cantidad real entregada.
   - Costo del flete imputado a la operación.
   - Si está vinculado a una factura, queda asociado para auditoría.

---

## 8. Preguntas frecuentes

**¿Pierdo datos si se corta la luz / internet?**
> No. Los datos viven en el servidor (cloud o local), no en tu navegador. Si se corta la luz, los reanudás cuando vuelva. Si se corta internet pero el servidor local sigue prendido, podés seguir trabajando desde la red local. El modo PWA además guarda en el dispositivo lo que cargues offline.

**¿Cómo se hacen los backups?**
> Si estás en Cloud (AWS), automático y diario, con retención de 30 días. Si estás en servidor propio, se programa según el plan acordado (típicamente diario incremental + semanal completo).

**¿Puedo migrar datos de mi sistema actual?**
> Sí. Importamos desde Excel, planillas o archivos exportados de tu sistema previo. La migración inicial está incluida en la implementación.

**¿Cuánta gente puede usar el sistema al mismo tiempo?**
> No hay límite por licencia. Las únicas limitaciones son técnicas (servidor) y los precios planos no escalan por usuario.

**¿Funciona desde el celular?**
> Sí. Responsive y adaptado a pantallas pequeñas. La carga de movimientos puede hacerse desde el celular en el campo.

**¿Cómo se factura con ARCA?**
> Web service integrado. Una vez cargado tu certificado digital, las facturas se emiten directo con CAE. No necesitás ir al portal de ARCA.

**¿Y si quiero un módulo nuevo o un cambio específico?**
> Los pedidos se evalúan caso por caso. Hay un canal en tu plan de mantenimiento mensual. Cambios mayores tienen presupuesto aparte.

**¿Quién es dueño de los datos?**
> Vos. El código fuente y la infraestructura (cuenta AWS o servidor propio) son tuyos. Sin lock-in, sin sorpresas.

**¿Cuánto tarda la implementación?**
> Entre 4 y 6 semanas desde la confirmación, dependiendo del volumen de datos a migrar.

**¿Mis datos están seguros?**
> Estándares bancarios: HTTPS/TLS 1.3, encriptación AES-256, hash bcrypt para contraseñas, backups con retención, auditoría completa, OWASP Top 10. Firmamos NDA y los datos nunca salen de tu infraestructura.

**¿Puedo ver Hacienda en algún lado?**
> AgroCore tiene un módulo de **Hacienda por campo**: definís las categorías de animales por especie (bovino, porcino, ovino, etc.) desde el catálogo, registrás los movimientos de hacienda y el sistema lleva el **stock por campo**, comparando el declarado (SENASA / RENSPA) con el real. Funciona incluso sin conexión y las cabezas se consolidan también en los KPIs del Inicio.

---

## 9. Soporte y contacto

Durante la prueba del demo y en el plan de mantenimiento:

- **WhatsApp:** (te lo pasamos en la primera conversación)
- **Email:** sergiodbilbao@gmail.com
- **Web:** https://agrocore.ar

**Horario:** lunes a viernes, 9:00 a 18:00 hs (Argentina).
**Respuesta:** 24 hs hábiles para consultas, 4 hs para incidentes críticos.

### Para reportar un bug durante el testing

1. Qué estabas haciendo cuando pasó (paso a paso).
2. Qué esperabas que pasara.
3. Qué pasó en realidad.
4. Captura de pantalla del error.
5. Tu usuario y aproximadamente la hora.

---

*Manual elaborado por el equipo de AgroCore Argentina.*
*Última actualización: mayo 2026.*
*© AgroCore Argentina · Todos los derechos reservados.*
