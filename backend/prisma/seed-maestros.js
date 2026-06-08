// Carga masiva de maestros y datos de ejemplo del AgroCore.html original
// en la empresa demo "AgroCore Demo". Ejecutar con: node prisma/seed-maestros.js
//
// IDEMPOTENTE: si el registro ya existe (por nombre/código/razón social) se omite.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================
// DATOS MAESTROS (extraídos de AgroCore.html líneas 556-648)
// ============================================================

const CATALOGOS = [
  // --- CEREALES ---
  ...['Soja','Maíz','Trigo','Sorgo','Girasol','Centeno','Avena','Cebada']
    .map(n => ({ tipo: 'Cereal', codigo: n.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''), nombre: n, descripcion: 'IVA 10,5%' })),

  // --- ESPECIES ANIMALES ---
  { tipo: 'Especie', codigo: 'BOV', nombre: 'Bovino' },
  { tipo: 'Especie', codigo: 'POR', nombre: 'Porcino' },
  { tipo: 'Especie', codigo: 'OVI', nombre: 'Ovino' },
  { tipo: 'Especie', codigo: 'CAP', nombre: 'Caprino' },
  { tipo: 'Especie', codigo: 'EQU', nombre: 'Equino' },

  // --- CATEGORÍAS ANIMALES ---
  ...['Vaca','Vaquillona','Ternero','Ternera','Novillo','Toro'].map(n => ({ tipo: 'Categoría animal', nombre: n, descripcion: 'Bovino' })),
  ...['Lechón','Capón','Madre'].map(n => ({ tipo: 'Categoría animal', nombre: n, descripcion: 'Porcino' })),
  ...['Cordero','Borrego','Oveja'].map(n => ({ tipo: 'Categoría animal', nombre: n, descripcion: 'Ovino' })),
  ...['Chivito','Chivo','Cabra'].map(n => ({ tipo: 'Categoría animal', nombre: n, descripcion: 'Caprino' })),

  // --- LABORES ---
  ...['Siembra','Pulverización','Fertilización','Cosecha','Laboreo/Rastra','Fumigación aérea','Roturación','Cincelado']
    .map(n => ({ tipo: 'Labor', nombre: n, descripcion: 'Unidad: ha' })),
  { tipo: 'Labor', nombre: 'Embolsado',   descripcion: 'Unidad: tn' },
  { tipo: 'Labor', nombre: 'Flete corto', descripcion: 'Unidad: tn' },
  { tipo: 'Labor', nombre: 'Flete largo', descripcion: 'Unidad: tn' },

  // --- TIPOS DE INSUMO ---
  ...['Herbicida','Insecticida','Fungicida','Fertilizante','Semilla','Coadyuvante','Curasemilla','Otro']
    .map(n => ({ tipo: 'Tipo de insumo', nombre: n })),

  // --- INSUMOS ---
  { tipo: 'Herbicida',    nombre: 'Glifosato',             descripcion: 'L/ha' },
  { tipo: 'Herbicida',    nombre: '2,4-D',                 descripcion: 'L/ha' },
  { tipo: 'Herbicida',    nombre: 'Atrazina',              descripcion: 'kg/ha' },
  { tipo: 'Herbicida',    nombre: 'Dicamba',               descripcion: 'L/ha' },
  { tipo: 'Insecticida',  nombre: 'Cipermetrina',          descripcion: 'L/ha' },
  { tipo: 'Insecticida',  nombre: 'Clorpirifos',           descripcion: 'L/ha' },
  { tipo: 'Fungicida',    nombre: 'Azoxistrobina',         descripcion: 'L/ha' },
  { tipo: 'Fungicida',    nombre: 'Tebuconazole',          descripcion: 'L/ha' },
  { tipo: 'Fertilizante', nombre: 'Urea 46%',              descripcion: 'kg/ha' },
  { tipo: 'Fertilizante', nombre: 'Fosfato diamónico (DAP)', descripcion: 'kg/ha' },
  { tipo: 'Fertilizante', nombre: 'UAN 32',                descripcion: 'L/ha' },
  { tipo: 'Semilla',      nombre: 'Soja DM53i54',          descripcion: 'kg/ha' },
  { tipo: 'Semilla',      nombre: 'Maíz DK7210',           descripcion: 'kg/ha' },
  { tipo: 'Semilla',      nombre: 'Trigo Baguette',        descripcion: 'kg/ha' },
  { tipo: 'Coadyuvante',  nombre: 'Aceite mineral',        descripcion: 'L/ha' },

  // --- UNIDADES DE MEDIDA ---
  { tipo: 'Unidad de medida', codigo: 'KG',  nombre: 'Kilogramo' },
  { tipo: 'Unidad de medida', codigo: 'TN',  nombre: 'Tonelada' },
  { tipo: 'Unidad de medida', codigo: 'L',   nombre: 'Litro' },
  { tipo: 'Unidad de medida', codigo: 'HA',  nombre: 'Hectárea' },
  { tipo: 'Unidad de medida', codigo: 'UN',  nombre: 'Unidad' },
  { tipo: 'Unidad de medida', codigo: 'HS',  nombre: 'Horas' },
  { tipo: 'Unidad de medida', codigo: 'SRV', nombre: 'Servicio' },

  // --- CONDICIÓN IVA ---
  { tipo: 'Condición IVA', codigo: 'RI',  nombre: 'Responsable Inscripto' },
  { tipo: 'Condición IVA', codigo: 'MON', nombre: 'Monotributista' },
  { tipo: 'Condición IVA', codigo: 'EX',  nombre: 'Exento' },
  { tipo: 'Condición IVA', codigo: 'CF',  nombre: 'Consumidor Final' },
  { tipo: 'Condición IVA', codigo: 'NI',  nombre: 'No Inscripto' },

  // --- PAÍSES (América Latina) ---
  ...[
    'Argentina','Bolivia','Brasil','Chile','Colombia','Costa Rica','Cuba',
    'Ecuador','El Salvador','Guatemala','Haití','Honduras','México','Nicaragua',
    'Panamá','Paraguay','Perú','Puerto Rico','República Dominicana','Uruguay','Venezuela',
  ].map(n => ({ tipo: 'País', nombre: n })),

  // --- PROVINCIAS (Argentina, las 23 + CABA) ---
  ...[
    'Buenos Aires','Ciudad Autónoma de Buenos Aires','Catamarca','Chaco','Chubut','Córdoba',
    'Corrientes','Entre Ríos','Formosa','Jujuy','La Pampa','La Rioja','Mendoza','Misiones',
    'Neuquén','Río Negro','Salta','San Juan','San Luis','Santa Cruz','Santa Fe',
    'Santiago del Estero','Tierra del Fuego','Tucumán',
  ].map(n => ({ tipo: 'Provincia', nombre: n, descripcion: 'Argentina' })),

  // --- CIUDADES / LOCALIDADES principales de Argentina ---
  // Buenos Aires
  ...['La Plata','Mar del Plata','Bahía Blanca','Tandil','Olavarría','Junín','Pergamino','9 de Julio','Azul','Chivilcoy','Luján','Necochea','Zárate','Campana','San Nicolás','Pilar','San Pedro','Tres Arroyos','Trenque Lauquen','Balcarce']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Buenos Aires' })),
  // CABA
  { tipo: 'Ciudad', nombre: 'Ciudad Autónoma de Buenos Aires', descripcion: 'CABA' },
  // Córdoba
  ...['Córdoba','Río Cuarto','Villa Carlos Paz','Villa María','San Francisco','Alta Gracia','Jesús María','Marcos Juárez','Bell Ville','Río Tercero','La Carlota','Laboulaye']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Córdoba' })),
  // Santa Fe
  ...['Rosario','Santa Fe','Rafaela','Venado Tuerto','Reconquista','Villa Gobernador Gálvez','Casilda','Esperanza','San Lorenzo','Cañada de Gómez']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Santa Fe' })),
  // Mendoza
  ...['Mendoza','San Rafael','Godoy Cruz','Guaymallén','Maipú','Luján de Cuyo','Rivadavia','General Alvear']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Mendoza' })),
  // Entre Ríos
  ...['Paraná','Concordia','Gualeguaychú','Concepción del Uruguay','Gualeguay','Victoria','Villaguay','La Paz']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Entre Ríos' })),
  // Tucumán
  ...['San Miguel de Tucumán','Yerba Buena','Tafí Viejo','Concepción','Banda del Río Salí']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Tucumán' })),
  // Salta
  ...['Salta','San Ramón de la Nueva Orán','Tartagal','General Güemes','Metán']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Salta' })),
  // Jujuy
  ...['San Salvador de Jujuy','Palpalá','Libertador General San Martín','Perico']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Jujuy' })),
  // Chaco
  ...['Resistencia','Presidencia Roque Sáenz Peña','Villa Ángela','Charata','General José de San Martín']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Chaco' })),
  // Corrientes
  ...['Corrientes','Goya','Paso de los Libres','Mercedes','Curuzú Cuatiá','Bella Vista']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Corrientes' })),
  // Misiones
  ...['Posadas','Oberá','Eldorado','Puerto Iguazú','Apóstoles']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Misiones' })),
  // Santiago del Estero
  ...['Santiago del Estero','La Banda','Termas de Río Hondo','Añatuya','Frías']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Santiago del Estero' })),
  // Formosa
  ...['Formosa','Clorinda','Pirané','El Colorado']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Formosa' })),
  // La Pampa
  ...['Santa Rosa','General Pico','Toay','Realicó','General Acha']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'La Pampa' })),
  // Río Negro
  ...['Viedma','San Carlos de Bariloche','General Roca','Cipolletti','Villa Regina','Allen']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Río Negro' })),
  // Neuquén
  ...['Neuquén','Cutral Có','Plottier','San Martín de los Andes','Zapala','Villa La Angostura']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Neuquén' })),
  // Chubut
  ...['Comodoro Rivadavia','Rawson','Trelew','Puerto Madryn','Esquel']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Chubut' })),
  // Santa Cruz
  ...['Río Gallegos','Caleta Olivia','El Calafate','Puerto San Julián','Perito Moreno']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Santa Cruz' })),
  // Tierra del Fuego
  ...['Ushuaia','Río Grande','Tolhuin']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Tierra del Fuego' })),
  // San Juan
  ...['San Juan','Rivadavia','Chimbas','Rawson','Pocito']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'San Juan' })),
  // San Luis
  ...['San Luis','Villa Mercedes','Merlo','La Toma']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'San Luis' })),
  // La Rioja
  ...['La Rioja','Chilecito','Chamical','Aimogasta']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'La Rioja' })),
  // Catamarca
  ...['San Fernando del Valle de Catamarca','Andalgalá','Belén','Tinogasta']
    .map(n => ({ tipo: 'Ciudad', nombre: n, descripcion: 'Catamarca' })),
];

// ============================================================
// PRODUCTOS (granos, hacienda, combustibles)
// ============================================================

const PRODUCTOS = [
  // Granos (stock inicial del AgroCore.html)
  { categoria: 'granos', nombre: 'Soja',    unidad: 'kg', stockMinimo: 0 },
  { categoria: 'granos', nombre: 'Maíz',    unidad: 'kg', stockMinimo: 0 },
  { categoria: 'granos', nombre: 'Centeno', unidad: 'kg', stockMinimo: 0 },
  { categoria: 'granos', nombre: 'Trigo',   unidad: 'kg', stockMinimo: 0 },
  { categoria: 'granos', nombre: 'Girasol', unidad: 'kg', stockMinimo: 0 },

  // Hacienda
  { categoria: 'hacienda', nombre: 'Bovino - Vaca',    unidad: 'cabezas', stockMinimo: 0 },
  { categoria: 'hacienda', nombre: 'Bovino - Ternero', unidad: 'cabezas', stockMinimo: 0 },
  { categoria: 'hacienda', nombre: 'Bovino - Toro',    unidad: 'cabezas', stockMinimo: 0 },
  { categoria: 'hacienda', nombre: 'Porcino - Lechón', unidad: 'cabezas', stockMinimo: 0 },
  { categoria: 'hacienda', nombre: 'Ovino - Cordero',  unidad: 'cabezas', stockMinimo: 0 },
  { categoria: 'hacienda', nombre: 'Caprino - Chivito', unidad: 'cabezas', stockMinimo: 0 },

  // Insumos para stock
  { categoria: 'insumos', nombre: 'Glifosato',  unidad: 'L',  stockMinimo: 20 },
  { categoria: 'insumos', nombre: 'Urea 46%',   unidad: 'kg', stockMinimo: 500 },
  { categoria: 'insumos', nombre: 'Atrazina',   unidad: 'kg', stockMinimo: 10 },

  // Combustibles
  { categoria: 'combustibles', nombre: 'Gasoil grado 2', unidad: 'L', stockMinimo: 500 },
];

// ============================================================
// MOVIMIENTOS DE STOCK INICIAL (ingresos por apertura)
// ============================================================

const STOCK_INICIAL = [
  { producto: 'Soja',                  cantidad: 270000, fecha: '2026-03-01', motivo: 'Apertura inventario' },
  { producto: 'Maíz',                  cantidad: 85000,  fecha: '2026-03-01', motivo: 'Apertura inventario' },
  { producto: 'Centeno',               cantidad: 198000, fecha: '2026-04-10', motivo: 'Apertura inventario' },
  { producto: 'Bovino - Vaca',         cantidad: 19,     fecha: '2026-01-01', motivo: 'Apertura inventario' },
  { producto: 'Bovino - Ternero',      cantidad: 19,     fecha: '2026-01-01', motivo: 'Apertura inventario' },
  { producto: 'Bovino - Toro',         cantidad: 2,      fecha: '2026-01-01', motivo: 'Apertura inventario' },
  { producto: 'Porcino - Lechón',      cantidad: 24,     fecha: '2026-01-01', motivo: 'Apertura inventario' },
];

// ============================================================
// CLIENTES (facturación)
// ============================================================

const CLIENTES = [
  { razonSocial: 'Cofco Internacional Argentina S.A.', cuit: '30-69751232-1', condIVA: 'RI',  direccion: 'Av. Corrientes 1234, CABA' },
  { razonSocial: 'Renova S.A.',                        cuit: '30-71034567-4', condIVA: 'RI',  direccion: 'San Lorenzo 5500, Santa Fe' },
  { razonSocial: 'Arre S.A.',                          cuit: '30-71200001-2', condIVA: 'RI',  direccion: 'Ruta 33 km 23, Buenos Aires' },
  { razonSocial: 'Mascanfroni Angel',                  cuit: '20-12345678-9', condIVA: 'Monotributo', direccion: 'Paraje Rural, Córdoba' },
  { razonSocial: 'Consumidor Final',                   cuit: '00-00000000-0', condIVA: 'ConsumidorFinal', direccion: '—' },
];

// ============================================================
// PROVEEDORES
// ============================================================

const PROVEEDORES = [
  { razonSocial: 'Nuxen Agrotécnica S.A.',       cuit: '30-70999111-8', condIVA: 'RI',  rubro: 'Insumos agropecuarios',    direccion: 'Ruta 8 km 123, Villa María' },
  { razonSocial: 'Estación Servicio YPF Lomas',  cuit: '30-71122334-5', condIVA: 'RI',  rubro: 'Combustibles',             direccion: 'Av. San Martín 1200' },
  { razonSocial: 'Juan Pérez (fletero)',         cuit: '20-24567890-1', condIVA: 'Monotributo', rubro: 'Fletes',           direccion: 'Rural s/n' },
  { razonSocial: 'Lartirigoyen y Cia SA',        cuit: '30-71200022-7', condIVA: 'RI',  rubro: 'Acopio / comercialización', direccion: 'Pergamino, Buenos Aires' },
  { razonSocial: 'Next Agro',                    cuit: '30-71200033-4', condIVA: 'RI',  rubro: 'Insumos',                  direccion: 'Ruta 9 km 250' },
];

// ============================================================
// CAMPOS + LOTES (producción)
// ============================================================

const CAMPOS = [
  {
    campo: { nombre: 'Campo LLSP', localidad: 'Córdoba', provincia: 'Córdoba', hectareas: 320, propietario: 'LLSP' },
    lotes: [
      { nombre: 'Lote 1', hectareas: 80 },
      { nombre: 'Lote 2', hectareas: 120 },
      { nombre: 'Lote 3', hectareas: 120 },
    ],
  },
  {
    campo: { nombre: 'Campo Mincof Lote 1', localidad: 'Holberg', provincia: 'Córdoba', hectareas: 22, propietario: 'Mincof (arrendado)' },
    lotes: [
      { nombre: 'Lote contra Mincof', hectareas: 22 },
    ],
  },
];

// ============================================================
// CAMPAÑAS (atadas a lote por nombre)
// ============================================================

const CAMPANAS = [
  { loteNombre: 'Lote contra Mincof', cultivo: 'Centeno', ciclo: '2025/26', fechaSiembra: '2025-05-25', fechaCosecha: null,         hectareas: 22,  rindeReal: null,  estado: 'sembrada' },
  { loteNombre: 'Lote 1',             cultivo: 'Soja',    ciclo: '2025/26', fechaSiembra: '2025-11-10', fechaCosecha: '2026-04-05', hectareas: 80,  rindeReal: 3200,  estado: 'cosechada' },
  { loteNombre: 'Lote 2',             cultivo: 'Maíz',    ciclo: '2025/26', fechaSiembra: '2025-10-02', fechaCosecha: '2026-03-20', hectareas: 120, rindeReal: 9000,  estado: 'cosechada' },
  { loteNombre: 'Lote 3',             cultivo: 'Girasol', ciclo: '2025/26', fechaSiembra: '2025-11-15', fechaCosecha: null,         hectareas: 120, rindeReal: null,  estado: 'sembrada' },
];

// ============================================================
// CHEQUES
// ============================================================

const CHEQUES = [
  { tipo: 'terceros', banco: 'Banco San Juan',   nroCheque: '123', fechaEmision: '2025-03-20', fechaPago: '2025-05-20', monto: 555,    librador: 'Valli Enrique Federico', estado: 'emitido' },
  { tipo: 'terceros', banco: 'BBVA Francés',     nroCheque: '124', fechaEmision: '2025-03-20', fechaPago: '2025-05-20', monto: 555555, librador: 'Perotti Germán Antonio', estado: 'emitido' },
  { tipo: 'propio',   banco: 'Banco Coinag',     nroCheque: '125', fechaEmision: '2026-03-20', fechaPago: '2026-04-21', monto: 55555,  beneficiario: 'Nuxen Agrotécnica S.A.', estado: 'depositado' },
  { tipo: 'terceros', banco: 'Banco Industrial', nroCheque: '126', fechaEmision: '2026-04-06', fechaPago: '2026-04-25', monto: 55555,  librador: 'Lartirigoyen y Cia SA', estado: 'emitido' },
  { tipo: 'propio',   banco: 'Banco Coinag',     nroCheque: '127', fechaEmision: '2026-03-20', fechaPago: '2026-04-28', monto: 55555,  beneficiario: 'Nuxen Agrotécnica S.A.', estado: 'emitido' },
];

// ============================================================
// CUENTAS CORRIENTES (saldos a cobrar)
// ============================================================

const CTAS_CTES = [
  { contactoTipo: 'cliente', nombreContacto: 'Mascanfroni Angel', fecha: '2025-10-13', detalle: 'Venta soja pendiente cobro (echeq)',  debe: 240000,    haber: 0, referencia: 'BABEL.DEBATE.RENO' },
  { contactoTipo: 'libre',   nombreLibre: 'Rentas LLSP',          fecha: '2025-09-30', detalle: 'Rentas meses sep y oct',              debe: 809854.43, haber: 0 },
  { contactoTipo: 'libre',   nombreLibre: 'Rentas El Pistrin',    fecha: '2025-09-30', detalle: 'Rentas meses sep y oct',              debe: 195105.46, haber: 0 },
];

// ============================================================
// ARRENDAMIENTOS
// ============================================================

const ARRENDAMIENTOS = [
  { campoNombre: 'Campo Mincof Lote 1', propietario: 'Mincof', hectareas: 22, importeHa: 278323.14, tipoPago: 'kilos de soja', vencimiento: '2026-03-31', pagado: true,  observaciones: 'Feb (pago marzo) - 12.507 kg soja a us$489,5' },
];

// ============================================================
// FLUJO DE CAJA (proyectado + real)
// ============================================================

const FLUJO_CAJA = [
  { fecha: '2026-02-10', categoria: 'Bancos',          concepto: 'Cuota crédito',               monto: -8400000 },
  { fecha: '2026-02-10', categoria: 'Bancos',          concepto: 'Cuota crédito (interes)',     monto: -115000 },
  { fecha: '2026-02-15', categoria: 'Otros',           concepto: 'Gastos varios',               monto: -36520.5 },
  { fecha: '2026-02-20', categoria: 'Compras',         concepto: 'Proveedores (insumos)',       monto: -125905.73 },
  { fecha: '2026-02-25', categoria: 'Compras',         concepto: 'Proveedores (gasoil)',        monto: -21000 },
  { fecha: '2026-02-28', categoria: 'Compras',         concepto: 'Proveedores (flete)',         monto: -33000 },
  { fecha: '2026-02-28', categoria: 'Sueldos',         concepto: 'Empleado 1',                  monto: -857500 },
  { fecha: '2026-02-28', categoria: 'Sueldos',         concepto: 'Empleado 2',                  monto: -840000 },
  { fecha: '2026-02-28', categoria: 'Sueldos',         concepto: 'Empleado 3',                  monto: -795000 },
  { fecha: '2026-02-28', categoria: 'Sueldos',         concepto: 'Empleado 4',                  monto: -884000 },
  { fecha: '2026-02-28', categoria: 'Sueldos',         concepto: 'Empleado 5',                  monto: -423000 },
  { fecha: '2026-03-02', categoria: 'Bancos',          concepto: 'Crédito bancario ingresado',  monto: 110957177.91 },
  { fecha: '2026-03-05', categoria: 'Ventas',          concepto: 'Venta granos',                monto: 5400000 },
  { fecha: '2026-03-10', categoria: 'Ventas',          concepto: 'Venta hacienda',              monto: 25616250 },
  { fecha: '2026-03-15', categoria: 'Arrendamientos',  concepto: 'Pago arrendamientos feb',     monto: -6123109 },
  { fecha: '2026-03-28', categoria: 'Sueldos',         concepto: 'Sueldos marzo',               monto: -1200000 },
  { fecha: '2026-04-05', categoria: 'Ventas',          concepto: 'Venta granos abril',          monto: 3188670 },
  { fecha: '2026-04-20', categoria: 'Impuestos',       concepto: 'IVA + Ganancias',             monto: -1800000 },
];

// ============================================================
// VIAJES (carta de porte)
// ============================================================

const VIAJES = [
  { fecha: '2025-08-10', origen: 'Campo LLSP', destino: 'Acequias - Santa Fe',     producto: 'Maíz',    cantidad: 27980, unidad: 'kg', transportista: 'Propio', chofer: 'Luciano',  patente: 'AE000AA', cartaPorte: '390',  flete: 352325, observaciones: 'Gas 304.625 + peaje 10.200 + comida 24.000' },
  { fecha: '2025-08-12', origen: 'Campo LLSP', destino: 'Acequias - Santa Fe',     producto: 'Maíz',    cantidad: 27830, unidad: 'kg', transportista: 'Propio', chofer: 'Luciano',  patente: 'AE000AA', cartaPorte: '394',  flete: 395873, observaciones: 'Gas 348.673 + peaje 10.200' },
  { fecha: '2025-08-27', origen: 'Campo LLSP', destino: 'Chucul - Santa Fe',       producto: 'Soja',    cantidad: 27880, unidad: 'kg', transportista: 'Propio', chofer: 'Germán',   patente: 'AE000AA', cartaPorte: '199',  flete: 391387, observaciones: 'Gas 354.987' },
  { fecha: '2025-08-29', origen: 'Campo LLSP', destino: 'Holberg - Gral Deheza',   producto: 'Girasol', cantidad: 12790, unidad: 'kg', transportista: 'Propio', chofer: 'Germán',   patente: 'AE000AA', cartaPorte: '398',  flete: 202464 },
  { fecha: '2025-09-16', origen: 'Campo LLSP', destino: 'La Carolina - Renova',    producto: 'Soja',    cantidad: null,  unidad: 'kg', transportista: 'Propio', chofer: 'Germán',   patente: 'AE000AA', cartaPorte: '3',    flete: 413972 },
  { fecha: '2025-09-20', origen: 'Campo LLSP', destino: 'La Carolina - Cofco',     producto: 'Soja',    cantidad: 27900, unidad: 'kg', transportista: 'Propio', chofer: 'Germán',   patente: 'AE000AA', cartaPorte: '5',    flete: 260065 },
];

// ============================================================
// EMPLEADOS
// ============================================================

const EMPLEADOS = [
  { nombre: 'Ingrid',  apellido: 'Administración',       puesto: 'Administración', sueldo: 1200000, activo: true },
  { nombre: 'Luciano', apellido: 'Operaciones',          puesto: 'Operaciones',    sueldo: 1200000, activo: true },
  { nombre: 'Germán',  apellido: 'Alvarado',             puesto: 'Peón',           sueldo: 900000,  activo: true },
  { nombre: 'Julio',   apellido: 'Santillán',            puesto: 'Peón',           sueldo: 900000,  activo: true },
  { nombre: 'Vicki',   apellido: 'Colaboradora',         puesto: 'Colaboradora',   sueldo: 600000,  activo: true },
];

// ============================================================
// MAIN
// ============================================================

async function upsertFirst(model, where, create) {
  const existing = await model.findFirst({ where });
  if (existing) return { row: existing, created: false };
  const row = await model.create({ data: create });
  return { row, created: true };
}

async function main() {
  console.log('\n🌾 Cargando maestros y datos de ejemplo en AgroCore Demo...\n');

  // 1) Obtener empresa demo
  const empresa = await prisma.company.findFirst({ where: { name: 'AgroCore Demo' } });
  if (!empresa) {
    console.error('❌ No encontré la empresa "AgroCore Demo". Corré antes: node prisma/seed.js');
    process.exit(1);
  }
  const companyId = empresa.id;
  console.log(`   Empresa: ${empresa.name} (${companyId})\n`);

  // 2) CATÁLOGOS
  console.log('📚 Catálogos maestros...');
  let catOk = 0, catSkip = 0;
  for (const c of CATALOGOS) {
    const where = { companyId, tipo: c.tipo, nombre: c.nombre };
    const { created } = await upsertFirst(prisma.catalogo, where, { ...c, companyId, activo: true });
    created ? catOk++ : catSkip++;
  }
  console.log(`   ${catOk} creados, ${catSkip} ya existían`);

  // 3) PRODUCTOS
  console.log('\n📦 Productos (stock)...');
  let pOk = 0, pSkip = 0;
  for (const p of PRODUCTOS) {
    const where = { companyId, nombre: p.nombre };
    const { created } = await upsertFirst(prisma.producto, where, { ...p, companyId, activo: true });
    created ? pOk++ : pSkip++;
  }
  console.log(`   ${pOk} creados, ${pSkip} ya existían`);

  // 4) MOVIMIENTOS DE APERTURA
  console.log('\n🔁 Movimientos de apertura (stock inicial)...');
  let mOk = 0, mSkip = 0;
  for (const m of STOCK_INICIAL) {
    const producto = await prisma.producto.findFirst({ where: { companyId, nombre: m.producto } });
    if (!producto) { console.log(`   ⚠️  producto no encontrado: ${m.producto}`); continue; }
    const existing = await prisma.movimiento.findFirst({
      where: { companyId, productoId: producto.id, motivo: m.motivo, fecha: new Date(m.fecha) },
    });
    if (existing) { mSkip++; continue; }
    await prisma.movimiento.create({
      data: {
        companyId, productoId: producto.id,
        fecha: new Date(m.fecha), tipo: 'ingreso',
        motivo: m.motivo, cantidad: m.cantidad,
      },
    });
    mOk++;
  }
  console.log(`   ${mOk} creados, ${mSkip} ya existían`);

  // 5) CLIENTES
  console.log('\n👥 Clientes...');
  let clOk = 0, clSkip = 0;
  for (const c of CLIENTES) {
    const where = { companyId, razonSocial: c.razonSocial };
    const { created } = await upsertFirst(prisma.cliente, where, { ...c, companyId, activo: true });
    created ? clOk++ : clSkip++;
  }
  console.log(`   ${clOk} creados, ${clSkip} ya existían`);

  // 6) PROVEEDORES
  console.log('\n🏬 Proveedores...');
  let prOk = 0, prSkip = 0;
  for (const p of PROVEEDORES) {
    const where = { companyId, razonSocial: p.razonSocial };
    const { created } = await upsertFirst(prisma.proveedor, where, { ...p, companyId, activo: true });
    created ? prOk++ : prSkip++;
  }
  console.log(`   ${prOk} creados, ${prSkip} ya existían`);

  // 7) CAMPOS + LOTES
  console.log('\n🗺️  Campos y lotes...');
  let caOk = 0, caSkip = 0, loOk = 0, loSkip = 0;
  for (const cdef of CAMPOS) {
    let campo = await prisma.campo.findFirst({ where: { companyId, nombre: cdef.campo.nombre } });
    if (!campo) {
      campo = await prisma.campo.create({ data: { ...cdef.campo, companyId, activo: true } });
      caOk++;
    } else caSkip++;
    for (const ldef of cdef.lotes) {
      const lote = await prisma.lote.findFirst({ where: { campoId: campo.id, nombre: ldef.nombre } });
      if (!lote) { await prisma.lote.create({ data: { ...ldef, campoId: campo.id, activo: true } }); loOk++; }
      else loSkip++;
    }
  }
  console.log(`   Campos: ${caOk} creados, ${caSkip} ya existían`);
  console.log(`   Lotes:  ${loOk} creados, ${loSkip} ya existían`);

  // 8) CAMPAÑAS
  console.log('\n🌱 Campañas...');
  let cpOk = 0, cpSkip = 0;
  for (const c of CAMPANAS) {
    const lote = await prisma.lote.findFirst({
      where: { nombre: c.loteNombre, campo: { companyId } },
    });
    if (!lote) { console.log(`   ⚠️  lote no encontrado: ${c.loteNombre}`); continue; }
    const existing = await prisma.campana.findFirst({
      where: { companyId, loteId: lote.id, cultivo: c.cultivo, ciclo: c.ciclo },
    });
    if (existing) { cpSkip++; continue; }
    await prisma.campana.create({
      data: {
        companyId, loteId: lote.id,
        cultivo: c.cultivo, ciclo: c.ciclo,
        hectareas: c.hectareas,
        rindeReal: c.rindeReal,
        fechaSiembra: c.fechaSiembra ? new Date(c.fechaSiembra) : null,
        fechaCosecha: c.fechaCosecha ? new Date(c.fechaCosecha) : null,
        estado: c.estado,
      },
    });
    cpOk++;
  }
  console.log(`   ${cpOk} creadas, ${cpSkip} ya existían`);

  // 9) CHEQUES
  console.log('\n💳 Cheques...');
  let chOk = 0, chSkip = 0;
  for (const c of CHEQUES) {
    const where = { companyId, nroCheque: c.nroCheque, banco: c.banco };
    const { created } = await upsertFirst(prisma.cheque, where, {
      ...c, companyId,
      fechaEmision: new Date(c.fechaEmision),
      fechaPago: new Date(c.fechaPago),
    });
    created ? chOk++ : chSkip++;
  }
  console.log(`   ${chOk} creados, ${chSkip} ya existían`);

  // 10) CTAS CTES
  console.log('\n📇 Cuentas corrientes...');
  let ccOk = 0, ccSkip = 0;
  for (const m of CTAS_CTES) {
    let data = {
      companyId,
      contactoTipo: m.contactoTipo,
      fecha: new Date(m.fecha),
      detalle: m.detalle,
      debe: m.debe || 0,
      haber: m.haber || 0,
      referencia: m.referencia || null,
    };
    if (m.contactoTipo === 'cliente' && m.nombreContacto) {
      const c = await prisma.cliente.findFirst({ where: { companyId, razonSocial: m.nombreContacto } });
      if (c) data.contactoId = c.id;
    } else if (m.contactoTipo === 'proveedor' && m.nombreContacto) {
      const p = await prisma.proveedor.findFirst({ where: { companyId, razonSocial: m.nombreContacto } });
      if (p) data.contactoId = p.id;
    } else if (m.contactoTipo === 'libre') {
      data.nombreLibre = m.nombreLibre;
    }
    const existing = await prisma.ctaCte.findFirst({
      where: { companyId, detalle: m.detalle, fecha: data.fecha },
    });
    if (existing) { ccSkip++; continue; }
    await prisma.ctaCte.create({ data });
    ccOk++;
  }
  console.log(`   ${ccOk} creadas, ${ccSkip} ya existían`);

  // 11) ARRENDAMIENTOS
  console.log('\n🏞️  Arrendamientos...');
  let arOk = 0, arSkip = 0;
  for (const a of ARRENDAMIENTOS) {
    const campo = a.campoNombre ? await prisma.campo.findFirst({ where: { companyId, nombre: a.campoNombre } }) : null;
    const data = {
      companyId,
      campoId: campo?.id || null,
      propietario: a.propietario,
      hectareas: a.hectareas,
      importeHa: a.importeHa || null,
      tipoPago: a.tipoPago || null,
      vencimiento: a.vencimiento ? new Date(a.vencimiento) : null,
      pagado: !!a.pagado,
      observaciones: a.observaciones || null,
    };
    const existing = await prisma.arrendamiento.findFirst({
      where: { companyId, propietario: a.propietario, vencimiento: data.vencimiento },
    });
    if (existing) { arSkip++; continue; }
    await prisma.arrendamiento.create({ data });
    arOk++;
  }
  console.log(`   ${arOk} creados, ${arSkip} ya existían`);

  // 12) FLUJO DE CAJA
  console.log('\n📈 Flujo de caja...');
  let fcOk = 0, fcSkip = 0;
  for (const f of FLUJO_CAJA) {
    const fecha = new Date(f.fecha);
    const existing = await prisma.flujoCaja.findFirst({
      where: { companyId, concepto: f.concepto, fecha, monto: f.monto },
    });
    if (existing) { fcSkip++; continue; }
    await prisma.flujoCaja.create({
      data: { companyId, concepto: f.concepto, categoria: f.categoria, fecha, monto: f.monto },
    });
    fcOk++;
  }
  console.log(`   ${fcOk} creados, ${fcSkip} ya existían`);

  // 13) VIAJES
  console.log('\n🚚 Viajes...');
  let vOk = 0, vSkip = 0;
  for (const v of VIAJES) {
    const fecha = new Date(v.fecha);
    const existing = await prisma.viaje.findFirst({
      where: { companyId, fecha, cartaPorte: v.cartaPorte || undefined },
    });
    if (existing) { vSkip++; continue; }
    await prisma.viaje.create({ data: { ...v, companyId, fecha } });
    vOk++;
  }
  console.log(`   ${vOk} creados, ${vSkip} ya existían`);

  // 14) EMPLEADOS
  console.log('\n👷 Empleados...');
  let eOk = 0, eSkip = 0;
  for (const e of EMPLEADOS) {
    const where = { companyId, nombre: e.nombre, apellido: e.apellido };
    const { created } = await upsertFirst(prisma.empleado, where, { ...e, companyId });
    created ? eOk++ : eSkip++;
  }
  console.log(`   ${eOk} creados, ${eSkip} ya existían`);

  console.log('\n✅ Seed de maestros completado.\n');
}

main()
  .catch((e) => { console.error('Seed maestros fallo:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
