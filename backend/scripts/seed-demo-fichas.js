// ============================================================
//  Seed Demo — Fichas de animales ↔ Stock (v2.143.0)
//  Muestra cómo las fichas suman al stock general y cómo se mueve:
//   - Siembra las categorías de equinos en el catálogo de animales.
//   - Genera el movimiento de "alta" (ingreso) por cada ficha en el campo.
//   - Registra la venta de la ficha ya vendida (egreso).
//   - Presta un caballo de ejemplo (egreso provisorio) para mostrar que
//     los prestados NO suman al stock del campo.
//  NO borra nada: es aditivo e idempotente (no duplica movimientos).
//
//  Uso (en el server de Demo):
//    cd C:\AgroCore\backend
//    node scripts\seed-demo-fichas.js                (busca la empresa "Demo")
//    node scripts\seed-demo-fichas.js <companyId>    (empresa puntual)
// ============================================================
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ANI_ESPECIE_LABEL = { equino: 'Equino', bovino: 'Bovino', porcino: 'Porcino', otro: 'Otro' };
const ANI_ESTADOS_EN_CAMPO = ['cria','recria','doma','hechura','jugando','servicio','gestacion','disponible_venta','activo'];
const EQUINO_CATEGORIAS = [
  'Padrillo','Yegua madre','Yegua','Potrillo','Potranca','Potro','Redomón','Caballo',
  'Caballo castrado','Petiso','Petiso de polo','Caballo de polo','Caballo de salto',
  'Caballo de carrera','Caballo de trabajo','Caballo de escuela','Falabella','Mula','Burro / Asno',
];
const prodNombre = (esp, cat) => `${ANI_ESPECIE_LABEL[esp] || 'Animal'} · ${(cat || '').trim() || 'Sin categoría'}`;

async function ensureProducto(companyId, esp, cat) {
  const nombre = prodNombre(esp, cat);
  let p = await prisma.producto.findFirst({ where: { companyId, categoria: 'Animales', nombre }, select: { id: true } });
  if (!p) p = await prisma.producto.create({ data: { companyId, categoria: 'Animales', nombre, unidad: 'cabeza', stockMinimo: 0, activo: true }, select: { id: true } });
  return p.id;
}
async function movFicha(companyId, animal, tipo, motivo, fecha) {
  // idempotente: no duplica el mismo movimiento (misma ficha+motivo+tipo)
  const ref = `FICHA-${animal.id}`;
  const ya = await prisma.movimiento.findFirst({ where: { companyId, referencia: ref, tipo, motivo } });
  if (ya) return;
  const productoId = await ensureProducto(companyId, animal.especie, animal.categoria);
  await prisma.movimiento.create({ data: {
    companyId, productoId, fecha: fecha || new Date(), tipo, motivo, cantidad: 1,
    referencia: ref, observaciones: `${animal.nombre || 'Animal'}${animal.categoria ? ' · ' + animal.categoria : ''}`,
  }});
}

async function main() {
  const arg = process.argv[2];
  let company;
  if (arg) company = await prisma.company.findUnique({ where: { id: arg } });
  if (!company) company = await prisma.company.findFirst({ where: { name: { contains: 'Demo', mode: 'insensitive' } } });
  if (!company) { console.error('No encontré la empresa Demo. Pasá el companyId como argumento.'); process.exit(1); }
  const companyId = company.id;
  console.log('Empresa:', company.name, companyId);

  // 1) Catálogo de equinos
  let cat = 0;
  for (let i = 0; i < EQUINO_CATEGORIAS.length; i++) {
    const nombre = EQUINO_CATEGORIAS[i];
    const ya = await prisma.categoriaHaciendaConfig.findFirst({ where: { companyId, nombre } });
    if (ya) continue;
    try { await prisma.categoriaHaciendaConfig.create({ data: { companyId, especie: 'Equino', nombre, orden: i, activo: true } }); cat++; } catch {}
  }
  console.log('Categorías de equino agregadas al catálogo:', cat);

  // 2) Productos de fichas (uno por especie+categoría existentes + catálogo)
  const animales = await prisma.animal.findMany({ where: { companyId } });
  const pares = new Set(EQUINO_CATEGORIAS.map(c => `equino||${c}`));
  animales.forEach(a => pares.add(`${a.especie || 'equino'}||${(a.categoria || '').trim() || 'Sin categoría'}`));
  for (const key of pares) { const [e, c] = key.split('||'); await ensureProducto(companyId, e, c); }
  console.log('Productos de fichas sincronizados.');

  // 3) Alta (ingreso) por cada ficha en el campo; venta (egreso) para las vendidas
  let alta = 0, venta = 0;
  for (const a of animales) {
    if (a.externo) continue; // las de terceros no son stock propio
    if (ANI_ESTADOS_EN_CAMPO.includes(a.estado)) {
      const before = await prisma.movimiento.count({ where: { companyId, referencia: `FICHA-${a.id}` } });
      await movFicha(companyId, a, 'ingreso', 'alta ficha', a.fechaIngreso || a.createdAt || new Date());
      const after = await prisma.movimiento.count({ where: { companyId, referencia: `FICHA-${a.id}` } });
      if (after > before) alta++;
    } else if (a.estado === 'vendido') {
      // Para ver el movimiento completo: alta + venta
      await movFicha(companyId, a, 'ingreso', 'alta ficha', a.fechaIngreso || a.createdAt || new Date());
      const before = await prisma.movimiento.count({ where: { companyId, referencia: `FICHA-${a.id}`, tipo: 'egreso' } });
      await movFicha(companyId, a, 'egreso', 'venta', a.fechaVenta || new Date());
      const after = await prisma.movimiento.count({ where: { companyId, referencia: `FICHA-${a.id}`, tipo: 'egreso' } });
      if (after > before) venta++;
    }
  }
  console.log('Altas de stock:', alta, '· Ventas de stock:', venta);

  // 4) Prestar un caballo de ejemplo (si hay uno en el campo y ninguno prestado aún)
  const yaPrestado = animales.find(a => a.estado === 'prestado');
  if (!yaPrestado) {
    const cand = animales.find(a => !a.externo && ANI_ESTADOS_EN_CAMPO.includes(a.estado));
    if (cand) {
      const fecha = new Date();
      const vuelta = new Date(Date.now() + 30 * 86400000);
      await prisma.$transaction(async (tx) => {
        await tx.animalEvento.create({ data: { companyId, animalId: cand.id, fecha, tipo: 'traslado',
          concepto: `🤝 Prestado a Cancha de polo (Bs. As.) · vuelve ${vuelta.toISOString().slice(0,10)}`, costo: 0, moneda: cand.moneda || 'ARS' } });
        await tx.animal.update({ where: { id: cand.id }, data: { estado: 'prestado', prestadoA: 'Cancha de polo (Bs. As.)', prestamoFecha: fecha, prestamoVuelta: vuelta } });
      });
      // egreso de stock (sale del campo)
      const before = await prisma.movimiento.count({ where: { companyId, referencia: `FICHA-${cand.id}`, tipo: 'egreso' } });
      await movFicha(companyId, cand, 'egreso', 'préstamo (sale del campo)', fecha);
      const after = await prisma.movimiento.count({ where: { companyId, referencia: `FICHA-${cand.id}`, tipo: 'egreso' } });
      console.log('Caballo prestado (ejemplo):', cand.nombre, after > before ? '(egreso de stock creado)' : '');
    }
  } else {
    console.log('Ya había un caballo prestado, no se agregó otro.');
  }

  console.log('\n✅ Seed Demo de fichas ↔ stock completo. Abrí Stock y filtrá la categoría "Animales".');
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
