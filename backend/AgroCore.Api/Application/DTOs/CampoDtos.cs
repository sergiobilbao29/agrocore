namespace AgroCore.Application.DTOs;

// ---- Campo / Lote ----------------------------------------------------------
public record CampoDto(int CampoId, string Codigo, string Nombre, decimal SuperficieTotalHa, string? Localidad, string? Provincia, string? Renspa, bool Propio, bool Activo);
public record CampoCreateDto(string Codigo, string Nombre, decimal SuperficieTotalHa, string? Localidad, string? Provincia, string? Renspa, string? GeoJson, bool Propio);
public record CampoUpdateDto(string Nombre, decimal SuperficieTotalHa, string? Localidad, string? Provincia, string? Renspa, string? GeoJson, bool Propio, bool Activo);

public record LoteDto(int LoteId, int CampoId, string Codigo, string Nombre, decimal SuperficieHa, string? TipoSuelo, string? Aptitud, bool Activo, string? CampanaActual);
public record LoteCreateDto(int CampoId, string Codigo, string Nombre, decimal SuperficieHa, string? GeoJson, string? TipoSuelo, string? Aptitud);
public record LoteUpdateDto(string Nombre, decimal SuperficieHa, string? GeoJson, string? TipoSuelo, string? Aptitud, bool Activo);

// ---- Campaña ---------------------------------------------------------------
public record CampanaDto(
    int CampanaId, int LoteId, string LoteNombre, int CultivoId, string CultivoNombre,
    string Nombre, DateTime? FechaSiembra, DateTime? FechaCosechaEstimada, DateTime? FechaCosechaReal,
    decimal SuperficieSembradaHa, decimal? RendimientoEstimadoKgHa, decimal? RendimientoRealKgHa,
    decimal? KgCosechadosTotales, string Estado, decimal CostoAcumuladoArs, decimal CostoAcumuladoUsd);

public record CampanaCreateDto(int LoteId, int CultivoId, string Nombre, DateTime? FechaSiembra, DateTime? FechaCosechaEstimada, decimal SuperficieSembradaHa, decimal? RendimientoEstimadoKgHa, string? Observaciones);

public record CampanaUpdateDto(string Nombre, DateTime? FechaSiembra, DateTime? FechaCosechaEstimada, DateTime? FechaCosechaReal, decimal SuperficieSembradaHa, decimal? RendimientoEstimadoKgHa, decimal? RendimientoRealKgHa, decimal? KgCosechadosTotales, decimal? HumedadPromedio, string Estado, string? Observaciones);

// ---- Insumos / Compras -----------------------------------------------------
public record InsumoDto(int InsumoId, string Codigo, string Nombre, string TipoInsumo, string UnidadMedida, decimal StockActual, decimal StockMinimo, decimal? CostoPromedio, byte MonedaCostoId, bool Activo);
public record InsumoCreateDto(string Codigo, string Nombre, string TipoInsumo, string UnidadMedida, string? Marca, decimal StockMinimo, byte MonedaCostoId);
public record InsumoUpdateDto(string Nombre, string UnidadMedida, string? Marca, decimal StockMinimo, byte MonedaCostoId, bool Activo);

public record CompraInsumoDto(int CompraInsumoId, int ProveedorId, string ProveedorNombre, DateTime Fecha, string? NumeroComprobante, byte MonedaId, decimal TipoCambio, decimal Total, List<CompraInsumoDetalleDto> Detalles);
public record CompraInsumoDetalleDto(int CompraInsumoDetalleId, int InsumoId, string InsumoNombre, decimal Cantidad, decimal PrecioUnitario, decimal Descuento, decimal Subtotal);
public record CompraInsumoCreateDto(int ProveedorId, DateTime Fecha, string? NumeroComprobante, string? TipoComprobante, byte MonedaId, decimal TipoCambio, decimal Percepciones, string? MedioPago, string? Observaciones, List<CompraInsumoDetalleCreateDto> Detalles);
public record CompraInsumoDetalleCreateDto(int InsumoId, decimal Cantidad, decimal PrecioUnitario, decimal Descuento);

// ---- Órdenes de Trabajo ----------------------------------------------------
public record OrdenTrabajoDto(int OrdenTrabajoId, string Numero, int LoteId, string LoteNombre, int? CampanaId, string? CampanaNombre, string TipoLabor, DateTime FechaPlanificada, DateTime? FechaInicio, DateTime? FechaFin, decimal SuperficieHa, string Estado, int? MaquinariaId, string? MaquinariaNombre, int? OperarioId, string? OperarioNombre, decimal? CostoTotalArs, decimal? CostoTotalUsd);

public record OrdenTrabajoDetalleDto(OrdenTrabajoDto Cabecera, List<OrdenTrabajoInsumoDto> Insumos, List<OrdenTrabajoCostoDto> Costos);

public record OrdenTrabajoInsumoDto(int OrdenTrabajoInsumoId, int InsumoId, string InsumoNombre, string Unidad, decimal PlanCantidad, decimal? RealCantidad, decimal? PlanCostoUnitario, decimal? RealCostoUnitario, byte MonedaId);
public record OrdenTrabajoCostoDto(int OrdenTrabajoCostoId, string Concepto, decimal Cantidad, decimal PrecioUnitario, byte MonedaId, decimal TipoCambio, decimal ImporteTotal);

public record OrdenTrabajoCreateDto(int LoteId, int? CampanaId, int? MaquinariaId, int? OperarioId, string TipoLabor, DateTime FechaPlanificada, decimal SuperficieHa, string? ObservacionesPlan, List<OrdenTrabajoInsumoCreateDto> Insumos, List<OrdenTrabajoCostoCreateDto> Costos);
public record OrdenTrabajoInsumoCreateDto(int InsumoId, decimal PlanCantidad, decimal? PlanCostoUnitario, byte MonedaId);
public record OrdenTrabajoCostoCreateDto(string Concepto, decimal Cantidad, decimal PrecioUnitario, byte MonedaId, decimal TipoCambio);

public record OrdenTrabajoEjecutarDto(DateTime FechaInicio, DateTime? FechaFin, decimal? HorasMaquina, decimal? LitrosCombustible, decimal? VelocidadKmH, decimal? DosisPorHa, string? CondicionesClimaticas, string? ObservacionesReal, string? GeoJsonTraza, List<OrdenTrabajoInsumoEjecutarDto> InsumosReales, List<OrdenTrabajoCostoCreateDto>? CostosAdicionales);
public record OrdenTrabajoInsumoEjecutarDto(int OrdenTrabajoInsumoId, decimal RealCantidad, decimal? RealCostoUnitario);
