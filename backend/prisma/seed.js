// Seed inicial auto-contenido: roles del sistema + empresa demo + usuarios demo.
// Ejecutar con: node prisma/seed.js
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Roles "de fábrica"
const BUILTIN_ROLES = [
  {
    key: 'admin',
    label: 'Administrador',
    description: 'Acceso total a todos los módulos',
    permissions: ['*:*'],
  },
  {
    key: 'contable',
    label: 'Contable',
    description: 'Finanzas, ventas, compras, reportes',
    permissions: [
      'dashboard:read', 'finanzas:*', 'ventas:*', 'compras:*',
      'produccion:read', 'stock:read', 'contactos:*', 'reportes:read',
    ],
  },
  {
    key: 'operaciones',
    label: 'Operaciones',
    description: 'Producción, stock y logística',
    permissions: [
      'dashboard:read', 'produccion:*', 'stock:*', 'logistica:*',
      'contactos:read', 'reportes:read',
    ],
  },
  {
    key: 'lectura',
    label: 'Solo lectura',
    description: 'Ver todo pero no modificar',
    permissions: [
      'dashboard:read', 'produccion:read', 'stock:read', 'contactos:read',
      'ventas:read', 'compras:read', 'finanzas:read', 'reportes:read',
    ],
  },
];

async function main() {
  console.log('\n🌱 Sembrando datos iniciales...\n');

  // 1) Roles
  for (const r of BUILTIN_ROLES) {
    const existing = await prisma.role.findUnique({ where: { key: r.key } });
    if (existing) {
      await prisma.role.update({
        where: { key: r.key },
        data: { label: r.label, description: r.description, permissions: r.permissions, builtin: true },
      });
      console.log(`  OK  Rol actualizado: ${r.key}`);
    } else {
      await prisma.role.create({
        data: { key: r.key, label: r.label, description: r.description, permissions: r.permissions, builtin: true },
      });
      console.log(`  OK  Rol creado:     ${r.key}`);
    }
  }

  // 2) Empresa demo
  let empresa = await prisma.company.findFirst({ where: { name: 'AgroCore Demo' } });
  if (!empresa) {
    empresa = await prisma.company.create({
      data: {
        name: 'AgroCore Demo',
        razonSocial: 'AgroCore Demo S.A.',
        cuit: '30-70000000-0',
        localidad: 'Pergamino',
        provincia: 'Buenos Aires',
        condIVA: 'RI',
        activo: true,
      },
    });
    console.log(`  OK  Empresa demo creada: ${empresa.name}`);
  } else {
    console.log(`  --  Empresa demo ya existe: ${empresa.name}`);
  }

  // 3) SuperAdmin
  const superEmail = 'super@agrocore.local';
  const superPass = 'super123';
  let superUser = await prisma.user.findUnique({ where: { email: superEmail } });
  if (!superUser) {
    superUser = await prisma.user.create({
      data: {
        email: superEmail,
        passwordHash: await bcrypt.hash(superPass, 10),
        nombre: 'Super', apellido: 'Admin', superAdmin: true,
      },
    });
    console.log(`  OK  SuperAdmin creado: ${superEmail} / ${superPass}`);
  } else {
    console.log(`  --  SuperAdmin ya existe: ${superEmail}`);
  }

  // 4) Admin de empresa demo
  const adminEmail = 'admin@demo.local';
  const adminPass = 'admin123';
  const adminRole = await prisma.role.findUnique({ where: { key: 'admin' } });
  let adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPass, 10),
        nombre: 'Admin', apellido: 'Demo',
        userCompanies: { create: { companyId: empresa.id, roleId: adminRole.id } },
      },
    });
    console.log(`  OK  Admin de empresa demo creado: ${adminEmail} / ${adminPass}`);
  } else {
    console.log(`  --  Admin de empresa demo ya existe: ${adminEmail}`);
  }

  console.log('\nSeed completado.\n');
  console.log('Credenciales de prueba:');
  console.log(`  SuperAdmin:  ${superEmail}  /  ${superPass}`);
  console.log(`  Admin demo:  ${adminEmail}  /  ${adminPass}`);
  console.log(`  CompanyId:   ${empresa.id}\n`);
}

main()
  .catch((e) => { console.error('Seed fallo:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });