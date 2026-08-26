/* Seed de ejemplo — Caballos de polo (módulo Fichas de animales).
 * Carga un pequeño haras de demostración con genealogía enlazada, sanidad,
 * herraje, reproducción, traslados y una venta con margen.
 *
 * Uso (en el server de la Demo, con la v2.128.0 ya publicada):
 *   cd C:\AgroCore\backend
 *   node scripts/seed-demo-caballos.js                # usa la 1ª empresa
 *   $env:COMPANY_ID="<id>"; node scripts/seed-demo-caballos.js   # empresa puntual
 *
 * Es idempotente: si ya existe "Colibrí" en esa empresa, no vuelve a cargar.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function d(s){ return new Date(s + 'T12:00:00'); }
function futuro(dias){ const x=new Date(); x.setDate(x.getDate()+dias); return x; }

async function main(){
  let companyId = process.env.COMPANY_ID;
  if (!companyId) {
    const c = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!c) { console.error('No hay empresas. Creá una y reintentá.'); process.exit(1); }
    companyId = c.id; console.log('Empresa:', c.nombre || c.id);
  }
  const yaHaras = await prisma.animal.findFirst({ where: { companyId, nombre: 'Colibrí' } });
  const yaPension = await prisma.animal.findFirst({ where: { companyId, nombre: 'Pampero (de terceros)' } });
  const yaRodeoT = await prisma.rodeo.findFirst({ where: { companyId, nombre: 'Engorde terceros — La Estancia' } });
  if (yaHaras && yaPension && yaRodeoT) { console.log('El ejemplo ya estaba cargado. Nada que hacer.'); return; }

  const mk = (o) => prisma.animal.create({ data: { companyId, especie:'equino', moneda:'USD', ...o } });
  const ev = (animalId, o) => prisma.animalEvento.create({ data: { companyId, animalId, moneda:'USD', costo:0, ...o } });

  if (!yaHaras) {

  // Padrillo y madres (base de la genealogía)
  const padrillo = await mk({ nombre:'Machitos', sexo:'macho', categoria:'Padrillo', estado:'servicio',
    pelaje:'Zaino', raza:'SPC', fechaNac:d('2015-09-10'), microchip:'941000012340001', nroRegistro:'AACCP-1001',
    origen:'comprado', costoIngreso:25000, valuacion:40000, ubicacion:'Campo', observaciones:'Padrillo cabaña, línea de juego.' });
  const madre1 = await mk({ nombre:'Guapa', sexo:'hembra', categoria:'Yegua madre', estado:'cria',
    pelaje:'Alazana', raza:'SPC', fechaNac:d('2014-10-02'), microchip:'941000012340002', nroRegistro:'AACCP-1002',
    origen:'comprado', costoIngreso:18000, valuacion:30000, ubicacion:'Campo' });
  const madre2 = await mk({ nombre:'Reina', sexo:'hembra', categoria:'Yegua madre', estado:'gestacion',
    pelaje:'Tostada', raza:'SPC', fechaNac:d('2013-11-20'), microchip:'941000012340003', nroRegistro:'AACCP-1003',
    origen:'nacido', costoIngreso:0, valuacion:28000, ubicacion:'Campo' });

  // Hijas (descendencia enlazada por padreId/madreId)
  const hija1 = await mk({ nombre:'Colibrí', sexo:'hembra', categoria:'Potranca', estado:'hechura',
    pelaje:'Zaina', raza:'SPC', fechaNac:d('2021-10-15'), microchip:'941000012340010', nroRegistro:'AACCP-1210',
    origen:'nacido', costoIngreso:0, valuacion:20000, ubicacion:'Buenos Aires (escuela)',
    padreId:padrillo.id, padreNombre:padrillo.nombre, madreId:madre1.id, madreNombre:madre1.nombre });
  const hija2 = await mk({ nombre:'Perla', sexo:'hembra', categoria:'Potranca', estado:'doma',
    pelaje:'Alazana', raza:'SPC', fechaNac:d('2022-09-28'), microchip:'941000012340011', nroRegistro:'AACCP-1311',
    origen:'nacido', costoIngreso:0, valuacion:12000, ubicacion:'Campo',
    padreId:padrillo.id, padreNombre:padrillo.nombre, madreId:madre1.id, madreNombre:madre1.nombre });
  const potrillo = await mk({ nombre:'Trueno', sexo:'macho', categoria:'Potrillo', estado:'recria',
    pelaje:'Moro', raza:'SPC', fechaNac:d('2023-10-05'), microchip:'941000012340012',
    origen:'nacido', costoIngreso:0, ubicacion:'Campo',
    padreId:padrillo.id, padreNombre:padrillo.nombre, madreId:madre2.id, madreNombre:madre2.nombre });

  // Sanidad / Coggins con vencimiento (dispara alerta), herraje, doma, reproducción, traslado
  await ev(hija1.id, { fecha:d('2026-07-01'), tipo:'sanidad', concepto:'Test de Coggins (AIE) — negativo', proximaFecha:futuro(20), costo:35 });
  await ev(hija1.id, { fecha:d('2026-07-01'), tipo:'vacuna', concepto:'Influenza + Encefalomielitis', proximaFecha:futuro(150), costo:40 });
  await ev(hija1.id, { fecha:d('2026-07-15'), tipo:'herraje', concepto:'Desvasado y herrada', costo:30 });
  await ev(hija1.id, { fecha:d('2026-06-10'), tipo:'entrenamiento', concepto:'Escuela de polo — manejo de boca y velocidad' });
  await ev(hija1.id, { fecha:d('2026-05-20'), tipo:'traslado', concepto:'Campo → Buenos Aires (escuela)', costo:120 });

  await ev(hija2.id, { fecha:d('2026-07-05'), tipo:'sanidad', concepto:'Coggins — negativo', proximaFecha:futuro(5), costo:35 });
  await ev(hija2.id, { fecha:d('2026-07-20'), tipo:'doma', concepto:'Inicio de doma — mansedumbre' });

  await ev(madre1.id, { fecha:d('2020-11-01'), tipo:'reproduccion', concepto:'TE · padrillo Machitos · Preñada',
    datos: JSON.stringify({ metodo:'TE (transferencia embrionaria)', padrillo:'Machitos', receptora:'Madrina 1', resultado:'Preñada' }) });
  await ev(madre2.id, { fecha:d('2026-08-01'), tipo:'reproduccion', concepto:'IA · padrillo Machitos · Servicio',
    datos: JSON.stringify({ metodo:'IA (inseminación)', padrillo:'Machitos', resultado:'Servicio' }), proximaFecha:futuro(40) });

  await ev(potrillo.id, { fecha:d('2026-07-10'), tipo:'sanidad', concepto:'Desparasitación', costo:15 });

  // Un caballo vendido (para mostrar costo acumulado + margen)
  const vendido = await mk({ nombre:'Relámpago', sexo:'castrado', categoria:'Petiso jugado', estado:'vendido',
    pelaje:'Zaino', raza:'SPC', fechaNac:d('2019-10-01'), microchip:'941000012340020', nroRegistro:'AACCP-0920',
    origen:'nacido', costoIngreso:0, ubicacion:'Vendido',
    padreId:padrillo.id, padreNombre:padrillo.nombre, madreId:madre1.id, madreNombre:madre1.nombre,
    fechaVenta:d('2026-06-30'), precioVenta:22000, monedaVenta:'USD', ventaRef:'Boleto 0001' });
  await ev(vendido.id, { fecha:d('2024-03-01'), tipo:'doma', concepto:'Doma completa', costo:1500 });
  await ev(vendido.id, { fecha:d('2025-02-01'), tipo:'entrenamiento', concepto:'Hechura y prácticas (temporada)', costo:3000 });
  await ev(vendido.id, { fecha:d('2026-01-15'), tipo:'torneo', concepto:'Torneo — buen desempeño', costo:500 });
  await ev(vendido.id, { fecha:d('2026-06-30'), tipo:'venta', concepto:'Venta · Boleto 0001', datos: JSON.stringify({ precioVenta:22000, moneda:'USD', ref:'Boleto 0001' }) });

    console.log('✔ Haras: 1 padrillo, 2 madres, 2 potrancas, 1 potrillo y 1 vendido, con genealogía y eventos.');
  } // fin bloque haras

  // ── HOTELERÍA: un caballo de un tercero en pensión (cargos a cobrar al dueño) ──
  if (!yaPension) {
    const pension = await mk({ nombre:'Pampero (de terceros)', sexo:'castrado', categoria:'Petiso jugado', estado:'hechura',
      pelaje:'Bayo', raza:'SPC', fechaNac:d('2018-10-01'), microchip:'941000012349001', nroRegistro:'AACCP-0801',
      origen:'externo', externo:true, propietario:'Estancia La Querencia SA', ubicacion:'Buenos Aires (pensión)',
      costoIngreso:0, observaciones:'Caballo de tercero en pensión/hotelería. Los gastos se le cobran al dueño.' });
    await ev(pension.id, { fecha:d('2026-08-01'), tipo:'pension', concepto:'Pensión mensual (box + comida)', costo:450, aCobrar:true });
    await ev(pension.id, { fecha:d('2026-08-10'), tipo:'herraje', concepto:'Herrada completa', costo:60, aCobrar:true });
    await ev(pension.id, { fecha:d('2026-08-12'), tipo:'servicio', concepto:'Veterinario — revisación', costo:80, aCobrar:true });
    await ev(pension.id, { fecha:d('2026-08-05'), tipo:'sanidad', concepto:'Test de Coggins', proximaFecha:futuro(25), costo:35, aCobrar:true });
    console.log('✔ Pensión: 1 caballo de tercero (Estancia La Querencia) con cargos a cobrar.');
  }

  // ── CAPITALIZACIÓN DE HACIENDA: rodeo de engorde de terceros (hotelería ganadera) ──
  if (!yaRodeoT) {
    const rt = await prisma.rodeo.create({ data: { companyId, nombre:'Engorde terceros — La Estancia', sistema:'feedlot',
      categoria:'Novillito', estado:'activo', fechaInicio:d('2026-06-01'), cabezasInicial:120, kgInicial:24000,
      externo:true, propietario:'Estancia La Querencia SA',
      observaciones:'Hacienda de terceros recibida para engorde. Se le cobra la capitalización al dueño.' } });
    const rev = (o) => prisma.rodeoEvento.create({ data: { companyId, rodeoId: rt.id, moneda:'ARS', ...o } });
    // costos reales del engorde (NO se le cobran directo, van al costo del servicio)
    await rev({ fecha:d('2026-06-15'), tipo:'alimentacion', concepto:'Ración balanceada', monto:180000 });
    await rev({ fecha:d('2026-07-10'), tipo:'pesaje', concepto:'Pesada de control', kg:31200 });
    // cargos a cobrar al dueño (capitalización por cabeza/día + sanidad)
    await rev({ fecha:d('2026-06-30'), tipo:'capitalizacion', concepto:'Capitalización junio (120 cab.)', cabezas:120, monto:360000, aCobrar:true });
    await rev({ fecha:d('2026-07-31'), tipo:'capitalizacion', concepto:'Capitalización julio (120 cab.)', cabezas:120, monto:372000, aCobrar:true });
    await rev({ fecha:d('2026-07-05'), tipo:'servicio', concepto:'Sanidad — vacunación y antiparasitario', monto:54000, aCobrar:true });
    console.log('✔ Capitalización: 1 rodeo de terceros (120 cab.) con cargos a cobrar.');
  }

  console.log('✔ Demo de caballos + hotelería/capitalización lista.');
}
main().catch(e=>{ console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());
