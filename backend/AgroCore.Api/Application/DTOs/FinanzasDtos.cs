namespace AgroCore.Application.DTOs;

// ---- Grano -----------------------------------------------------------------
public record StockGranoDto(int StockGranoId, int SiloId, string SiloDescripcion, int CultivoId, string CultivoNombre, int? CampanaId, decimal Kilogramos, decimal? HumedadPromedio);
public record MovimientoGranoCreateDto(int SiloId, int CultivoId, int? CampanaId, DateTime Fecha, string Tipo, decimal Kilogramos, decimal? Humedad, decimal? Impureza, string? NumeroCartaPorte, int? ClienteId, int? SiloDestinoId, int? ViajeCamionId, string? Observaciones);

// ---- Hacienda --------------------------------------------------------------
public record HaciendaDto(int HaciendaId, string? CaravanaSenasa, string Categoria, string? Raza, decimal? PesoActualKg, string Estado);
public record MovimientoHaciendaCreateDto(DateTime Fecha, string Tipo, string? Categoria, int Cantidad, decimal? PesoTotalKg, int? CampoOrigenId, int? CampoDestinoId, int? ClienteId, int? ProveedorId, string? Dte, string? Observaciones);

// ---- Ventas ----------------------------------------------------------------
public record VentaGranoCreateDto(int ClienteId, int CultivoId, int? SiloId, DateTime Fecha, string? NumeroContrato, decimal Kilogramos, decimal PrecioUnitarioPorTn, byte MonedaId, decimal TipoCambio, decimal Comisiones, decimal Fletes, decimal Retenciones, decimal Iva, string? MedioPago, string? Observaciones);
public record VentaHaciendaCreateDto(int ClienteId, DateTime Fecha, string? NumeroRemito, int Cantidad, string? Categoria, decimal PesoTotalKg, decimal PrecioUnitarioPorKg, byte MonedaId, decimal TipoCambio, decimal Comisiones, decimal Fletes, string? MedioPago, string? Observaciones);
public record VentaPymeCreateDto(int? ClienteId, DateTime Fecha, string Concepto, decimal Cantidad, decimal PrecioUnitario, byte MonedaId, decimal TipoCambio, decimal Iva, string? MedioPago, string? Observaciones);

// ---- Tesorería -------------------------------------------------------------
public record MovimientoCajaDto(int MovimientoCajaId, DateTime Fecha, string Tipo, string? MedioPago, string? Concepto, byte MonedaId, decimal TipoCambio, decimal Importe, decimal ImporteArs);
public record MovimientoCajaCreateDto(DateTime Fecha, string Tipo, string? MedioPago, int? CuentaOrigenId, int? CuentaDestinoId, int? CategoriaId, byte MonedaId, decimal TipoCambio, decimal Importe, string? Concepto, int? ProveedorId, int? ClienteId, int? EmpleadoId, int? ChequeId, int? ComprobanteId, string? Observaciones);

public record ChequeDto(int ChequeId, string Tipo, string Numero, string? Banco, string? Titular, DateTime FechaEmision, DateTime FechaVencimiento, byte MonedaId, decimal Importe, string Estado);
public record ChequeCreateDto(string Tipo, string Numero, string? Banco, string? Sucursal, string? Titular, string? CuitTitular, DateTime FechaEmision, DateTime FechaVencimiento, byte MonedaId, decimal Importe, int? ClienteOrigenId, string? Observaciones);
public record ChequeCambioEstadoDto(string NuevoEstado, DateTime? Fecha, int? ProveedorEndosadoId, string? Observaciones);

public record CuentaCorrienteDto(int CuentaCorrienteId, string Tipo, int? ClienteId, int? ProveedorId, string Contraparte, byte MonedaId, decimal Saldo);
public record CuentaMovimientoDto(int CuentaMovimientoId, DateTime Fecha, string Tipo, string Concepto, decimal Importe, string? NumeroComprobante);
public record CuentaMovimientoCreateDto(int CuentaCorrienteId, DateTime Fecha, string Tipo, string Concepto, decimal Importe, string? NumeroComprobante, int? ComprobanteId, int? MovimientoCajaId);

// ---- Contratos / Empleados / Viajes ---------------------------------------
public record ContratoDto(int ContratoArrendamientoId, int CampoId, string CampoNombre, string NumeroContrato, string ArrendadorNombre, string TipoContrato, DateTime FechaInicio, DateTime FechaFin, decimal SuperficieHa, byte MonedaId, bool Activo);
public record ContratoCreateDto(int CampoId, string NumeroContrato, string ArrendadorNombre, string? ArrendadorCuit, string TipoContrato, DateTime FechaInicio, DateTime FechaFin, decimal SuperficieHa, decimal? ValorHa, decimal? QuintalesPorHa, int? CultivoReferenciaId, decimal? PorcentajeGanancia, byte MonedaId, string? FrecuenciaPago, string? Observaciones);

public record EmpleadoDto(int EmpleadoId, string Legajo, string Apellido, string Nombre, string? Puesto, decimal? SueldoBasico, byte MonedaId, bool Activo);
public record EmpleadoCreateDto(string Legajo, string Apellido, string Nombre, string? Dni, string? Cuil, DateTime? FechaIngreso, string? Puesto, string? Categoria, decimal? SueldoBasico, byte MonedaId, string? Telefono, string? Email, string? Direccion);

public record ViajeCamionDto(int ViajeCamionId, DateTime Fecha, string? NumeroCartaPorte, string? DominioTractor, string? ChoferNombre, string? TransportistaRazonSocial, int? ClienteId, string? ClienteNombre, int? CultivoId, string? CultivoNombre, decimal? KgOrigen, decimal? KgDestino, decimal? Merma, string Estado);
public record ViajeCamionCreateDto(DateTime Fecha, string? NumeroCartaPorte, string? DominioTractor, string? DominioAcoplado, string? ChoferNombre, string? ChoferCuil, string? TransportistaRazonSocial, string? TransportistaCuit, int? OrigenCampoId, string? DestinoRazonSocial, string? DestinoPlanta, int? ClienteId, int? CultivoId, decimal? KgOrigen, decimal? TarifaKm, decimal? TarifaTn, byte MonedaId, string? Observaciones);

// ---- Comprobantes ----------------------------------------------------------
public record ComprobanteDto(int ComprobanteId, byte ComprobanteTipoId, string TipoNombre, int PuntoVentaId, int PuntoVentaNumero, long Numero, DateTime Fecha, int? ClienteId, int? ProveedorId, byte MonedaId, decimal Total, string Estado, string? Cae);
public record ComprobanteCreateDto(byte ComprobanteTipoId, int PuntoVentaId, DateTime Fecha, int? ClienteId, int? ProveedorId, string? CuitContraparte, string? CondicionIvaContraparte, byte MonedaId, decimal TipoCambio, List<ComprobanteDetalleCreateDto> Detalles, string? Observaciones);
public record ComprobanteDetalleCreateDto(string Descripcion, decimal Cantidad, decimal PrecioUnitario, decimal AlicuotaIva);

// ---- Dashboard / Analítica -------------------------------------------------
public record DashboardDto(
    int CampanasActivas,
    decimal SuperficieTotalHa,
    decimal StockGranoKg,
    int CabezasHacienda,
    decimal SaldoCajaArs,
    decimal SaldoCajaUsd,
    decimal ChequesACobrarArs,
    decimal ChequesACobrarUsd,
    decimal DeudaProveedoresArs,
    int AlertasStockBajo,
    List<MargenBrutoDto> TopCampanas);

public record MargenBrutoDto(
    int CampanaId, string CampanaNombre, string CultivoNombre, decimal SuperficieHa,
    decimal IngresoArs, decimal CostoDirectoArs, decimal CostoArrendamientoArs, decimal MargenBrutoArs,
    decimal MargenBrutoPorHa, decimal? RendimientoKgHa, string Moneda);
