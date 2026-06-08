/* ============================================================================
   AgroCore — Schema SQL Server 2019+
   Sistema de gestión agropecuaria multi-empresa (holding) con sync offline
   ----------------------------------------------------------------------------
   Convenciones:
     - Todas las tablas transaccionales tienen GrupoId (holding) + EmpresaId
     - RowVersion (ROWVERSION) para sincronización incremental
     - CreatedAt/UpdatedAt/DeletedAt (soft-delete) para auditoría
     - UpdatedBy para trazabilidad
     - SyncClientId + SyncUuid para conciliación offline-first (UUID del cliente)
     - Uso extenso de claves foráneas con NO ACTION para evitar cascadas peligrosas
     - Uso de DECIMAL(18,4) para montos y cantidades
   ============================================================================ */

IF DB_ID('AgroCore') IS NULL
BEGIN
    CREATE DATABASE AgroCore COLLATE Modern_Spanish_CI_AS;
END
GO
USE AgroCore;
GO

SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET NOCOUNT ON;
GO

/* ============================================================================
   1. SEGURIDAD — Grupo económico, Empresas, Usuarios, Roles, Permisos
   ============================================================================ */

CREATE TABLE dbo.Grupo (
    GrupoId           INT IDENTITY(1,1) CONSTRAINT PK_Grupo PRIMARY KEY,
    Nombre            NVARCHAR(150)  NOT NULL,
    CuitHolding       VARCHAR(13)    NULL,
    Descripcion       NVARCHAR(500)  NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Grupo_Activo DEFAULT 1,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Grupo_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Grupo_UpdatedAt DEFAULT SYSUTCDATETIME(),
    RowVersion        ROWVERSION     NOT NULL
);

CREATE TABLE dbo.Empresa (
    EmpresaId         INT IDENTITY(1,1) CONSTRAINT PK_Empresa PRIMARY KEY,
    GrupoId           INT            NOT NULL,
    RazonSocial       NVARCHAR(200)  NOT NULL,
    NombreFantasia    NVARCHAR(200)  NULL,
    Cuit              VARCHAR(13)    NOT NULL,
    IngresosBrutos    VARCHAR(30)    NULL,
    CondicionIva      NVARCHAR(50)   NOT NULL CONSTRAINT DF_Empresa_CondIva DEFAULT 'RI', -- RI, MONO, EX
    Renspa            VARCHAR(30)    NULL,
    Direccion         NVARCHAR(300)  NULL,
    Localidad         NVARCHAR(100)  NULL,
    Provincia         NVARCHAR(50)   NULL,
    Telefono          VARCHAR(30)    NULL,
    Email             NVARCHAR(150)  NULL,
    EsPyme            BIT            NOT NULL CONSTRAINT DF_Empresa_EsPyme DEFAULT 0,
    Activo            BIT            NOT NULL CONSTRAINT DF_Empresa_Activo DEFAULT 1,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Empresa_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Empresa_UpdatedAt DEFAULT SYSUTCDATETIME(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT UK_Empresa_Cuit UNIQUE (Cuit),
    CONSTRAINT FK_Empresa_Grupo FOREIGN KEY (GrupoId) REFERENCES dbo.Grupo(GrupoId)
);
CREATE INDEX IX_Empresa_GrupoId ON dbo.Empresa(GrupoId) WHERE Activo = 1;

CREATE TABLE dbo.Usuario (
    UsuarioId         INT IDENTITY(1,1) CONSTRAINT PK_Usuario PRIMARY KEY,
    GrupoId           INT            NOT NULL,
    Username          NVARCHAR(60)   NOT NULL,
    Email             NVARCHAR(200)  NOT NULL,
    NombreCompleto    NVARCHAR(200)  NOT NULL,
    PasswordHash      VARBINARY(256) NOT NULL, -- bcrypt / argon2 desde la API
    PasswordSalt      VARBINARY(128) NULL,
    Telefono          VARCHAR(30)    NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Usuario_Activo DEFAULT 1,
    MfaSecret         VARBINARY(64)  NULL,
    UltimoLoginAt     DATETIME2(0)   NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Usuario_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Usuario_UpdatedAt DEFAULT SYSUTCDATETIME(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT UK_Usuario_Username UNIQUE (GrupoId, Username),
    CONSTRAINT UK_Usuario_Email    UNIQUE (GrupoId, Email),
    CONSTRAINT FK_Usuario_Grupo   FOREIGN KEY (GrupoId) REFERENCES dbo.Grupo(GrupoId)
);

CREATE TABLE dbo.Rol (
    RolId             INT IDENTITY(1,1) CONSTRAINT PK_Rol PRIMARY KEY,
    GrupoId           INT            NOT NULL,
    Codigo            VARCHAR(40)    NOT NULL,  -- ADMIN, CONTABLE, OPERACIONES, LECTURA, CAMPO, ...
    Nombre            NVARCHAR(100)  NOT NULL,
    Descripcion       NVARCHAR(500)  NULL,
    EsSistema         BIT            NOT NULL CONSTRAINT DF_Rol_Sistema DEFAULT 0,
    Activo            BIT            NOT NULL CONSTRAINT DF_Rol_Activo DEFAULT 1,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Rol_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Rol_UpdatedAt DEFAULT SYSUTCDATETIME(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT UK_Rol_Codigo UNIQUE (GrupoId, Codigo),
    CONSTRAINT FK_Rol_Grupo  FOREIGN KEY (GrupoId) REFERENCES dbo.Grupo(GrupoId)
);

CREATE TABLE dbo.Permiso (
    PermisoId         INT IDENTITY(1,1) CONSTRAINT PK_Permiso PRIMARY KEY,
    Codigo            VARCHAR(60)   NOT NULL, -- produccion:read, finanzas:write, cheques:delete, etc.
    Modulo            VARCHAR(40)   NOT NULL,
    Accion            VARCHAR(20)   NOT NULL, -- read|create|edit|delete|approve
    Descripcion       NVARCHAR(300) NULL,
    CONSTRAINT UK_Permiso_Codigo UNIQUE (Codigo)
);

CREATE TABLE dbo.RolPermiso (
    RolId             INT NOT NULL,
    PermisoId         INT NOT NULL,
    CONSTRAINT PK_RolPermiso PRIMARY KEY (RolId, PermisoId),
    CONSTRAINT FK_RolPermiso_Rol      FOREIGN KEY (RolId)     REFERENCES dbo.Rol(RolId)     ON DELETE CASCADE,
    CONSTRAINT FK_RolPermiso_Permiso  FOREIGN KEY (PermisoId) REFERENCES dbo.Permiso(PermisoId) ON DELETE CASCADE
);

CREATE TABLE dbo.UsuarioEmpresaRol (
    UsuarioEmpresaRolId BIGINT IDENTITY(1,1) CONSTRAINT PK_UsuarioEmpresaRol PRIMARY KEY,
    UsuarioId         INT NOT NULL,
    EmpresaId         INT NOT NULL,
    RolId             INT NOT NULL,
    CreatedAt         DATETIME2(0) NOT NULL CONSTRAINT DF_UER_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UK_UER UNIQUE (UsuarioId, EmpresaId, RolId),
    CONSTRAINT FK_UER_Usuario FOREIGN KEY (UsuarioId) REFERENCES dbo.Usuario(UsuarioId) ON DELETE CASCADE,
    CONSTRAINT FK_UER_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_UER_Rol     FOREIGN KEY (RolId)     REFERENCES dbo.Rol(RolId)
);
CREATE INDEX IX_UER_Usuario ON dbo.UsuarioEmpresaRol(UsuarioId, EmpresaId);

CREATE TABLE dbo.RefreshToken (
    RefreshTokenId    BIGINT IDENTITY(1,1) CONSTRAINT PK_RefreshToken PRIMARY KEY,
    UsuarioId         INT            NOT NULL,
    TokenHash         VARBINARY(64)  NOT NULL,
    DeviceInfo        NVARCHAR(300)  NULL,
    ExpiraAt          DATETIME2(0)   NOT NULL,
    RevocadoAt        DATETIME2(0)   NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_RT_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_RT_Usuario FOREIGN KEY (UsuarioId) REFERENCES dbo.Usuario(UsuarioId) ON DELETE CASCADE
);
CREATE INDEX IX_RT_Usuario ON dbo.RefreshToken(UsuarioId, RevocadoAt);

CREATE TABLE dbo.AuditLog (
    AuditLogId        BIGINT IDENTITY(1,1) CONSTRAINT PK_AuditLog PRIMARY KEY,
    GrupoId           INT            NOT NULL,
    EmpresaId         INT            NULL,
    UsuarioId         INT            NULL,
    Entidad           VARCHAR(60)    NOT NULL,
    EntidadId         VARCHAR(40)    NULL,
    Accion            VARCHAR(20)    NOT NULL, -- INSERT|UPDATE|DELETE|LOGIN|...
    DatosAntes        NVARCHAR(MAX)  NULL,
    DatosDespues      NVARCHAR(MAX)  NULL,
    Ip                VARCHAR(45)    NULL,
    UserAgent         NVARCHAR(500)  NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Audit_CreatedAt DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Audit_Empresa ON dbo.AuditLog(EmpresaId, CreatedAt DESC);
CREATE INDEX IX_Audit_Entidad ON dbo.AuditLog(Entidad, EntidadId);


/* ============================================================================
   2. CATÁLOGOS GENERALES
   ============================================================================ */

CREATE TABLE dbo.Moneda (
    MonedaId          TINYINT        NOT NULL CONSTRAINT PK_Moneda PRIMARY KEY,
    Codigo            CHAR(3)        NOT NULL, -- ARS, USD, EUR
    Nombre            NVARCHAR(40)   NOT NULL,
    Simbolo           NVARCHAR(5)    NOT NULL,
    CONSTRAINT UK_Moneda_Codigo UNIQUE (Codigo)
);

CREATE TABLE dbo.TipoCambio (
    TipoCambioId      INT IDENTITY(1,1) CONSTRAINT PK_TipoCambio PRIMARY KEY,
    Fecha             DATE           NOT NULL,
    MonedaId          TINYINT        NOT NULL,
    CotizacionOficial DECIMAL(18,4)  NULL,
    CotizacionBlue    DECIMAL(18,4)  NULL,
    CotizacionMep     DECIMAL(18,4)  NULL,
    CotizacionCcl     DECIMAL(18,4)  NULL,
    Fuente            NVARCHAR(100)  NULL, -- BCRA, Bolsa, Manual
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_TC_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UK_TipoCambio UNIQUE (Fecha, MonedaId),
    CONSTRAINT FK_TC_Moneda  FOREIGN KEY (MonedaId) REFERENCES dbo.Moneda(MonedaId)
);
CREATE INDEX IX_TC_Fecha ON dbo.TipoCambio(Fecha DESC);

CREATE TABLE dbo.Categoria (
    CategoriaId       INT IDENTITY(1,1) CONSTRAINT PK_Categoria PRIMARY KEY,
    GrupoId           INT            NOT NULL,
    Tipo              VARCHAR(30)    NOT NULL, -- INGRESO, EGRESO, INSUMO, LABOR, ...
    Codigo            VARCHAR(40)    NOT NULL,
    Nombre            NVARCHAR(120)  NOT NULL,
    Descripcion       NVARCHAR(300)  NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Cat_Activo DEFAULT 1,
    CONSTRAINT UK_Categoria UNIQUE (GrupoId, Tipo, Codigo),
    CONSTRAINT FK_Categoria_Grupo FOREIGN KEY (GrupoId) REFERENCES dbo.Grupo(GrupoId)
);


/* ============================================================================
   3. ESTABLECIMIENTOS — Campos, Lotes, Cultivos
   ============================================================================ */

CREATE TABLE dbo.Campo (
    CampoId           INT IDENTITY(1,1) CONSTRAINT PK_Campo PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Nombre            NVARCHAR(150)  NOT NULL,
    Ubicacion         NVARCHAR(300)  NULL,
    Localidad         NVARCHAR(100)  NULL,
    Provincia         NVARCHAR(50)   NULL,
    Latitud           DECIMAL(9,6)   NULL,
    Longitud          DECIMAL(9,6)   NULL,
    HaTotales         DECIMAL(10,2)  NOT NULL CONSTRAINT DF_Campo_Ha DEFAULT 0,
    TipoPosesion      VARCHAR(20)    NOT NULL CONSTRAINT DF_Campo_Tipo DEFAULT 'PROPIO', -- PROPIO | ARRENDADO | APARCERIA
    Notas             NVARCHAR(MAX)  NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Campo_Activo DEFAULT 1,
    DeletedAt         DATETIME2(0)   NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Campo_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Campo_UpdatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy         INT            NULL,
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Campo_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Campo_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);
CREATE INDEX IX_Campo_Empresa ON dbo.Campo(EmpresaId) WHERE Activo = 1;

CREATE TABLE dbo.Lote (
    LoteId            INT IDENTITY(1,1) CONSTRAINT PK_Lote PRIMARY KEY,
    CampoId           INT            NOT NULL,
    Nombre            NVARCHAR(100)  NOT NULL,
    Codigo            NVARCHAR(30)   NULL,
    HaSiembra         DECIMAL(10,2)  NOT NULL CONSTRAINT DF_Lote_Ha DEFAULT 0,
    Poligono          NVARCHAR(MAX)  NULL,   -- GeoJSON del polígono (o usar GEOGRAPHY)
    TipoSuelo         NVARCHAR(50)   NULL,
    Notas             NVARCHAR(MAX)  NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Lote_Activo DEFAULT 1,
    DeletedAt         DATETIME2(0)   NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Lote_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Lote_UpdatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy         INT            NULL,
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Lote_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Lote_Campo FOREIGN KEY (CampoId) REFERENCES dbo.Campo(CampoId)
);
CREATE INDEX IX_Lote_Campo ON dbo.Lote(CampoId) WHERE Activo = 1;

CREATE TABLE dbo.Cultivo (
    CultivoId         INT IDENTITY(1,1) CONSTRAINT PK_Cultivo PRIMARY KEY,
    GrupoId           INT            NOT NULL,
    Nombre            NVARCHAR(80)   NOT NULL,  -- Soja, Maíz, Trigo, Girasol, Centeno...
    Especie           NVARCHAR(50)   NULL,
    CicloDias         INT            NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Cult_Activo DEFAULT 1,
    CONSTRAINT UK_Cultivo UNIQUE (GrupoId, Nombre),
    CONSTRAINT FK_Cult_Grupo FOREIGN KEY (GrupoId) REFERENCES dbo.Grupo(GrupoId)
);


/* ============================================================================
   4. PRODUCCIÓN — Campañas, Insumos/Labores, Órdenes de Trabajo, Maquinaria
   ============================================================================ */

CREATE TABLE dbo.Campana (
    CampanaId         INT IDENTITY(1,1) CONSTRAINT PK_Campana PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    LoteId            INT            NOT NULL,
    CultivoId         INT            NOT NULL,
    Ciclo             VARCHAR(10)    NOT NULL,  -- 2025/26
    HaSembradas       DECIMAL(10,2)  NOT NULL CONSTRAINT DF_Camp_Ha DEFAULT 0,
    FechaSiembra      DATE           NULL,
    FechaCosecha      DATE           NULL,
    RendQqHaEst       DECIMAL(10,2)  NULL,  -- estimado
    RendQqHaReal      DECIMAL(10,2)  NULL,  -- real al cierre
    PrecioUsdTonEst   DECIMAL(10,2)  NULL,
    PrecioUsdTonReal  DECIMAL(10,2)  NULL,
    Estado            VARCHAR(20)    NOT NULL CONSTRAINT DF_Camp_Estado DEFAULT 'PLANIFICADA',
                                              -- PLANIFICADA|EN_CURSO|COSECHADA|CERRADA|CANCELADA
    Notas             NVARCHAR(MAX)  NULL,
    DeletedAt         DATETIME2(0)   NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Camp_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Camp_UpdatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy         INT            NULL,
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Camp_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Camp_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_Camp_Lote    FOREIGN KEY (LoteId)    REFERENCES dbo.Lote(LoteId),
    CONSTRAINT FK_Camp_Cultivo FOREIGN KEY (CultivoId) REFERENCES dbo.Cultivo(CultivoId)
);
CREATE INDEX IX_Camp_Empresa ON dbo.Campana(EmpresaId, Estado);
CREATE INDEX IX_Camp_Lote    ON dbo.Campana(LoteId, Ciclo);

CREATE TABLE dbo.Maquinaria (
    MaquinariaId      INT IDENTITY(1,1) CONSTRAINT PK_Maquinaria PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Tipo              VARCHAR(30)    NOT NULL, -- TRACTOR, COSECHADORA, PULVERIZADORA, SEMBRADORA, CAMION
    Marca             NVARCHAR(80)   NULL,
    Modelo            NVARCHAR(80)   NULL,
    Identificacion    NVARCHAR(60)   NULL,  -- patente/interna
    Anio              INT            NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Maq_Activo DEFAULT 1,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Maq_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Maq_UpdatedAt DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Maq_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Maq_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);

-- Catálogo maestro de insumos (stock lleva el saldo)
CREATE TABLE dbo.Insumo (
    InsumoId          INT IDENTITY(1,1) CONSTRAINT PK_Insumo PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Codigo            NVARCHAR(40)   NULL,
    Nombre            NVARCHAR(150)  NOT NULL,
    Tipo              VARCHAR(30)    NOT NULL, -- HERBICIDA, INSECTICIDA, FUNGICIDA, FERTILIZANTE, SEMILLA, COMBUSTIBLE, OTRO
    UnidadMedida      VARCHAR(20)    NOT NULL CONSTRAINT DF_Insumo_UM DEFAULT 'LT', -- LT, KG, UN, CM3, M3, BOLSA
    PrincipioActivo   NVARCHAR(150)  NULL,
    MarcaComercial    NVARCHAR(100)  NULL,
    StockMinimo       DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Insumo_StkMin DEFAULT 0,
    StockActual       DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Insumo_StkAct DEFAULT 0, -- materializado para rendimiento
    PrecioPromUsd     DECIMAL(18,4)  NULL,
    PrecioPromArs     DECIMAL(18,4)  NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Insumo_Activo DEFAULT 1,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Insumo_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Insumo_UpdatedAt DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Insumo_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Insumo_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);
CREATE INDEX IX_Insumo_Empresa ON dbo.Insumo(EmpresaId, Tipo) WHERE Activo = 1;

-- Proveedores
CREATE TABLE dbo.Proveedor (
    ProveedorId       INT IDENTITY(1,1) CONSTRAINT PK_Proveedor PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    RazonSocial       NVARCHAR(200)  NOT NULL,
    Cuit              VARCHAR(13)    NULL,
    CondicionIva      VARCHAR(20)    NULL,
    Telefono          VARCHAR(40)    NULL,
    Email             NVARCHAR(150)  NULL,
    Direccion         NVARCHAR(300)  NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Prov_Activo DEFAULT 1,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Prov_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Prov_UpdatedAt DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Prov_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Prov_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);

-- Clientes
CREATE TABLE dbo.Cliente (
    ClienteId         INT IDENTITY(1,1) CONSTRAINT PK_Cliente PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    RazonSocial       NVARCHAR(200)  NOT NULL,
    Cuit              VARCHAR(13)    NULL,
    CondicionIva      VARCHAR(20)    NULL,
    Telefono          VARCHAR(40)    NULL,
    Email             NVARCHAR(150)  NULL,
    Direccion         NVARCHAR(300)  NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Cli_Activo DEFAULT 1,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Cli_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Cli_UpdatedAt DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Cli_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Cli_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);

-- Compras de insumos
CREATE TABLE dbo.CompraInsumo (
    CompraInsumoId    INT IDENTITY(1,1) CONSTRAINT PK_CompraInsumo PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    ProveedorId       INT            NOT NULL,
    Fecha             DATE           NOT NULL,
    NroComprobante    NVARCHAR(40)   NULL,
    Moneda            CHAR(3)        NOT NULL CONSTRAINT DF_CompIns_Moneda DEFAULT 'ARS',
    TipoCambio        DECIMAL(18,4)  NULL,
    SubTotal          DECIMAL(18,4)  NOT NULL,
    Iva               DECIMAL(18,4)  NOT NULL CONSTRAINT DF_CompIns_Iva DEFAULT 0,
    Total             DECIMAL(18,4)  NOT NULL,
    Estado            VARCHAR(20)    NOT NULL CONSTRAINT DF_CompIns_Estado DEFAULT 'PENDIENTE', -- PENDIENTE|PAGADA|ANULADA
    Notas             NVARCHAR(MAX)  NULL,
    DeletedAt         DATETIME2(0)   NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_CompIns_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_CompIns_Updated DEFAULT SYSUTCDATETIME(),
    UpdatedBy         INT            NULL,
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_CompIns_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_CompIns_Empresa   FOREIGN KEY (EmpresaId)   REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_CompIns_Proveedor FOREIGN KEY (ProveedorId) REFERENCES dbo.Proveedor(ProveedorId)
);
CREATE INDEX IX_CompIns_Empresa ON dbo.CompraInsumo(EmpresaId, Fecha DESC);

CREATE TABLE dbo.CompraInsumoDetalle (
    CompraInsumoDetalleId INT IDENTITY(1,1) CONSTRAINT PK_CompIns_Det PRIMARY KEY,
    CompraInsumoId    INT            NOT NULL,
    InsumoId          INT            NOT NULL,
    Cantidad          DECIMAL(18,4)  NOT NULL,
    PrecioUnitario    DECIMAL(18,4)  NOT NULL,
    DescuentoPct      DECIMAL(5,2)   NOT NULL CONSTRAINT DF_CID_Desc DEFAULT 0,
    Subtotal          AS (Cantidad * PrecioUnitario * (1 - DescuentoPct/100)) PERSISTED,
    Notas             NVARCHAR(300)  NULL,
    CONSTRAINT FK_CID_Compra FOREIGN KEY (CompraInsumoId) REFERENCES dbo.CompraInsumo(CompraInsumoId) ON DELETE CASCADE,
    CONSTRAINT FK_CID_Insumo FOREIGN KEY (InsumoId)      REFERENCES dbo.Insumo(InsumoId)
);

-- Movimientos de stock de insumos (trazabilidad COMPLETA por insumo)
CREATE TABLE dbo.MovimientoStockInsumo (
    MovimientoId      BIGINT IDENTITY(1,1) CONSTRAINT PK_MovStock PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    InsumoId          INT            NOT NULL,
    Fecha             DATETIME2(0)   NOT NULL CONSTRAINT DF_MovStk_Fecha DEFAULT SYSUTCDATETIME(),
    TipoMovimiento    VARCHAR(20)    NOT NULL, -- ENTRADA_COMPRA | SALIDA_APLICACION | AJUSTE | TRANSFERENCIA | MERMA
    Cantidad          DECIMAL(18,4)  NOT NULL, -- positivo si entrada, negativo si salida
    SaldoResultante   DECIMAL(18,4)  NOT NULL, -- saldo posterior al movimiento (cache)
    ReferenciaTipo    VARCHAR(30)    NULL,     -- COMPRA, OT, AJUSTE_MANUAL
    ReferenciaId      BIGINT         NULL,
    LoteId            INT            NULL,     -- donde se aplicó
    CampanaId         INT            NULL,
    Notas             NVARCHAR(500)  NULL,
    CreatedBy         INT            NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_MovStk_Created DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_MovStk_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_MovStk_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_MovStk_Insumo  FOREIGN KEY (InsumoId)  REFERENCES dbo.Insumo(InsumoId),
    CONSTRAINT FK_MovStk_Lote    FOREIGN KEY (LoteId)    REFERENCES dbo.Lote(LoteId),
    CONSTRAINT FK_MovStk_Campana FOREIGN KEY (CampanaId) REFERENCES dbo.Campana(CampanaId)
);
CREATE INDEX IX_MovStk_Insumo ON dbo.MovimientoStockInsumo(InsumoId, Fecha DESC);
CREATE INDEX IX_MovStk_Campana ON dbo.MovimientoStockInsumo(CampanaId);

-- Orden de Trabajo (OT) — la pieza clave para campo
CREATE TABLE dbo.OrdenTrabajo (
    OrdenTrabajoId    INT IDENTITY(1,1) CONSTRAINT PK_OT PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    NroOt             VARCHAR(30)    NOT NULL,
    CampanaId         INT            NULL,
    LoteId            INT            NOT NULL,
    TipoLabor         VARCHAR(30)    NOT NULL, -- SIEMBRA, PULVERIZACION, FERTILIZACION, COSECHA, RIEGO, OTRO
    FechaPlan         DATE           NULL,
    FechaInicio       DATETIME2(0)   NULL,
    FechaFin          DATETIME2(0)   NULL,
    MaquinariaId      INT            NULL,
    OperarioUsuarioId INT            NULL, -- empleado usuario del sistema
    OperarioNombre    NVARCHAR(200)  NULL, -- si no es usuario registrado
    HaTrabajadas      DECIMAL(10,2)  NULL,
    HorasMaquina      DECIMAL(8,2)   NULL,
    CondicionClima    NVARCHAR(200)  NULL, -- lluvia, viento, temperatura...
    Estado            VARCHAR(20)    NOT NULL CONSTRAINT DF_OT_Estado DEFAULT 'PLANIFICADA',
                                     -- PLANIFICADA|EN_CURSO|COMPLETADA|CANCELADA
    Observaciones     NVARCHAR(MAX)  NULL,
    FirmaOperario     VARBINARY(MAX) NULL, -- PNG base64 decoded
    DeletedAt         DATETIME2(0)   NULL,
    CreatedBy         INT            NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_OT_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_OT_Updated DEFAULT SYSUTCDATETIME(),
    UpdatedBy         INT            NULL,
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_OT_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT UK_OT_Nro UNIQUE (EmpresaId, NroOt),
    CONSTRAINT FK_OT_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_OT_Campana FOREIGN KEY (CampanaId) REFERENCES dbo.Campana(CampanaId),
    CONSTRAINT FK_OT_Lote    FOREIGN KEY (LoteId)    REFERENCES dbo.Lote(LoteId),
    CONSTRAINT FK_OT_Maq     FOREIGN KEY (MaquinariaId) REFERENCES dbo.Maquinaria(MaquinariaId),
    CONSTRAINT FK_OT_Op      FOREIGN KEY (OperarioUsuarioId) REFERENCES dbo.Usuario(UsuarioId)
);
CREATE INDEX IX_OT_Empresa ON dbo.OrdenTrabajo(EmpresaId, Estado, FechaPlan);
CREATE INDEX IX_OT_Lote    ON dbo.OrdenTrabajo(LoteId, FechaPlan DESC);

-- Insumos planificados vs aplicados en cada OT
CREATE TABLE dbo.OrdenTrabajoInsumo (
    OtInsumoId        INT IDENTITY(1,1) CONSTRAINT PK_OTInsumo PRIMARY KEY,
    OrdenTrabajoId    INT            NOT NULL,
    InsumoId          INT            NOT NULL,
    CantidadPlan      DECIMAL(18,4)  NULL,
    CantidadReal      DECIMAL(18,4)  NULL,
    DosisHaPlan       DECIMAL(18,4)  NULL,
    DosisHaReal       DECIMAL(18,4)  NULL,
    Notas             NVARCHAR(300)  NULL,
    CONSTRAINT FK_OTIns_OT     FOREIGN KEY (OrdenTrabajoId) REFERENCES dbo.OrdenTrabajo(OrdenTrabajoId) ON DELETE CASCADE,
    CONSTRAINT FK_OTIns_Insumo FOREIGN KEY (InsumoId)       REFERENCES dbo.Insumo(InsumoId)
);

-- Costos por OT (mano obra, combustible extra, etc)
CREATE TABLE dbo.OrdenTrabajoCosto (
    OtCostoId         INT IDENTITY(1,1) CONSTRAINT PK_OTCosto PRIMARY KEY,
    OrdenTrabajoId    INT            NOT NULL,
    Concepto          NVARCHAR(200)  NOT NULL,
    Moneda            CHAR(3)        NOT NULL CONSTRAINT DF_OTC_Moneda DEFAULT 'ARS',
    Monto             DECIMAL(18,4)  NOT NULL,
    TipoCambio        DECIMAL(18,4)  NULL,
    CONSTRAINT FK_OTC_OT FOREIGN KEY (OrdenTrabajoId) REFERENCES dbo.OrdenTrabajo(OrdenTrabajoId) ON DELETE CASCADE
);


/* ============================================================================
   5. STOCK — Granos y Hacienda
   ============================================================================ */

CREATE TABLE dbo.Silo (
    SiloId            INT IDENTITY(1,1) CONSTRAINT PK_Silo PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Nombre            NVARCHAR(100)  NOT NULL,
    Tipo              VARCHAR(20)    NOT NULL CONSTRAINT DF_Silo_Tipo DEFAULT 'SILO', -- SILO, SILOBOLSA, GALPON
    CapacidadTn       DECIMAL(10,2)  NULL,
    CampoId           INT            NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Silo_Activo DEFAULT 1,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Silo_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Silo_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_Silo_Campo   FOREIGN KEY (CampoId)   REFERENCES dbo.Campo(CampoId)
);

CREATE TABLE dbo.StockGrano (
    StockGranoId      INT IDENTITY(1,1) CONSTRAINT PK_StockGrano PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    CultivoId         INT            NOT NULL,
    SiloId            INT            NULL,
    KgInicial         DECIMAL(18,2)  NOT NULL CONSTRAINT DF_StkG_Ini DEFAULT 0,
    KgEntradas        DECIMAL(18,2)  NOT NULL CONSTRAINT DF_StkG_In  DEFAULT 0,
    KgSalidas         DECIMAL(18,2)  NOT NULL CONSTRAINT DF_StkG_Out DEFAULT 0,
    KgDisponible      AS (KgInicial + KgEntradas - KgSalidas) PERSISTED,
    FechaCorte        DATE           NOT NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_StkG_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_StkG_Updated DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_StkG_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_StkG_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_StkG_Cultivo FOREIGN KEY (CultivoId) REFERENCES dbo.Cultivo(CultivoId),
    CONSTRAINT FK_StkG_Silo    FOREIGN KEY (SiloId)    REFERENCES dbo.Silo(SiloId)
);

CREATE TABLE dbo.MovimientoGrano (
    MovGranoId        BIGINT IDENTITY(1,1) CONSTRAINT PK_MovGrano PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    CultivoId         INT            NOT NULL,
    SiloId            INT            NULL,
    Fecha             DATE           NOT NULL,
    TipoMovimiento    VARCHAR(20)    NOT NULL, -- COSECHA | VENTA | TRANSFERENCIA | AJUSTE | MERMA
    Kilos             DECIMAL(18,2)  NOT NULL, -- positivo entrada, negativo salida
    ReferenciaTipo    VARCHAR(30)    NULL,     -- CAMPANA|VENTA|AJUSTE
    ReferenciaId      BIGINT         NULL,
    Cpe               VARCHAR(30)    NULL,     -- Carta de Porte Electrónica
    Notas             NVARCHAR(300)  NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_MovG_Created DEFAULT SYSUTCDATETIME(),
    CreatedBy         INT            NULL,
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_MovG_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_MovG_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);
CREATE INDEX IX_MovG_Empresa ON dbo.MovimientoGrano(EmpresaId, CultivoId, Fecha DESC);

-- Hacienda
CREATE TABLE dbo.Hacienda (
    HaciendaId        INT IDENTITY(1,1) CONSTRAINT PK_Hacienda PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Especie           VARCHAR(20)    NOT NULL, -- BOVINO, PORCINO, OVINO, CAPRINO, EQUINO
    Categoria         VARCHAR(40)    NOT NULL, -- VACA, TERNERO, TORO, LECHON, CORDERO...
    StockTeorico      INT            NOT NULL CONSTRAINT DF_Hac_Stk DEFAULT 0,
    StockReal         INT            NOT NULL CONSTRAINT DF_Hac_StkR DEFAULT 0,
    Renspa            VARCHAR(30)    NULL,
    Notas             NVARCHAR(500)  NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Hac_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Hac_Updated DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Hac_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Hac_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);

CREATE TABLE dbo.MovimientoHacienda (
    MovHacId          BIGINT IDENTITY(1,1) CONSTRAINT PK_MovHac PRIMARY KEY,
    HaciendaId        INT            NOT NULL,
    Fecha             DATE           NOT NULL,
    TipoMovimiento    VARCHAR(20)    NOT NULL, -- ALTA, BAJA, VENTA, COMPRA, MUERTE, TRASLADO
    Cantidad          INT            NOT NULL,
    ReferenciaTipo    VARCHAR(30)    NULL,
    ReferenciaId      BIGINT         NULL,
    Notas             NVARCHAR(300)  NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_MovH_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_MovH_Hac FOREIGN KEY (HaciendaId) REFERENCES dbo.Hacienda(HaciendaId)
);


/* ============================================================================
   6. VENTAS — Granos, Hacienda, PyME
   ============================================================================ */

CREATE TABLE dbo.VentaGrano (
    VentaGranoId      INT IDENTITY(1,1) CONSTRAINT PK_VtaG PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    ClienteId         INT            NULL,
    CultivoId         INT            NOT NULL,
    Fecha             DATE           NOT NULL,
    CargaCamion       NVARCHAR(60)   NULL,
    KilosDescarga     DECIMAL(18,2)  NOT NULL,
    KilosDescuento    DECIMAL(18,2)  NOT NULL CONSTRAINT DF_VtaG_Desc DEFAULT 0,
    KilosTotales      AS (KilosDescarga - KilosDescuento) PERSISTED,
    PizarraDia        DECIMAL(10,2)  NOT NULL,
    DescuentoPizarra  DECIMAL(10,2)  NOT NULL CONSTRAINT DF_VtaG_DescPiz DEFAULT 0,
    PrecioNeto        AS (PizarraDia - DescuentoPizarra) PERSISTED,
    Importe           AS ((KilosDescarga - KilosDescuento) * (PizarraDia - DescuentoPizarra)) PERSISTED,
    CostoFlete        DECIMAL(18,4)  NULL,
    CostoComisiones   DECIMAL(18,4)  NULL,
    Moneda            CHAR(3)        NOT NULL CONSTRAINT DF_VtaG_Moneda DEFAULT 'ARS',
    MedioPago         NVARCHAR(100)  NULL,
    Cpe               VARCHAR(30)    NULL,
    Estado            VARCHAR(20)    NOT NULL CONSTRAINT DF_VtaG_Estado DEFAULT 'CONFIRMADA',
    Notas             NVARCHAR(MAX)  NULL,
    DeletedAt         DATETIME2(0)   NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_VtaG_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_VtaG_Updated DEFAULT SYSUTCDATETIME(),
    UpdatedBy         INT            NULL,
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_VtaG_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_VtaG_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_VtaG_Cliente FOREIGN KEY (ClienteId) REFERENCES dbo.Cliente(ClienteId),
    CONSTRAINT FK_VtaG_Cultivo FOREIGN KEY (CultivoId) REFERENCES dbo.Cultivo(CultivoId)
);
CREATE INDEX IX_VtaG_Empresa ON dbo.VentaGrano(EmpresaId, Fecha DESC);

CREATE TABLE dbo.VentaHacienda (
    VentaHaciendaId   INT IDENTITY(1,1) CONSTRAINT PK_VtaH PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    ClienteId         INT            NULL,
    HaciendaId        INT            NULL,
    Fecha             DATE           NOT NULL,
    Categoria         VARCHAR(40)    NOT NULL,
    Cabezas           INT            NULL,
    KilosBruto        DECIMAL(18,2)  NULL,
    KilosTara         DECIMAL(18,2)  NULL,
    KilosNeto         AS (ISNULL(KilosBruto,0) - ISNULL(KilosTara,0)) PERSISTED,
    DesvastePct       DECIMAL(6,4)   NULL, -- 0.08 = 8%
    KilosDesvaste     AS ((ISNULL(KilosBruto,0) - ISNULL(KilosTara,0)) * ISNULL(DesvastePct,0)) PERSISTED,
    KilosTotales      AS ((ISNULL(KilosBruto,0) - ISNULL(KilosTara,0)) * (1 - ISNULL(DesvastePct,0))) PERSISTED,
    Precio            DECIMAL(18,4)  NULL,
    Importe           AS (((ISNULL(KilosBruto,0) - ISNULL(KilosTara,0)) * (1 - ISNULL(DesvastePct,0))) * ISNULL(Precio,0)) PERSISTED,
    MedioPago         NVARCHAR(100)  NULL,
    Notas             NVARCHAR(MAX)  NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_VtaH_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_VtaH_Updated DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_VtaH_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_VtaH_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_VtaH_Cliente FOREIGN KEY (ClienteId) REFERENCES dbo.Cliente(ClienteId),
    CONSTRAINT FK_VtaH_Hac     FOREIGN KEY (HaciendaId) REFERENCES dbo.Hacienda(HaciendaId)
);
CREATE INDEX IX_VtaH_Empresa ON dbo.VentaHacienda(EmpresaId, Fecha DESC);

CREATE TABLE dbo.VentaPyme (
    VentaPymeId       INT IDENTITY(1,1) CONSTRAINT PK_VtaP PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Fecha             DATE           NOT NULL,
    Tipo              VARCHAR(30)    NOT NULL, -- Lechón, Cordero, Chivito, Pollo...
    Kilos             DECIMAL(10,2)  NOT NULL,
    PrecioKg          DECIMAL(18,4)  NOT NULL,
    Importe           AS (Kilos * PrecioKg) PERSISTED,
    Estado            VARCHAR(20)    NOT NULL CONSTRAINT DF_VtaP_Estado DEFAULT 'PENDIENTE', -- PENDIENTE|PAGADA
    EntregadoA        NVARCHAR(200)  NULL,
    Notas             NVARCHAR(500)  NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_VtaP_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_VtaP_Updated DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_VtaP_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_VtaP_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);


/* ============================================================================
   7. FINANZAS — Flujo de caja, Cheques, Cuentas corrientes, Efectivo, Arrendamientos
   ============================================================================ */

CREATE TABLE dbo.MovimientoCaja (
    MovCajaId         INT IDENTITY(1,1) CONSTRAINT PK_MovCaja PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Fecha             DATE           NOT NULL,
    Periodo           VARCHAR(7)     NOT NULL, -- MM/AA (para compatibilidad con el Excel)
    TipoMovimiento    VARCHAR(10)    NOT NULL, -- INGRESO | EGRESO
    CategoriaCodigo   VARCHAR(40)    NOT NULL, -- GRANOS, HACIENDA, EMPLEADOS, PROVEEDORES, ...
    Concepto          NVARCHAR(200)  NULL,
    Moneda            CHAR(3)        NOT NULL CONSTRAINT DF_MovC_Moneda DEFAULT 'ARS',
    Monto             DECIMAL(18,4)  NOT NULL,
    TipoCambio        DECIMAL(18,4)  NULL,
    MontoUsd          DECIMAL(18,4)  NULL,
    MedioPago         VARCHAR(30)    NULL, -- EFECTIVO|TRANSFER|CHEQUE|DEBITO|CREDITO
    ReferenciaTipo    VARCHAR(30)    NULL,
    ReferenciaId      BIGINT         NULL,
    Notas             NVARCHAR(MAX)  NULL,
    DeletedAt         DATETIME2(0)   NULL,
    CreatedBy         INT            NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_MovC_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_MovC_Updated DEFAULT SYSUTCDATETIME(),
    UpdatedBy         INT            NULL,
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_MovC_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_MovC_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);
CREATE INDEX IX_MovC_Empresa ON dbo.MovimientoCaja(EmpresaId, Fecha DESC);
CREATE INDEX IX_MovC_Periodo ON dbo.MovimientoCaja(EmpresaId, Periodo);

CREATE TABLE dbo.Cheque (
    ChequeId          INT IDENTITY(1,1) CONSTRAINT PK_Cheque PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Banco             NVARCHAR(100)  NOT NULL,
    Numero            VARCHAR(40)    NOT NULL,
    Tipo              VARCHAR(20)    NOT NULL, -- FISICO | ECHEQ
    TitularNombre     NVARCHAR(200)  NOT NULL,
    TitularCuit       VARCHAR(13)    NULL,
    FechaRecepcion    DATE           NULL,
    FechaEntrega      DATE           NULL,
    FechaPago         DATE           NULL,
    Monto             DECIMAL(18,4)  NOT NULL,
    Moneda            CHAR(3)        NOT NULL CONSTRAINT DF_Cheque_Moneda DEFAULT 'ARS',
    Origen            NVARCHAR(200)  NULL,
    Destino           NVARCHAR(200)  NULL,
    ClasificaCartera  VARCHAR(20)    NOT NULL CONSTRAINT DF_Cheque_Clase DEFAULT 'PROPIO', -- PROPIO | TERCERO
    Estado            VARCHAR(20)    NOT NULL CONSTRAINT DF_Cheque_Estado DEFAULT 'EN_CARTERA',
                                        -- EN_CARTERA | DEPOSITADO | ENTREGADO | RECHAZADO | COBRADO | ANULADO
    QuienLoRecibe     NVARCHAR(100)  NULL,
    Notas             NVARCHAR(MAX)  NULL,
    DeletedAt         DATETIME2(0)   NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Cheque_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Cheque_Updated DEFAULT SYSUTCDATETIME(),
    UpdatedBy         INT            NULL,
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Cheque_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Cheque_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);
CREATE INDEX IX_Cheque_Empresa ON dbo.Cheque(EmpresaId, Estado, FechaPago);

CREATE TABLE dbo.CuentaCorriente (
    CuentaId          INT IDENTITY(1,1) CONSTRAINT PK_Cuenta PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    ClienteId         INT            NULL,
    ProveedorId       INT            NULL,
    Tipo              VARCHAR(10)    NOT NULL, -- CLIENTE | PROVEEDOR
    Nombre            NVARCHAR(200)  NOT NULL, -- denorm para búsqueda
    Saldo             DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Cta_Saldo DEFAULT 0,
    Moneda            CHAR(3)        NOT NULL CONSTRAINT DF_Cta_Moneda DEFAULT 'ARS',
    MedioPagoPref     NVARCHAR(50)   NULL,
    Prioridad         VARCHAR(10)    NOT NULL CONSTRAINT DF_Cta_Prio DEFAULT 'MEDIA', -- ALTA|MEDIA|BAJA
    Estado            VARCHAR(20)    NOT NULL CONSTRAINT DF_Cta_Estado DEFAULT 'PENDIENTE',
    FechaSolicitud    DATE           NULL,
    Observaciones     NVARCHAR(MAX)  NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Cta_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Cta_Updated DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Cta_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Cta_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_Cta_Cli     FOREIGN KEY (ClienteId) REFERENCES dbo.Cliente(ClienteId),
    CONSTRAINT FK_Cta_Prov    FOREIGN KEY (ProveedorId) REFERENCES dbo.Proveedor(ProveedorId)
);

CREATE TABLE dbo.CuentaMovimiento (
    CuentaMovId       BIGINT IDENTITY(1,1) CONSTRAINT PK_CtaMov PRIMARY KEY,
    CuentaId          INT            NOT NULL,
    Fecha             DATE           NOT NULL,
    TipoMov           VARCHAR(15)    NOT NULL, -- DEBE | HABER
    Concepto          NVARCHAR(200)  NOT NULL,
    Monto             DECIMAL(18,4)  NOT NULL,
    ReferenciaTipo    VARCHAR(30)    NULL,
    ReferenciaId      BIGINT         NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_CtaMov_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_CtaMov_Cuenta FOREIGN KEY (CuentaId) REFERENCES dbo.CuentaCorriente(CuentaId) ON DELETE CASCADE
);

CREATE TABLE dbo.MovimientoEfectivo (
    MovEfectivoId     INT IDENTITY(1,1) CONSTRAINT PK_MovEf PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Fecha             DATE           NOT NULL,
    Ingreso           DECIMAL(18,4)  NOT NULL CONSTRAINT DF_MovEf_In DEFAULT 0,
    Egreso            DECIMAL(18,4)  NOT NULL CONSTRAINT DF_MovEf_Out DEFAULT 0,
    RecibidoPor       NVARCHAR(150)  NULL,
    EntregadoA        NVARCHAR(150)  NULL,
    Concepto          NVARCHAR(300)  NULL,
    CajaId            VARCHAR(30)    NULL, -- varias cajas (oficina, campo...)
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_MovEf_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_MovEf_Updated DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_MovEf_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_MovEf_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);

CREATE TABLE dbo.ContratoArrendamiento (
    ContratoId        INT IDENTITY(1,1) CONSTRAINT PK_Contrato PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    CampoId           INT            NULL,   -- puede ser por varios lotes
    PropietarioNombre NVARCHAR(200)  NOT NULL,
    PropietarioCuit   VARCHAR(13)    NULL,
    FechaInicio       DATE           NOT NULL,
    FechaFin          DATE           NULL,
    FormaPago         VARCHAR(30)    NOT NULL, -- QQ_SOJA, USD, ARS, MIXTO
    QqSojaAnuales     DECIMAL(10,2)  NULL,
    ImporteAnualUsd   DECIMAL(18,4)  NULL,
    Observaciones     NVARCHAR(MAX)  NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_Cont_Activo DEFAULT 1,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Cont_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Cont_Updated DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Cont_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Cont_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_Cont_Campo   FOREIGN KEY (CampoId)   REFERENCES dbo.Campo(CampoId)
);

CREATE TABLE dbo.MovimientoArrendamiento (
    MovArrId          INT IDENTITY(1,1) CONSTRAINT PK_MovArr PRIMARY KEY,
    ContratoId        INT            NOT NULL,
    Fecha             DATE           NOT NULL,
    Concepto          NVARCHAR(200)  NOT NULL,
    Kilos             DECIMAL(18,2)  NULL,
    PromedioSoja      DECIMAL(18,4)  NULL,
    Pagos             DECIMAL(18,4)  NOT NULL CONSTRAINT DF_MovArr_Pagos DEFAULT 0,
    Saldo             DECIMAL(18,4)  NOT NULL CONSTRAINT DF_MovArr_Saldo DEFAULT 0,
    MedioPago         NVARCHAR(60)   NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_MovArr_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_MovArr_Contrato FOREIGN KEY (ContratoId) REFERENCES dbo.ContratoArrendamiento(ContratoId) ON DELETE CASCADE
);


/* ============================================================================
   8. RRHH Y LOGÍSTICA — Empleados, Sueldos, Viajes
   ============================================================================ */

CREATE TABLE dbo.Empleado (
    EmpleadoId        INT IDENTITY(1,1) CONSTRAINT PK_Empleado PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    UsuarioId         INT            NULL,
    Nombre            NVARCHAR(200)  NOT NULL,
    Cuil              VARCHAR(13)    NULL,
    Puesto            NVARCHAR(100)  NULL,
    FechaIngreso      DATE           NULL,
    FechaEgreso       DATE           NULL,
    SueldoBase        DECIMAL(18,4)  NULL,
    DiasLaborablesMes INT            NOT NULL CONSTRAINT DF_Emp_Dias DEFAULT 22,
    Activo            BIT            NOT NULL CONSTRAINT DF_Emp_Activo DEFAULT 1,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Emp_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Emp_Updated DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Emp_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Emp_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_Emp_Usuario FOREIGN KEY (UsuarioId) REFERENCES dbo.Usuario(UsuarioId)
);

CREATE TABLE dbo.Liquidacion (
    LiquidacionId     INT IDENTITY(1,1) CONSTRAINT PK_Liq PRIMARY KEY,
    EmpleadoId        INT            NOT NULL,
    Periodo           VARCHAR(7)     NOT NULL, -- MM/AA
    DiasTrabajados    INT            NOT NULL,
    DiasNoTrabajados  INT            NOT NULL CONSTRAINT DF_Liq_DiasNo DEFAULT 0,
    Adelantos         DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Liq_Adel DEFAULT 0,
    Extras            DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Liq_Extras DEFAULT 0,
    Descuentos        DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Liq_Desc DEFAULT 0,
    TotalACobrar      DECIMAL(18,4)  NOT NULL,
    Estado            VARCHAR(20)    NOT NULL CONSTRAINT DF_Liq_Estado DEFAULT 'BORRADOR',
    FechaPago         DATE           NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Liq_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UK_Liq UNIQUE (EmpleadoId, Periodo),
    CONSTRAINT FK_Liq_Empleado FOREIGN KEY (EmpleadoId) REFERENCES dbo.Empleado(EmpleadoId)
);

CREATE TABLE dbo.ViajeCamion (
    ViajeId           INT IDENTITY(1,1) CONSTRAINT PK_Viaje PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    MaquinariaId      INT            NULL, -- el camión
    ChoferUsuarioId   INT            NULL,
    FechaInicio       DATE           NOT NULL,
    FechaFin          DATE           NULL,
    Origen            NVARCHAR(200)  NULL,
    Destino           NVARCHAR(200)  NULL,
    Transporta        NVARCHAR(100)  NULL,
    Cpe               VARCHAR(30)    NULL,
    Ctg               VARCHAR(30)    NULL,
    NumeroCdp         VARCHAR(30)    NULL,
    KmInicio          DECIMAL(12,2)  NULL,
    KmFin             DECIMAL(12,2)  NULL,
    KmRecorridos      AS (ISNULL(KmFin,0) - ISNULL(KmInicio,0)) PERSISTED,
    GastoCombustible  DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Viaje_Comb DEFAULT 0,
    GastoPeajes       DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Viaje_Peaj DEFAULT 0,
    GastoComida       DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Viaje_Com  DEFAULT 0,
    GastoVarios       DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Viaje_Var  DEFAULT 0,
    GastosTotales     AS (GastoCombustible + GastoPeajes + GastoComida + GastoVarios) PERSISTED,
    Transferencias    DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Viaje_Tr DEFAULT 0,
    EfectivoEntregado DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Viaje_Efe DEFAULT 0,
    SobranteAnterior  DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Viaje_Sob DEFAULT 0,
    KgDescarga        DECIMAL(18,2)  NULL,
    Observaciones     NVARCHAR(MAX)  NULL,
    Estado            VARCHAR(20)    NOT NULL CONSTRAINT DF_Viaje_Estado DEFAULT 'EN_CURSO',
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Viaje_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Viaje_Updated DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Viaje_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT FK_Viaje_Empresa FOREIGN KEY (EmpresaId)    REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_Viaje_Maq     FOREIGN KEY (MaquinariaId) REFERENCES dbo.Maquinaria(MaquinariaId),
    CONSTRAINT FK_Viaje_Chof    FOREIGN KEY (ChoferUsuarioId) REFERENCES dbo.Usuario(UsuarioId)
);


/* ============================================================================
   9. FACTURACIÓN ELECTRÓNICA ARCA (ex AFIP)
   ============================================================================ */

CREATE TABLE dbo.PuntoVenta (
    PuntoVentaId      INT IDENTITY(1,1) CONSTRAINT PK_PtoVta PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Numero            INT            NOT NULL,
    Nombre            NVARCHAR(100)  NULL,
    Activo            BIT            NOT NULL CONSTRAINT DF_PVta_Activo DEFAULT 1,
    CONSTRAINT UK_PVta UNIQUE (EmpresaId, Numero),
    CONSTRAINT FK_PVta_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);

CREATE TABLE dbo.ComprobanteTipo (
    TipoCbteId        INT            NOT NULL CONSTRAINT PK_CbteTipo PRIMARY KEY, -- código AFIP (1=FA, 6=FB, 11=FC, 201=FCEA, 6=NC, 7=ND...)
    Letra             CHAR(1)        NOT NULL,
    Nombre            NVARCHAR(80)   NOT NULL
);

CREATE TABLE dbo.Comprobante (
    ComprobanteId     INT IDENTITY(1,1) CONSTRAINT PK_Cbte PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    PuntoVentaId      INT            NOT NULL,
    TipoCbteId        INT            NOT NULL,
    Numero            BIGINT         NOT NULL,
    FechaEmision      DATE           NOT NULL,
    ClienteId         INT            NULL,
    DocTipo           VARCHAR(10)    NULL, -- CUIT, DNI, CUIL
    DocNumero         VARCHAR(15)    NULL,
    DenominacionReceptor NVARCHAR(300) NULL,
    CondicionIvaReceptor VARCHAR(20) NULL,
    Moneda            CHAR(3)        NOT NULL CONSTRAINT DF_Cbte_Moneda DEFAULT 'PES', -- código AFIP
    CotizacionMoneda  DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Cbte_Cotiz DEFAULT 1,
    ImporteNeto       DECIMAL(18,4)  NOT NULL,
    ImporteIva        DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Cbte_Iva DEFAULT 0,
    ImporteTributos   DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Cbte_Tri DEFAULT 0,
    ImporteNoGravado  DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Cbte_NG DEFAULT 0,
    ImporteExento     DECIMAL(18,4)  NOT NULL CONSTRAINT DF_Cbte_Ex DEFAULT 0,
    ImporteTotal      DECIMAL(18,4)  NOT NULL,
    -- Respuesta AFIP
    Cae               VARCHAR(20)    NULL,
    CaeFechaVto       DATE           NULL,
    Estado            VARCHAR(20)    NOT NULL CONSTRAINT DF_Cbte_Estado DEFAULT 'PENDIENTE',
                                        -- PENDIENTE | AUTORIZADO | RECHAZADO | ANULADO | OBSERVADO
    Observaciones     NVARCHAR(MAX)  NULL,
    -- request/response crudo para auditoría
    RequestXml        NVARCHAR(MAX)  NULL,
    ResponseXml       NVARCHAR(MAX)  NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Cbte_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Cbte_Updated DEFAULT SYSUTCDATETIME(),
    SyncUuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Cbte_Sync DEFAULT NEWSEQUENTIALID(),
    RowVersion        ROWVERSION     NOT NULL,
    CONSTRAINT UK_Cbte UNIQUE (EmpresaId, PuntoVentaId, TipoCbteId, Numero),
    CONSTRAINT FK_Cbte_Empresa FOREIGN KEY (EmpresaId)    REFERENCES dbo.Empresa(EmpresaId),
    CONSTRAINT FK_Cbte_PVta    FOREIGN KEY (PuntoVentaId) REFERENCES dbo.PuntoVenta(PuntoVentaId),
    CONSTRAINT FK_Cbte_Tipo    FOREIGN KEY (TipoCbteId)   REFERENCES dbo.ComprobanteTipo(TipoCbteId),
    CONSTRAINT FK_Cbte_Cli     FOREIGN KEY (ClienteId)    REFERENCES dbo.Cliente(ClienteId)
);
CREATE INDEX IX_Cbte_Empresa ON dbo.Comprobante(EmpresaId, FechaEmision DESC);

CREATE TABLE dbo.ComprobanteDetalle (
    ComprobanteDetalleId INT IDENTITY(1,1) CONSTRAINT PK_CbteDet PRIMARY KEY,
    ComprobanteId     INT            NOT NULL,
    Descripcion       NVARCHAR(300)  NOT NULL,
    Cantidad          DECIMAL(18,4)  NOT NULL,
    PrecioUnitario    DECIMAL(18,4)  NOT NULL,
    AlicuotaIva       DECIMAL(5,2)   NOT NULL CONSTRAINT DF_CbteDet_IVA DEFAULT 21,
    Subtotal          AS (Cantidad * PrecioUnitario) PERSISTED,
    CONSTRAINT FK_CbteDet_Cbte FOREIGN KEY (ComprobanteId) REFERENCES dbo.Comprobante(ComprobanteId) ON DELETE CASCADE
);


/* ============================================================================
   10. DOCUMENTOS Y ADJUNTOS (fotos, PDFs remitos/facturas)
   ============================================================================ */

CREATE TABLE dbo.Adjunto (
    AdjuntoId         INT IDENTITY(1,1) CONSTRAINT PK_Adj PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    EntidadTipo       VARCHAR(40)    NOT NULL, -- COMPRA_INSUMO, OT, VENTA_GRANO, CHEQUE, COMPROBANTE, ...
    EntidadId         BIGINT         NOT NULL,
    NombreArchivo     NVARCHAR(300)  NOT NULL,
    RutaStorage       NVARCHAR(500)  NOT NULL, -- ruta en filesystem del servidor
    MimeType          VARCHAR(100)   NOT NULL,
    TamanoBytes       BIGINT         NOT NULL,
    HashSha256        VARBINARY(32)  NULL,
    Descripcion       NVARCHAR(500)  NULL,
    UploadedBy        INT            NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_Adj_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Adj_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(EmpresaId)
);
CREATE INDEX IX_Adj_Entidad ON dbo.Adjunto(EntidadTipo, EntidadId);


/* ============================================================================
   11. SYNC — Control de sincronización offline-first
   ============================================================================ */

-- Registro de dispositivos (celulares/tablets) por usuario
CREATE TABLE dbo.SyncClient (
    SyncClientId      INT IDENTITY(1,1) CONSTRAINT PK_SyncClient PRIMARY KEY,
    UsuarioId         INT            NOT NULL,
    ClientUuid        UNIQUEIDENTIFIER NOT NULL, -- generado en el dispositivo
    DeviceName        NVARCHAR(200)  NULL,
    Plataforma        VARCHAR(40)    NULL, -- Android, iOS, Web
    AppVersion        VARCHAR(20)    NULL,
    UltimoPullAt      DATETIME2(0)   NULL,
    UltimoPushAt      DATETIME2(0)   NULL,
    LastRowVersion    BINARY(8)      NULL, -- puntero del último rowversion sincronizado
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_SyncClient_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UK_SyncClient UNIQUE (UsuarioId, ClientUuid),
    CONSTRAINT FK_SyncClient_Usuario FOREIGN KEY (UsuarioId) REFERENCES dbo.Usuario(UsuarioId) ON DELETE CASCADE
);

-- Outbox de eventos para sync (especialmente útil en conflictos y deletes)
CREATE TABLE dbo.SyncOutbox (
    SyncOutboxId      BIGINT IDENTITY(1,1) CONSTRAINT PK_SyncOut PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Entidad           VARCHAR(50)    NOT NULL,
    EntidadId         BIGINT         NOT NULL,
    Accion            VARCHAR(10)    NOT NULL, -- INSERT | UPDATE | DELETE
    Payload           NVARCHAR(MAX)  NULL,
    OcurridoAt        DATETIME2(0)   NOT NULL CONSTRAINT DF_SyncOut_At DEFAULT SYSUTCDATETIME(),
    RowVersion        ROWVERSION     NOT NULL
);
CREATE INDEX IX_SyncOut_Empresa ON dbo.SyncOutbox(EmpresaId, OcurridoAt);

-- Registro de conflictos (cuando 2 dispositivos editan la misma fila offline)
CREATE TABLE dbo.SyncConflict (
    SyncConflictId    BIGINT IDENTITY(1,1) CONSTRAINT PK_SyncConf PRIMARY KEY,
    EmpresaId         INT            NOT NULL,
    Entidad           VARCHAR(50)    NOT NULL,
    EntidadId         BIGINT         NOT NULL,
    ClienteUuidA      UNIQUEIDENTIFIER NULL,
    ClienteUuidB      UNIQUEIDENTIFIER NULL,
    PayloadCliente    NVARCHAR(MAX)  NULL,
    PayloadServidor   NVARCHAR(MAX)  NULL,
    Resolucion        VARCHAR(20)    NULL, -- SERVER_WINS | CLIENT_WINS | MERGED | MANUAL
    ResueltoPor       INT            NULL,
    ResueltoAt        DATETIME2(0)   NULL,
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_SyncConf_Created DEFAULT SYSUTCDATETIME()
);
GO


/* ============================================================================
   12. VISTAS DE REPORTES
   ============================================================================ */

CREATE OR ALTER VIEW dbo.vw_FlujoCajaMensual AS
SELECT EmpresaId,
       Periodo,
       SUM(CASE WHEN TipoMovimiento='INGRESO' THEN Monto ELSE 0 END) AS Ingresos,
       SUM(CASE WHEN TipoMovimiento='EGRESO'  THEN Monto ELSE 0 END) AS Egresos,
       SUM(CASE WHEN TipoMovimiento='INGRESO' THEN Monto ELSE -Monto END) AS FlujoNeto
FROM dbo.MovimientoCaja
WHERE DeletedAt IS NULL
GROUP BY EmpresaId, Periodo;
GO

CREATE OR ALTER VIEW dbo.vw_CostoCampana AS
SELECT c.CampanaId,
       c.EmpresaId,
       c.CultivoId,
       c.Ciclo,
       c.HaSembradas,
       ISNULL(ins.TotalUsd, 0) AS InsumosUsd,
       ISNULL(lab.TotalUsd, 0) AS LaboresUsd,
       ISNULL(ins.TotalUsd,0) + ISNULL(lab.TotalUsd,0) AS CostoTotalUsd,
       CASE WHEN c.HaSembradas > 0
            THEN (ISNULL(ins.TotalUsd,0) + ISNULL(lab.TotalUsd,0))/c.HaSembradas
            ELSE NULL END AS CostoUsdHa
FROM dbo.Campana c
LEFT JOIN (
    SELECT ot.CampanaId,
           SUM(oti.CantidadReal * ISNULL(i.PrecioPromUsd,0)) AS TotalUsd
    FROM dbo.OrdenTrabajo ot
    JOIN dbo.OrdenTrabajoInsumo oti ON oti.OrdenTrabajoId = ot.OrdenTrabajoId
    JOIN dbo.Insumo i ON i.InsumoId = oti.InsumoId
    WHERE ot.Estado = 'COMPLETADA'
    GROUP BY ot.CampanaId
) ins ON ins.CampanaId = c.CampanaId
LEFT JOIN (
    SELECT ot.CampanaId,
           SUM(CASE WHEN otc.Moneda='USD' THEN otc.Monto ELSE otc.Monto/ISNULL(otc.TipoCambio,1) END) AS TotalUsd
    FROM dbo.OrdenTrabajo ot
    JOIN dbo.OrdenTrabajoCosto otc ON otc.OrdenTrabajoId = ot.OrdenTrabajoId
    GROUP BY ot.CampanaId
) lab ON lab.CampanaId = c.CampanaId;
GO

CREATE OR ALTER VIEW dbo.vw_MargenBruto AS
SELECT c.CampanaId, c.EmpresaId,
       c.HaSembradas,
       cm.CostoTotalUsd,
       ISNULL(vg.IngresoUsd, 0) AS IngresoUsd,
       ISNULL(vg.IngresoUsd,0) - ISNULL(cm.CostoTotalUsd,0) AS MargenBrutoUsd,
       CASE WHEN c.HaSembradas>0
            THEN (ISNULL(vg.IngresoUsd,0) - ISNULL(cm.CostoTotalUsd,0)) / c.HaSembradas
            ELSE NULL END AS MargenUsdHa
FROM dbo.Campana c
LEFT JOIN dbo.vw_CostoCampana cm ON cm.CampanaId = c.CampanaId
LEFT JOIN (
    SELECT v.CultivoId, v.EmpresaId,
           SUM(CASE WHEN v.Moneda='USD' THEN v.Importe ELSE v.Importe / NULLIF((SELECT TOP 1 CotizacionOficial FROM dbo.TipoCambio tc WHERE tc.Fecha <= v.Fecha ORDER BY tc.Fecha DESC),0) END) AS IngresoUsd
    FROM dbo.VentaGrano v
    WHERE v.DeletedAt IS NULL
    GROUP BY v.CultivoId, v.EmpresaId
) vg ON vg.CultivoId = c.CultivoId AND vg.EmpresaId = c.EmpresaId;
GO

CREATE OR ALTER VIEW dbo.vw_StockInsumoBajo AS
SELECT EmpresaId, InsumoId, Nombre, Tipo, UnidadMedida, StockActual, StockMinimo,
       CAST(StockActual / NULLIF(StockMinimo,0) AS DECIMAL(10,2)) AS RatioStock
FROM dbo.Insumo
WHERE Activo = 1 AND StockActual <= StockMinimo;
GO


/* ============================================================================
   13. TRIGGERS DE CONSISTENCIA
   ============================================================================ */

-- Trigger: al insertar movimiento de insumo, actualiza el stock
CREATE OR ALTER TRIGGER tr_MovStockInsumo_AfterInsert
ON dbo.MovimientoStockInsumo
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE i
    SET StockActual = i.StockActual + ins.Cantidad,
        UpdatedAt   = SYSUTCDATETIME()
    FROM dbo.Insumo i
    JOIN inserted ins ON ins.InsumoId = i.InsumoId;
END;
GO

-- Trigger: al insertar detalle de compra, crea movimiento de entrada de stock
CREATE OR ALTER TRIGGER tr_CompraInsumoDetalle_AfterInsert
ON dbo.CompraInsumoDetalle
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.MovimientoStockInsumo (EmpresaId, InsumoId, TipoMovimiento, Cantidad, SaldoResultante, ReferenciaTipo, ReferenciaId, Notas)
    SELECT ci.EmpresaId, d.InsumoId, 'ENTRADA_COMPRA', d.Cantidad,
           (SELECT StockActual FROM dbo.Insumo WHERE InsumoId = d.InsumoId) + d.Cantidad,
           'COMPRA', ci.CompraInsumoId,
           N'Entrada por compra #' + CAST(ci.CompraInsumoId AS NVARCHAR(10))
    FROM inserted d
    JOIN dbo.CompraInsumo ci ON ci.CompraInsumoId = d.CompraInsumoId;
END;
GO

-- Trigger: al completar una OT con insumos, genera salidas de stock
CREATE OR ALTER TRIGGER tr_OrdenTrabajo_AfterUpdate_StockOut
ON dbo.OrdenTrabajo
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF UPDATE(Estado)
    BEGIN
        INSERT INTO dbo.MovimientoStockInsumo (EmpresaId, InsumoId, TipoMovimiento, Cantidad, SaldoResultante, ReferenciaTipo, ReferenciaId, LoteId, CampanaId, Notas)
        SELECT i.EmpresaId, oti.InsumoId, 'SALIDA_APLICACION', -oti.CantidadReal,
               (SELECT StockActual FROM dbo.Insumo WHERE InsumoId = oti.InsumoId) - oti.CantidadReal,
               'OT', i.OrdenTrabajoId, i.LoteId, i.CampanaId,
               N'Aplicado en OT #' + i.NroOt
        FROM inserted i
        JOIN deleted d ON d.OrdenTrabajoId = i.OrdenTrabajoId
        JOIN dbo.OrdenTrabajoInsumo oti ON oti.OrdenTrabajoId = i.OrdenTrabajoId
        WHERE i.Estado = 'COMPLETADA' AND d.Estado <> 'COMPLETADA' AND oti.CantidadReal IS NOT NULL;
    END
END;
GO


/* ============================================================================
   14. STORED PROCEDURES para sync
   ============================================================================ */

-- PULL: devuelve cambios posteriores a un rowversion para las empresas del usuario
CREATE OR ALTER PROCEDURE dbo.sp_Sync_Pull
    @UsuarioId INT,
    @LastRowVersion BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @LastRowVersion IS NULL SET @LastRowVersion = 0x0000000000000000;

    ;WITH empresas AS (
        SELECT DISTINCT EmpresaId FROM dbo.UsuarioEmpresaRol WHERE UsuarioId = @UsuarioId
    )
    SELECT 'Campo' AS Entidad, c.* FROM dbo.Campo c
     JOIN empresas e ON e.EmpresaId = c.EmpresaId
     WHERE c.RowVersion > @LastRowVersion;

    SELECT 'Lote' AS Entidad, l.* FROM dbo.Lote l
     JOIN dbo.Campo c ON c.CampoId = l.CampoId
     JOIN (SELECT DISTINCT EmpresaId FROM dbo.UsuarioEmpresaRol WHERE UsuarioId=@UsuarioId) e ON e.EmpresaId = c.EmpresaId
     WHERE l.RowVersion > @LastRowVersion;

    -- ... repetir por cada entidad sincronizable (omitted for brevity)

    -- devolvemos también el nuevo puntero
    SELECT @@DBTS AS ServerRowVersion;
END;
GO


/* ============================================================================
   15. ÍNDICES ADICIONALES DE RENDIMIENTO
   ============================================================================ */
CREATE INDEX IX_MovStk_Sync ON dbo.MovimientoStockInsumo(RowVersion);
CREATE INDEX IX_MovCaja_Sync ON dbo.MovimientoCaja(RowVersion);
CREATE INDEX IX_OT_Sync     ON dbo.OrdenTrabajo(RowVersion);
CREATE INDEX IX_VtaG_Sync   ON dbo.VentaGrano(RowVersion);
CREATE INDEX IX_Cheque_Sync ON dbo.Cheque(RowVersion);
GO

PRINT 'AgroCore: schema creado correctamente.';
GO
