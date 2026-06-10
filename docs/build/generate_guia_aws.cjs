/* ============================================================
 * Genera C:\AgroCore\Guia-Implementacion-AWS.docx
 * Incluye flujo paso a paso para Linux Y Windows en AWS.
 * Uso:
 *   cd C:\AgroCore
 *   npm install docx --no-save
 *   node docs\build\generate_guia_aws.cjs
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
  TableOfContents, Bookmark, InternalHyperlink, ExternalHyperlink,
  PageOrientation,
} = require('docx');

// ---------- helpers ----------
const FONT = 'Calibri';
const COLOR_PRIMARY = '15803D';     // verde AgroCore
const COLOR_ACCENT  = 'B45309';     // ambar (Windows highlight)
const COLOR_LINUX   = '0E7490';     // cian (Linux highlight)
const COLOR_LIGHT   = 'F1F5F9';     // gris muy claro
const COLOR_BORDER  = 'CBD5E1';

const p = (text, opts = {}) => new Paragraph({
  spacing: { after: 120, ...(opts.spacing || {}) },
  alignment: opts.alignment,
  ...(opts.style ? { style: opts.style } : {}),
  ...(opts.numbering ? { numbering: opts.numbering } : {}),
  ...(opts.heading ? { heading: opts.heading } : {}),
  ...(opts.pageBreakBefore ? { pageBreakBefore: true } : {}),
  children: typeof text === 'string'
    ? [new TextRun({ text, font: FONT, ...(opts.run || {}) })]
    : text,
});

const t = (text, opts = {}) => new TextRun({ text, font: FONT, ...opts });

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 360, after: 200 },
  children: [new TextRun({ text, font: FONT, bold: true, size: 32, color: COLOR_PRIMARY })],
});
const h2 = (text, color) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 160 },
  children: [new TextRun({ text, font: FONT, bold: true, size: 26, color: color || '0F172A' })],
});
const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 200, after: 120 },
  children: [new TextRun({ text, font: FONT, bold: true, size: 22, color: '334155' })],
});

const bullet = (text) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { after: 80 },
  children: typeof text === 'string'
    ? [new TextRun({ text, font: FONT })]
    : text,
});
const num = (text) => new Paragraph({
  numbering: { reference: 'numbers', level: 0 },
  spacing: { after: 80 },
  children: typeof text === 'string'
    ? [new TextRun({ text, font: FONT })]
    : text,
});

const code = (text) => new Paragraph({
  spacing: { before: 80, after: 80 },
  shading: { type: ShadingType.CLEAR, fill: '0F172A' },
  border: {
    left:   { style: BorderStyle.SINGLE, size: 8, color: COLOR_PRIMARY, space: 4 },
    right:  { style: BorderStyle.SINGLE, size: 2, color: '0F172A', space: 4 },
    top:    { style: BorderStyle.SINGLE, size: 2, color: '0F172A', space: 4 },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: '0F172A', space: 4 },
  },
  children: text.split('\n').map((line, i, arr) => new TextRun({
    text: line + (i < arr.length - 1 ? '\n' : ''),
    font: 'Consolas', color: 'E2E8F0', size: 18, break: i === 0 ? 0 : 1,
  })),
});

const note = (text, color, fill) => new Paragraph({
  spacing: { before: 120, after: 120 },
  shading: { type: ShadingType.CLEAR, fill: fill || 'FEF3C7' },
  border: {
    left:   { style: BorderStyle.SINGLE, size: 12, color: color || COLOR_ACCENT, space: 6 },
    right:  { style: BorderStyle.SINGLE, size: 2,  color: color || COLOR_ACCENT, space: 6 },
    top:    { style: BorderStyle.SINGLE, size: 2,  color: color || COLOR_ACCENT, space: 6 },
    bottom: { style: BorderStyle.SINGLE, size: 2,  color: color || COLOR_ACCENT, space: 6 },
  },
  children: [new TextRun({ text, font: FONT, size: 20 })],
});

const tableBorder = { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER };
const tableBorders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder, insideHorizontal: tableBorder, insideVertical: tableBorder };

function compareTable() {
  const headerCells = ['Criterio', 'Linux (Amazon Linux 2023)', 'Windows Server 2022'];
  const rows = [
    ['Costo mensual EC2 t3.medium', '~USD 30 (sin licencia SO)', '~USD 65 (licencia Windows incluida)'],
    ['RAM recomendada', '2 GB (t3.small alcanza)', '4 GB (t3.medium recomendado)'],
    ['Almacenamiento', '30 GB gp3', '50 GB gp3 (Windows ocupa ~20 GB)'],
    ['Acceso remoto', 'SSH desde terminal', 'RDP desde Escritorio Remoto'],
    ['Auto-arranque del sistema', 'systemd service', 'Tarea programada de Windows'],
    ['Familiaridad para soporte', 'Requiere comodidad con terminal', 'GUI conocida por todo el mundo'],
    ['Actualizaciones de SO', 'sudo dnf upgrade (rápido)', 'Windows Update (más invasivo)'],
    ['Performance', 'Más liviano, mejor uso de recursos', 'Algo más pesado por el SO'],
  ];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2400, 3480, 3480],
    rows: [
      new TableRow({
        tableHeader: true,
        children: headerCells.map((txt, i) => new TableCell({
          width: { size: [2400, 3480, 3480][i], type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: COLOR_PRIMARY },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          borders: tableBorders,
          children: [new Paragraph({ children: [new TextRun({ text: txt, font: FONT, color: 'FFFFFF', bold: true })] })],
        })),
      }),
      ...rows.map((r, idx) => new TableRow({
        children: r.map((txt, i) => new TableCell({
          width: { size: [2400, 3480, 3480][i], type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: idx % 2 ? COLOR_LIGHT : 'FFFFFF' },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          borders: tableBorders,
          children: [new Paragraph({ children: [new TextRun({ text: txt, font: FONT, size: 20 })] })],
        })),
      })),
    ],
  });
}

function costTable() {
  const rows = [
    ['Aurora PostgreSQL Serverless v2 (0.5 ACU promedio)', 'USD 45 - 90'],
    ['Storage Aurora (50 GB iniciales)', 'USD 5 - 8'],
    ['EC2 t3.small Linux', 'USD 15 - 18'],
    ['EC2 t3.medium Windows (con licencia)', 'USD 50 - 65'],
    ['EBS gp3 30-50 GB', 'USD 4 - 6'],
    ['Data transfer salida (10 GB/mes)', 'USD 1'],
    ['Snapshots automáticos RDS', 'USD 2 - 4'],
    ['Route 53 (zona hospedada)', 'USD 0.50'],
    ['Total estimado (Linux)', 'USD 73 - 127 / mes'],
    ['Total estimado (Windows)', 'USD 108 - 174 / mes'],
  ];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [6360, 3000],
    rows: rows.map((r, idx) => {
      const isTotal = r[0].startsWith('Total');
      return new TableRow({
        children: [
          new TableCell({
            width: { size: 6360, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: isTotal ? '064E3B' : (idx % 2 ? COLOR_LIGHT : 'FFFFFF') },
            margins: { top: 70, bottom: 70, left: 120, right: 120 },
            borders: tableBorders,
            children: [new Paragraph({ children: [new TextRun({ text: r[0], font: FONT, size: 20, bold: isTotal, color: isTotal ? 'FFFFFF' : '000000' })] })],
          }),
          new TableCell({
            width: { size: 3000, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: isTotal ? '064E3B' : (idx % 2 ? COLOR_LIGHT : 'FFFFFF') },
            margins: { top: 70, bottom: 70, left: 120, right: 120 },
            borders: tableBorders,
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: r[1], font: FONT, size: 20, bold: isTotal, color: isTotal ? 'FFFFFF' : '000000' })] })],
          }),
        ],
      });
    }),
  });
}

// ============================================================
// DOCUMENTO
// ============================================================
const children = [];

// --- Portada ---
children.push(
  new Paragraph({ spacing: { before: 1800, after: 200 }, alignment: AlignmentType.CENTER, children: [
    new TextRun({ text: 'AgroCore', font: FONT, bold: true, size: 64, color: COLOR_PRIMARY }),
  ] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [
    new TextRun({ text: 'Guía técnica de implementación en AWS', font: FONT, bold: true, size: 36, color: '0F172A' }),
  ] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 800 }, children: [
    new TextRun({ text: 'Aurora PostgreSQL + EC2 (Linux o Windows) + Cloudflare Tunnel', font: FONT, size: 22, color: '475569' }),
  ] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [
    new TextRun({ text: 'Versión 2.0  ·  Junio 2026', font: FONT, size: 22, color: '475569' }),
  ] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [
    new TextRun({ text: 'Sistema AgroCore v0.7.2', font: FONT, size: 20, color: '64748B' }),
  ] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1600 }, children: [
    new TextRun({ text: 'agrocore.ar', font: FONT, size: 20, color: COLOR_PRIMARY, bold: true }),
  ] }),
  new Paragraph({ children: [new PageBreak()] }),
);

// --- TOC ---
children.push(h1('Tabla de contenidos'));
children.push(new TableOfContents('Tabla de contenidos', { hyperlink: true, headingStyleRange: '1-3' }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// --- 1. Introducción ---
children.push(h1('1. Introducción'));
children.push(p('Esta guía describe paso a paso la implementación de AgroCore en infraestructura AWS para un cliente productivo. El sistema corre sobre Node.js 20 con base PostgreSQL, y puede instalarse indistintamente sobre Linux o Windows en la instancia EC2 que oficia de servidor de aplicación. La base de datos siempre es Aurora PostgreSQL Serverless v2 (común a ambas opciones).'));
children.push(p('La guía está organizada para que puedas seguirla de forma lineal aunque elijas una sola variante de SO. Las secciones comunes (cuenta AWS, VPC, RDS, dominio, seguridad) se documentan una sola vez. Las que dependen del sistema operativo de la EC2 (instalación, arranque automático, scripts, troubleshooting) tienen dos versiones paralelas: la primera para Linux y la segunda para Windows.'));

children.push(h2('Cuándo elegir cada uno', COLOR_PRIMARY));
children.push(p('Las dos opciones llevan AgroCore al mismo resultado funcional. La elección depende del soporte que vas a dar después y del presupuesto del cliente:'));
children.push(compareTable());
children.push(p(''));
children.push(note(
  'Recomendación práctica: si vos sos quien va a dar soporte y estás cómodo con Linux, elegí Amazon Linux 2023 — es más barato y más liviano. Si el soporte va a estar del lado del cliente o querés un entorno familiar tipo escritorio Windows con UI, elegí Windows Server 2022.',
  COLOR_PRIMARY, 'DCFCE7',
));

// --- 2. Cuenta AWS y preparación ---
children.push(h1('2. Cuenta AWS y preparación'));
children.push(p('Estos pasos los hacés una sola vez por cliente. El cliente debería ser el dueño de la cuenta AWS para que la facturación y el control queden a su nombre; vos accedés como usuario IAM con permisos administrativos.'));

children.push(h3('Crear la cuenta'));
children.push(num('Entrar a https://aws.amazon.com y crear una cuenta a nombre del cliente (con su email y tarjeta de crédito o débito).'));
children.push(num('Validar la cuenta — AWS envía un código por SMS y hace una pre-autorización de USD 1 en la tarjeta.'));
children.push(num('Configurar MFA en el usuario root inmediatamente (Google Authenticator o YubiKey).'));
children.push(num('Crear un usuario IAM con grupo AdministratorAccess para vos y otro para el cliente. Después del setup inicial, no se vuelve a usar el usuario root.'));

children.push(h3('Región y soporte'));
children.push(p('Elegí la región más cercana al cliente para minimizar latencia. Para clientes en Argentina lo más recomendable es South America (São Paulo) sa-east-1. Verificá que el plan de soporte sea "Basic" (gratis) salvo que el cliente quiera invertir en Developer (USD 29/mes).'));

children.push(h3('Facturación y alertas'));
children.push(num('AWS Billing → Budgets → Crear presupuesto mensual de USD 150 con alerta al 80% por email.'));
children.push(num('Activar Cost Explorer (los primeros 14 meses gratis).'));
children.push(num('Configurar el método de pago como predeterminado.'));

// --- 3. Red privada (VPC) ---
children.push(h1('3. Red privada — VPC y subredes'));
children.push(p('Vamos a crear una VPC dedicada con dos subredes públicas (para la EC2 que da cara a internet) y dos subredes privadas (para la base de datos). Esto separa el tráfico y blinda la base.'));

children.push(num('VPC → Tus VPCs → Crear VPC.'));
children.push(num('Modo: VPC, subredes, etc. (asistente completo).'));
children.push(num('Nombre: agrocore-vpc.'));
children.push(num('Bloque CIDR IPv4: 10.0.0.0/16.'));
children.push(num('Cantidad de zonas de disponibilidad: 2.'));
children.push(num('Cantidad de subredes públicas: 2 — Cantidad de subredes privadas: 2.'));
children.push(num('Gateway NAT: ninguna (para AgroCore no hace falta, abarata costos).'));
children.push(num('Endpoint VPC para S3: ninguno.'));
children.push(num('Crear VPC.'));

children.push(p('El asistente crea automáticamente: Internet Gateway, 2 subredes públicas (10.0.0.0/20 y 10.0.16.0/20), 2 subredes privadas (10.0.128.0/20 y 10.0.144.0/20), tablas de ruteo y asociaciones. Te tarda unos 30 segundos.'));

children.push(note('Si vas a usar Cloudflare Tunnel para servir el sitio con HTTPS (recomendado), tampoco vas a necesitar Elastic IP en la EC2 — Cloudflare conecta de salida desde la EC2.', '0EA5E9', 'E0F2FE'));

// --- 4. Security Groups ---
children.push(h1('4. Grupos de seguridad'));
children.push(p('Vamos a crear dos: uno para la EC2 (app) y otro para Aurora (base). El de Aurora solo acepta tráfico que venga del SG de la EC2 — nunca de internet.'));

children.push(h3('agrocore-app-sg (para la EC2)'));
children.push(num('VPC → Grupos de seguridad → Crear grupo de seguridad.'));
children.push(num('Nombre: agrocore-app-sg — Descripción: "App server EC2 AgroCore" — VPC: agrocore-vpc.'));
children.push(num('Reglas de entrada (cambia según el SO):'));
children.push(bullet([
  t('Linux: '), t('SSH (22) desde tu IP solamente', { bold: true }),
  t(' — para entrar por terminal.'),
]));
children.push(bullet([
  t('Windows: '), t('RDP (3389) desde tu IP solamente', { bold: true }),
  t(' — para entrar por Escritorio Remoto.'),
]));
children.push(bullet('HTTP (80) desde 0.0.0.0/0 — para Cloudflare Tunnel y challenges Let\'s Encrypt.'));
children.push(bullet('HTTPS (443) desde 0.0.0.0/0 — para servir el sitio.'));
children.push(bullet('Custom TCP (3100) desde tu IP solamente — para probar el sistema directo durante setup.'));
children.push(num('Reglas de salida: dejá la default (todo permitido).'));

children.push(note(
  'CRÍTICO: las descripciones de cada regla NO deben tener acentos ni caracteres especiales. AWS las rechaza con un mensaje "Invalid rule description" muy poco claro. Usá "HTTPS publico" en lugar de "HTTPS público".',
  COLOR_ACCENT, 'FEF3C7',
));

children.push(h3('agrocore-db-sg (para Aurora)'));
children.push(num('Crear grupo de seguridad.'));
children.push(num('Nombre: agrocore-db-sg — Descripción: "Aurora PostgreSQL AgroCore" — VPC: agrocore-vpc.'));
children.push(num('Reglas de entrada:'));
children.push(bullet([
  t('Tipo: '), t('PostgreSQL (5432)', { bold: true }),
  t(' — Origen: Custom → buscá '), t('agrocore-app-sg', { bold: true, color: COLOR_PRIMARY }),
  t(' — Descripción: "App server access".'),
]));
children.push(num('Reglas de salida: default.'));

// --- 5. Base de datos Aurora ---
children.push(h1('5. Base de datos — Aurora PostgreSQL Serverless v2'));
children.push(p('Usamos Aurora Serverless v2 porque escala automáticamente entre 0 y 16 ACUs según la demanda. Para un cliente típico de AgroCore, el promedio queda en 0.5 ACUs.'));

children.push(h3('Crear el clúster'));
children.push(num('RDS → Bases de datos → Crear base de datos.'));
children.push(num('Tipo de motor: Amazon Aurora.'));
children.push(num('Edición: Aurora PostgreSQL-Compatible Edition.'));
children.push(num('Versión: la más reciente disponible (16.x).'));
children.push(num('Plantilla: Dev/Test (cambialo a Production cuando el cliente quiera Multi-AZ).'));
children.push(num('Identificador del clúster: agrocore-db.'));
children.push(num('Nombre de usuario maestro: agrocore_admin.'));
children.push(num('Contraseña: generala con KMS o tipeala fuerte (mínimo 16 caracteres, mayúsculas, números y símbolos).'));
children.push(num('Configuración de instancia: Sin servidor v2 (Serverless v2).'));
children.push(num('Capacidad: Mínimo 0 ACUs, Máximo 16 ACUs.'));
children.push(num('Conectividad: VPC agrocore-vpc, Grupo de subredes nuevo "agrocore-db-subnet" con las dos privadas, Grupo de seguridad agrocore-db-sg.'));
children.push(num('Acceso público: No.'));
children.push(num('Autenticación de base de datos: Autenticación de contraseña + Autenticación de IAM (las dos).'));
children.push(num('Cifrado: activado (KMS predeterminado).'));
children.push(num('Mantenimiento: Habilitado actualización menor automática.'));
children.push(num('Crear base de datos.'));

children.push(p('Toma 10-15 minutos. Mientras tanto, podés ir armando la EC2 (sección siguiente) y volver a esta al final para hacer el seed inicial.'));

children.push(h3('Crear la base y el usuario para AgroCore'));
children.push(p('El usuario "maestro" se usa solo para administración. Para que la aplicación se conecte necesitás crear una base y un usuario dedicados:'));

children.push(code('export RDSHOST="agrocore-db-instance-1.XXXXX.sa-east-1.rds.amazonaws.com"\npsql "host=$RDSHOST port=5432 dbname=postgres user=agrocore_admin sslmode=require"\n# (pega la password del master cuando te la pida)'));

children.push(p('Dentro de psql, pegá esto:'));
children.push(code(`CREATE DATABASE agrocore
  WITH ENCODING 'UTF8'
       LC_COLLATE = 'en_US.UTF-8'
       LC_CTYPE   = 'en_US.UTF-8';

CREATE USER agrocore WITH PASSWORD 'PONÉ_UNA_PASSWORD_FUERTE_ACÁ';

GRANT ALL PRIVILEGES ON DATABASE agrocore TO agrocore;

\\c agrocore
GRANT ALL ON SCHEMA public TO agrocore;
ALTER SCHEMA public OWNER TO agrocore;

\\q`));

children.push(note(
  'Anotá la password del usuario "agrocore". La vas a usar en el .env del backend (sección 7 o 8 según elijas Linux o Windows).',
  COLOR_PRIMARY, 'DCFCE7',
));

// --- 6. Decisión: Linux o Windows ---
children.push(h1('6. Elegir el SO de la instancia EC2'));
children.push(p('Ya tenés la base lista. Ahora viene la instancia de aplicación. A partir de acá hay dos caminos paralelos — seguí solo el que corresponda al SO que elijas:'));
children.push(bullet([
  t('Sección 7 — '), t('AgroCore sobre Linux (Amazon Linux 2023)', { bold: true, color: COLOR_LINUX }),
  t('  →  más liviano, más barato, ideal si te sentís cómodo con terminal.'),
]));
children.push(bullet([
  t('Sección 8 — '), t('AgroCore sobre Windows Server 2022', { bold: true, color: COLOR_ACCENT }),
  t('  →  más caro pero familiar, ideal para soporte vía Escritorio Remoto.'),
]));
children.push(p('Después de cualquiera de las dos, las secciones 9 (dominio y HTTPS), 10 (mantenimiento) y 11 (resolución de problemas) aplican a ambos.'));

// ============================================================
// --- 7. LINUX ---
// ============================================================
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('7. AgroCore sobre Linux (Amazon Linux 2023)'));
children.push(note(
  'Esta sección aplica si elegiste Linux. Si vas con Windows, saltala y andá directamente a la sección 8.',
  COLOR_LINUX, 'E0F2FE',
));

children.push(h2('7.1 Lanzar la instancia EC2', COLOR_LINUX));
children.push(num('EC2 → Instancias → Lanzar instancias.'));
children.push(num('Nombre: agrocore-app-server.'));
children.push(num('AMI: Amazon Linux 2023 (Free tier eligible).'));
children.push(num('Tipo de instancia: t3.small (2 vCPU, 2 GB RAM) — alcanza para un cliente típico.'));
children.push(num('Par de claves: el que ya creaste (o "Crear nuevo par de claves" y descargá el .pem).'));
children.push(num('Configuración de red: VPC agrocore-vpc, Subred pública, Asignar IP pública automáticamente: Habilitar, SG: agrocore-app-sg.'));
children.push(num('Almacenamiento: 30 GB gp3.'));
children.push(num('Lanzar instancia. Espera 2-3 minutos hasta que esté en Running.'));

children.push(h2('7.2 Conectarte por SSH', COLOR_LINUX));
children.push(p('Ajustá permisos del .pem y conectate (cambiá la IP por la de tu instancia):'));
children.push(code(`chmod 400 agrocore-key.pem
ssh -i agrocore-key.pem ec2-user@<IP-PÚBLICA>`));

children.push(h2('7.3 Instalar dependencias', COLOR_LINUX));
children.push(code(`# Actualizar el sistema
sudo dnf upgrade -y

# Instalar herramientas básicas
sudo dnf install -y git tar gzip

# Instalar Node.js 20 LTS
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# Instalar PostgreSQL client tools (para psql y pg_dump)
sudo dnf install -y postgresql16

# Verificar versiones
node --version    # debería decir v20.x
npm --version
git --version
psql --version`));

children.push(h2('7.4 Clonar AgroCore', COLOR_LINUX));
children.push(code(`sudo mkdir -p /opt/agrocore
sudo chown ec2-user:ec2-user /opt/agrocore
cd /opt
git clone https://github.com/sergiobilbao29/agrocore.git agrocore
cd /opt/agrocore/backend
npm install`));

children.push(h2('7.5 Configurar el .env apuntando a Aurora', COLOR_LINUX));
children.push(p('Crear /opt/agrocore/backend/.env con el siguiente contenido (reemplazá la password y el endpoint del RDS):'));
children.push(code(`cat > /opt/agrocore/backend/.env <<'EOF'
DATABASE_URL="postgresql://agrocore:LA_PASSWORD@agrocore-db-instance-1.XXXXX.sa-east-1.rds.amazonaws.com:5432/agrocore?schema=public&sslmode=require"
JWT_SECRET="$(openssl rand -base64 48)"
PORT=3100
CORS_ORIGIN="*"
AGROCORE_REPO=sergiobilbao29/agrocore
EOF
chmod 600 /opt/agrocore/backend/.env`));

children.push(h2('7.6 Aplicar migraciones y seed', COLOR_LINUX));
children.push(code(`cd /opt/agrocore/backend
npx prisma migrate deploy
npx prisma generate
node prisma/seed.js
# Si tenés seed-maestros.js, también
node prisma/seed-maestros.js`));

children.push(h2('7.7 Configurar systemd (arranque automático)', COLOR_LINUX));
children.push(p('Creá el archivo /etc/systemd/system/agrocore.service:'));
children.push(code(`sudo tee /etc/systemd/system/agrocore.service > /dev/null <<'EOF'
[Unit]
Description=AgroCore Backend
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/agrocore/backend
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/agrocore.log
StandardError=append:/var/log/agrocore.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo touch /var/log/agrocore.log
sudo chown ec2-user:ec2-user /var/log/agrocore.log
sudo systemctl daemon-reload
sudo systemctl enable agrocore
sudo systemctl start agrocore
sudo systemctl status agrocore`));

children.push(p('Si todo está OK, deberías ver "active (running)". Probá desde tu PC:'));
children.push(code(`curl http://<IP-PÚBLICA>:3100/api/system/version`));
children.push(p('Debería devolver el JSON con la versión.'));

// ============================================================
// --- 8. WINDOWS ---
// ============================================================
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('8. AgroCore sobre Windows Server 2022'));
children.push(note(
  'Esta sección aplica si elegiste Windows. Si vas con Linux, ya seguiste la sección 7 — saltala y andá a la sección 9.',
  COLOR_ACCENT, 'FEF3C7',
));

children.push(h2('8.1 Lanzar la instancia EC2', COLOR_ACCENT));
children.push(num('EC2 → Instancias → Lanzar instancias.'));
children.push(num('Nombre: agrocore-app-server.'));
children.push(num('AMI: en el buscador escribí "Windows Server 2022 Base" — elegí Microsoft Windows Server 2022 Base.'));
children.push(num('Tipo de instancia: t3.medium (2 vCPU, 4 GB RAM) recomendado. Windows necesita más RAM que Linux. Para clientes con muchas empresas y usuarios concurrentes, t3.large (8 GB).'));
children.push(num('Par de claves: el que ya creaste — Windows lo usa para descifrar la password de Administrator.'));
children.push(num('Configuración de red: VPC agrocore-vpc, Subred pública, Asignar IP pública automáticamente: Habilitar, SG: agrocore-app-sg.'));
children.push(num('Almacenamiento: 50 GB gp3 (Windows ocupa ~20 GB de base, dejá margen).'));
children.push(num('Detalles avanzados: dejá todo en default (User data no se usa así en Windows).'));
children.push(num('Lanzar instancia. Esperá 4-5 minutos — Windows tarda más en bootear la primera vez.'));

children.push(h2('8.2 Obtener la contraseña de Administrator', COLOR_ACCENT));
children.push(num('Cuando la instancia esté Running, seleccionala y andá a "Conectar".'));
children.push(num('Pestaña "Cliente RDP".'));
children.push(num('Click en "Obtener contraseña".'));
children.push(num('Cargá el archivo .pem del par de claves (el mismo que descargaste antes).'));
children.push(num('Click "Descifrar contraseña" — te muestra la password de Administrator. Copiala y guardala en lugar seguro.'));
children.push(num('Click "Descargar archivo de escritorio remoto" — descarga un .rdp.'));

children.push(h2('8.3 Conectarte por RDP', COLOR_ACCENT));
children.push(num('Doble clic al archivo .rdp descargado.'));
children.push(num('Usuario: Administrator.'));
children.push(num('Contraseña: la que descifraste.'));
children.push(num('Aceptás el certificado y ya estás en el escritorio de Windows Server 2022.'));

children.push(h2('8.4 Instalar dependencias', COLOR_ACCENT));
children.push(p('Abrí PowerShell como administrador (clic derecho en el menú Inicio) y pegá:'));
children.push(code(`# 1. Permitir scripts
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine -Force

# 2. Instalar Chocolatey
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# 3. Instalar Node, Git y PostgreSQL client tools
choco install -y nodejs-lts git postgresql17 --params '/Password:postgres-local-no-se-usa'

# 4. Refrescar variables de entorno
refreshenv

# 5. Verificar
node --version
git --version
psql --version`));

children.push(note(
  'PostgreSQL local se instala solo para tener psql y pg_dump disponibles — la base real es Aurora en RDS. AgroCore usa pg_dump localmente para el endpoint de backup.',
  '0EA5E9', 'E0F2FE',
));

children.push(h2('8.5 Clonar AgroCore', COLOR_ACCENT));
children.push(code(`cd C:\\
git clone https://github.com/sergiobilbao29/agrocore.git AgroCore
cd C:\\AgroCore\\backend
npm install`));

children.push(h2('8.6 Configurar el .env apuntando a Aurora', COLOR_ACCENT));
children.push(p('Generá el archivo C:\\AgroCore\\backend\\.env desde PowerShell:'));
children.push(code(`$jwtSecret = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
@"
DATABASE_URL="postgresql://agrocore:LA_PASSWORD@agrocore-db-instance-1.XXXXX.sa-east-1.rds.amazonaws.com:5432/agrocore?schema=public&sslmode=require"
JWT_SECRET="$jwtSecret"
PORT=3100
CORS_ORIGIN="*"
AGROCORE_REPO=sergiobilbao29/agrocore
"@ | Out-File -Encoding UTF8 C:\\AgroCore\\backend\\.env`));

children.push(p('Editá el .env con Notepad y reemplazá LA_PASSWORD por la real y XXXXX por el identificador real del endpoint RDS.'));

children.push(h2('8.7 Aplicar migraciones y seed', COLOR_ACCENT));
children.push(code(`cd C:\\AgroCore\\backend
npx prisma migrate deploy
npx prisma generate
node prisma\\seed.js
# Si tenés seed-maestros.js, también
node prisma\\seed-maestros.js`));

children.push(h2('8.8 Configurar arranque automático con Windows', COLOR_ACCENT));
children.push(p('Usamos el Programador de tareas (Task Scheduler) en lugar de un servicio de Windows porque es más simple de mantener. Te dejo el script PowerShell que lo configura:'));
children.push(code(`# Crear tarea que arranca AgroCore al boot del sistema
$action = New-ScheduledTaskAction \`
  -Execute "wscript.exe" \`
  -Argument 'C:\\AgroCore\\INICIAR-AGROCORE.vbs'

$trigger = New-ScheduledTaskTrigger -AtStartup

$principal = New-ScheduledTaskPrincipal \`
  -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet \`
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) \`
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Days 365)

Register-ScheduledTask -TaskName "AgroCore" \`
  -Action $action -Trigger $trigger -Principal $principal -Settings $settings \`
  -Description "Arranque automatico AgroCore al iniciar Windows"

# Arrancar ya mismo
Start-ScheduledTask -TaskName "AgroCore"

# Verificar
Start-Sleep -Seconds 5
Invoke-RestMethod http://localhost:3100/api/system/version`));

children.push(p('Si responde el JSON con la versión, está OK. Probá desde tu PC:'));
children.push(code(`# En cmd o navegador
http://<IP-PÚBLICA-EC2>:3100`));

children.push(h2('8.9 Configurar el firewall de Windows', COLOR_ACCENT));
children.push(p('Por las dudas el firewall interno de Windows bloquee el puerto 3100, agregás la regla:'));
children.push(code(`New-NetFirewallRule -DisplayName "AgroCore HTTP 3100" \`
  -Direction Inbound -Protocol TCP -LocalPort 3100 -Action Allow`));

// ============================================================
// --- 9. DOMINIO + HTTPS ---
// ============================================================
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('9. Dominio y HTTPS (común a Linux y Windows)'));
children.push(p('Por defecto el cliente accede por la IP pública con puerto 3100. Para producción querés un subdominio con HTTPS. Hay dos formas — elegí la que más te convenga.'));

children.push(h2('9.1 Opción A — Cloudflare Tunnel (recomendado)', COLOR_PRIMARY));
children.push(p('Cloudflare Tunnel expone tu servicio sin abrir puertos en la EC2 ni gestionar certificados. Es gratis y simple.'));

children.push(h3('Linux'));
children.push(code(`# Bajar el binario de cloudflared
sudo curl -L --output /usr/local/bin/cloudflared \\
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo chmod +x /usr/local/bin/cloudflared

# Autenticar (abre un link en el navegador)
cloudflared tunnel login

# Crear el túnel
cloudflared tunnel create agrocore-cliente

# Configurar
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<'EOF'
tunnel: <TUNNEL-ID>
credentials-file: /home/ec2-user/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: cliente.agrocore.ar
    service: http://localhost:3100
  - service: http_status:404
EOF

# Apuntar el DNS en Cloudflare
cloudflared tunnel route dns agrocore-cliente cliente.agrocore.ar

# Instalar como servicio
sudo cloudflared service install
sudo systemctl enable --now cloudflared`));

children.push(h3('Windows'));
children.push(code(`# Instalar cloudflared
choco install -y cloudflared

# Autenticar (abre Edge)
cloudflared tunnel login

# Crear el tunel
cloudflared tunnel create agrocore-cliente

# Crear config en C:\\Users\\Administrator\\.cloudflared\\config.yml con:
# tunnel: <TUNNEL-ID>
# credentials-file: C:\\Users\\Administrator\\.cloudflared\\<TUNNEL-ID>.json
# ingress:
#   - hostname: cliente.agrocore.ar
#     service: http://localhost:3100
#   - service: http_status:404

cloudflared tunnel route dns agrocore-cliente cliente.agrocore.ar

# Instalar como servicio
cloudflared service install`));

children.push(p('Después del tunnel funcionando, podés cerrar el puerto 3100 al público en el Security Group — solo lo necesita Cloudflare desde adentro de la EC2.'));

children.push(h2('9.2 Opción B — Nginx + Let\'s Encrypt (Linux solamente)', COLOR_LINUX));
children.push(p('Si el dominio del cliente está en su DNS y no quieren usar Cloudflare:'));
children.push(code(`sudo dnf install -y nginx certbot python3-certbot-nginx

# Configurar nginx reverse proxy
sudo tee /etc/nginx/conf.d/agrocore.conf > /dev/null <<'EOF'
server {
  listen 80;
  server_name cliente.agrocore.ar;
  location / {
    proxy_pass http://localhost:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF

sudo systemctl enable --now nginx
sudo certbot --nginx -d cliente.agrocore.ar`));

// ============================================================
// --- 10. MANTENIMIENTO ---
// ============================================================
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('10. Mantenimiento'));

children.push(h2('10.1 Backups automáticos', COLOR_PRIMARY));
children.push(p('Aurora hace snapshots automáticos diarios (los conserva 7 días por default — se puede subir a 35). Adicionalmente, AgroCore tiene su propio backup desde Configuración → Sistema → Descargar backup, que genera un .sql con pg_dump.'));

children.push(p('Para automatizar el backup de AgroCore a S3 (recomendado para retención de largo plazo):'));
children.push(h3('Linux'));
children.push(code(`# Crontab del usuario ec2-user
crontab -e
# Pegar:
0 3 * * * /usr/bin/pg_dump $DATABASE_URL --no-owner --no-acl \\
  | gzip > /tmp/agrocore-$(date +\\%Y\\%m\\%d).sql.gz \\
  && aws s3 cp /tmp/agrocore-$(date +\\%Y\\%m\\%d).sql.gz s3://agrocore-backups-CLIENTE/ \\
  && rm /tmp/agrocore-$(date +\\%Y\\%m\\%d).sql.gz`));

children.push(h3('Windows'));
children.push(code(`# Tarea programada diaria a las 3 AM
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" \`
  -Argument '-Command "& { pg_dump \\$env:DATABASE_URL --no-owner --no-acl | gzip > \\$env:TEMP\\agrocore-\\$(Get-Date -f yyyyMMdd).sql.gz; aws s3 cp ... }"'
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "AgroCore-Backup-S3" -Action $action -Trigger $trigger`));

children.push(h2('10.2 Actualizaciones de AgroCore', COLOR_PRIMARY));
children.push(p('Desde el sistema mismo: Configuración → Sistema → Verificar actualizaciones. Si hay una versión nueva, el cliente ve un aviso y puede ejecutar el script de actualización.'));

children.push(h3('Linux'));
children.push(code(`cd /opt/agrocore
sudo systemctl stop agrocore
git pull
cd backend && npm install --omit=dev
npx prisma migrate deploy
npx prisma generate
sudo systemctl start agrocore
sudo systemctl status agrocore`));

children.push(h3('Windows'));
children.push(p('Tenés el script automatizado:'));
children.push(code(`powershell -ExecutionPolicy Bypass -File C:\\AgroCore\\Update-AgroCore.ps1`));
children.push(p('Hace backup automático antes, pull, npm install, prisma migrate y reinicia el sistema.'));

children.push(h2('10.3 Monitoreo de costos', COLOR_PRIMARY));
children.push(bullet('CloudWatch → Alarmas: configurar alerta cuando CPU EC2 > 80% por 15 minutos.'));
children.push(bullet('CloudWatch → Alarmas: configurar alerta cuando ACU Aurora > 4 por 30 minutos sostenidos.'));
children.push(bullet('Cost Explorer: revisar mensualmente — Aurora suele ser el primer gasto a optimizar.'));

// ============================================================
// --- 11. COSTOS ---
// ============================================================
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('11. Costos mensuales estimados'));
children.push(p('Valores aproximados en USD para la región sa-east-1 (São Paulo), uso típico de un cliente agropecuario con ~5-10 usuarios concurrentes:'));
children.push(costTable());
children.push(p(''));
children.push(note(
  'La factura real depende del uso. Aurora se escala dinámicamente, así que en horarios de baja demanda baja a 0.5 ACU. Para mantener costo bajo: usar EC2 Reserved Instance (1 año) — ahorrás ~30% en compute.',
  '0EA5E9', 'E0F2FE',
));

// ============================================================
// --- 12. TROUBLESHOOTING ---
// ============================================================
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('12. Resolución de problemas frecuentes'));

children.push(h2('12.1 No me puedo conectar por SSH / RDP', COLOR_PRIMARY));
children.push(bullet('Verificá que el SG agrocore-app-sg tenga regla 22 (Linux) o 3389 (Windows) desde tu IP actual. Si cambió tu IP pública (porque te conectás desde otra red), tenés que actualizar la regla.'));
children.push(bullet('Verificá que la instancia esté en estado "Running" en la consola.'));
children.push(bullet('Para SSH: que el .pem tenga permisos 400 (chmod 400 archivo.pem).'));
children.push(bullet('Para RDP: que tengas la password descifrada correcta (Get-Password con el .pem original).'));

children.push(h2('12.2 La aplicación no responde en el puerto 3100', COLOR_PRIMARY));
children.push(h3('Linux'));
children.push(code(`sudo systemctl status agrocore
sudo journalctl -u agrocore -n 50 --no-pager
sudo tail -50 /var/log/agrocore.log`));
children.push(h3('Windows'));
children.push(code(`Get-Process node
Get-ScheduledTask -TaskName "AgroCore" | Get-ScheduledTaskInfo
# Logs de la app: C:\\AgroCore\\backend\\logs\\ (si están)
# O directamente correr a mano:
cd C:\\AgroCore\\backend
node src\\server.js`));

children.push(h2('12.3 Error de conexión a la base', COLOR_PRIMARY));
children.push(bullet('Verificar que el SG agrocore-db-sg tenga regla 5432 desde agrocore-app-sg.'));
children.push(bullet('Verificar que el endpoint del RDS en el .env esté bien copiado (RDS → Bases de datos → tu instancia → "Endpoint").'));
children.push(bullet('Verificar que la password del usuario agrocore esté bien (sin acentos ni espacios accidentales).'));
children.push(bullet('Probar conexión manual: psql "host=<ENDPOINT> port=5432 dbname=agrocore user=agrocore sslmode=require".'));

children.push(h2('12.4 Aurora se duerme y la primera consulta tarda', COLOR_PRIMARY));
children.push(p('Aurora Serverless v2 con mínimo 0 ACUs se pausa cuando no hay tráfico. Al despertar tarda 10-15 segundos. Si querés evitarlo, subí el mínimo a 0.5 ACU (cuesta ~USD 45/mes más pero la app responde siempre instantánea).'));

children.push(h2('12.5 Costos más altos de lo esperado', COLOR_PRIMARY));
children.push(bullet('Verificar que no haya snapshots manuales acumulados (Aurora → Mantenimiento → Snapshots).'));
children.push(bullet('Verificar que no haya Elastic IPs sin asociar (cuestan USD 3.60/mes cada una sin usar).'));
children.push(bullet('Verificar que CloudWatch no esté guardando logs detallados sin necesidad.'));
children.push(bullet('Para clientes pequeños: considerar migrar de Aurora a RDS PostgreSQL estándar (db.t3.small) — ahorra ~USD 40/mes.'));

// ============================================================
// --- 13. CHECKLIST DE ENTREGA ---
// ============================================================
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('13. Checklist de entrega al cliente'));
children.push(p('Antes de cerrar la implementación y entregar al cliente, verificar:'));
children.push(bullet('AgroCore responde en https://cliente.agrocore.ar.'));
children.push(bullet('Login con Super Admin del cliente funciona; la password ya NO es super123.'));
children.push(bullet('Configuración → Sistema → Verificar actualizaciones devuelve "Ya estás en la última versión".'));
children.push(bullet('Configuración → Sistema → Descargar backup genera un .sql descargable de varios MB.'));
children.push(bullet('Asistente "Preparar para entrega al cliente" no detecta más nada para limpiar.'));
children.push(bullet('El hint de "Usuarios de prueba" no aparece en el login (abrir en incógnito para confirmar).'));
children.push(bullet('Las empresas del cliente están creadas con datos básicos (CUIT, IVA, dirección).'));
children.push(bullet('Los usuarios reales del cliente están creados con sus roles correctos.'));
children.push(bullet('Vos seguís siendo Super Admin con tu password secreta para soporte futuro.'));
children.push(bullet('Snapshot manual del RDS guardado (RDS → Mantenimiento → Tomar snapshot).'));
children.push(bullet('Cliente sabe cómo contactarte ante incidentes (WhatsApp, email).'));
children.push(bullet('Manual de Usuario v1.9 enviado al cliente en PDF.'));
children.push(bullet('Credenciales del cliente entregadas en forma segura (NUNCA por email plano — usar 1Password, Bitwarden o similar).'));

// ============================================================
// --- 14. CIERRE ---
// ============================================================
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('14. Notas finales'));
children.push(p('Esta guía cubre la implementación productiva de AgroCore en AWS para un cliente concreto. Se mantiene actualizada con el sistema en la versión 0.7.2.'));
children.push(p('Para cualquier duda durante la implementación, los logs detallados están en:'));
children.push(bullet('Linux: /var/log/agrocore.log + journalctl -u agrocore'));
children.push(bullet('Windows: console output del proceso node (correrlo a mano la primera vez)'));
children.push(bullet('AWS: CloudWatch → Log Groups → /aws/rds/cluster/agrocore-db'));
children.push(p(''));
children.push(p('Documento generado automáticamente desde el repositorio de AgroCore con generate_guia_aws.cjs.'));

// ============================================================
// CONSTRUCCIÓN DEL DOCUMENTO
// ============================================================
const doc = new Document({
  creator: 'AgroCore',
  title: 'Guía de Implementación AWS',
  description: 'Guía técnica paso a paso para implementar AgroCore en AWS con Aurora PostgreSQL + EC2 (Linux o Windows)',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: COLOR_PRIMARY },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: FONT },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: FONT, color: '334155' },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'numbers',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_PRIMARY, space: 4 } },
        children: [new TextRun({ text: 'AgroCore — Guía de Implementación AWS', font: FONT, size: 18, color: '64748B' })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Página ', font: FONT, size: 18, color: '64748B' }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '64748B' }),
          new TextRun({ text: ' de ', font: FONT, size: 18, color: '64748B' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18, color: '64748B' }),
        ],
      })] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join('C:', 'AgroCore', 'Guia-Implementacion-AWS.docx');
  fs.writeFileSync(out, buf);
  console.log(`[OK] Generado: ${out}`);
  console.log(`     Tamaño: ${(buf.length / 1024).toFixed(1)} KB`);
}).catch((e) => {
  console.error('Error generando el .docx:', e);
  process.exit(1);
});
